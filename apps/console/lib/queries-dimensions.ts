// Sélecteurs de valeurs de dimension (P6.1) — couche I/O. Validation, portée,
// SQL et mise en forme viennent de ./dimensions ; ce module ne fait que les
// exécuter.
import { q } from "./db";
import {
  DIMENSIONS,
  dimensionValuesFrom,
  dimensionValuesSql,
  type DimensionValues,
  type DimensionValuesRequest,
} from "./dimensions";

/** Couture I/O : la production lit par `q` ; les tests SQL passent leur base jetable. */
export type LectureDimensions = <T>(text: string, params: unknown[]) => Promise<T[]>;

/**
 * Valeurs d'une dimension pour UNE app et une fenêtre, à partir d'une demande
 * déjà validée par `dimensionValuesRequest` (portée du principal comprise).
 *
 * La console est publiée AVANT que migration-v75 ne tourne : sans la colonne, la
 * réponse est une liste vide marquée indisponible, jamais une erreur d'écran. La
 * sonde est rejouée à chaque appel, pour basculer dès la migration passée sans
 * redémarrage.
 */
export async function dimensionValues(
  request: DimensionValuesRequest,
  lire: LectureDimensions = q,
): Promise<DimensionValues> {
  const d = DIMENSIONS[request.dimension];
  if (d.migration) {
    const [sonde] = await lire<{ present: boolean }>(
      `select exists(select 1 from information_schema.columns
         where table_schema = 'public' and table_name = $1 and column_name = $2) as present`,
      [d.population === "sessions" ? "rum_session" : "rum_event_index", d.column],
    );
    if (sonde?.present !== true) return dimensionValuesFrom(request, [], false);
  }
  const { text, params } = dimensionValuesSql(request);
  return dimensionValuesFrom(request, await lire<{ valeur: string | null; n: number }>(text, params));
}
