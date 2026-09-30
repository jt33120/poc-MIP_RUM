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
//
// COLLECTE INTERROMPUE (sixième règle, 29/09/2026). Un jour de référence — ou un
// jour comparé — recoupé par une fenêtre `interrompue` du registre
// (`collecte_fenetre`) n'a pas d'écart : « 0 page vue » pendant une panne n'est pas
// une chute. Seules les fenêtres qui touchent l'un des deux jours comptent.
import {
  debutCollecte,
  evaluerCouverture,
  sourcesSousFiltres,
  type CouverturePrecedente,
  type SourceComparaison,
} from "./comparaison";
import { filtersOfQuery } from "./filters";
import { fmtInstant } from "./format";
import { bornesJourLocal } from "./fuseau-local";
import { lireFenetresCollecte } from "./queries-collecte";
import { retentionDays } from "./queries-explorer";
import type { AnalyticsQuery } from "./query-contract";
import type { FenetreCollecte } from "./series";

/** Le jour local « AAAA-MM-JJ » décalé de `n` jours (calendaire, sans heure). */
function jourPlus(jour: string, n: number): string {
  const [a, m, j] = jour.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

function recoupeJour(f: FenetreCollecte, bornes: { from: string; to: string }): boolean {
  const fin = f.fin === null ? Number.POSITIVE_INFINITY : Date.parse(f.fin);
  return f.etat === "interrompue" && Date.parse(f.debut) < Date.parse(bornes.to) && fin > Date.parse(bornes.from);
}

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
  fenetres = [],
}: {
  query: AnalyticsQuery;
  source: SourceComparaison;
  jour: string;
  tz: string;
  debut: Date | null | "echec";
  nowMs: number;
  retentionJours: number;
  n: number | null;
  /** Fenêtres hors collecte lues sur [jour de référence, maintenant) ; absentes = aucune. */
  fenetres?: readonly FenetreCollecte[];
}): CouverturePrecedente {
  const reference = bornesJourLocal(jour, tz);
  const { from, to } = reference;
  const duree = Date.parse(to) - Date.parse(from);
  // `previousRange([to, to + durée))` = `[from, to)` : exactement le jour de référence.
  const plage = { from: to, to: iso(Date.parse(to) + duree), preset: null, bucketSeconds: 86_400 };
  // Le lendemain fabriqué n'est pas le jour comparé : seules les fenêtres du jour de
  // référence entrent dans `evaluerCouverture` (elles y tombent en « précédente »).
  const couverture = evaluerCouverture({
    query: { ...query, range: plage },
    source,
    debut,
    nowMs,
    retentionJours,
    fenetres: fenetres.filter((f) => recoupeJour(f, reference)),
  });
  if (couverture.etat !== "complete") return { ...couverture, n };
  // Le jour comparé (J, sept jours après la référence) : même règle, dite pour lui.
  const compare = fenetres.find((f) => recoupeJour(f, bornesJourLocal(jourPlus(jour, 7), tz)));
  if (compare) {
    const quand = compare.fin === null ? `depuis le ${fmtInstant(compare.debut)}` : `du ${fmtInstant(compare.debut)} au ${fmtInstant(compare.fin)}`;
    return { etat: "partielle", raison: `collecte interrompue ${quand}, pendant le jour comparé`, n };
  }
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
  // Registre illisible : la règle se tait, les autres jugent comme avant.
  const fenetres = await lireFenetresCollecte(
    { from: bornesJourLocal(jour, tz).from, to: new Date(nowMs).toISOString() },
    query.scope.effectiveApps,
  ).catch(() => [] as FenetreCollecte[]);
  const couvertures = await Promise.all(
    toutes.map(async (source) => {
      let debut: Date | null | "echec";
      try {
        debut = await debutCollecte(f, source);
      } catch {
        debut = "echec";
      }
      return couvertureJourReference({ query, source, jour, tz, debut, nowMs, retentionJours, n, fenetres });
    }),
  );
  return couvertures.find((c) => c.etat !== "complete") ?? { etat: "complete", raison: null, n };
}
