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

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Ouverte",
  for_review: "À revoir",
  resolved: "Résolue",
  ignored: "Ignorée",
};

export const GROUPING_BASIS_LABELS: Record<GroupingBasis, string> = {
  override: "Clé déclarée",
  symbolicated_frame: "Frame source",
  normalized_frame: "Frame normalisée",
  low_confidence: "Faible confiance",
};
