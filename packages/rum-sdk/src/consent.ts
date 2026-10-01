// Consent mode RGPD (LIMITES §3) : tant que le consentement n'est pas donné,
// aucun span n'est créé (donc aucune requête réseau) — les événements sont
// bufferisés en mémoire et rejoués à consent(true), purgés à consent(false).
import type { AttrValue, Emit } from "./errors";

export const CONSENT_BUFFER_CAP = 200;

// ═══════════════════════ Le terminal, sous le même accord ═══════════════════════
//
// Finding 1.11 de docs/AUDIT_RUM_EXTERNE.md. La barrière ci-dessous ne retenait que
// le RÉSEAU : l'identifiant de session, celui du visiteur et le mode
// d'échantillonnage étaient écrits dans le stockage local AVANT elle, et
// survivaient au refus. Or l'article 82 de la loi Informatique et Libertés vise
// toute lecture ou écriture sur le terminal, stockage local compris.
//
// Désormais, avec `requireConsent`, aucun module du SDK ne lit ni n'écrit le
// stockage local tant que l'accord manque : ils interrogent tous cet
// interrupteur. Un refus le referme, et efface ce que le SDK avait posé.
// Sans `requireConsent`, il reste ouvert du début à la fin : rien ne change.
let accesTerminal = true;

/** Le SDK peut-il lire ou écrire le stockage local du navigateur ? */
export function accesTerminalAutorise(): boolean {
  return accesTerminal;
}

export function autoriserAccesTerminal(autorise: boolean): void {
  accesTerminal = autorise;
}

/**
 * Tout ce que le SDK pose sur le terminal, hors file de rejeu (`retry.ts` la
 * purge lui-même : ses clés sont lues par ses propres tests). Une clé ajoutée
 * ailleurs sans figurer ici survivrait à un refus.
 */
export const CLE_SESSION = "mip_rum_session";
export const CLE_VISITEUR = "mip_rum_visitor";
export const CLE_ECHANTILLONNAGE = "mip_rum_sampling";
export const CLE_SEQUENCE = "mip_rum_seq";
export const CLES_TERMINAL = [CLE_SESSION, CLE_VISITEUR, CLE_ECHANTILLONNAGE, CLE_SEQUENCE] as const;

/** Efface ce que le SDK a posé sur le terminal (refus de consentement). */
export function effacerTerminal(): void {
  for (const cle of CLES_TERMINAL) {
    try {
      localStorage.removeItem(cle);
    } catch {
      /* stockage indisponible : rien n'y a été écrit */
    }
  }
}

type ConsentState = "granted" | "pending" | "denied";

/** Un événement retenu en attendant l'accord, tel qu'il sera rejoué. */
export interface BufferedEvent {
  name: string;
  attrs: Record<string, AttrValue>;
  ts: number; // horodatage d'origine, réutilisé au rejeu
}

export class ConsentGate {
  private state: ConsentState;
  private buffer: BufferedEvent[] = [];
  private revokedRoots = new Set<string>();

  constructor(
    requireConsent: boolean,
    private capacity: number = CONSENT_BUFFER_CAP,
  ) {
    this.state = requireConsent ? "pending" : "granted";
  }

  get granted(): boolean {
    return this.state === "granted";
  }

  bufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Passe l'événement si consenti, le bufferise si en attente, le jette si refusé.
   *
   * Retourne true quand l'événement est PRIS EN CHARGE — livré, ou bufferisé
   * pour être rejoué au consentement. false uniquement quand il est jeté.
   * L'appelant peut ainsi savoir si un envoi a réellement eu lieu : le widget
   * d'avis s'en sert pour ne pas afficher « envoyé » sur un événement perdu,
   * ni armer sa période de silence sur un avis qui n'est jamais parti.
   */
  submit(name: string, attrs: Record<string, AttrValue>, deliver: Emit, ts?: number): boolean {
    const actionId = typeof attrs["mip.action_id"] === "string" ? attrs["mip.action_id"] : null;
    const isRoot = name === "rum.action" && attrs["mip.event_type"] === "action";
    if (this.state === "granted") {
      let deliveredAttrs = attrs;
      if (isRoot && actionId) this.revokedRoots.delete(actionId);
      else if (actionId && this.revokedRoots.has(actionId)) {
        deliveredAttrs = { ...attrs };
        delete deliveredAttrs["mip.action_id"];
      }
      deliver(name, deliveredAttrs, ts);
      return true;
    }
    if (this.state === "denied") return false;
    let bufferedAttrs = attrs;

    if (this.buffer.length >= this.capacity) {
      const evicted = this.buffer.shift(); // FIFO : on garde le plus récent
      const evictedId = evicted && this.rootActionId(evicted);
      if (evictedId) {
        this.revokedRoots.add(evictedId);
        this.buffer = this.buffer.filter((event) => event.attrs["mip.action_id"] !== evictedId);
      }
    }
    // En attente de consentement, aucun enfant ne peut survivre sans sa racine
    // dans le même buffer. On vérifie APRÈS l'éviction FIFO : si celle-ci vient
    // de retirer la racine, l'effet reste collectable mais devient non lié.
    if (actionId && !isRoot && !this.hasBufferedRoot(actionId)) {
      bufferedAttrs = { ...attrs };
      delete bufferedAttrs["mip.action_id"];
    }
    this.buffer.push({ name, attrs: bufferedAttrs, ts: ts ?? Date.now() });
    return true;
  }

  /**
   * consent(true) : rejoue le buffer (timestamps d'origine) ; consent(false) : purge + désactive.
   *
   * `retenir` voit le tampon entier avant le rejeu. Il sert aux décisions que
   * l'accord seul permet de prendre — le mode d'échantillonnage, l'identifiant de
   * session repris du stockage — et qui portent sur la page entière.
   */
  set(
    granted: boolean,
    deliver: Emit,
    retenir?: (tampon: readonly BufferedEvent[]) => readonly BufferedEvent[],
  ): void {
    if (granted) {
      this.state = "granted";
      const pending = retenir ? retenir(this.buffer) : this.buffer;
      this.buffer = [];
      for (const e of pending) deliver(e.name, e.attrs, e.ts);
    } else {
      this.state = "denied";
      this.buffer = [];
      this.revokedRoots.clear();
    }
  }

  private rootActionId(event: BufferedEvent): string | null {
    const id = event.attrs["mip.action_id"];
    return event.name === "rum.action" && event.attrs["mip.event_type"] === "action" && typeof id === "string"
      ? id
      : null;
  }

  private hasBufferedRoot(actionId: string): boolean {
    return this.buffer.some((event) => this.rootActionId(event) === actionId);
  }
}
