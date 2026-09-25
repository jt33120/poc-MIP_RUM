// LE CHARGEUR DE L'ÉCRAN « Pages » (C4) — `app/pages/page.tsx`.
//
// En trois temps, comme la page :
//   1. les lectures de l'écran, chacune une section (F02) — classement par route
//      (sous le vital piloté), tuiles, séries, découpages, percentiles, navigation,
//      ressources, tâches longues ; la période précédente sous `cmp=prev` ;
//   2. les DISTRIBUTIONS (§ 5.2.2) : leur plafond d'affichage dépend des
//      percentiles lus, d'où une seconde lecture ;
//   3. la COMPARAISON DE RELEASES (§ 3.2) : B contre A, choisies dans l'URL ou par
//      la règle (dernier déploiement déclaré…), lues sous `cmp=release`.
// Et le panneau d'une route (`panel=route:<r>`, F17), lu avec l'écran.
import { datasetAvailability } from "../breakdowns";
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { HISTO_BUCKETS } from "../distribution";
import type { Filters } from "../filters";
import { analyserFiltres } from "../filtres-ecran";
import { estVital, type VitalName } from "../fmt-ids";
import { avecCondition, classementParRoute, distributionsAffichees, plafondAffichage } from "../perf-domain";
import { choisirReleases } from "../presets";
import {
  ROUTES_MAX,
  pageviewSeries,
  samplingVitals,
  slowResourcesByRoute,
  slowRoutes,
  vitalHistogram,
  vitalPercentiles,
  vitalSeriesN,
  vitalsP75,
  vuesParNavType,
  type VitalAgg,
} from "../queries";
import { VITALS_BREAKDOWN_DATASETS, vitalsBreakdown, type BreakdownResult, type VitalsBreakdownRow } from "../queries-breakdowns";
import { comparaisonVersions, listDeploys } from "../queries-deploys";
import { longtaskSeries, worstLongtasks } from "../queries-longtasks";
import { resourcesVue } from "../queries-resources";
import { dimensionSupport } from "../query-compiler";
import { paramReader } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { lireComparaison, lireEtatDeVue } from "../view-state";
import { section, sansSection, type Chargeur } from "./commun";
import { lirePanneauRoute } from "./panneau-route";

// Sources des tuiles comparées à la période précédente (§ 3.2) : un p75 n'est pas
// un compte (le retard d'ingestion ne le fausse pas), les pages vues si.
const SOURCE_VITAUX: SourceComparaison = { table: "rum_metric", colonneTemps: "ts", additive: false };
const SOURCE_VUES: SourceComparaison = { table: "rum_pageview", colonneTemps: "started_at", additive: true };

/**
 * Les mêmes filtres SANS condition de release : les releases comparées (§ 3.2) se
 * choisissent parmi toutes celles de la fenêtre — sous `release=B`, la lecture des
 * versions ne verrait que B, et « précédente » n'existerait plus.
 */
function sansRelease(f: Filters): Filters {
  if (!f.query) return f;
  const { release: _release, ...filtres } = f.query.filters;
  return {
    ...f,
    query: { ...f.query, filters: { ...filtres, segments: filtres.segments.filter((c) => c.dimension !== "release") } },
  };
}

