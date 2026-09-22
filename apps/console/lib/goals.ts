// Objectifs & conversions — logique PURE et testée (Lot 8b). Un objectif matche
// une valeur (route pour un objectif de page vue, nom d'événement pour un objectif
// d'événement) selon son type de correspondance. Le SQL (queries-goals) reflète
// cette définition ; ici c'est la référence + le taux de conversion.
import { FAIBLE_SOUS_PROPORTION } from "./stats/incertitude";

export type GoalKind = "pageview" | "event";
export type MatchType = "exact" | "contains";

export interface GoalDef {
  id: number;
  app_id: string;
  name: string;
  kind: GoalKind;
  pattern: string;
  match_type: MatchType;
  active: boolean;
}

/** Une valeur (route ou nom d'événement) satisfait-elle la condition ? */
export function goalMatches(matchType: MatchType, pattern: string, value: string): boolean {
  return matchType === "exact" ? value === pattern : value.includes(pattern);
}

/**
 * Taux de conversion (0..1). `null` sans session : sans dénominateur il n'y a pas
 * de taux, et « 0 % » se lirait « personne n'a converti » sur une fenêtre vide.
 */
export function conversionRate(conversions: number, sessions: number): number | null {
  return sessions > 0 ? conversions / sessions : null;
}

export interface GoalConversion extends GoalDef {
  conversions: number; // sessions ayant satisfait l'objectif
  rate: number | null; // conversions / sessions de la fenêtre ; null sans session
}

// ═══════════════════════ Lecture de l'écran (F66, § 5.14) ═══════════════════════
//
// L'intervalle de Wilson de chaque taux est celui de P*.1 (`intervalleWilson`,
// lib/stats/incertitude.ts) : une seule implémentation pour toute la console.

/** « page vue = /merci », « événement contient checkout » : la condition, en mots. */
export function libelleCondition(g: Pick<GoalDef, "kind" | "match_type" | "pattern">): string {
  return `${g.kind === "event" ? "événement" : "page vue"} ${g.match_type === "contains" ? "contient" : "="} ${g.pattern}`;
}

/**
 * Échantillon faible (P3) : moins de 30 conversions OU moins de 30 non-conversions.
 * Un taux de 2 sur 5 comme un taux de 498 sur 500 se départage mal d'un voisin :
 * l'intervalle est large d'un côté ou de l'autre. Sans session, pas de taux :
 * rien à qualifier.
 */
export function echantillonFaibleObjectif(conversions: number, sessions: number): boolean {
  if (!(sessions > 0)) return false;
  return conversions < FAIBLE_SOUS_PROPORTION || sessions - conversions < FAIBLE_SOUS_PROPORTION;
}

/**
 * Ordre du classement (G3) : taux décroissant ; les échantillons faibles en fin
 * (deux taux proches ne s'y départagent pas) ; les taux inconnus (aucune session
 * dans l'app de l'objectif) tout en bas, jamais classés comme « 0 % ».
 */
export function classerObjectifs<T extends { rate: number | null; conversions: number; sessions: number; name: string }>(
  rows: readonly T[],
): T[] {
  const rang = (g: T) => (g.rate == null ? 2 : echantillonFaibleObjectif(g.conversions, g.sessions) ? 1 : 0);
  return [...rows].sort(
    (a, b) => rang(a) - rang(b) || (b.rate ?? 0) - (a.rate ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/** Le meilleur taux (tuile) : le premier taux CONNU dans l'ordre du classement du hero. */
export function meilleurObjectif<T extends { rate: number | null; conversions: number; sessions: number; name: string }>(
  rows: readonly T[],
): T | null {
  return classerObjectifs(rows).find((g) => g.rate != null) ?? null;
}

/**
 * L'effectif d'un taux tel que `KpiTile.couverture` le reçoit. La tuile marque
 * « échantillon faible » quand `n < faibleSous`, un seuil sur les SESSIONS ; pour
 * une proportion, la règle porte sur les deux côtés (`echantillonFaibleObjectif` :
 * moins de 30 conversions OU moins de 30 non-conversions). Le seuil passé rend
 * donc exactement la décision de cette fonction — la même que le hero et la
 * table —, jamais un « moins de 30 sessions » qui laisserait passer 5 conversions
 * sur 400 sessions.
 */
export function couvertureTaux(conversions: number, sessions: number): { n: number; unite: string; faibleSous: number } {
  return { n: sessions, unite: "sessions", faibleSous: echantillonFaibleObjectif(conversions, sessions) ? sessions + 1 : 0 };
}

/** Demi-largeur d'un intervalle de proportion, en points de pourcentage (« ± 1,8 pt »). */
export function demiLargeurPoints(i: { bas: number; haut: number }): number {
  return ((i.haut - i.bas) / 2) * 100;
}

/** Écart en points entre deux taux (0..1) ; null dès que l'un manque. */
export function ecartPoints(taux: number | null, reference: number | null): number | null {
  return taux == null || reference == null ? null : (taux - reference) * 100;
}

/** « +1,8 pt », « −3,1 pt », « 0,0 pt » : signe écrit, virgule française. */
export function formaterPoints(pt: number): string {
  const arrondi = Math.round(pt * 10) / 10;
  const signe = arrondi > 0 ? "+" : arrondi < 0 ? "−" : "";
  return `${signe}${Math.abs(arrondi).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pt`;
}

/** Appareils de la table des sessions, dans l'ordre d'affichage ; `null` = « Inconnu » (V3). */
export const APPAREILS: readonly string[] = ["desktop", "mobile", "tablet"];
export const LIBELLE_APPAREIL: Record<string, string> = { desktop: "Desktop", mobile: "Mobile", tablet: "Tablette" };
export const APPAREIL_INCONNU = "Inconnu";

export interface LigneAppareil {
  device: string | null;
  libelle: string;
  sessions: number;
  conversions: number;
  /** null sans session sur cet appareil : « — », jamais « 0 % ». */
  rate: number | null;
}

/**
 * Les appareils d'un objectif (G4) : desktop, mobile, tablette, puis tout autre
 * type lu, puis « Inconnu », TOUJOURS dans cet ordre ; un appareil sans session
 * garde sa ligne, sans taux. Même échelle pour tous les objectifs (petits multiples).
 */
export function lignesAppareils(
  goalId: number,
  lignes: readonly { goal_id: number; device: string | null; conversions: number; sessions: number }[],
): LigneAppareil[] {
  const miennes = lignes.filter((l) => l.goal_id === goalId);
  const autres = [...new Set(miennes.map((l) => l.device).filter((d): d is string => d != null && !APPAREILS.includes(d)))].sort();
  return [...APPAREILS, ...autres, null].map((device) => {
    const l = miennes.find((x) => x.device === device);
    const sessions = l?.sessions ?? 0;
    const conversions = l?.conversions ?? 0;
    return {
      device,
      libelle: device == null ? APPAREIL_INCONNU : (LIBELLE_APPAREIL[device] ?? device),
      sessions,
      conversions,
      rate: conversionRate(conversions, sessions),
    };
  });
}
