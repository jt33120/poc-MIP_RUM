// Statuts, bases de regroupement et libellés des issues d'erreurs, SANS la base.
//
// Séparé de `error-issues.ts` le 24/09/2026 (cliquet de la piste C,
// docs/architecture/console-api/README.md) : un badge de statut, la liste et le
// formulaire de triage n'ont besoin que de ces taxonomies. Tant qu'ils les lisaient
// dans `error-issues.ts`, leur graphe d'import atteignait `lib/db.ts`.

// Copies des taxonomies de migration-v72 (la console ne type pas un module .mjs) ;
// tests/unit/error-grouping-v2.test.ts les compare à l'ingestion.
export const ISSUE_STATUSES = ["open", "for_review", "resolved", "ignored"] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const GROUPING_BASES = ["override", "symbolicated_frame", "normalized_frame", "low_confidence"] as const;

export type GroupingBasis = (typeof GROUPING_BASES)[number];

export type IssueOrigin = "new" | "migration";

// L'écran dit « groupe » (masculin) pour une issue comme pour un groupe historique
// (recette du 26/09/2026 : « issue », « groupe », « signature » et « fingerprint »
// désignaient la même chose selon l'application). Les statuts s'accordent.
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Ouvert",
  for_review: "À revoir",
  resolved: "Résolu",
  ignored: "Ignoré",
};

// Libellés affichés en infobulle ; seule « Regroupement approximatif » se montre
// en badge, car elle change la lecture du groupe.
export const GROUPING_BASIS_LABELS: Record<GroupingBasis, string> = {
  override: "Clé déclarée par l'application",
  symbolicated_frame: "Ligne de code source",
  normalized_frame: "Ligne de pile",
  low_confidence: "Regroupement approximatif",
};
