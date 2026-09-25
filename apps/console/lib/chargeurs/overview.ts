// LE CHARGEUR DE LA « Vue d'ensemble » (C4) — `app/page.tsx`.
//
// L'écran le plus lourd de la console, et composable : le choix des blocs (cookie
// de la console, passé ici en paramètre `blocs`) est lu AVANT les requêtes — un
// bloc éteint ne coûte rien. `overviewStats` reste inconditionnel : le bandeau
// « pas encore de données » en dépend, même sur un tableau de bord réduit au minimum.
//
// En deux temps : les lectures de l'écran, chacune une section (F02, § 3.8) ; puis
// les RELEASES COMPARÉES (§ 3.2) — celles de l'URL, sinon la règle du dernier
// déploiement —, lues sous `cmp=release` pour les tuiles, le hero et la zone 8.
//
// UN JOUR VOYAGE EN CLÉ « AAAA-MM-JJ » : la grille d'historique regroupe par
// `date_trunc('day', … at time zone <app>)`, un `timestamp` sans fuseau que
// node-postgres rend en `Date` à minuit HEURE LOCALE du processus ; la clé est
// formée ici (`cleJour`), par le processus qui a lu la ligne.
import { availableBreakdowns, BREAKDOWN_PARAM, datasetAvailability, parseBreakdown } from "../breakdowns";
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { filtersOfQuery } from "../filters";
import { analyserFiltres } from "../filtres-ecran";
import { VITAUX, type VitalName } from "../fmt-ids";
import { cleJour } from "../forecast";
import { fuseauDe } from "../fuseau";
import { healthScore } from "../health";
import { avecCondition } from "../perf-domain";
import { choisirReleases } from "../presets";
import { overviewStats, pageviewSeries, samplingVitals, vitalSeriesN, vitalsP75, type VitalAgg, type VitalSeriesPoint } from "../queries";
import { VITALS_BREAKDOWN_DATASETS, vitalsBreakdown } from "../queries-breakdowns";
import { comparaisonVersions, latestDeployImpact, listDeploys } from "../queries-deploys";
import { errorSeries, erreursNavigateur, listErrorGroups } from "../queries-errors";
import { dailyLcpSeries, healthGrid, type DailyLcp } from "../queries-grid";
import { engagementStats, observedVisitorsTrend } from "../queries-sessions";
import { alertFirings, correlationCards, correlationConcordance, unackedAlertCount } from "../queries-v2";
import { UnsupportedFilterError } from "../query-compiler";
import { paramReader } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { lireComparaison } from "../view-state";
import { ALERTES_PAR_EVENEMENT, releasesComparees, sansConditionRelease } from "../vue-ensemble";
import { blocsDe, section, sansSection, type Chargeur } from "./commun";

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
/** Les trois petits multiples du hero (§ 5.1.2) : trois unités, trois échelles. */
export const VITAUX_HERO = ["LCP", "INP", "CLS"] as const satisfies readonly VitalName[];
/** Groupes lus pour le classement des segments (CP1 : coupe par volume, puis tri gravité). */
export const DECOUPAGE_LUS = 200;

