// Coût IA par dimension — helper PUR et testé (UTI-B). La dimension d'agrégation
// vient de la query string (?group_by=...) : on la valide contre une ALLOWLIST
// pour qu'aucune valeur utilisateur ne touche le SQL (les noms de colonnes/tables
// restent des constantes côté code). Défaut : par utilisateur (user_hash).

export const AI_COST_DIMENSIONS = ["user", "model", "route"] as const;
export type AiCostDimension = (typeof AI_COST_DIMENSIONS)[number];

/** Valide ?group_by ; toute valeur hors allowlist (ou absente) -> "user". */
export function parseCostDimension(raw: string | null | undefined): AiCostDimension {
  const v = (raw ?? "").toLowerCase().trim();
  return (AI_COST_DIMENSIONS as readonly string[]).includes(v) ? (v as AiCostDimension) : "user";
}