export const chargerPages = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/pages");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.filters;
  const query = ecran.query;
  const lecteur = paramReader(sp);
  const etatVue = lireEtatDeVue("/pages", lecteur);
  const comparaison = lireComparaison("/pages", lecteur);
  const vital: VitalName = etatVue.etat.vital && estVital(etatVue.etat.vital) ? etatVue.etat.vital : "LCP";
  const classement = classementParRoute(vital);
  const mode = comparaison.valeur.mode;
  const prev = mode === "prev";
  const panneau = etatVue.etat.panel?.type === "route" ? etatVue.etat.panel.id : null;

  const schema = await dimensionSchema();
  const dispo = datasetAvailability(VITALS_BREAKDOWN_DATASETS, schema);
  const dispoNavigateur = dispo("browser");
  const dispoPays = dispo("country");
  const couvertures = (source: SourceComparaison) =>
    Promise.all(sourcesSousFiltres(query, source).map((s) => couverturePrecedente(query, s)));

  // 1. Chaque lecture est indépendante (F02, § 3.8).
  const [
    decoupe,
    routes,
    ressourcesRoutes,
    vitaux,
    vitauxPrev,
    serieVital,
    vues,
    vuesPrev,
    echantillonnage,
    couvVitaux,
    couvVues,
    deploys,
    versions,
    navigateurs,
    pays,
    pcts,
    navigation,
    ressources,
    blocages,
    pires,
    panneauLu,
  ] = await Promise.all([
    classement.disponible ? section(() => vitalsBreakdown(f, "route", ROUTES_MAX)) : sansSection<BreakdownResult<VitalsBreakdownRow> | null>(null),
    classement.disponible ? section(() => slowRoutes(f)) : sansSection([]),
    // Une `Map` ne voyage pas : les ressources lentes par route, en objet.
    classement.disponible
      ? section(async () => Object.fromEntries(await slowResourcesByRoute(f)))
      : sansSection({} as Record<string, never[]>),
    section(() => vitalsP75(f)),
    prev ? section(() => vitalsP75(f, true)) : sansSection<VitalAgg[]>([]),
    section(() => vitalSeriesN(f, vital)),
    section(() => pageviewSeries(f)),
    prev ? section(() => pageviewSeries(f, true)) : sansSection([]),
    section(() => samplingVitals(f)),
    prev ? couvertures(SOURCE_VITAUX) : Promise.resolve<CouverturePrecedente[]>([]),
    prev ? couvertures(SOURCE_VUES) : Promise.resolve<CouverturePrecedente[]>([]),
    section(() => listDeploys(f, 20)),
    section(() => comparaisonVersions(sansRelease(f))),
    dispoNavigateur.available ? section(() => vitalsBreakdown(f, "browser", ROUTES_MAX)) : sansSection(null),
    dispoPays.available ? section(() => vitalsBreakdown(f, "country", ROUTES_MAX)) : sansSection(null),
    section(() => vitalPercentiles(f)),
    section(() => vuesParNavType(f)),
    section(() => resourcesVue(f)),
    section(() => longtaskSeries(f)),
    section(() => worstLongtasks(f)),
    // Le panneau d'une route (F17), lu avec l'écran — jamais sans panneau.
    panneau ? lirePanneauRoute(panneau, f, query, vital) : Promise.resolve(null),
  ]);

  // 2. Distributions : 20 bacs linéaires jusqu'au plafond RETENU (VITAL_CAP, ou p99
  // arrondi quand la population est concentrée très en dessous). Percentiles
  // illisibles : plafond par défaut, et « percentiles non calculables » sur la figure.
  const pctsParNom = new Map((pcts.ok ? pcts.data : []).map((r) => [r.name, r] as const));
  const distributions = distributionsAffichees(vital).map((nom) => {
    const r = pctsParNom.get(nom);
    return { nom, pcts: r ?? null, ...plafondAffichage(nom, r ? { p95: r.pcts[3] ?? null, p99: r.pcts[4] ?? null } : null) };
  });
  const histos = await Promise.all(distributions.map((d) => section(() => vitalHistogram(f, d.nom, d.plafond, HISTO_BUCKETS))));

  // 3. Comparaison de releases : celles de l'URL, sinon la règle du § 3.2. Si l'une
  // manque, ou si la dimension n'est pas collectée pour les mesures, la tuile n'a
  // pas d'écart ET le dit.
  const choix = deploys.ok && versions.ok ? choisirReleases(deploys.data, versions.data.rows) : null;
  let releaseTuile: { relA: string; relB: string; regle: string } | null = null;
  let releaseIndisponible: string | null = null;
  if (mode === "release") {
    const relB = comparaison.valeur.relB ?? choix?.relB ?? null;
    const relA = comparaison.valeur.relA ?? choix?.relA ?? null;
    const support = dimensionSupport("vitals", "release", schema);
    if (!support.supported) releaseIndisponible = support.message;
    else if (!choix && (relA === null || relB === null)) releaseIndisponible = "lecture des releases en échec";
    else if (relA === null || relB === null || relA === relB) releaseIndisponible = choix?.indisponible ?? "moins de deux releases sur la fenêtre";
    else {
      const regle =
        comparaison.valeur.relA && comparaison.valeur.relB
          ? `${relB} contre ${relA}, choisies dans l'URL`
          : (choix?.regle ?? `${relB} contre ${relA}`);
      releaseTuile = { relA, relB, regle };
    }
  }
  const releases = releaseTuile;
  const [vitauxB, vitauxA, serieB] = releases
    ? await Promise.all([
        section(() => vitalsP75(avecCondition(f, "release", releases.relB))),
        section(() => vitalsP75(avecCondition(f, "release", releases.relA))),
        section(() => vitalSeriesN(avecCondition(f, "release", releases.relB), vital)),
      ])
    : [null, null, null];

  return {
    etat: "ok",
    query,
    label: ecran.label,
    bucketLabel: ecran.bucketLabel,
    schema: [...schema].sort(),
    decoupe,
    routes,
    ressourcesRoutes,
    vitaux,
    vitauxPrev,
    serieVital,
    vues,
    vuesPrev,
    echantillonnage,
    couvVitaux,
    couvVues,
    deploys,
    versions,
    navigateurs,
    pays,
    pcts,
    navigation,
    ressources,
    blocages,
    pires,
    distributions,
    histos,
    choix,
    releaseTuile,
    releaseIndisponible,
    vitauxB,
    vitauxA,
    serieB,
    panneau: panneau && panneauLu ? { route: panneau, lecture: panneauLu } : null,
  } as const;
}) satisfies Chargeur<unknown>;
