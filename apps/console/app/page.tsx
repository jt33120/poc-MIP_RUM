import Link from "next/link";
import { HealthHeatmap } from "@/components/charts/HealthHeatmap";
import { KpiTile } from "@/components/charts/KpiTile";
import { TrafficTimeseries } from "@/components/charts/TrafficTimeseries";
import { VitalsTimeseries } from "@/components/charts/VitalsTimeseries";
import { GlossaryTip } from "@/components/GlossaryTip";
import { InsightStrip } from "@/components/InsightStrip";
import { PageHeader } from "@/components/PageHeader";
import { PresetBar } from "@/components/PresetBar";
import { ChargeErreursLcp, HeroCwv, type AnnotationsFigure, type ModeSeries } from "@/components/vue-ensemble/SeriesVueEnsemble";
import { cookies } from "next/headers";
import { catalogueDe, lireChoix } from "@/lib/dashboard-blocs";
import { TousEteints } from "@/components/TousEteints";
import { VitalCard } from "@/components/VitalCard";
import { HealthBanner } from "@/components/health/HealthBanner";
import { AnomalyTable } from "@/components/health/AnomalyTable";
import { VersionsTable } from "@/components/VersionsTable";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { Breakdown } from "@/components/Breakdown";
import { VITALS_BREAKDOWN_COLUMNS, vitalsBreakdownClasse } from "@/components/breakdown-view";
import { filtersOfQuery, type SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import {
  BREAKDOWN_NOTICES,
  BREAKDOWN_PARAM,
  availableBreakdowns,
  breakdownTabs,
  datasetAvailability,
  parseBreakdown,
} from "@/lib/breakdowns";
import { etatLectureEchantillonnage } from "@/lib/echantillonnage";
import { healthScore } from "@/lib/health";
import { lire, type Lecture } from "@/lib/lecture";
import { fuseauDe, joursLocaux, libelleDeuxFuseaux } from "@/lib/fuseau";
import { formatDuVital, formater, VITAUX, type FormatId, type VitalName } from "@/lib/fmt-ids";
import { bucketStarts, hrefWithQuery, paramReader } from "@/lib/query-contract";
import { alignerSeaux, grilleIso, isoSansMs } from "@/lib/series";
import { cleJour } from "@/lib/forecast";
import { dimensionSchema } from "@/lib/query-schema";
import {
  overviewStats,
  pageviewSeries,
  samplingVitals,
  vitalSeriesN,
  vitalsP75,
  type VitalAgg,
  type VitalSeriesPoint,
} from "@/lib/queries";
import { errorSeries, erreursNavigateur, listErrorGroups } from "@/lib/queries-errors";
import { engagementStats, observedVisitorsTrend } from "@/lib/queries-sessions";
import { alertFirings, unackedAlertCount } from "@/lib/queries-v2";
import { VITALS_BREAKDOWN_DATASETS, vitalsBreakdown, type VitalsBreakdownRow } from "@/lib/queries-breakdowns";
import { dailyLcpSeries, dailyTraffic, GRID_DAYS, healthGrid } from "@/lib/queries-grid";
import {
  comparaisonVersions,
  latestDeployImpact,
  listDeploys,
  type ComparaisonVersions,
} from "@/lib/queries-deploys";
import { ecartP75 } from "@/lib/stats/incertitude";
import {
  couverturePrecedente,
  deltasDeLaRangee,
  sourcesSousFiltres,
  type CouverturePrecedente,
  type SourceComparaison,
} from "@/lib/comparaison";
import { avecCondition, RAISON_AUCUNE_VUE, ratioPour100, serieRatioPour100, sparklineDeCompte } from "@/lib/perf-domain";
import { choisirReleases, vuesProduit, type Entree } from "@/lib/presets";
import { annotationsDeploiements } from "@/lib/annotations";
import { explorerHref } from "@/lib/explorer-page-params";
import { gabaritZoom, lireComparaison, lireTri, VIEW_CONTEXT_PARAMS } from "@/lib/view-state";
import {
  ALERTES_PAR_EVENEMENT,
  constatsVueEnsemble,
  FENETRE_CONSTATS,
  lectureErreursPour100,
  referencePrecedente,
  referenceRelease,
  releasesComparees,
  sansConditionRelease,
} from "@/lib/vue-ensemble";

/** La question de l'écran (P1) : le sous-titre de l'en-tête. */
const QUESTION = "Les vrais visiteurs vont-ils bien sur cette période, et sinon, où et depuis quand ?";

// Sources des deux rangées de tuiles comparées à la période précédente (§ 3.2).
// « Sessions commencées » se date par `started_at` (R-P). Le ratio d'erreurs
// n'est pas un compte : le retard d'ingestion touche son numérateur ET son
// dénominateur, il n'est pas traité comme additif.
const SOURCE_VITAUX: SourceComparaison = { table: "rum_metric", colonneTemps: "ts", additive: false };
const SOURCES_TRAFIC: SourceComparaison[] = [
  { table: "rum_session", colonneTemps: "started_at", additive: true },
  { table: "rum_pageview", colonneTemps: "started_at", additive: true },
  { table: "rum_error", colonneTemps: "ts", additive: false },
];

/** Groupes d'erreurs lus pour y chercher les régressés (ordre CP9 : régressés d'abord). */
const REGRESSES_LUS = 50;
/** Sous ce nombre de mesures, un vital est « échantillon faible » (§ 3.12). */
const VITAL_FAIBLE_SOUS = 100;
/** Les trois petits multiples du hero (§ 5.1.2) : trois unités, trois échelles. */
const VITAUX_HERO = ["LCP", "INP", "CLS"] as const satisfies readonly VitalName[];

export const dynamic = "force-dynamic";

/** Lecture non lancée (bloc éteint) : une valeur sûre, jamais affichée comme mesure. */
const sansLecture = <T,>(data: T): Promise<Lecture<T>> => Promise.resolve({ ok: true, data });

/** Une tuile, ou l'échec de sa lecture (jamais un « 0 » ou un « — » pour une fenêtre non lue). */
type Tuile = { cle: string; titre: string } & (
  | { props: React.ComponentProps<typeof KpiTile> }
  | { echec: true }
);

// PAS DE `<Suspense>` AUTOUR DE L'ÉCRAN, ni de `loading.tsx` (F02, correctif). Une
// frontière de chargement posée au-dessus de TOUTE la page bloquait les
// navigations qui ne changent que la query (période, comparaison, segment) : la
// transition de `router.replace` ne se validait plus, l'URL restait l'ancienne
// (e2e `etat-de-vue`, `navigation-filtres`). Les frontières restent PAR SECTION
// (`SectionErreur`), où elles ne gênent pas la navigation.
export default async function Overview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/");
  if (!ecran.ok) return <FilterProblemNotice title="Vue d'ensemble" problem={ecran.problem} />;
  const f = ecran.filters;
  const query = ecran.query;
  const period = { label: ecran.label, bucketLabel: ecran.bucketLabel };

  // toggle « heures ouvrées » de la heatmap, porté par l'URL (?hours=business),
  // en préservant les autres filtres (app/période/device)
  const businessHours = sp.hours === "business";
  const baseParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") baseParams.set(k, v);
  const hrefWith = (val: string | null) => {
    const p = new URLSearchParams(baseParams);
    if (val) p.set("hours", val);
    else p.delete("hours");
    const qs = p.toString();
    return qs ? `/?${qs}` : "/";
  };
  // Comparaison choisie (`cmp`, `rel_a`, `rel_b`) : elle suit la navigation (§ 3.1),
  // donc chaque lien vers un autre écran la reporte, avec la population et la plage.
  const contexte: Record<string, string | null> = {};
  for (const nom of VIEW_CONTEXT_PARAMS) contexte[nom] = typeof sp[nom] === "string" ? (sp[nom] as string) : null;
  const lien = (chemin: string, extra: Record<string, string | null> = {}) =>
    hrefWithQuery(chemin, query, { ...contexte, ...extra });

  // Le choix des blocs est lu ICI, AVANT les requêtes : un bloc éteint ne coûte
  // rien. Masquer en CSS aurait laissé tout le travail serveur en place, ce qui
  // vide la fonctionnalité de son intérêt sur un écran qui porte neuf requêtes.
  //
  // `overviewStats(f)` reste inconditionnel : le bandeau « pas encore de
  // données » en dépend, et il doit s'afficher même sur un tableau de bord
  // réduit au minimum — c'est justement là qu'on a besoin de savoir pourquoi
  // l'écran est vide.
  const cat = catalogueDe("/")!;
  const blocs = lireChoix(cat, (await cookies()).get(cat.cookie)?.value);

  // Découpage (P6.3) : l'onglet est jugé sur les mesures RÉELLEMENT groupées —
  // les Web Vitals — et non sur ce que l'écran sait filtrer. L'accueil compte
  // aussi des sessions, qui ne portent pas de route : c'est pourquoi le clic sur
  // un groupe de routes ouvre `/pages`, la surface qui sait appliquer ce filtre.
  const schema = await dimensionSchema();
  const dispoDecoupage = datasetAvailability(VITALS_BREAKDOWN_DATASETS, schema);
  const decoupage = blocs.decoupage
    ? parseBreakdown(paramReader(sp).get(BREAKDOWN_PARAM), availableBreakdowns(dispoDecoupage))
    : null;
  // Ordre du découpage (F05, P3) : gravité par défaut, `tri=volume` sur demande.
  // `tri=impact` attend le compte des mesures « Mauvais » (B2) : ignoré et SIGNALÉ
  // par `lireTri`, jamais trié au hasard. La bascule garde tous les autres paramètres.
  const triLu = lireTri("/", paramReader(sp));
  const triDecoupage = triLu.tri === "volume" ? "volume" : "gravite";
  const hrefTri = (valeur: "volume" | null) => {
    const p = new URLSearchParams(baseParams);
    if (valeur) p.set("tri", valeur);
    else p.delete("tri");
    const qs = p.toString();
    return qs ? `/?${qs}` : "/";
  };
  // Fuseau de l'app : celui des jours et des heures de la heatmap, et de ses liens (R-T).
  const fuseau = await fuseauDe(query.scope.requestedApp);

  // Comparaison (F06) : la période précédente n'est lue qu'en `cmp=prev` (défaut de
  // cet écran), et ses écarts ne s'affichent que si elle est COMPLÈTE — une plage
  // de 30 jours, dont la précédente est purgée, n'en montre donc aucun.
  const comparaison = lireComparaison("/", paramReader(sp)).valeur;
  // Un seul gabarit de zoom pour l'écran : la heatmap (et le hero, F04) ne changent
  // que la plage — comparaison, tri, découpage et heures ouvrées restent.
  const gabaritZoomEcran = gabaritZoom(hrefWithQuery("/", query, { period: null, from: "{from}", to: "{to}" }), sp);
  const prev = comparaison.mode === "prev";
  // Sous un filtre porté par une colonne récente (`browser`, v75…), la couverture
  // se juge aussi sur CETTE colonne : une source de plus par colonne exigée.
  const couvertures = (sources: readonly SourceComparaison[]) =>
    Promise.all(sources.flatMap((s) => sourcesSousFiltres(query, s)).map((s) => couverturePrecedente(query, s)));
  // Les releases se choisissent sur TOUTES celles de la fenêtre : sous `release=B`,
  // la lecture des versions n'en verrait qu'une (§ 3.2, `choisirReleases`).
  const fToutesReleases = filtersOfQuery(sansConditionRelease(query));
  const dispoNavigateur = dispoDecoupage("browser");
  const dispoPays = dispoDecoupage("country");
  /** La série p75 d'un vital sert-elle à un bloc allumé (tuiles, hero, charge) ? */
  const serieUtile = (nom: VitalName) =>
    blocs.vitals || (blocs.hero && (VITAUX_HERO as readonly string[]).includes(nom)) || (blocs.charge && nom === "LCP");

  // CHAQUE LECTURE EST INDÉPENDANTE (F02, § 3.8 règle 1). `lire()` ne lève pas :
  // une lecture en échec devient `{ ok: false }`, et seule SA section le dit. Le
  // `Promise.all` d'avant rejetait au premier échec et emportait tout l'écran —
  // quand il ne recevait pas, des lectures « fail-soft », des vides et des zéros
  // qu'on lisait comme une période calme. `couverturePrecedente` ne lève pas : une
  // lecture en échec y devient déjà une couverture « inconnue », avec sa raison.
  const [
    vitals,
    vitalsPrev,
    stats,
    statsPrev,
    engagement,
    engagementPrev,
    tendanceSessions,
    vues,
    erreurs,
    erreursPrev,
    serieErreurs,
    seriesVitaux,
    echantillonnage,
    seriesPrecedentes,
    health,
    grid,
    traffic,
    dailyLcp,
    versions,
    decoupe,
    deploys,
    versionsFenetre,
    navigateurs,
    pays,
    impact,
    alertes,
    groupesErreurs,
    couvVitaux,
    couvTrafic,
  ] = await Promise.all([
    blocs.vitals || blocs.reseau || blocs.decoupage ? lire(() => vitalsP75(f)) : sansLecture<VitalAgg[]>([]),
    blocs.vitals && prev ? lire(() => vitalsP75(f, true)) : sansLecture<VitalAgg[]>([]),
    lire(() => overviewStats(f)),
    blocs.trafic && prev ? lire(() => overviewStats(f, true)) : sansLecture(null),
    blocs.trafic ? lire(() => engagementStats(f)) : sansLecture(null),
    blocs.trafic && prev ? lire(() => engagementStats(f, true)) : sansLecture(null),
    blocs.trafic ? lire(() => observedVisitorsTrend(f)) : sansLecture([]),
    blocs.trafic || blocs.charge ? lire(() => pageviewSeries(f)) : sansLecture([]),
    blocs.trafic ? lire(() => erreursNavigateur(f)) : sansLecture(null),
    blocs.trafic && prev ? lire(() => erreursNavigateur(f, true)) : sansLecture(null),
    blocs.trafic || blocs.charge ? lire(() => errorSeries(f)) : sansLecture(null),
    // p75 par seau du contrat, sur les mesures brutes (V5) : sparkline de chaque tuile
    // Web Vital, petits multiples du hero et panneau LCP de la charge — UNE lecture par
    // vital, mutualisée entre les trois.
    Promise.all(VITAUX.map((nom) => (serieUtile(nom) ? lire(() => vitalSeriesN(f, nom)) : sansLecture<VitalSeriesPoint[]>([])))),
    blocs.vitals ? lire(() => samplingVitals(f)) : sansLecture(null),
    // Période précédente des séries (cmp=prev), alignée par rang de seau (§ 3.2).
    Promise.all(
      VITAUX_HERO.map((nom) =>
        prev && (blocs.hero || (blocs.charge && nom === "LCP")) ? lire(() => vitalSeriesN(f, nom, true)) : sansLecture(null),
      ),
    ),
    // Santé ET constats (anomalies 24 h) : lue même bandeau éteint, les constats en dépendent.
    lire(() => healthScore(f)),
    blocs.historique ? lire(() => healthGrid(f)) : sansLecture([]),
    blocs.historique ? lire(() => dailyTraffic(f)) : sansLecture([]),
    blocs.historique ? lire(() => dailyLcpSeries(f)) : sansLecture([]),
    blocs.versions
      ? lire(() => comparaisonVersions(f))
      : sansLecture<ComparaisonVersions>({ rows: [], source: "occurrence" }),
    decoupage ? lire(() => vitalsBreakdown(f, decoupage)) : sansLecture(null),
    // Vues préréglées (§ 3.6) et releases comparées (§ 3.2) : marqueurs de
    // déploiement et releases de la fenêtre, navigateurs et pays mesurés.
    lire(() => listDeploys(f, 20)),
    lire(() => comparaisonVersions(fToutesReleases, 12)),
    dispoNavigateur.available ? lire(() => vitalsBreakdown(f, "browser", 200)) : sansLecture(null),
    dispoPays.available ? lire(() => vitalsBreakdown(f, "country", 200)) : sansLecture(null),
    // Constats (zone 4) : dernier déploiement, alertes non acquittées, erreurs régressées.
    lire(() => latestDeployImpact(f)),
    ALERTES_PAR_EVENEMENT
      ? lire(async () => ({ mode: "evenements" as const, lignes: (await alertFirings(f, 1)).lignes }))
      : lire(async () => ({ mode: "compte" as const, n: await unackedAlertCount(f) })),
    lire(() => listErrorGroups(f, { limit: REGRESSES_LUS, offset: 0 })),
    (blocs.vitals || blocs.hero || blocs.charge) && prev
      ? couvertures([SOURCE_VITAUX])
      : Promise.resolve<CouverturePrecedente[]>([]),
    blocs.trafic && prev ? couvertures(SOURCES_TRAFIC) : Promise.resolve<CouverturePrecedente[]>([]),
  ]);

  // ─── Releases comparées (§ 3.2) : URL d'abord, sinon la règle du dernier déploiement ───
  const choix = deploys.ok && versionsFenetre.ok ? choisirReleases(deploys.data, versionsFenetre.data.rows) : null;
  const releases = releasesComparees({ relA: comparaison.relA, relB: comparaison.relB }, choix);
  // `cmp=release` : les tuiles Web Vitals lisent la release B et la comparent à A,
  // même fenêtre (§ 5.1.2). Deux lectures de plus, lancées seulement dans ce mode.
  const [vitalsB, vitalsA] =
    comparaison.mode === "release" && blocs.vitals && releases.ok
      ? await Promise.all([
          lire(() => vitalsP75(avecCondition(f, "release", releases.relB))),
          lire(() => vitalsP75(avecCondition(f, "release", releases.relA))),
        ])
      : [null, null];
  // …et le hero trace deux séries par vital : orange = B, gris pointillé = A (§ 3.2).
  const seriesRelease =
    comparaison.mode === "release" && blocs.hero && releases.ok
      ? await Promise.all(
          VITAUX_HERO.map(async (nom) => {
            const [b, a] = await Promise.all([
              lire(() => vitalSeriesN(avecCondition(f, "release", releases.relB), nom)),
              lire(() => vitalSeriesN(avecCondition(f, "release", releases.relA), nom)),
            ]);
            return { b, a };
          }),
        )
      : null;

  const deltasVitaux = deltasDeLaRangee(comparaison.mode, couvVitaux);
  const deltasTrafic = deltasDeLaRangee(comparaison.mode, couvTrafic);
  // Une ligne par raison distincte : la rétention, qui touche toutes les sources, n'est dite qu'une fois.
  const notesComparaison = [
    ...new Set(
      [blocs.vitals ? deltasVitaux.note : null, blocs.trafic ? deltasTrafic.note : null].filter(
        (n): n is string => n !== null,
      ),
    ),
  ];

  // ─── Rangée trafic (zone 2) ───
  const debutsSeaux = bucketStarts(query.range);
  const grilleContrat = grilleIso(debutsSeaux);
  const referencePrev = referencePrecedente(query.range);
  // La référence n'est posée que si la période précédente est COMPLÈTE : sinon aucun
  // écart, et la note de rangée dit pourquoi (une fois, pas huit fois).
  const comparerTrafic = prev && deltasTrafic.deltas;
  const couvComplete: CouverturePrecedente = { etat: "complete", raison: null };
  const precedentOu = <T,>(lu: Lecture<T | null>, valeur: (d: T) => number | null) =>
    !comparerTrafic || !lu.ok || lu.data === null ? undefined : valeur(lu.data);
  const refTrafic = comparerTrafic ? { reference: referencePrev, couverturePrecedente: couvComplete } : {};

  const tuilesTrafic: Tuile[] = [];
  if (blocs.trafic) {
    // Sessions COMMENCÉES (R-P) : la même population que la tuile de tête de
    // `/sessions`, et la sparkline compte la même (Σ seaux = valeur, sinon retirée).
    tuilesTrafic.push(
      !engagement.ok || engagement.data === null
        ? { cle: "sessions", titre: "Sessions commencées", echec: true }
        : {
            cle: "sessions",
            titre: "Sessions commencées",
            props: {
              label: "Sessions commencées",
              valeur: engagement.data.sessions_started,
              format: "count",
              sensMeilleur: "neutre",
              precedent: precedentOu(engagementPrev, (d) => d.sessions_started),
              ...refTrafic,
              serie: tendanceSessions.ok
                ? (sparklineDeCompte(
                    tendanceSessions.data.map((b) => ({ bucket: b.bucket, n: b.sessions })),
                    debutsSeaux,
                    engagement.data.sessions_started,
                  ) ?? undefined)
                : undefined,
              href: lien("/sessions"),
            },
          },
    );
    const vuesParSeau = vues.ok ? vues.data.map((v) => ({ bucket: v.bucket, n: v.chargements + v.spa + v.inconnu })) : null;
    tuilesTrafic.push(
      !stats.ok
        ? { cle: "pages-vues", titre: "Pages vues", echec: true }
        : {
            cle: "pages-vues",
            titre: "Pages vues",
            props: {
              label: "Pages vues",
              valeur: stats.data.pageviews,
              format: "count",
              sensMeilleur: "neutre",
              precedent: precedentOu(statsPrev, (d) => d.pageviews),
              ...refTrafic,
              serie: vuesParSeau ? (sparklineDeCompte(vuesParSeau, debutsSeaux, stats.data.pageviews) ?? undefined) : undefined,
              href: lien("/pages"),
            },
          },
    );
    // Un RATIO de deux comptes (CP14) : format « pour 100 », jamais « % » ; sans vue, `null`.
    tuilesTrafic.push(
      !stats.ok || !erreurs.ok || erreurs.data === null
        ? { cle: "erreurs", titre: "Occurrences d'erreurs pour 100 pages vues", echec: true }
        : {
            cle: "erreurs",
            titre: "Occurrences d'erreurs pour 100 pages vues",
            props: {
              label: "Occurrences d'erreurs pour 100 pages vues",
              valeur: ratioPour100(erreurs.data.navigateur, stats.data.pageviews),
              raisonNull: RAISON_AUCUNE_VUE,
              format: "pour100",
              sensMeilleur: "bas",
              precedent:
                comparerTrafic && statsPrev.ok && statsPrev.data && erreursPrev.ok && erreursPrev.data
                  ? ratioPour100(erreursPrev.data.navigateur, statsPrev.data.pageviews)
                  : undefined,
              ...refTrafic,
              lecture: lectureErreursPour100(erreurs.data),
              serie:
                serieErreurs.ok && serieErreurs.data && vues.ok
                  ? serieRatioPour100(serieErreurs.data.points, vues.data).map((p) => p.ratio)
                  : undefined,
              href: lien("/errors"),
            },
          },
    );
  }
  // La période précédente illisible (et non incomplète) : les tuiles perdent leur
  // écart, et le disent — une absence de flèche ne doit pas se lire « stable ».
  const rangeesIllisibles = [
    comparerTrafic && (!statsPrev.ok || !engagementPrev.ok || !erreursPrev.ok) ? "le trafic" : null,
    blocs.vitals && prev && deltasVitaux.deltas && !vitalsPrev.ok ? "les Web Vitals" : null,
  ].filter((r): r is string => r !== null);
  const precedenteIllisible = rangeesIllisibles.length
    ? `la période précédente n'a pas pu être lue : aucune variation n'est affichée sur ${rangeesIllisibles.join(" ni sur ")}.`
    : null;

  // ─── Rangée Web Vitals (zone 3) ───
  const byName = Object.fromEntries((vitals.ok ? vitals.data : []).map((v) => [v.name, v]));
  const prevByName = Object.fromEntries((vitalsPrev.ok ? vitalsPrev.data : []).map((v) => [v.name, v]));
  const modeRelease = comparaison.mode === "release" && releases.ok && vitalsB !== null && vitalsA !== null;
  const bByName = Object.fromEntries((vitalsB?.ok ? vitalsB.data : []).map((v) => [v.name, v]));
  const aByName = Object.fromEntries((vitalsA?.ok ? vitalsA.data : []).map((v) => [v.name, v]));
  // La règle d'`ecartP75` nomme « la période précédente » : en comparaison de
  // releases, la référence est la release A, et la phrase doit le dire.
  const ecartDeTuile = (courant: VitalAgg["intervalle"] | undefined, reference: VitalAgg["intervalle"] | undefined, format: FormatId) => {
    const e = ecartP75(courant, reference, (v) => formater(format, v));
    return e && modeRelease && releases.ok ? { ...e, regle: e.regle.replace("période précédente", `release ${releases.relA}`) } : e;
  };
  const tuilesVitaux: Tuile[] = VITAUX.map((nom, i): Tuile => {
    const titre = `${nom} p75`;
    const lecture = modeRelease ? vitalsB : vitals;
    if (!lecture?.ok) return { cle: nom, titre, echec: true };
    const format = formatDuVital(nom);
    const courant: VitalAgg | undefined = modeRelease ? bByName[nom] : byName[nom];
    const n = courant?.n ?? 0;
    // Sous 100 mesures, la médiane accompagne le p75 (« échantillon faible · médiane »).
    const mediane = courant && n < VITAL_FAIBLE_SOUS ? `médiane ${formater(format, courant.p50)}` : null;
    const reference = modeRelease && releases.ok ? referenceRelease(releases.relA) : prev && deltasVitaux.deltas ? referencePrev : undefined;
    const precedentLu = modeRelease ? aByName[nom] : prevByName[nom];
    const serieLue = seriesVitaux[i];
    return {
      cle: nom,
      titre,
      props: {
        label: titre,
        valeur: courant?.p75 ?? null,
        raisonNull: `aucune mesure ${nom} sur ${modeRelease && releases.ok ? `la release ${releases.relB}, ` : ""}${period.label}`,
        format,
        vital: nom,
        precedent:
          reference === undefined || (!modeRelease && !vitalsPrev.ok) || (modeRelease && !vitalsA?.ok)
            ? undefined
            : (precedentLu?.p75 ?? null),
        reference,
        couverturePrecedente: reference ? { etat: "complete", raison: null, n: precedentLu?.n ?? null } : undefined,
        couverture: { n, unite: "mesures", faibleSous: VITAL_FAIBLE_SOUS },
        intervalle: courant?.intervalle,
        // P*.1 : pas de test sur deux p75 ; leurs intervalles comparés disent si
        // l'écart est établi — contre la période précédente, ou contre la release A.
        ecart: reference ? ecartDeTuile(courant?.intervalle, precedentLu?.intervalle, format) : null,
        lecture: [modeRelease && releases.ok ? `release ${releases.relB} seulement` : null, mediane]
          .filter(Boolean)
          .join(" · ") || undefined,
        // La sparkline compte la population de la valeur : sous `cmp=release`, la
        // valeur est celle de la release B, la courbe de toute la population — retirée.
        serie: !modeRelease && serieLue.ok ? serieLue.data.map((p) => p.p75) : undefined,
        href: lien("/pages", { vital: nom }),
      },
    };
  });
  const etatEchantillon = blocs.vitals && echantillonnage.ok && echantillonnage.data
    ? etatLectureEchantillonnage({ ok: true, data: echantillonnage.data })
    : blocs.vitals && !echantillonnage.ok
      ? etatLectureEchantillonnage({ ok: false, raison: echantillonnage.raison })
      : null;

  // ─── Vues préréglées (zone 1, § 3.6) ───
  const entreeReleases: Entree<ReturnType<typeof choisirReleases>> = choix
    ? { valeur: choix }
    : { indisponible: "lecture des releases de la fenêtre en échec" };
  // Une dimension absente de la base (colonne d'avant v75) ou illisible : la vue qui
  // en dépend est affichée désactivée, avec sa raison (§ 3.6).
  const lignesDecoupage = (
    lu: typeof navigateurs,
    dispo: { available: boolean; reason: string | null },
    quoi: string,
  ): Entree<VitalsBreakdownRow[]> =>
    !dispo.available
      ? { indisponible: dispo.reason ?? `${quoi} non collectés` }
      : lu.ok && lu.data
        ? { valeur: lu.data.rows }
        : { indisponible: `lecture des ${quoi} en échec` };
  const navLus = lignesDecoupage(navigateurs, dispoNavigateur, "navigateurs");
  const paysLus = lignesDecoupage(pays, dispoPays, "pays estimés");
  const vuesPrereglees = vuesProduit({
    releases: entreeReleases,
    navigateurs: navLus,
    pays: "valeur" in paysLus ? { valeur: paysLus.valeur.map((l) => ({ valeur: l.valeur, volume: l.samples })) } : paysLus,
  });

  // ─── Constats (zone 4) ───
  const maintenant = Math.floor(Date.now() / 60_000) * 60_000;
  const versionPrecedente = (version: string | null) =>
    deploys.ok && version ? (deploys.data.find((d) => d.version && d.version !== version)?.version ?? null) : null;
  const constats = constatsVueEnsemble(
    {
      anomalies: health.ok
        ? {
            ok: true,
            data: {
              lignes: health.data.anomalies,
              filtrees: health.data.factors.some((x) => x.key === "anomalies" && x.raisonNull === "sous filtre"),
            },
          }
        : { ok: false },
      deploiement: impact.ok
        ? { ok: true, data: impact.data ? { impact: impact.data, versionPrecedente: versionPrecedente(impact.data.version) } : null }
        : { ok: false },
      alertes: alertes.ok ? { ok: true, data: alertes.data } : { ok: false },
      regresses: groupesErreurs.ok
        ? { ok: true, data: groupesErreurs.data.groups.filter((g) => g.regressed) }
        : { ok: false },
    },
    {
      // L'heure de l'anomalie, bornée à la minute passée : le contrat refuse un `to` futur.
      anomalie: (a) => {
        const debut = new Date(a.bucket).getTime();
        return lien("/pages", {
          app: a.app_id,
          route: a.route,
          period: null,
          from: isoSansMs(debut),
          to: isoSansMs(Math.min(debut + 3_600_000, maintenant)),
        });
      },
      deploiement: (relB, relA) => hrefWithQuery("/", query, { cmp: "release", rel_b: relB, rel_a: relB ? relA : null }),
      alertes: lien("/alerts"),
      alerte: (evt) => lien("/alerts", { evt: String(evt) }),
      // Le panneau erreur (`panel=error:<fp>`, F20) et le filtre `statut` (F19) ne sont pas
      // encore lus par `/errors` : la page du groupe, et la liste — où les régressés sont en
      // tête (ordre CP9). Écart déclaré ; F20 / F19 rebasculeront ces deux liens.
      erreur: (g) => lien(`/errors/${encodeURIComponent(g.fingerprint)}`, { app: g.app_id }),
      regresses: lien("/errors"),
    },
  );

  // ─── Séries des zones 5 et 6 (F12) ───
  // SÉRIES SUR GRILLE (§ 3.10) : `vitalSeriesN`, `pageviewSeries` et `errorSeries`
  // rendent déjà un point par seau attendu (F10) ; un seau sans mesure reste un trou,
  // un seau sans page vue vaut 0 page vue. Toutes les figures partagent la grille du
  // contrat, le seau, le gabarit de zoom et les annotations de déploiement.
  //
  // Comparaison : la période précédente seulement si elle est COMPLÈTE (même règle
  // que les tuiles) ; deux releases seulement si elles sont deux.
  const modeSeries: ModeSeries =
    comparaison.mode === "release" && releases.ok && seriesRelease
      ? { kind: "release", relA: releases.relA, relB: releases.relB }
      : prev && deltasVitaux.deltas
        ? { kind: "prev" }
        : { kind: "simple" };
  // Annotations de déploiement (§ 3.7) : filtrées sur la fenêtre ; sous plage
  // personnalisée, le message B1 à la place des traits ; lecture en échec, dite.
  const deploiements = deploys.ok
    ? annotationsDeploiements(deploys.data, query.range, {
        // Annotation → comparer cette release à la précédente, même écran, même plage (§ 3.3).
        lien: (relB, relA) => hrefWithQuery("/", query, { cmp: "release", rel_b: relB, rel_a: relA }),
      })
    : null;
  const annotations: AnnotationsFigure = deploiements
    ? { annotations: deploiements.annotations, indisponible: deploiements.indisponible }
    : { annotations: [], indisponible: "lecture des marqueurs de déploiement en échec" };
  const communSeries = {
    grille: grilleContrat,
    seauSecondes: query.range.bucketSeconds,
    zoomHref: gabaritZoomEcran,
    annotations,
    plage: period.label,
  };
  const serieDe = (nom: VitalName) => seriesVitaux[VITAUX.indexOf(nom)];
  /** Période précédente d'une série du hero : lue (ou en échec) en `cmp=prev`, sinon aucune. */
  const precedenteDe = (i: number): Lecture<VitalSeriesPoint[]> | null => {
    if (modeSeries.kind !== "prev") return null;
    const lu = seriesPrecedentes[i];
    return !lu.ok ? lu : lu.data ? { ok: true, data: lu.data } : null;
  };
  const lectureHero =
    modeSeries.kind === "release"
      ? `p75 par seau ; orange = release ${modeSeries.relB}, gris pointillé = release ${modeSeries.relA}, même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte. Règle : ${releases.ok ? releases.regle : ""}.`
      : modeSeries.kind === "prev"
        ? `p75 par seau sur les zones Bon / À améliorer / Mauvais ; gris pointillé = ${referencePrev.replace(/^vs /, "")}, aligné par rang de seau. Un seau sous 30 mesures est un point creux ; un seau sans mesure, un trou ; un clic zoome sur le seau.`
        : `p75 par seau sur les zones Bon / À améliorer / Mauvais. Un seau sous 30 mesures est un point creux ; un seau sans mesure, un trou ; un clic zoome sur le seau.${
            comparaison.mode === "release" && !releases.ok
              ? ` Comparaison de releases indisponible : ${releases.raison}.`
              : prev && !deltasVitaux.deltas && deltasVitaux.note
                ? ` Aucune série de référence : ${deltasVitaux.note}.`
                : ""
          }`;
  // L'historique découpe ses JOURS dans le fuseau de l'application (`queries-grid`) :
  // sa grille est celle de `dailyTraffic` (14 jours, vides compris), ou, s'il n'a pas
  // pu être lu, les 14 derniers jours de ce fuseau.
  const jours =
    traffic.ok && traffic.data.length > 0
      ? traffic.data.map((t) => cleJour(t.day))
      : joursLocaux(GRID_DAYS, fuseau, Date.now());
  const debutsJours = jours.map((j) => Date.parse(j));
  const pointsTrafic = traffic.ok
    ? alignerSeaux(
        traffic.data.map((t) => ({ bucket: cleJour(t.day), pageviews: Number(t.pageviews), errors: Number(t.errors) })),
        debutsJours,
        true,
      ).map((r, i) => ({ t: jours[i], pageviews: r?.pageviews ?? null, errors: r?.errors ?? null }))
    : [];
  const pointsLcpJour = dailyLcp.ok
    ? alignerSeaux(
        dailyLcp.data.map((r) => ({ bucket: cleJour(r.bucket), p75: r.p75 == null ? null : Number(r.p75) })),
        debutsJours,
        false,
      ).map((r, i) => ({ t: jours[i], p75: r?.p75 ?? null }))
    : [];

  return (
    <div className="animate-fade-up">
      <PageHeader title="Vue d'ensemble" sub={QUESTION} help="rum" />
      {/* Plage personnalisée (case de la heatmap, zoom) : dite dans les DEUX fuseaux
          (R-T) — « 15/07 09:00-10:00 Europe/Paris (07:00-08:00 UTC) ». */}
      {query.range.preset === null && (
        <p role="note" data-testid="plage-deux-fuseaux" className="-mt-2 mb-4 text-xs text-ink-soft">
          Plage lue : {libelleDeuxFuseaux(query.range.from, query.range.to, fuseau)}
        </p>
      )}

      {f.app && stats.ok && stats.data.sessions === 0 && (
        <div
          data-testid="onboarding-nudge"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm"
        >
          <span className="text-ink">
            <strong>Cette application n&apos;a pas encore reçu de données.</strong> Posez le capteur RUM
            sur votre site, puis simulez un parcours — les mesures apparaîtront ici.
          </span>
          <Link href={`/select/new?app=${encodeURIComponent(f.app)}`} className="btn-accent ml-auto shrink-0 px-3 py-1.5">
            Guide d&apos;intégration →
          </Link>
        </div>
      )}

      {/* Zone 1 — vues préréglées (P13) : une vue ne change que la population. */}
      <div className="mb-4 min-w-0">
        <PresetBar vues={vuesPrereglees} actif={null} />
      </div>

      {/* Pourquoi les tuiles n'ont pas d'écart : dit en clair, UNE fois par raison,
          jamais un delta calculé sur une période à moitié mesurée (§ 3.2). */}
      {(blocs.vitals || blocs.trafic) &&
        (notesComparaison.length > 0 || precedenteIllisible || comparaison.mode === "release") && (
          <div role="note" data-testid="note-comparaison" className="mb-4 space-y-1 text-xs text-ink-soft">
            {notesComparaison.map((note) => (
              <p key={note}>Aucun écart affiché — {note}.</p>
            ))}
            {precedenteIllisible && <p>Aucun écart affiché — {precedenteIllisible}</p>}
            {comparaison.mode === "release" &&
              (releases.ok ? (
                <p>
                  Comparaison de releases ({releases.regle}) : les tuiles Web Vitals lisent la release{" "}
                  {releases.relB} face à {releases.relA}, même fenêtre, sans normalisation de trafic : l&apos;écart mêle
                  le code et le contexte. Les tuiles de trafic n&apos;ont pas d&apos;écart par release.
                </p>
              ) : (
                <p>Comparaison de releases indisponible : {releases.raison}.</p>
              ))}
          </div>
        )}

      {/* Zone 2 — santé (compacte) et trafic, sur une rangée à 1440 px. Le trafic
          prend 7/12 : ses trois tuiles portent des valeurs « 2,4 pour 100 » qu'une
          colonne de 5/12 ne loge pas sans déborder (écart au § 5.1.1, dit en PR). */}
      {(blocs.sante || blocs.trafic) && (
        <div className="mb-6 grid min-w-0 grid-cols-1 gap-4 min-[1400px]:grid-cols-12">
          {blocs.sante && (
            <div className={`min-w-0 ${blocs.trafic ? "min-[1400px]:col-span-5" : "min-[1400px]:col-span-12"}`}>
              <SectionErreur titre="Santé de la période">
                {!health.ok ? (
                  <EchecLecture titre="Santé de la période" />
                ) : (
                  <HealthBanner
                    health={health.data}
                    periodLabel={period.label}
                    compact
                    liens={{
                      vitals: lien("/pages"),
                      errors: lien("/errors"),
                      stability: lien("/sessions"),
                      anomalies: "#anomalies",
                    }}
                  />
                )}
              </SectionErreur>
            </div>
          )}
          {blocs.trafic && (
            <div className={`min-w-0 ${blocs.sante ? "min-[1400px]:col-span-7" : "min-[1400px]:col-span-12"}`}>
              <SectionErreur titre="Trafic">
                <RangeeTuiles tuiles={tuilesTrafic} classes="grid-cols-1 sm:grid-cols-3" />
              </SectionErreur>
            </div>
          )}
        </div>
      )}

      {/* Zone 3 — Web Vitals au p75, verdict et intervalle (P*.1), sparkline sur la bande « Bon ». */}
      {blocs.vitals && (
        <SectionErreur titre="Web Vitals">
          <div className="mb-6 min-w-0">
            <RangeeTuiles tuiles={tuilesVitaux} classes="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" />
            {etatEchantillon && (
              <div className="mt-3">
                <EtatSurface compact etat={etatEchantillon} />
              </div>
            )}
          </div>
        </SectionErreur>
      )}

      {/* Zone 4 — constats automatiques à règle publiée, repliés. */}
      <div className="mb-6 min-w-0">
        <SectionErreur titre="Constats">
          {constats.echecs.length > 0 && (
            <div className="mb-2">
              <EtatSurface
                compact
                etat={{ kind: "partiel", raison: `constats partiels : lecture en échec de ${constats.echecs.join(", ")}` }}
              />
            </div>
          )}
          <InsightStrip constats={constats.constats} regles={constats.regles} fenetre={FENETRE_CONSTATS} />
        </SectionErreur>
      </div>

      {blocs.reseau && (
        <SectionErreur titre="Décomposition réseau du TTFB">
          {vitals.ok ? (
            <PhasesReseau vitals={byName} periodLabel={period.label} />
          ) : (
            <div className="mb-6">
              <EchecLecture titre="Décomposition réseau du TTFB" />
            </div>
          )}
        </SectionErreur>
      )}

      {/* Zone 5 — HERO (P1) : il répond à la question de l'écran, au-dessus du pli à
          1440 × 900. Trois petits multiples, trois unités, trois échelles. */}
      {blocs.hero && (
        <SectionErreur titre="Core Web Vitals dans le temps">
          <HeroCwv
            {...communSeries}
            mode={modeSeries}
            lecture={lectureHero}
            vitaux={VITAUX_HERO.map((nom, i) => ({
              vital: nom,
              courant: serieDe(nom),
              precedent: precedenteDe(i),
              releaseB: seriesRelease?.[i].b ?? null,
              releaseA: seriesRelease?.[i].a ?? null,
              explorer: explorerHref(query, {
                version: 1,
                dataset: "vitals",
                measure: { field: "value", aggregation: "p75" },
                variant: nom,
                groupBy: [],
                visualization: "timeseries",
                limit: 5,
                cursor: null,
              }),
            }))}
          />
        </SectionErreur>
      )}

      {/* Zone 6 — la dégradation coïncide-t-elle avec la charge ou avec des erreurs ?
          Trois panneaux empilés, un axe chacun (P5). */}
      {blocs.charge && (
        <div className="mb-6 min-w-0">
          <SectionErreur titre="Charge, erreurs et LCP">
            <ChargeErreursLcp
              {...communSeries}
              mode={modeSeries}
              lectures={{
                vues: vues,
                erreurs: serieErreurs.ok && serieErreurs.data ? { ok: true, data: serieErreurs.data } : { ok: false, raison: "non lue" },
                lcp: serieDe("LCP"),
                lcpPrecedent: precedenteDe(0),
              }}
            />
          </SectionErreur>
        </div>
      )}

      {/* Découpage (P6.3) : les mêmes Web Vitals, répartis par dimension. Chaque
          groupe ouvre la surface de détail avec la MÊME plage et le filtre du
          groupe en plus — jamais à la place des filtres déjà posés. */}
      {decoupage && (
        <SectionErreur titre="Web Vitals par dimension">
          {!decoupe.ok ? (
            <div className="mb-6">
              <EchecLecture titre="Web Vitals par dimension" />
            </div>
          ) : (
            decoupe.data && (
              <Breakdown
                title="Web Vitals par dimension"
                tabs={breakdownTabs("/", query, decoupage, dispoDecoupage, {
                  hours: businessHours ? "business" : null,
                  tri: triDecoupage === "volume" ? "volume" : null,
                })}
                notice={BREAKDOWN_NOTICES[decoupage]}
                items={vitalsBreakdownClasse(
                  { pathname: "/", query, schema, dimension: decoupage },
                  decoupe.data.rows,
                  { tri: triDecoupage, ensembleLcp: vitals.ok ? (byName.LCP?.p75 ?? null) : null },
                )}
                columns={triDecoupage === "gravite" ? ["Mesures LCP", ...VITALS_BREAKDOWN_COLUMNS] : VITALS_BREAKDOWN_COLUMNS}
                groups={decoupe.data.groups}
                truncated={decoupe.data.truncated}
                measureLabel={triDecoupage === "gravite" ? "LCP p75" : "Mesures"}
                emptyLabel={`Aucune mesure LCP, INP ou CLS sur ${period.label}.`}
                tri={triDecoupage}
                triHref={{ gravite: hrefTri(null), volume: hrefTri("volume") }}
                avertissement={triLu.ignore}
                reference={
                  vitals.ok && byName.LCP
                    ? `Écart au LCP p75 de l'ensemble (toute la population filtrée) : ${formater("ms", byName.LCP.p75)} sur ${byName.LCP.n.toLocaleString("fr-FR")} mesures.`
                    : null
                }
              />
            )
          )}
        </SectionErreur>
      )}

      {/* Historique de santé 14 j (fenêtre fixe, comme les anomalies) :
          heatmap jour × heure + courbes de volume et de p75 LCP associées.
          Rendu SEULEMENT si le bloc est allumé : éteint, ses lectures ne sont pas
          lancées, et l'ancien « Pas assez de données sur 14 jours » affiché à sa
          place décrivait une lecture qui n'avait pas eu lieu. */}
      {blocs.historique && (
      <section className="card mt-6 p-4">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* La bulle d'aide OUVRE le titre au lieu de le clore : posée après un
              intitulé long, sa bulle de 288 px centrée sortait de l'écran par la
              droite et portait la page à 493 px sur une fenêtre de 390. En tête
              de titre, elle s'ouvre toujours vers l'intérieur de la page. */}
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            <GlossaryTip id="healthGrid" />
            Historique de santé — {GRID_DAYS} derniers jours
          </h2>
          {/* filtre heures ouvrées (Lun–Ven, 8h–19h) — ne montre que les créneaux à trafic attendu */}
          <div className="ml-auto flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5">
            <Link
              href={hrefWith(null)}
              scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                !businessHours ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-faint hover:text-ink-soft"
              }`}
            >
              24 h/24
            </Link>
            <Link
              href={hrefWith("business")}
              scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                businessHours ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-faint hover:text-ink-soft"
              }`}
            >
              Heures ouvrées
            </Link>
          </div>
        </div>
        <p className="mb-4 text-xs text-ink-faint">
          Fenêtre fixe (indépendante du filtre période) · une case = une heure, sa couleur = la part de
          mesures « good ».{" "}
          {businessHours
            ? "Vue Lun–Ven, 8h–19h."
            : "Une case vide = aucune page vue ce créneau (le RUM n'enregistre que le trafic réel) — les nuits/week-ends creux sont normaux."}
        </p>
        <SectionErreur titre="Heatmap de santé">
          {!grid.ok ? (
            <EchecLecture titre="Heatmap de santé" />
          ) : grid.data.length > 0 ? (
            <HealthHeatmap
              jours={joursLocaux(GRID_DAYS, fuseau)}
              cellules={grid.data}
              fuseau={fuseau}
              zoomHref={gabaritZoomEcran}
              businessOnly={businessHours}
            />
          ) : (
            <p className="py-10 text-center text-sm text-ink-faint">
              Pas assez de données sur 14 jours — la heatmap se remplit au fil des mesures.
            </p>
          )}
        </SectionErreur>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Volume & fiabilité par jour
            </h3>
            <SectionErreur titre="Volume & fiabilité par jour">
              {!traffic.ok ? (
                <EchecLecture titre="Volume & fiabilité par jour" />
              ) : traffic.data.length ? (
                <TrafficTimeseries
                  grille={jours}
                  points={pointsTrafic}
                  seauSecondes={86_400}
                  fuseau={fuseau}
                  libelleErreurs="Occurrences d'erreurs, toutes sources"
                />
              ) : (
                <p className="py-12 text-center text-sm text-ink-faint">Pas de données.</p>
              )}
            </SectionErreur>
          </div>
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              p75 LCP par jour
            </h3>
            <SectionErreur titre="p75 LCP par jour">
              {!dailyLcp.ok ? (
                <EchecLecture titre="p75 LCP par jour" />
              ) : dailyLcp.data.length ? (
                <VitalsTimeseries
                  vital="LCP"
                  grille={jours}
                  points={pointsLcpJour}
                  seauSecondes={86_400}
                  fuseau={fuseau}
                />
              ) : (
                <p className="py-12 text-center text-sm text-ink-faint">Pas de données.</p>
              )}
            </SectionErreur>
          </div>
        </div>
      </section>
      )}

      {/* Le bloc décide LUI-MÊME de s'afficher : sous deux versions, une
          « comparaison » d'une ligne n'apprend rien (cf. VersionsTable). */}
      {blocs.versions && (
        <SectionErreur titre="Comparaison des versions">
          {versions.ok ? (
            <VersionsTable comparaison={versions.data} periodLabel={period.label} />
          ) : (
            <div className="mt-6">
              <EchecLecture titre="Comparaison des versions" />
            </div>
          )}
        </SectionErreur>
      )}

      {blocs.anomalies && (
        <SectionErreur titre="Anomalies">
          {health.ok ? (
            <AnomalyTable health={health.data} />
          ) : (
            <div className="mt-6">
              <EchecLecture titre="Anomalies" />
            </div>
          )}
        </SectionErreur>
      )}
      {!Object.values(blocs).some(Boolean) && <TousEteints />}
    </div>
  );
}

