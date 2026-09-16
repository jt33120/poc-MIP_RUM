// Consent mode RGPD (LIMITES §3) : tant que le consentement n'est pas donné,
// aucun span n'est créé (donc aucune requête réseau) — les événements sont
// bufferisés en mémoire et rejoués à consent(true), purgés à consent(false).
import type { AttrValue, Emit } from "./errors";

export const CONSENT_BUFFER_CAP = 200;

type ConsentState = "granted" | "pending" | "denied";

interface BufferedEvent {
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

  /** consent(true) : rejoue le buffer (timestamps d'origine) ; consent(false) : purge + désactive. */
  set(granted: boolean, deliver: Emit): void {
    if (granted) {
      this.state = "granted";
      const pending = this.buffer;
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
