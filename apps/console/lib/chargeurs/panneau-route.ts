// LA LECTURE DU PANNEAU D'UNE ROUTE (F17) — `panel=route:<r>` sur `/pages`.
//
// Déplacée du composant (`components/perf/RoutePanel.tsx`) vers la couche de
// données : le chargeur de `/pages` la lance pour la route ouverte ; le composant
// ne fait plus que rendre. La plage est celle de l'ÉCRAN (§ 3.5) : même libellé
// que l'en-tête, même fuseau de lecture — le panneau n'a pas de fenêtre à lui.
import { HISTO_BUCKETS } from "../distribution";
import type { Filters } from "../filters";
import type { VitalName } from "../fmt-ids";
import { fuseauDe } from "../fuseau";
import { avecCondition, plafondAffichage } from "../perf-domain";
import { pageviewSeries, slowResourcesByRoute, vitalHistogram, vitalPercentiles, vitalSeriesN, vitalsP75, type VitalPercentiles } from "../queries";
import { listErrorGroups } from "../queries-errors";
import { correlationCards, correlationConcordance } from "../queries-v2";
import { UnsupportedFilterError } from "../query-compiler";
import { rangeLabel, type AnalyticsQuery } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { mapSection, section } from "./commun";

/** Groupes d'erreurs montrés dans le panneau (§ 5.2.3). */
export const ERREURS_PANNEAU = 3;

/**
 * Lecture d'un jeu que `/pages` ne déclare pas dans sa surface (le robot,
 * `synthetic`) : un filtre de l'écran qu'il ne porte pas lève
 * `UnsupportedFilterError`, que `lire` relance. Ici le seul BLOC le dit ; les
 * autres restent (même règle qu'à la Vue d'ensemble).
 */
const sectionOuRefus = <T,>(fn: () => Promise<T>) =>
  section<{ refus: null; data: T } | { refus: string }>(async () => {
    try {
      return { refus: null, data: await fn() };
    } catch (e) {
      if (e instanceof UnsupportedFilterError) return { refus: e.message };
      throw e;
    }
  });

export async function lirePanneauRoute(route: string, f: Filters, query: AnalyticsQuery, vital: VitalName) {
  const fRoute = avecCondition(f, "route", route);
  // Toutes les lectures du panneau, en parallèle, chacune derrière `section()`.
  const [fuseau, schema, serieRoute, serieEnsemble, pcts, ensemble, reel, cartes, concordance, ressources, erreurs, vues] =
    await Promise.all([
      fuseauDe(query.scope.requestedApp),
      // Ce que `/sessions` sait appliquer (lien « Sessions sur cette route »).
      dimensionSchema(),
      section(() => vitalSeriesN(fRoute, vital)),
      section(() => vitalSeriesN(f, vital)),
      section(() => vitalPercentiles(fRoute)),
      section(() => vitalsP75(f)),
      section(() => vitalsP75(fRoute)),
      sectionOuRefus(() => correlationCards(f)),
      sectionOuRefus(() => correlationConcordance(f)),
      section(() => slowResourcesByRoute(f)),
      section(() => listErrorGroups(fRoute, { limit: ERREURS_PANNEAU, offset: 0 })),
      section(() => pageviewSeries(fRoute)),
    ]);

  // Le plafond d'affichage dépend des percentiles de LA ROUTE : d'où une seconde
  // lecture (même règle qu'à l'écran, F15). Percentiles illisibles : plafond par
  // défaut, et la figure le dit.
  const pctsDuVital: VitalPercentiles | null = pcts.ok ? (pcts.data.find((r) => r.name === vital) ?? null) : null;
  const { plafond, libelle: plafondLibelle } = plafondAffichage(
    vital,
    pctsDuVital ? { p95: pctsDuVital.pcts[3] ?? null, p99: pctsDuVital.pcts[4] ?? null } : null,
  );
  const histo = await section(() => vitalHistogram(fRoute, vital, plafond, HISTO_BUCKETS));
  return {
    plage: rangeLabel(query.range, fuseau),
    schema: [...schema].sort(),
    serieRoute,
    serieEnsemble,
    /** Les percentiles de la route ont-ils été lus (la distribution le dit sinon) ? */
    pctsLus: pcts.ok,
    pctsDuVital,
    ensemble,
    reel,
    cartes,
    concordance,
    // Les ressources lentes de CETTE route (la lecture les rend pour toutes, par route).
    ressources: mapSection(ressources, (parRoute) => parRoute.get(route) ?? []),
    erreurs: mapSection(erreurs, ({ groups, total }) => ({ groups, total })),
    vues,
    plafond,
    plafondLibelle,
    histo,
  };
}

export type LecturePanneauRoute = Awaited<ReturnType<typeof lirePanneauRoute>>;