/**
 * Une rangée de tuiles (§ 3.12 : une rangée = une population). Une tuile dont la
 * lecture a échoué dit l'échec à SA place : ni « 0 », ni « — », qui se liraient
 * comme une mesure sur une fenêtre qu'on n'a simplement pas pu lire.
 */
function RangeeTuiles({ tuiles, classes }: { tuiles: Tuile[]; classes: string }) {
  return (
    <div className={`grid min-w-0 gap-3 ${classes}`}>
      {tuiles.map((t) => (
        <div key={t.cle} className="flex min-w-0 flex-col" data-testid={`tuile-${t.cle}`}>
          {"echec" in t ? <EchecLecture compact titre={t.titre} /> : <KpiTile {...t.props} />}
        </div>
      ))}
    </div>
  );
}

/** Les phases réseau qui composent le TTFB, dans l'ordre chronologique. Libellés
 *  français à l'affichage, noms bruts pour la lecture des données. */
const PHASES: { cle: string; label: string }[] = [
  { cle: "REDIRECT", label: "Redirection" },
  { cle: "DNS", label: "DNS" },
  { cle: "TCP", label: "Connexion" },
  { cle: "TLS", label: "TLS" },
  { cle: "REQUEST", label: "Requête" },
  { cle: "RESPONSE", label: "Réponse" },
];

