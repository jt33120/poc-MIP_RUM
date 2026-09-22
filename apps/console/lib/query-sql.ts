// Liaison I/O du contrat de filtres : requête résolue + schéma sondé → prédicats
// compilés et paramètres liés d'UNE instruction SQL. Les lectures migrées (P6.2)
// n'écrivent plus ni `$1 = app`, ni `now() - interval`, ni clause bots/segment à la
// main : elles déclarent leur cible (jeu de données, alias, colonne temporelle).
import { queryOf, type FiltersLike } from "./filters";
import {
  binder,
  compileWhereOrThrow,
  type Bind,
  type CompileTarget,
  type DimensionSchema,
} from "./query-compiler";
import type { AnalyticsQuery } from "./query-contract";
import { dimensionSchema } from "./query-schema";

export interface SqlContext {
  query: AnalyticsQuery;
  schema: DimensionSchema;
  /** Paramètres liés de l'instruction, dans l'ordre des `$n` rendus. */
  params: unknown[];
  bind: Bind;
  /** Prédicats (` and …`) d'une cible ; lève `UnsupportedFilterError` si une dimension manque. */
  where: (target: CompileTarget) => string;
}

export async function sqlContext(f: FiltersLike): Promise<SqlContext> {
  const query = queryOf(f);
  const schema = await dimensionSchema();
  return contextFor(query, schema);
}

/** Nouveau jeu de paramètres pour une autre instruction, même requête et même schéma. */
export function contextFor(query: AnalyticsQuery, schema: DimensionSchema): SqlContext {
  const { params, bind } = binder();
  return { query, schema, params, bind, where: (target) => compileWhereOrThrow(query, target, schema, bind) };
}
