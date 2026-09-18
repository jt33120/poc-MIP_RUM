// Schéma de dimensions pour les tests à base simulée (P6.2) : la sonde réelle
// (lib/query-schema.ts) interroge information_schema par `q`, que ces tests
// remplacent. `schemaComplet` déclare toutes les colonnes du registre (schéma
// migré, P6.1 compris) ; `schemaSans` en retire pour simuler une console publiée
// avant sa migration.
import { DATASET_REGISTRY, type DimensionSchema } from "../../apps/console/lib/query-compiler";

export function schemaComplet(): DimensionSchema {
  const columns = new Set<string>();
  for (const dataset of Object.values(DATASET_REGISTRY)) {
    for (const source of Object.values(dataset.dimensions)) {
      if (source) columns.add(`${source.table}.${source.column}`);
    }
  }
  return columns;
}

export function schemaSans(...absentes: string[]): DimensionSchema {
  const columns = new Set(schemaComplet());
  for (const column of absentes) columns.delete(column);
  return columns;
}