/**
 * Lecture d'un jeu de données que l'écran ne déclare pas dans sa surface (le robot,
 * `synthetic`) : un filtre de `/` qu'il ne porte pas (appareil, navigateur…) lève
 * `UnsupportedFilterError`, que `lire` relance pour que l'écran refuse. Ici, la
 * section seule le dit (`refus`) ; les autres restent.
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

export const chargerOverview = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.filters;
  const query = ecran.query;
  const blocs = blocsDe(sp, "/");

  // Découpage (P6.3) : l'onglet est jugé sur les mesures RÉELLEMENT groupées — les Web Vitals.
  const schema = await dimensionSchema();
  const dispoDecoupage = datasetAvailability(VITALS_BREAKDOWN_DATASETS, schema);
  const decoupage = blocs.decoupage
    ? parseBreakdown(paramReader(sp).get(BREAKDOWN_PARAM), availableBreakdowns(dispoDecoupage))
    : null;
  // Fuseau de l'app : celui des jours et des heures de la heatmap, et de ses liens (R-T).
  const fuseau = await fuseauDe(query.scope.requestedApp);
  const comparaison = lireComparaison("/", paramReader(sp)).valeur;
  const prev = comparaison.mode === "prev";
  // Sous un filtre porté par une colonne récente (`browser`, v75…), la couverture
  // se juge aussi sur CETTE colonne : une source de plus par colonne exigée.
  const couvertures = (sources: readonly SourceComparaison[]) =>
    Promise.all(sources.flatMap((s) => sourcesSousFiltres(query, s)).map((s) => couverturePrecedente(query, s)));
  // Les releases se choisissent sur TOUTES celles de la fenêtre (§ 3.2, `choisirReleases`).
  const fToutesReleases = filtersOfQuery(sansConditionRelease(query));
  const dispoNavigateur = dispoDecoupage("browser");
  const dispoPays = dispoDecoupage("country");
  /** La série p75 d'un vital sert-elle à un bloc allumé (tuiles, hero, charge) ? */
  const serieUtile = (nom: VitalName) =>
    blocs.vitals || (blocs.hero && (VITAUX_HERO as readonly string[]).includes(nom)) || (blocs.charge && nom === "LCP");

  // CHAQUE LECTURE EST INDÉPENDANTE (F02, § 3.8 règle 1) : une lecture en échec
  // devient `{ ok: false }`, et seule SA section le dit.
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
    lcpQuotidienP7,
  ] = await Promise.all([
    blocs.vitals || blocs.decoupage ? section(() => vitalsP75(f)) : sansSection<VitalAgg[]>([]),
    blocs.vitals && prev ? section(() => vitalsP75(f, true)) : sansSection<VitalAgg[]>([]),
    section(() => overviewStats(f)),
    blocs.trafic && prev ? section(() => overviewStats(f, true)) : sansSection(null),
    blocs.trafic ? section(() => engagementStats(f)) : sansSection(null),
    blocs.trafic && prev ? section(() => engagementStats(f, true)) : sansSection(null),
    blocs.trafic ? section(() => observedVisitorsTrend(f)) : sansSection([]),
    blocs.trafic || blocs.charge ? section(() => pageviewSeries(f)) : sansSection([]),
    blocs.trafic ? section(() => erreursNavigateur(f)) : sansSection(null),
    blocs.trafic && prev ? section(() => erreursNavigateur(f, true)) : sansSection(null),
    blocs.trafic || blocs.charge ? section(() => errorSeries(f)) : sansSection(null),
    // p75 par seau du contrat, sur les mesures brutes (V5) : UNE lecture par vital,
    // mutualisée entre tuiles, hero et panneau LCP de la charge.
    Promise.all(VITAUX.map((nom) => (serieUtile(nom) ? section(() => vitalSeriesN(f, nom)) : sansSection<VitalSeriesPoint[]>([])))),
    blocs.vitals ? section(() => samplingVitals(f)) : sansSection(null),
    // Période précédente des séries (cmp=prev), alignée par rang de seau (§ 3.2).
    Promise.all(
      VITAUX_HERO.map((nom) =>
        prev && (blocs.hero || (blocs.charge && nom === "LCP")) ? section(() => vitalSeriesN(f, nom, true)) : sansSection(null),
      ),
    ),
    // Santé ET constats (anomalies 24 h) : lue même bandeau éteint, les constats en dépendent.
    section(() => healthScore(f)),
    // La grille d'historique : chaque jour en clé « AAAA-MM-JJ » (voir l'en-tête).
    blocs.historique
      ? section(async () => (await healthGrid(f)).map((c) => ({ ...c, day: cleJour(c.day) })))
      : sansSection([]),
    // Angle mort (zone 6) : le COMPTE exact vient de la matrice de concordance (F57).
    blocs.angles ? sectionOuRefus(() => correlationConcordance(f)) : sansSection(null),
    blocs.angles ? sectionOuRefus(() => correlationCards(f)) : sansSection(null),
    // Classement : 200 groupes lus, ordonnés ENSUITE par gravité (CP1).
    decoupage ? section(() => vitalsBreakdown(f, decoupage, DECOUPAGE_LUS)) : sansSection(null),
    // Vues préréglées (§ 3.6) et releases comparées (§ 3.2).
    section(() => listDeploys(f, 20)),
    section(() => comparaisonVersions(fToutesReleases, 12)),
    dispoNavigateur.available ? section(() => vitalsBreakdown(f, "browser", 200)) : sansSection(null),
    dispoPays.available ? section(() => vitalsBreakdown(f, "country", 200)) : sansSection(null),
    // Constats (zone 4) : dernier déploiement, alertes non acquittées, erreurs régressées.
    section(() => latestDeployImpact(f)),
    ALERTES_PAR_EVENEMENT
      ? // Les lignes NOMMÉES viennent du jour UTC en cours (`alertFirings(f, 1)`) ; le
        // « et N autres » se compte sur le total non acquitté.
        section(async () => {
          const [declenchements, total] = await Promise.all([alertFirings(f, 1), unackedAlertCount(f)]);
          return { mode: "evenements" as const, lignes: declenchements.lignes, total };
        })
      : section(async () => ({ mode: "compte" as const, n: await unackedAlertCount(f) })),
    section(() => listErrorGroups(f, { limit: REGRESSES_LUS, offset: 0 })),
    (blocs.vitals || blocs.hero || blocs.charge) && prev ? couvertures([SOURCE_VITAUX]) : Promise.resolve<CouverturePrecedente[]>([]),
    blocs.trafic && prev ? couvertures(SOURCES_TRAFIC) : Promise.resolve<CouverturePrecedente[]>([]),
    // P*.7 — « depuis quand ? » : la datation d'une rupture se lit sur la fenêtre FIXE
    // de 14 jours complets, dans le fuseau de l'app.
    blocs.hero ? section(() => dailyLcpSeries(f, { exclureAujourdhui: true })) : sansSection<DailyLcp[]>([]),
  ]);

  // ─── Releases comparées (§ 3.2) : URL d'abord, sinon la règle du dernier déploiement ───
  const choix = deploys.ok && versionsFenetre.ok ? choisirReleases(deploys.data, versionsFenetre.data.rows) : null;
  const releases = releasesComparees({ relA: comparaison.relA, relB: comparaison.relB }, choix);
  const [[vitalsB, vitalsA], seriesRelease, releasesLues] = await Promise.all([
    // `cmp=release` : les tuiles Web Vitals lisent la release B et la comparent à A.
    comparaison.mode === "release" && blocs.vitals && releases.ok
      ? Promise.all([
          section(() => vitalsP75(avecCondition(f, "release", releases.relB))),
          section(() => vitalsP75(avecCondition(f, "release", releases.relA))),
        ])
      : Promise.resolve([null, null] as const),
    // …et le hero trace deux séries par vital : orange = B, gris pointillé = A (§ 3.2).
    comparaison.mode === "release" && blocs.hero && releases.ok
      ? Promise.all(
          VITAUX_HERO.map(async (nom) => {
            const [b, a] = await Promise.all([
              section(() => vitalSeriesN(avecCondition(f, "release", releases.relB), nom)),
              section(() => vitalSeriesN(avecCondition(f, "release", releases.relA), nom)),
            ]);
            return { b, a };
          }),
        )
      : Promise.resolve(null),
    // Zone 8 : A et B LUES une à une (lecture intersectée `release=<v>`, même fenêtre).
    blocs.versions && releases.ok
      ? Promise.all(
          [releases.relB, releases.relA].map((v) => section(() => comparaisonVersions(avecCondition(fToutesReleases, "release", v), 12))),
        )
      : Promise.resolve(null),
  ]);

  return {
    etat: "ok",
    query,
    label: ecran.label,
    bucketLabel: ecran.bucketLabel,
    schema: [...schema].sort(),
    decoupage,
    fuseau,
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
    lcpQuotidienP7,
    choix,
    releases,
    vitalsB,
    vitalsA,
    seriesRelease,
    releasesLues,
  } as const;
}) satisfies Chargeur<unknown>;
