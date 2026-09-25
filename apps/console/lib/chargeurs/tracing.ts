// LE CHARGEUR DE L'ÉCRAN « Tracing » (C4) — `app/tracing/page.tsx`.
//
// Couverture et chiffres clés (RED), décomposition des appels, série de latence,
// routes serveur, traces les plus lentes (sous le filtre `appel`), déploiements,
// impact du dernier déploiement, déclenchements d'alerte ; et, sous `cmp=prev`, la
// période précédente et la couverture de ses sources.
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { analyserFiltres } from "../filtres-ecran";
import { latestDeployImpact, listDeploys } from "../queries-deploys";
import { apiCallsDecomposition, backRoutes, slowTraces, spanLatencySeries, traceCoverage, type TraceCoverage } from "../queries-tracing";
import { alertEvents } from "../queries-v2";
import { paramReader, previousRange } from "../query-contract";
import { lireAppel } from "../tracing-ancres";
import { lireComparaison } from "../view-state";
import { section, sansSection, type Chargeur } from "./commun";

const SOURCE_APPELS: SourceComparaison = { table: "rum_span", colonneTemps: "ts", additive: true };
const SOURCE_DUREES: SourceComparaison = { table: "rum_span", colonneTemps: "ts", additive: false };

export const chargerTracing = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/tracing");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.filters;
  const query = ecran.query;
  const prev = lireComparaison("/tracing", paramReader(sp)).valeur.mode === "prev";
  const appel = lireAppel(sp);
  const fPrec = { ...f, query: { ...query, range: previousRange(query.range) } };
  const couvertures = (source: SourceComparaison) =>
    Promise.all(sourcesSousFiltres(query, source).map((s) => couverturePrecedente(query, s)));

  const [cov, covPrec, couvAppels, couvDurees, appels, serie, seriePrec, routes, lentes, deploys, impact, alertes] =
    await Promise.all([
      section(() => traceCoverage(f)),
      prev ? section(() => traceCoverage(fPrec)) : sansSection<TraceCoverage | null>(null),
      prev ? couvertures(SOURCE_APPELS) : Promise.resolve<CouverturePrecedente[]>([]),
      prev ? couvertures(SOURCE_DUREES) : Promise.resolve<CouverturePrecedente[]>([]),
      section(() => apiCallsDecomposition(f)),
      section(() => spanLatencySeries(f)),
      prev ? section(() => spanLatencySeries(fPrec)) : sansSection(null),
      section(() => backRoutes(f)),
      section(() => slowTraces(f, appel ? { appel } : undefined)),
      section(() => listDeploys(f, 20)),
      section(() => latestDeployImpact(f)),
      // Annotations d'alerte (F67) : les 100 derniers déclenchements du périmètre ;
      // la fenêtre est appliquée par `annotationsAlertes`, pas par la lecture.
      section(() => alertEvents(f)),
    ]);
  return {
    etat: "ok",
    query,
    label: ecran.label,
    bucketLabel: ecran.bucketLabel,
    cov,
    covPrec,
    couvAppels,
    couvDurees,
    appels,
    serie,
    seriePrec,
    routes,
    lentes,
    deploys,
    impact,
    alertes,
  } as const;
}) satisfies Chargeur<unknown>;
