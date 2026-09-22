import Link from "next/link";
import { Figure } from "@/components/charts/Figure";
import { HealthHeatmap } from "@/components/charts/HealthHeatmap";
import { KpiTile } from "@/components/charts/KpiTile";
import { ImpactTable } from "@/components/ImpactTable";
import { InsightStrip } from "@/components/InsightStrip";
import { PageHeader } from "@/components/PageHeader";
import { PresetBar } from "@/components/PresetBar";
import { ReleaseCompare, statsDeVersion, type ReleaseStats } from "@/components/ReleaseCompare";
import { ChargeErreursLcp, HeroCwv, type AnnotationsFigure, type ModeSeries } from "@/components/vue-ensemble/SeriesVueEnsemble";
import { LIBELLE_ANGLE_MORT, TuileAngleMort, type EtatAngleMort } from "@/components/vue-ensemble/AngleMort";
import { cookies } from "next/headers";
import { catalogueDe, lireChoix } from "@/lib/dashboard-blocs";
import { TousEteints } from "@/components/TousEteints";
import { HealthBanner } from "@/components/health/HealthBanner";
import { AnomalyTable } from "@/components/health/AnomalyTable";
import { VersionsTable } from "@/components/VersionsTable";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { filtersOfQuery, type SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import {
  BREAKDOWN_NOTICES,
  BREAKDOWN_PARAM,
  availableBreakdowns,
  breakdownDrillHref,
  breakdownTabs,
  datasetAvailability,
  groupDescription,
  groupLabel,
  parseBreakdown,
} from "@/lib/breakdowns";
import { etatLectureEchantillonnage } from "@/lib/echantillonnage";
import { healthScore } from "@/lib/health";
import { lire, type Lecture } from "@/lib/lecture";
import { fuseauDe, joursLocaux, libelleDeuxFuseaux } from "@/lib/fuseau";
import { formatDuVital, formater, VITAUX, type FormatId, type VitalName } from "@/lib/fmt-ids";
import { bucketStarts, hrefWithQuery, paramReader } from "@/lib/query-contract";
import { grilleIso, isoSansMs } from "@/lib/series";
import { dimensionSchema } from "@/lib/query-schema";
import { THRESHOLDS } from "@/lib/rating";
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
import { alertFirings, correlationCards, correlationConcordance, unackedAlertCount } from "@/lib/queries-v2";
import { UnsupportedFilterError } from "@/lib/query-compiler";
import { VITALS_BREAKDOWN_DATASETS, vitalsBreakdown, type VitalsBreakdownRow } from "@/lib/queries-breakdowns";
import { GRID_DAYS, healthGrid } from "@/lib/queries-grid";
import { comparaisonVersions, latestDeployImpact, listDeploys, type ComparaisonVersions } from "@/lib/queries-deploys";
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
import { gabaritZoom, lireComparaison, lireEtatDeVue, lireTri, VIEW_CONTEXT_PARAMS } from "@/lib/view-state";
import {
  ALERTES_PAR_EVENEMENT,
  constatsVueEnsemble,
  estVitalDecoupe,
  FENETRE_CONSTATS,
  heuresAngleMort,
  lectureErreursPour100,
  lignesSegments,
  referencePrecedente,
  referenceRelease,
  regleAngleMort,
  releasesComparees,
  sansConditionRelease,
  VITAUX_DECOUPES,
  type VitalDecoupe,
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

/** Groupes lus pour le classement des segments (CP1 : coupe par volume, puis tri gravité). */
const DECOUPAGE_LUS = 200;

/**
 * Lecture d'un jeu de données que l'écran ne déclare pas dans sa surface (le robot,
 * `synthetic`) : un filtre de `/` qu'il ne porte pas (appareil, navigateur…) lève
 * `UnsupportedFilterError`, que `lire` relance pour que l'écran refuse. Ici, la
 * section seule le dit (`refus`) ; les autres restent.
 */
const lireOuRefus = <T,>(fn: () => Promise<T>) =>
  lire<{ refus: null; data: T } | { refus: string }>(async () => {
    try {
      return { refus: null, data: await fn() };
    } catch (e) {
      if (e instanceof UnsupportedFilterError) return { refus: e.message };
      throw e;
    }
  });

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
    concordance,
    cartesRobot,
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
    blocs.vitals || blocs.decoupage ? lire(() => vitalsP75(f)) : sansLecture<VitalAgg[]>([]),
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
    // Angle mort (zone 6) : le COMPTE exact vient de la matrice de concordance (F57),
    // jamais de la liste plafonnée à 50 couples (CP13) ; l'existence du robot, des cartes.
    // Un filtre que le synthétique ne porte pas est un refus dit, pas une panne.
    blocs.angles ? lireOuRefus(() => correlationConcordance(f)) : sansLecture(null),
    blocs.angles ? lireOuRefus(() => correlationCards(f)) : sansLecture(null),
    // Classement : 200 groupes lus, ordonnés ENSUITE par gravité (CP1 : la lecture
    // coupe par volume ; la troncature restante est dite).
    decoupage ? lire(() => vitalsBreakdown(f, decoupage, DECOUPAGE_LUS)) : sansLecture(null),
    // Vues préréglées (§ 3.6) et releases comparées (§ 3.2) : marqueurs de
    // déploiement et releases de la fenêtre, navigateurs et pays mesurés.
    lire(() => listDeploys(f, 20)),
    lire(() => comparaisonVersions(fToutesReleases, 12)),
    dispoNavigateur.available ? lire(() => vitalsBreakdown(f, "browser", 200)) : sansLecture(null),
    dispoPays.available ? lire(() => vitalsBreakdown(f, "country", 200)) : sansLecture(null),
    // Constats (zone 4) : dernier déploiement, alertes non acquittées, erreurs régressées.
    lire(() => latestDeployImpact(f)),
    ALERTES_PAR_EVENEMENT
      ? // Les lignes NOMMÉES viennent du jour UTC en cours (`alertFirings(f, 1)`,
        // § 5.1.2) ; le « et N autres » se compte sur le total non acquitté, sans
        // quoi une alerte d'avant-hier disparaîtrait des constats à minuit UTC.
        lire(async () => {
          const [declenchements, total] = await Promise.all([alertFirings(f, 1), unackedAlertCount(f)]);
          return { mode: "evenements" as const, lignes: declenchements.lignes, total };
        })
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
  // Zone 8 : A et B LUES une à une (lecture intersectée `release=<v>`, même fenêtre, sans
  // le filtre `release` de l'URL). La liste `versionsFenetre` s'arrête aux 12 releases
  // les plus vues : une release venue de l'URL (lien d'annotation, constat de
  // déploiement) hors de ces 12 y aurait « 0 session » alors que les tuiles montrent
  // ses p75.
  const releasesLues =
    blocs.versions && releases.ok
      ? await Promise.all(
          [releases.relB, releases.relA].map((v) => lire(() => comparaisonVersions(avecCondition(fToutesReleases, "release", v), 12))),
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
      // L'ancre amène l'événement à l'écran ; `evt` le met en évidence (F67).
      alerte: (evt) => `${lien("/alerts", { evt: String(evt) })}#evt-${evt}`,
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
  // ─── Zone 6 — heures × route en angle mort (F13, F57) ───
  const etatAngle: EtatAngleMort | null = !blocs.angles
    ? null
    : !concordance.ok || !cartesRobot.ok || concordance.data === null || cartesRobot.data === null
      ? { kind: "echec" }
      : concordance.data.refus !== null || cartesRobot.data.refus !== null
        ? { kind: "refus", raison: concordance.data.refus ?? cartesRobot.data.refus ?? "filtre non porté par le robot" }
        : // Le robot existe s'il a au moins un passage sur le périmètre (`correlationCards`).
          !cartesRobot.data.data.some((c) => c.syn_latency_avg != null)
          ? { kind: "sans_robot" }
          : {
              kind: "ok",
              heures: heuresAngleMort(concordance.data.data.cellules),
              pire: concordance.data.data.anglesMortsParRoute[0]
                ? {
                    route: concordance.data.data.anglesMortsParRoute[0].route,
                    heures: concordance.data.data.anglesMortsParRoute[0].heures,
                    href: lien("/correlation", { serie: concordance.data.data.anglesMortsParRoute[0].serie }),
                  }
                : null,
            };

  // ─── Zone 7 — segments les plus dégradés (F13) ───
  // Le vital qui pilote le classement (`vital=`, défaut LCP) : le découpage ne lit que
  // LCP, INP et CLS (CP2) — FCP et TTFB sont refusés, dits, et le LCP classe.
  const vitalDemande = lireEtatDeVue("/", paramReader(sp)).etat.vital ?? "LCP";
  const vitalClasse: VitalDecoupe = estVitalDecoupe(vitalDemande) ? vitalDemande : "LCP";
  const noteVital = estVitalDecoupe(vitalDemande)
    ? null
    : `classement ${vitalDemande} non disponible : le découpage ne lit que LCP, INP et CLS — classé par LCP p75.`;
  const segments =
    decoupage && decoupe.ok && decoupe.data
      ? lignesSegments(decoupe.data.rows, {
          vital: vitalClasse,
          tri: triDecoupage,
          ensemble: vitals.ok ? (byName[vitalClasse]?.p75 ?? null) : null,
          libelle: groupLabel,
          // Une route ouvre son panneau sur `/pages` (§ 3.3) ; toute autre dimension,
          // `/pages` filtré ; « Inconnu », la condition `is_null`.
          // `/pages` filtré sur le groupe (`route=`, `browser=`…, « Inconnu » : `is_null`).
          // Le panneau route (`panel=route:<r>`, § 3.3) attend F17 : `/pages` ne le lit pas
          // encore, et le lien filtré est celui qui marchait avant F13 (écart déclaré).
          lien: (valeur) => breakdownDrillHref("/pages", query, decoupage, valeur, schema),
          description: (valeur, mesures) => groupDescription(decoupage, valeur, mesures, `mesure(s) ${vitalClasse}`),
        })
      : null;
  const ensembleVital = vitals.ok ? byName[vitalClasse] : undefined;
  const referenceSegments = ensembleVital
    ? {
        libelle: "Ensemble (toute la population filtrée)",
        valeurs: {
          pilote: `${vitalClasse} p75 ${formater(formatDuVital(vitalClasse), ensembleVital.p75)}`,
          volume: formater("count", ensembleVital.n),
          lcp: formater("ms", byName.LCP?.p75 ?? null),
          inp: formater("ms", byName.INP?.p75 ?? null),
          cls: formater("cls", byName.CLS?.p75 ?? null),
        },
      }
    : null;

  // ─── Zone 8 — nouvelle release face à la précédente (F13) ───
  // Lues sans le filtre `release` de l'URL (`fToutesReleases`) : sous `release=B`, A
  // n'aurait aucune session, et la comparaison ne dirait rien.
  // Lue explicitement : aucune ligne pour cette release, c'est réellement aucune session
  // de cette release sur la fenêtre (et plus « hors des 12 plus vues »).
  const statsRelease = (v: string, lu: ComparaisonVersions): ReleaseStats => {
    const ligne = lu.rows.find((r) => r.version === v);
    return ligne ? statsDeVersion(ligne) : { release: v, sessions: 0, lcp_p75: null, inp_p75: null, sessionsEnErreur: null };
  };
  const [lueB, lueA] = releasesLues ?? [null, null];
  const lienRelease = (v: string) => lien("/", { release: v, cmp: null, rel_a: null, rel_b: null });

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
          Trois panneaux empilés, un axe chacun (P5) — 8/12 ; à côté, 4/12, les heures
          où le robot dit « ok » et les visiteurs attendaient (angle mort). */}
      {(blocs.charge || etatAngle) && (
        <div className="mb-6 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12">
          {blocs.charge && (
            <div className={`min-w-0 ${etatAngle ? "xl:col-span-8" : "xl:col-span-12"}`}>
              <SectionErreur titre="Charge, erreurs et LCP">
                <ChargeErreursLcp
                  {...communSeries}
                  mode={modeSeries}
                  lectures={{
                    vues: vues,
                    erreurs:
                      serieErreurs.ok && serieErreurs.data ? { ok: true, data: serieErreurs.data } : { ok: false, raison: "non lue" },
                    lcp: serieDe("LCP"),
                    lcpPrecedent: precedenteDe(0),
                  }}
                />
              </SectionErreur>
            </div>
          )}
          {etatAngle && (
            <div className={`min-w-0 ${blocs.charge ? "xl:col-span-4" : "xl:col-span-12"}`}>
              <SectionErreur titre={LIBELLE_ANGLE_MORT}>
                <TuileAngleMort
                  etat={etatAngle}
                  href={`${lien("/correlation")}#angles-morts`}
                  regle={regleAngleMort(THRESHOLDS.LCP[0])}
                  plage={period.label}
                />
              </SectionErreur>
            </div>
          )}
        </div>
      )}

      {/* Zone 7 — segments classés par GRAVITÉ (P3, IP-Label « top offenders ») :
          p75 du vital choisi, écart à l'ensemble, échantillon faible en fin. Une
          route ouvre son panneau sur `/pages`, une autre dimension `/pages` filtré. */}
      {decoupage && (
        <SectionErreur titre="Segments les plus dégradés">
          {triLu.ignore && (
            <p role="note" className="mb-2 text-xs text-ink-soft" data-testid="impact-avertissement">
              {triLu.ignore}
            </p>
          )}
          {noteVital && (
            <p role="note" className="mb-2 text-xs text-ink-soft" data-testid="impact-vital-refuse">
              {noteVital}
            </p>
          )}
          {!decoupe.ok ? (
            <div className="mb-6">
              <EchecLecture titre="Segments les plus dégradés" />
            </div>
          ) : (
            decoupe.data &&
            segments && (
              <>
                <nav aria-label="Vital qui classe les segments" className="mb-2 flex flex-wrap items-center gap-1 text-xs">
                  <span className="text-ink-soft">Classé par :</span>
                  {VITAUX_DECOUPES.map((v) => (
                    <Link
                      key={v}
                      href={`/?${new URLSearchParams([...baseParams.entries()].filter(([k]) => k !== "vital").concat(v === "LCP" ? [] : [["vital", v]])).toString()}`}
                      scroll={false}
                      aria-current={v === vitalClasse ? "true" : undefined}
                      data-testid={`impact-vital-${v}`}
                      className={`rounded-md border px-2 py-0.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
                        // TEXTE en `perf-ink` sur la teinte `bg-perf/10` (4,5:1 en clair, F01).
                        v === vitalClasse
                          ? "border-perf/50 bg-perf/10 text-perf-ink dark:text-perf"
                          : "border-line text-ink-soft hover:text-ink"
                      }`}
                    >
                      {v} p75
                    </Link>
                  ))}
                </nav>
                <ImpactTable
                  titre="Segments les plus dégradés"
                  onglets={breakdownTabs("/", query, decoupage, dispoDecoupage, {
                    ...contexte,
                    hours: businessHours ? "business" : null,
                    tri: triDecoupage === "volume" ? "volume" : null,
                    vital: vitalClasse === "LCP" ? null : vitalClasse,
                  })}
                  tri={triDecoupage}
                  // `impact` attend le compte des mesures « Mauvais » par groupe (B2) : barré, avec sa raison.
                  triHref={{ gravite: hrefTri(null), volume: hrefTri("volume"), impact: null, fourni: null }}
                  reference={referenceSegments}
                  referenceRaison={
                    vitals.ok ? `aucune mesure ${vitalClasse} sur ${period.label}` : "le p75 de l'ensemble n'a pas pu être lu"
                  }
                  lignes={segments.lignes}
                  colonnes={["LCP p75", "INP p75", "CLS p75"]}
                  unitePilote={vitalClasse === "CLS" ? "cls" : "ms"}
                  volumeLibelle={`Mesures ${vitalClasse}`}
                  groupes={decoupe.data.groups}
                  tronque={decoupe.data.truncated}
                  notice={
                    decoupe.data.truncated
                      ? `${BREAKDOWN_NOTICES[decoupage]} Les ${formater("count", DECOUPAGE_LUS)} groupes les plus mesurés sont classés ; ${formater("count", decoupe.data.groups - decoupe.data.rows.length)} autres, moins mesurés, ne le sont pas.`
                      : BREAKDOWN_NOTICES[decoupage]
                  }
                />
              </>
            )
          )}
        </SectionErreur>
      )}

      {/* Zone 8 — la dernière release face à la précédente, même fenêtre (§ 3.2). La
          règle de choix est écrite ; sous deux releases, la comparaison se tait et dit
          pourquoi. */}
      {blocs.versions && (
        <section className="mb-6 min-w-0" aria-labelledby="release-titre" data-testid="zone-release">
          <h2 id="release-titre" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Nouvelle release face à la précédente
          </h2>
          <SectionErreur titre="Nouvelle release face à la précédente">
            {!releases.ok ? (
              // Sans releases à comparer : leur liste illisible est une panne, pas « moins de deux ».
              !versionsFenetre.ok ? (
                <EchecLecture titre="Nouvelle release face à la précédente" />
              ) : (
                <div className="card p-4" data-testid="release-indisponible">
                  <EtatSurface compact etat={{ kind: "partiel", raison: `comparaison désactivée : ${releases.raison}` }} />
                </div>
              )
            ) : !lueB?.ok || !lueA?.ok ? (
              <EchecLecture titre="Nouvelle release face à la précédente" />
            ) : (
              <ReleaseCompare
                a={statsRelease(releases.relA, lueA.data)}
                b={statsRelease(releases.relB, lueB.data)}
                plage={period.label}
                source={lueB.data.source}
                regleChoix={releases.regle}
                hrefs={{ a: lienRelease(releases.relA), b: lienRelease(releases.relB) }}
                toutesLesVersions={
                  versionsFenetre.ok ? <VersionsTable comparaison={versionsFenetre.data} periodLabel={period.label} /> : undefined
                }
              />
            )}
          </SectionErreur>
        </section>
      )}

      {/* Zone 9 — historique 14 jours fixes, jour × heure dans le fuseau de l'app,
          échelle SÉQUENTIELLE (90 % et 50 % ne sont pas des seuils publiés : R-S). Une
          case ouvre son heure en instants UTC. Rendu seulement si le bloc est allumé. */}
      {blocs.historique && (
        <div className="mb-6 min-w-0">
          <SectionErreur titre="Historique 14 jours">
            <Figure
              titre={`Historique ${GRID_DAYS} jours`}
              aide="healthGrid"
              id="historique"
              etat={
                !grid.ok
                  ? { kind: "erreur", titre: `Historique ${GRID_DAYS} jours` }
                  : grid.data.length === 0
                    ? { kind: "vide", population: "mesure Web Vitals", plage: `les ${GRID_DAYS} derniers jours` }
                    : undefined
              }
              meta={
                <>
                  <span data-testid="historique-fenetre">
                    {GRID_DAYS} jours fixes, indépendants de la période ; le jour en cours est incomplet
                  </span>
                  <span>une case = une heure, fuseau de l&apos;app ({fuseau})</span>
                  <span>légende : % de mesures Bon, pondéré (LCP ×2)</span>
                </>
              }
              lecture={
                businessHours
                  ? "Vue Lun–Ven, 8 h–19 h. Teinte d'une seule couleur : plus foncée, plus de mesures « Bon » ; aucune couleur de verdict."
                  : "Une case vide : aucune donnée sur ce créneau (le RUM n'enregistre que le trafic réel). Teinte d'une seule couleur : plus foncée, plus de mesures « Bon » ; aucune couleur de verdict."
              }
            >
              {/* Heures ouvrées (Lun–Ven, 8 h–19 h) : les créneaux où l'on attend du trafic. */}
              <div className="mb-3 flex w-fit gap-0.5 rounded-lg border border-line bg-panel2 p-0.5">
                <Link
                  href={hrefWith(null)}
                  scroll={false}
                  aria-current={!businessHours ? "true" : undefined}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    !businessHours ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  24 h/24
                </Link>
                <Link
                  href={hrefWith("business")}
                  scroll={false}
                  aria-current={businessHours ? "true" : undefined}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    businessHours ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  Heures ouvrées
                </Link>
              </div>
              {grid.ok && (
                <HealthHeatmap
                  jours={joursLocaux(GRID_DAYS, fuseau)}
                  cellules={grid.data}
                  fuseau={fuseau}
                  zoomHref={gabaritZoomEcran}
                  businessOnly={businessHours}
                />
              )}
            </Figure>
          </SectionErreur>
        </div>
      )}

      {/* Anomalies LCP (24 h) : la section existe toujours — zéro anomalie est une
          information (P6). Cible du badge du bandeau de santé. */}
      {blocs.anomalies && (
        <SectionErreur titre="Anomalies">
          {health.ok ? (
            <AnomalyTable
              health={health.data}
              filtree={health.data.factors.some((x) => x.key === "anomalies" && x.raisonNull === "sous filtre")}
              lien={(a) => {
                const debut = new Date(a.bucket).getTime();
                return lien("/pages", {
                  app: a.app_id,
                  route: a.route,
                  period: null,
                  from: isoSansMs(debut),
                  to: isoSansMs(Math.min(debut + 3_600_000, maintenant)),
                });
              }}
            />
          ) : (
            <div className="mb-6">
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
