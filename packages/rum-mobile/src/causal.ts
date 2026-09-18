// Fenêtre causale React Native — même contrat que P3 côté web, adapté aux
// promesses et aux interactions RN.
//
// CE QU'ELLE PROMET. Un signal émis PENDANT la fenêtre d'une action acceptée
// porte l'identifiant de cette action. Tout le reste ne porte rien.
//
// CE QU'ELLE NE FAIT PAS, ET POURQUOI. Elle ne devine jamais « le dernier clic ».
// Un travail asynchrone démarré après la fermeture de la fenêtre reste NON
// ATTRIBUÉ : rattacher une requête lancée trente secondes après un appui, au
// motif qu'aucune autre action n'a eu lieu entre-temps, inventerait une
// causalité que rien n'a observée — et le ferait d'autant plus souvent que
// l'utilisateur est inactif.
//
// L'ADAPTATION AUX PROMESSES est la seule différence de fond avec le web. Sur
// le web, la fenêtre est un simple délai : cinq secondes après le clic, on
// arrête d'attribuer. Sur mobile, un `onPress` rend très souvent une promesse
// (`async () => { await api.payer(); }`), et cette promesse EST la preuve
// observée que le travail appartient encore à l'appui. Tant qu'elle est en vol,
// la fenêtre est MAINTENUE — jusqu'à un plafond dur, parce qu'une promesse qui
// ne se résout jamais ne doit pas maintenir une attribution indéfinie.
//
// L'horloge est MONOTONE : une fenêtre de cinq secondes mesurée sur une horloge
// murale qui recule ne se fermerait jamais.

/** Fenêtre de base, identique à `ACTION_WINDOW_MS` du SDK web (P3). */
export const FENETRE_CAUSALE_MS = 5_000;

/**
 * Plafond du maintien par promesse. Au-delà, la promesse est traitée comme
 * perdue : l'attribution s'arrête, la promesse elle-même n'est ni annulée ni
 * signalée — ce n'est pas notre rôle.
 */
export const MAINTIEN_MAX_MS = 30_000;

/**
 * Type d'action tel que l'ingestion l'accepte (`ACTION_TYPES` dans `otlp.mjs`).
 * `press` n'existe pas côté serveur : un appui sur un Pressable est le geste
 * primaire de l'interface, donc un `click` au sens de la table `rum_action`.
 */
export type TypeAction = "click" | "manual";

export interface OptionsFenetre {
  /** Horloge MONOTONE en millisecondes. */
  now(): number;
  /** Session courante : une racine ne survit pas à une rotation. */
  sessionId(): string;
  /** Époque de consentement : une racine ne survit pas à une révocation. */
  epoch(): number;
  /** Identifiant d'action. */
  newId(): string;
  /**
   * Émet la racine. Rend `true` seulement si la gate de consentement ET le hook
   * `beforeSend` l'ont acceptée — c'est cette valeur, et elle seule, qui décide
   * si les signaux suivants porteront l'identifiant.
   */
  emitRoot(id: string, name: string, type: TypeAction): boolean;
  fenetreMs?: number;
  maintienMaxMs?: number;
}

interface Racine {
  id: string;
  ouverteA: number;
  sessionId: string;
  epoch: number;
  acceptee: boolean;
  /** Instant monotone limite du maintien par promesse, ou `null`. */
  maintenueJusqua: number | null;
  /** Promesses encore en vol rattachées à cette racine. */
  enVol: number;
}

export class FenetreCausale {
  private racine: Racine | null = null;
  private readonly fenetreMs: number;
  private readonly maintienMaxMs: number;

  constructor(private readonly options: OptionsFenetre) {
    this.fenetreMs = options.fenetreMs ?? FENETRE_CAUSALE_MS;
    this.maintienMaxMs = options.maintienMaxMs ?? MAINTIEN_MAX_MS;
  }

  /**
   * Ouvre une racine et l'émet. Rend son identifiant si elle a été acceptée,
   * `null` sinon.
   *
   * Une nouvelle racine REMPLACE la précédente, acceptée ou non : deux appuis
   * rapprochés appartiennent à deux intentions, et attribuer les effets du
   * second au premier serait pire que de ne rien attribuer.
   */
  ouvrir(nom: string, type: TypeAction): string | null {
    const id = this.options.newId();
    const racine: Racine = {
      id,
      ouverteA: this.options.now(),
      sessionId: this.options.sessionId(),
      epoch: this.options.epoch(),
      acceptee: false,
      maintenueJusqua: null,
      enVol: 0,
    };
    // La racine est posée AVANT l'émission : le span racine lui-même porte déjà
    // `mip.action_id`, et un signal émis par un `beforeSend` réentrant verrait
    // sinon l'action précédente.
    this.racine = racine;
    racine.acceptee = this.options.emitRoot(id, nom, type) === true;
    return racine.acceptee ? id : null;
  }

  /**
   * Identifiant à porter par un signal émis MAINTENANT, ou `null`.
   *
   * `null` couvre tout ce qui n'est pas prouvé : aucune racine, racine refusée
   * par la gate ou par le hook, fenêtre expirée, session tournée, consentement
   * révoqué.
   */
  courante(at: number = this.options.now()): string | null {
    const racine = this.racine;
    if (!racine || !racine.acceptee) return null;
    if (racine.sessionId !== this.options.sessionId()) return null;
    if (racine.epoch !== this.options.epoch()) return null;
    if (at < racine.ouverteA) return null;
    if (at - racine.ouverteA <= this.fenetreMs) return racine.id;
    // Hors fenêtre de base : seul un maintien EXPLICITE par promesse prolonge.
    if (racine.maintenueJusqua != null && at <= racine.maintenueJusqua) return racine.id;
    return null;
  }

  /**
   * Rattache une valeur rendue par un gestionnaire d'interaction. Si c'est une
   * promesse, la fenêtre est maintenue jusqu'à son règlement.
   *
   * On ne consomme pas la promesse : `then` sert d'observateur, et le rejet est
   * RÉ-IGNORÉ (`catch` vide sur une dérivation) pour ne pas transformer un rejet
   * déjà non géré de l'application en rejet géré — sinon notre observation
   * ferait disparaître l'erreur que l'application aurait vue sans nous.
   */
  suivre(resultat: unknown): void {
    const racine = this.racine;
    if (!racine || !racine.acceptee) return;
    const then = (resultat as { then?: unknown } | null | undefined)?.then;
    if (typeof then !== "function") return;
    racine.enVol++;
    const limite = racine.ouverteA + this.maintienMaxMs;
    racine.maintenueJusqua = racine.maintenueJusqua == null
      ? limite
      : Math.max(racine.maintenueJusqua, limite);
    const regle = () => {
      if (--racine.enVol > 0) return;
      // Le règlement referme le maintien ; la fenêtre de base, si elle court
      // encore, continue de s'appliquer.
      racine.maintenueJusqua = null;
    };
    try {
      then.call(resultat, regle, regle);
    } catch {
      // Un « thenable » hostile : on renonce au maintien plutôt que de propager.
      racine.enVol--;
      racine.maintenueJusqua = null;
    }
  }

  /**
   * Ferme la fenêtre courante. Appelée à chaque navigation et à chaque rotation
   * d'identité : un écran qui change met fin à l'intention de l'appui
   * précédent, et ce qui suit appartient au nouvel écran.
   */
  fermer(): void {
    this.racine = null;
  }

  /** Vrai si une racine acceptée est encore attribuable — pour les diagnostics. */
  get active(): boolean {
    return this.courante() != null;
  }
}
