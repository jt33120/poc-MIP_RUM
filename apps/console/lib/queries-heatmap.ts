// LECTURE DE LA HEATMAP DE LATENCE (A2 § 6.2, vague 3b).
//
// Les seaux horaires pré-agrégés d'un vital (`metric_histogram_hourly`, v61 : robots
// exclus, poids d'échantillonnage dans le seau), pour UNE app, sur les heures de la
// période. Seules les heures déjà agrégées y figurent : l'heure en cours reste une
// colonne vide, et la figure le dit — jamais comblée par autre chose.
import { q } from "./db";
import type { LigneHistogramme } from "./heatmap-latence";
import { appDeLaSerie } from "./queries-detections";
import type { AnalyticsQuery } from "./query-contract";

export type LectureHeatmap = { etat: "une_app_requise" } | { etat: "ok"; app: string; lignes: LigneHistogramme[] };

export async function histogrammesHoraires(query: AnalyticsQuery, vital: string): Promise<LectureHeatmap> {
  const app = appDeLaSerie(query);
  if (!app) return { etat: "une_app_requise" };
  const lignes = await q<{ hour: Date | string; bucket: number; poids: number; mesures: number }>(
    `select hour, bucket, sum(weighted_count)::float8 as poids, sum(observed_count)::int as mesures
       from metric_histogram_hourly
      where app_id = $1 and name = $2 and hour >= date_trunc('hour', $3::timestamptz) and hour < $4::timestamptz
      group by 1, 2`,
    [app, vital, query.range.from, query.range.to],
  );
  return {
    etat: "ok",
    app,
    lignes: lignes.map((l) => ({ heure: new Date(l.hour).toISOString(), bucket: Number(l.bucket), poids: Number(l.poids), mesures: Number(l.mesures) })),
  };
}
