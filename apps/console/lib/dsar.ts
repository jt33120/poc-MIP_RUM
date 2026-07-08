// DSAR (Data Subject Access Request) — logique PURE et testée (Lot 5, souveraineté).
//
// Toutes les données d'un utilisateur sont ancrées sur rum_session.user_hash
// (fingerprint anonymisé). Les tables enfant les rattachent par session_id. Ce
// module est la DÉFINITION DE RÉFÉRENCE du périmètre couvert (export & effacement)
// et de l'ordre de suppression SÛR au regard des clés étrangères — le SQL
// (queries-dsar.ts) la reflète.
//
// Les noms de tables/colonnes sont des CONSTANTES (allowlist compile-time),
// jamais des entrées utilisateur : seuls app_id et user_hash sont paramétrés.

/** Table qui porte user_hash — supprimée en DERNIER (les enfants la référencent). */
export const DSAR_ANCHOR = "rum_session" as const;

/**
 * Tables enfant reliées par session_id, dans un ordre de suppression SÛR.
 * Contrainte FK vérifiée en base : rum_metric/rum_error → rum_pageview, et
 * toutes → rum_session. rum_ai.session_id n'a pas de FK (nullable). L'ordre
 * ci-dessous supprime donc metric/error AVANT pageview, et tout AVANT l'ancre.
 */
export const DSAR_CHILD_TABLES = [
  "rum_metric",
  "rum_error",
  "rum_pageview",
  "rum_span",
  "rum_event",
  "rum_breadcrumb",
  "rum_longtask",
  "rum_resource",
  "rum_ai",
  "replay_chunk",
] as const;

export type DsarTable = (typeof DSAR_CHILD_TABLES)[number] | typeof DSAR_ANCHOR;

/** Toutes les tables du périmètre DSAR (enfants + ancre). */
export const DSAR_TABLES: readonly string[] = [...DSAR_CHILD_TABLES, DSAR_ANCHOR];

/** Ordre de suppression : enfants (déjà ordonnés FK) puis l'ancre en dernier. */
export function dsarDeleteOrder(): DsarTable[] {
  return [...DSAR_CHILD_TABLES, DSAR_ANCHOR];
}

/**
 * Arêtes FK connues À L'INTÉRIEUR du périmètre DSAR (enfant → parent) : l'enfant
 * doit être supprimé AVANT son parent. Garde-fou testable de l'ordre.
 */
export const DSAR_FK_EDGES: ReadonlyArray<readonly [DsarTable, DsarTable]> = [
  ["rum_metric", "rum_pageview"],
  ["rum_metric", "rum_session"],
  ["rum_error", "rum_pageview"],
  ["rum_error", "rum_session"],
  ["rum_pageview", "rum_session"],
  ["rum_span", "rum_session"],
  ["rum_event", "rum_session"],
  ["rum_breadcrumb", "rum_session"],
  ["rum_longtask", "rum_session"],
  ["rum_resource", "rum_session"],
];

/**
 * Vrai si l'ordre supprime chaque enfant AVANT son parent (toutes les arêtes FK
 * respectées) — invariant de sûreté de dsarDeleteOrder().
 */
export function isSafeDeleteOrder(
  order: readonly string[],
  edges: ReadonlyArray<readonly [string, string]> = DSAR_FK_EDGES,
): boolean {
  const rank = new Map(order.map((t, i) => [t, i]));
  return edges.every(([child, parent]) => {
    const c = rank.get(child);
    const p = rank.get(parent);
    return c != null && p != null && c < p;
  });
}

/** Document d'export DSAR — forme portable et stable (une clé par table). */
export interface DsarExport {
  kind: "mip-rum-dsar-export";
  version: 1;
  app: string;
  user_hash: string;
  generated_at: string;
  session_count: number;
  summary: Record<string, number>;
  tables: Record<string, unknown[]>;
}

/** Compte de lignes par table (résumé lisible du volume exporté/à effacer). */
export function summarizeCounts(tables: Record<string, unknown[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [t, rows] of Object.entries(tables)) out[t] = rows.length;
  return out;
}

/** Assemble le document d'export à partir des lignes brutes par table. */
export function buildDsarExport(input: {
  app: string;
  userHash: string;
  generatedAt: string;
  tables: Record<string, unknown[]>;
}): DsarExport {
  const summary = summarizeCounts(input.tables);
  return {
    kind: "mip-rum-dsar-export",
    version: 1,
    app: input.app,
    user_hash: input.userHash,
    generated_at: input.generatedAt,
    session_count: input.tables[DSAR_ANCHOR]?.length ?? 0,
    summary,
    tables: input.tables,
  };
}

/** Nom de fichier d'export : horodaté et tronqué (hash long, pas de PII). */
export function dsarExportFilename(userHash: string, generatedAt: string): string {
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const shortHash = userHash.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "");
  return `dsar-${shortHash || "user"}-${stamp}.json`;
}
