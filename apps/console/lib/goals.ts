// Objectifs & conversions — logique PURE et testée (Lot 8b). Un objectif matche
// une valeur (route pour un objectif de page vue, nom d'événement pour un objectif
// d'événement) selon son type de correspondance. Le SQL (queries-goals) reflète
// cette définition ; ici c'est la référence + le taux de conversion.

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

/** Taux de conversion (0..1), sûr si dénominateur nul. */
export function conversionRate(conversions: number, sessions: number): number {
  return sessions > 0 ? conversions / sessions : 0;
}

export interface GoalConversion extends GoalDef {
  conversions: number; // sessions ayant satisfait l'objectif
  rate: number; // conversions / sessions de la fenêtre
}