/**
 * Décomposition du TTFB. Sans elle, la vue d'ensemble donnait le SYMPTÔME — « la
 * première donnée arrive en 900 ms » — sans jamais la cause : un DNS lent, une
 * poignée de main TLS coûteuse et un serveur lent produisent le même TTFB et
 * appellent trois corrections opposées.
 *
 * Aucune requête supplémentaire : `vitalsP75` groupe sur `m.name` sans filtrer,
 * ces lignes étaient déjà dans le résultat, simplement jamais lues.
 *
 * Rendu seulement si au moins une phase a des mesures — un parc qui tourne encore
 * sur une version antérieure du capteur n'en émet pas, et six cartes vides
 * feraient croire à une panne.
 */
function PhasesReseau({
  vitals,
  periodLabel,
}: {
  vitals: Record<string, { p75: number | null; p50: number | null; n: number } | undefined>;
  periodLabel: string;
}) {
  // La redirection vaut 0 sur l'immense majorité des navigations : lui donner une
  // carte permanente gâcherait une place pour n'afficher que des zéros.
  const visibles = PHASES.filter(
    (p) => (vitals[p.cle]?.n ?? 0) > 0 && (p.cle !== "REDIRECT" || (vitals[p.cle]?.p75 ?? 0) > 0),
  );
  if (visibles.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        D&apos;où vient le TTFB — décomposition réseau
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {visibles.map((p) => (
          <VitalCard
            key={p.cle}
            name={p.label}
            p75={vitals[p.cle]?.p75 ?? null}
            median={vitals[p.cle]?.p50 ?? null}
            n={vitals[p.cle]?.n ?? 0}
            periodLabel={periodLabel}
          />
        ))}
      </div>
    </section>
  );
}

