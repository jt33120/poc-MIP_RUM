// Sonde des colonnes de dimensions réellement présentes (P6.2).
//
// La console est publiée AVANT que la migration ne tourne : une dimension dont la
// colonne manque est déclarée « non collectée » au lieu de faire échouer l'écran.
// La mémoire est courte (5 s) : une migration appliquée se voit sans redémarrage,
// et un écran qui lance dix lectures en parallèle ne sonde qu'une fois.
import { q } from "./db";
import { registryColumns, type DimensionSchema } from "./query-compiler";

const TTL_MS = 5_000;
let memo: { at: number; schema: Promise<DimensionSchema> } | null = null;

export function dimensionSchema(): Promise<DimensionSchema> {
  const now = Date.now();
  if (memo && now - memo.at < TTL_MS) return memo.schema;
  const { tables, columns } = registryColumns();
  const schema = q<{ key: string }>(
    `select table_name || '.' || column_name as key
       from information_schema.columns
      where table_schema = 'public' and table_name = any($1::text[]) and column_name = any($2::text[])`,
    [tables, columns],
  ).then((rows) => new Set(rows.map((row) => row.key)) as DimensionSchema);
  memo = { at: now, schema };
  // Une sonde en échec n'est pas mémorisée : la suivante réessaie.
  schema.catch(() => {
    if (memo?.schema === schema) memo = null;
  });
  return schema;
}

/** Oublie la sonde — pour les tests SQL qui migrent une base en cours de suite. */
export function forgetDimensionSchema(): void {
  memo = null;
}
