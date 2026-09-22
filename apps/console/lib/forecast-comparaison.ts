// Couverture du jour de référence des tuiles de /forecast (§ 5.20.3, TE2-TE4, F65).
//
// POURQUOI. Les tuiles comparent le dernier jour complet au même jour de la
// semaine précédente (J−7). Si la collecte de l'app a commencé PENDANT ce jour de
// référence (à 18 h, disons), il n'a que quelques heures de trafic : l'écart
// mesurerait la collecte, pas le site — « +1 900 % vs même jour, semaine
// précédente ». La tuile doit alors se taire et dire pourquoi, comme pour la
// période précédente d'un écran à plage (§ 3.2, `couverturePrecedente`).
//
// MÊMES RÈGLES, MÊMES TEXTES. On ne réécrit pas les règles du § 3.2 : le jour de
// référence est posé comme la « période précédente » d'une plage fabriquée pour
// l'occasion — le jour qui le suit, de même durée (23 à 25 h selon le changement
// d'heure) —, et `evaluerCouverture` (lib/comparaison.ts) décide : rétention,
// début de collecte (lu sur le périmètre d'apps seul, colonne exigée par un filtre
// comprise), lecture en échec → `inconnue`.
import {
  debutCollecte,
  evaluerCouverture,
  sourcesSousFiltres,
  type CouverturePrecedente,
  type SourceComparaison,
} from "./comparaison";
import { filtersOfQuery } from "./filters";
import { bornesJourLocal } from "./fuseau";
import { retentionDays } from "./queries-explorer";
import type { AnalyticsQuery } from "./query-contract";

/** D'où vient chaque tuile de /forecast. Un ratio n'est pas un compte : pas de retard d'ingestion. */
export const SOURCES_TENDANCES = {
  lcp: [{ table: "rum_metric", colonneTemps: "ts", additive: false }],
  ratio: [
    { table: "rum_pageview", colonneTemps: "started_at", additive: false },
    { table: "rum_error", colonneTemps: "ts", additive: false },
  ],
  vues: [{ table: "rum_pageview", colonneTemps: "started_at", additive: true }],
} as const satisfies Record<string, readonly SourceComparaison[]>;

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * La couverture du jour LOCAL `jour` pour une source, `debut` déjà lu. PURE.
 * `n` : effectif du jour de référence (règle d'échantillon faible de `KpiTile`).
 */
export function couvertureJourReference({
  query,
  source,
  jour,
  tz,
  debut,
  nowMs,
  retentionJours,
  n,
}: {
  query: AnalyticsQuery;
  source: SourceComparaison;
  jour: string;
  tz: string;
  debut: Date | null | "echec";
  nowMs: number;
  retentionJours: number;
  n: number | null;
}): CouverturePrecedente {
  const { from, to } = bornesJourLocal(jour, tz);
  const duree = Date.parse(to) - Date.parse(from);
  // `previousRange([to, to + durée))` = `[from, to)` : exactement le jour de référence.
  const plage = { from: to, to: iso(Date.parse(to) + duree), preset: null, bucketSeconds: 86_400 };
  const couverture = evaluerCouverture({ query: { ...query, range: plage }, source, debut, nowMs, retentionJours });
  return { ...couverture, n };
}

/**
 * Couverture du jour de référence d'une tuile : chaque source (et chaque colonne
 * qu'un filtre exige) est lue ; la première incomplète gagne. Ne lève pas : une
 * lecture en échec devient une couverture `inconnue`, avec sa raison.
 */
export async function couvertureJour(
  query: AnalyticsQuery,
  sources: readonly SourceComparaison[],
  jour: string,
  tz: string,
  n: number | null,
): Promise<CouverturePrecedente> {
  const nowMs = Date.now();
  const retentionJours = retentionDays();
  const f = filtersOfQuery(query);
  const toutes = sources.flatMap((s) => sourcesSousFiltres(query, s));
  const couvertures = await Promise.all(
    toutes.map(async (source) => {
      let debut: Date | null | "echec";
      try {
        debut = await debutCollecte(f, source);
      } catch {
        debut = "echec";
      }
      return couvertureJourReference({ query, source, jour, tz, debut, nowMs, retentionJours, n });
    }),
  );
  return couvertures.find((c) => c.etat !== "complete") ?? { etat: "complete", raison: null, n };
}
