// Session et visiteur — deux populations distinctes, souvent confondues.
//
// VISITEUR = une installation. Identifiant aléatoire, app-scopé, persistant.
// Jamais un identifiant publicitaire, jamais un identifiant d'appareil, jamais
// un e-mail, jamais une empreinte matérielle : ces valeurs survivent à la
// désinstallation et traversent les applications, ce qui en fait un traceur
// inter-applicatif — exactement ce qu'un consentement ne couvre pas.
//
// SESSION = une visite. Elle tourne au lancement, et à la reprise après une
// inactivité prolongée. Elle NE tourne PAS parce que l'utilisateur a consulté
// une notification pendant deux secondes : facturer une visite à chaque retour
// au premier plan multiplie artificiellement le nombre de sessions et fait
// s'effondrer toutes les métriques par session.
//
// L'inactivité se mesure sur l'horloge MONOTONE. Une horloge murale qui recule
// — fuseau, NTP, réglage manuel — produirait sinon une inactivité négative, donc
// jamais de rotation ; et un saut en avant en produirait une fausse.
import { hexDepuis, type ClockAdapter, type RandomAdapter } from "./adapters";

/** Défaut : 30 minutes, comme la convention des outils de mesure d'audience. */
export const INACTIVITE_DEFAUT_MS = 30 * 60_000;
/** Bornes de la configuration applicative. En dessous d'une minute, toute */
/** notification consultée créerait une visite ; au-delà de quatre heures, une */
/** « visite » ne décrit plus rien d'observable. */
export const INACTIVITE_MIN_MS = 60_000;
export const INACTIVITE_MAX_MS = 4 * 60 * 60_000;

export function resoudreInactivite(valeur: unknown): number {
  const n = typeof valeur === "number" && Number.isFinite(valeur) ? Math.floor(valeur) : INACTIVITE_DEFAUT_MS;
  return Math.min(Math.max(n, INACTIVITE_MIN_MS), INACTIVITE_MAX_MS);
}

/** D'où vient l'identifiant de visiteur — repris tel quel par les diagnostics. */
export type PersistanceIdentite = "storage" | "memory";

export class SessionManager {
  private sessionId: string;
  /** Dernière activité observée, sur l'horloge monotone. */
  private derniereActivite: number;
  /** Instant du passage en arrière-plan, ou `null` si l'app est au premier plan. */
  private sortiPremierPlan: number | null = null;

  constructor(
    private random: RandomAdapter,
    private clock: ClockAdapter,
    private inactiviteMs: number,
  ) {
    this.sessionId = hexDepuis(random, 16);
    this.derniereActivite = clock.nowMs();
  }

  get id(): string {
    return this.sessionId;
  }

  /** Rotation explicite : changement d'identité métier, comme en P2. */
  rotate(): string {
    this.sessionId = hexDepuis(this.random, 16);
    this.derniereActivite = this.clock.nowMs();
    return this.sessionId;
  }

  /**
   * Appelé avant chaque événement. Tourne la session si l'inactivité dépasse le
   * seuil, puis enregistre l'activité. Rend `true` si la session a tourné.
   */
  touch(): boolean {
    const maintenant = this.clock.nowMs();
    const inactif = maintenant - this.derniereActivite;
    if (inactif >= this.inactiviteMs) {
      this.sessionId = hexDepuis(this.random, 16);
      this.derniereActivite = maintenant;
      return true;
    }
    this.derniereActivite = maintenant;
    return false;
  }

  /**
   * Cycle de vie. L'arrière-plan note l'instant ; le retour au premier plan
   * compare. Une bascule de deux secondes ne tourne rien — c'est tout l'objet
   * de cette méthode.
   */
  cycleDeVie(etat: "active" | "background" | "inactive"): boolean {
    const maintenant = this.clock.nowMs();
    if (etat !== "active") {
      if (this.sortiPremierPlan == null) this.sortiPremierPlan = maintenant;
      return false;
    }
    const depuis = this.sortiPremierPlan;
    this.sortiPremierPlan = null;
    if (depuis == null) return false;
    if (maintenant - depuis < this.inactiviteMs) {
      // Retour rapide : la visite continue. On recale simplement l'activité,
      // pour que le temps passé en arrière-plan ne compte pas comme inactivité.
      this.derniereActivite = maintenant;
      return false;
    }
    this.sessionId = hexDepuis(this.random, 16);
    this.derniereActivite = maintenant;
    return true;
  }
}

/**
 * Tire un identifiant de visiteur. 16 octets d'aléa : assez pour qu'une
 * collision entre deux installations soit hors de portée, trop peu pour porter
 * la moindre information sur l'appareil.
 */
export function nouveauVisiteur(random: RandomAdapter): string {
  return hexDepuis(random, 16);
}
