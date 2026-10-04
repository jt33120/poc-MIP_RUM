// RGPD (LIMITES §3) : sans consentement, aucun span ni requête réseau ; les
// événements attendent en mémoire, rejoués à consent(true), purgés à consent(false).
import type { AttrValue, Emit } from "./errors";

export const CONSENT_BUFFER_CAP = 200;

// L'article 82 de la loi Informatique et Libertés vise toute lecture ou écriture
// sur le terminal, stockage local compris : avec `requireConsent`, chaque module
// interroge cet interrupteur avant d'y toucher (finding 1.11).
let accesTerminal = true;

/** Le SDK peut-il lire ou écrire le stockage local du navigateur ? */
export function accesTerminalAutorise(): boolean {
  return accesTerminal;
}

export function autoriserAccesTerminal(autorise: boolean): void {
  accesTerminal = autorise;
}

/**
 * Clés que le SDK pose sur le terminal, hors file de rejeu (purgée par `retry.ts`).
 * Une clé absente d'ici survivrait à un refus.
 */
export const CLE_SESSION = "mip_rum_session";
export const CLE_VISITEUR = "mip_rum_visitor";
export const CLE_ECHANTILLONNAGE = "mip_rum_sampling";
export const CLE_SEQUENCE = "mip_rum_seq";
export const CLES_TERMINAL = [CLE_SESSION, CLE_VISITEUR, CLE_ECHANTILLONNAGE, CLE_SEQUENCE] as const;
/** Période de silence du widget d'avis, une clé par application (mip-rum-feedback.js). */
export const PREFIXE_AVIS = "mip_rum_feedback_last:";

/** Efface ce que le SDK et son widget d'avis ont posé sur le terminal (refus de consentement). */
export function effacerTerminal(): void {
  const cles: string[] = [...CLES_TERMINAL];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const cle = localStorage.key(i);
      if (cle?.startsWith(PREFIXE_AVIS)) cles.push(cle);
    }
  } catch {
    /* stockage sans énumération : les clés fixes suffisent */
  }
  for (const cle of cles) {
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
   * Livre l'événement si consenti, le retient si en attente, le jette si refusé.
   * Retourne false seulement s'il est jeté : le widget d'avis n'affiche alors pas « envoyé ».
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
    // Un enfant sans sa racine dans le tampon est délié ; vérifié APRÈS l'éviction,
    // qui a pu retirer la racine.
    if (actionId && !isRoot && !this.hasBufferedRoot(actionId)) {
      bufferedAttrs = { ...attrs };
      delete bufferedAttrs["mip.action_id"];
    }
    this.buffer.push({ name, attrs: bufferedAttrs, ts: ts ?? Date.now() });
    return true;
  }

  /**
   * true : rejoue le tampon à ses horodatages d'origine ; false : purge et désactive.
   * `retenir` filtre le tampon avant le rejeu, pour les décisions que seul l'accord
   * permet (échantillonnage, session reprise du stockage).
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
