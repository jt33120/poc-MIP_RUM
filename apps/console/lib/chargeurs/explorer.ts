// LE CHARGEUR DE L'« Explorer » (C3) — `app/explorer/page.tsx`.
//
// Rien n'est lancé avant « Exécuter » (`explorerDemande`) ; une fois la requête
// demandée, le résultat et ses deux lectures de CONTEXTE (volume, répartition)
// partent ENSEMBLE — le contexte, à budget plus court, renonce le premier et le
// dit. Sous `cmp=prev`, la même analyse sur la période précédente, et sa
// couverture ; sous une série, les déploiements de la fenêtre.
//
// Les droits d'écriture (ajouter à un tableau de bord, enregistrer une vue) sont
// résolus ICI, avant tout geste : un bouton qui échouerait n'est pas proposé. Les
// écritures elles-mêmes restent des actions de la console (C6).
import type { Section } from "@mip/console-contract";
import type { LectureContexte } from "@/components/explorer/ContexteResultat";
import type { PrecedentResultat } from "@/components/explorer/ResultatAnalyse";
import {
  ExplorerBudgetError,
  UnsupportedExplorerDimension,
  datasetDefinition,
  estAdditive,
  parseExplorerPlan,
  type ExplorerPlan,
} from "../analytics-schema";
import { BREAKDOWN_DIMENSIONS, BREAKDOWN_LABELS, BREAKDOWN_PARAM, type BreakdownDimension } from "../breakdowns";
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente } from "../comparaison";
import { canDashboardAction, dashboardPrincipal } from "../dashboard-access";
import {
  SERIES_MAX,
  datasetChoisi,
  explorerDemande,
  explorerSource,
  planDeRepartition,
  planDeVolume,
  referencePrecedente,
} from "../explorer-page-params";
import { analyserFiltres } from "../filtres-ecran";
import { listDashboards } from "../queries-dashboards";
import { listDeploys, type DeployRow } from "../queries-deploys";
import { exploreAnalytics, type ExplorerMeta, type ExplorerResult } from "../queries-explorer";
import { savedViewReader, savedViewsAvailable } from "../queries-saved-views";
import { DATASET_REGISTRY, dimensionSupport, type DimensionSchema } from "../query-compiler";
import { paramReader, previousRange, type AnalyticsQuery } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { canCreateSavedView } from "../saved-views";
import { lireComparaison } from "../view-state";
import { lire } from "../lecture";
import { section, type Chargeur, type ParametresEcran } from "./commun";

/**
 * W-E7 — dimension de répartition par défaut (§ 5.21.4) : l'appareil. C'est la seule
 * dimension que TOUS les jeux portent par la session, et la plus lisible sans
 * connaître le site ; `split` en choisit une autre.
 */
const REPARTITION_DEFAUT: BreakdownDimension = "device";

/**
 * Budget des lectures de CONTEXTE (W-E2, W-E7), plus court que celui du résultat
 * (`EXPLORER_TIMEOUT_MS`, 5 s) — délibérément. Un contexte n'est pas la réponse : s'il
 * ne tient pas dans ce budget, il se tait et le dit, plutôt que de retarder ou de
 * faire échouer la figure qu'il accompagne.
 */
const BUDGET_CONTEXTE_MS = 1_500;

/**
 * Ce que l'URL de l'Explorer demande, pour un schéma de dimensions : jeu, plan,
 * exécution, répartition. La MÊME fonction pour le chargeur (quoi lire) et la page
 * (quoi afficher).
 */
export function demandeExplorer(query: AnalyticsQuery, sp: ParametresEcran, schema: DimensionSchema) {
  const reader = paramReader(sp);
  const dataset = datasetChoisi(reader);
  const definition = datasetDefinition(dataset);
  const plan = parseExplorerPlan({ ...explorerSource(reader), dataset }, query);
  const demande = explorerDemande(reader);
  // W-E7 — dimensions de la répartition : les six onglets de découpage, chacun avec
  // sa disponibilité RÉELLE sur ce jeu (`dimensionSupport`). Une dimension que le jeu
  // ne porte pas reste proposée, désactivée, avec sa raison écrite.
  const dimensionsRepartition = BREAKDOWN_DIMENSIONS.map((dimension) => {
    const support = dimensionSupport(definition.dataset, dimension, schema);
    return {
      dimension,
      label: BREAKDOWN_LABELS[dimension],
      disponible: support.supported,
      raison: support.supported ? null : support.message,
    };
  });
  const repartitionPortees = dimensionsRepartition.filter((d) => d.disponible).map((d) => d.dimension);
  const splitDemande = reader.get(BREAKDOWN_PARAM)?.trim() || null;
  const splitConnu = BREAKDOWN_DIMENSIONS.find((d) => d === splitDemande) ?? null;
  const dimensionRepartition: BreakdownDimension | null =
    splitConnu !== null && repartitionPortees.includes(splitConnu)
      ? splitConnu
      : repartitionPortees.includes(REPARTITION_DEFAUT)
        ? REPARTITION_DEFAUT
        : (repartitionPortees[0] ?? null);
  // CE6 (P14) : une série à plus de cinq groupes n'est pas lancée.
  const tropDeSeries = plan.ok && plan.value.visualization === "timeseries" && plan.value.limit > SERIES_MAX;
  return { reader, dataset, definition, plan, demande, dimensionsRepartition, splitDemande, splitConnu, dimensionRepartition, tropDeSeries };
}

/**
 * Une lecture de contexte. Le budget dépassé n'est pas une panne mais une RÉPONSE
 * (« pas lu dans le temps imparti ») : il est converti avant `lire`, pour que la
 * section propose de réduire la requête au lieu de « Réessayer » ce qui échouera
 * pareil. Une vraie panne reste une panne — journalisée par `lire`, locale à sa
 * section.
 */
async function lireContexte(lecture: () => Promise<ExplorerResult>): Promise<LectureContexte> {
  const lu = await lire(async () => {
    try {
      return await lecture();
    } catch (e) {
      if (e instanceof ExplorerBudgetError) return null;
      throw e;
    }
  });
  if (!lu.ok) return { etat: "echec" };
  return lu.data === null ? { etat: "budget" } : { etat: "ok", resultat: lu.data };
}

/** Tables dont `lib/comparaison.ts` sait lire le début de collecte (sa liste blanche). */
function sourceDeCollecte(plan: ExplorerPlan) {
  const definition = datasetDefinition(plan.dataset);
  return {
    table: DATASET_REGISTRY[definition.dataset].table,
    colonneTemps: definition.time,
    additive: estAdditive(plan.measure.aggregation),
  };
}

/** Couverture de la méta d'une lecture, dans le vocabulaire de la comparaison (§ 3.2). */
function couvertureDeMeta(meta: ExplorerMeta, n: number): CouverturePrecedente {
  if (meta.coverage.status === "complete") return { etat: "complete", raison: null, n };
  return {
    etat: meta.coverage.status === "partial" ? "partielle" : "inconnue",
    raison: meta.coverage.reason ?? "couverture non lue",
    n,
  };
}

/**
 * La période précédente est-elle COMPLÈTE (§ 3.2) ? D'abord la méta de sa propre
 * lecture (rétention) ; puis, pour les jeux dont la table figure dans la liste
 * blanche de `lib/comparaison.ts`, le début de collecte et le retard d'ingestion. La
 * première couverture incomplète gagne : un delta contre une période à moitié
 * mesurée mesurerait la collecte, pas le site.
 */
async function couvertureDeLaPrecedente(
  query: AnalyticsQuery,
  plan: ExplorerPlan,
  meta: ExplorerMeta,
  n: number,
): Promise<CouverturePrecedente> {
  const deMeta = couvertureDeMeta(meta, n);
  if (deMeta.etat !== "complete") return deMeta;
  let collecte: CouverturePrecedente[] = [];
  try {
    collecte = await Promise.all(
      sourcesSousFiltres(query, sourceDeCollecte(plan)).map((source) => couverturePrecedente(query, source)),
    );
  } catch {
    // Table hors de la liste blanche (ressources, tâches longues, appels tracés) :
    // seule la rétention est vérifiée, par la méta de la lecture ci-dessus.
    collecte = [];
  }
  const incomplete = collecte.find((c) => c.etat !== "complete");
  return incomplete ? { ...incomplete, n } : deMeta;
}

export const chargerExplorer = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/explorer");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const query = ecran.query;
  const schema = await dimensionSchema();
  const { plan, demande, dimensionRepartition, tropDeSeries, reader } = demandeExplorer(query, sp, schema);

  // Les droits d'écriture sont résolus AVANT l'action : un bouton qui échouerait
  // n'est pas proposé, et son absence est expliquée.
  const titulaire = await dashboardPrincipal(principal);
  // Ce que le formulaire « Ajouter au tableau de bord » en montre, rien de plus (ni
  // disposition, ni propriétaire) : le reste ne voyage pas.
  const cibles = titulaire
    ? (await listDashboards(ecran.filters))
        .filter((d) => canDashboardAction(titulaire, d, "add_widget"))
        .map(({ id, name, app_id, revision }) => ({ id, name, app_id, revision }))
    : [];
  const app = query.scope.requestedApp;
  const lecteurVues = principal ? await savedViewReader(principal) : null;
  const peutEnregistrerVue =
    app !== null && lecteurVues !== null && canCreateSavedView(lecteurVues, app) && (await savedViewsAvailable());

  let resultat: ExplorerResult | null = null;
  let echec: { titre: string; message: string } | null = null;
  // Zone 8 : plans DÉRIVÉS du contexte, et ce que chaque lecture a donné.
  let planVolume: ExplorerPlan | null = null;
  let planRepartition: ExplorerPlan | null = null;
  let contexteVolume: LectureContexte | null = null;
  let contexteRepartition: LectureContexte | null = null;
  // CE6 (P14) : une URL qui impose plus de cinq séries est refusée, avec sa raison.
  if (demande && tropDeSeries) {
    echec = {
      titre: "Trop de séries demandées",
      message: `Une série temporelle superpose au plus ${SERIES_MAX} groupes : au-delà, les courbes cessent d'être lisibles. Choisir 1, 3 ou ${SERIES_MAX} dans « Nombre maximum », ou la représentation « Classement ».`,
    };
  } else if (demande && plan.ok) {
    const p = plan.value;
    // W-E2 : le volume n'est pas affiché sous une série — le résultat dit déjà le
    // temps, et deux séries d'échelles différentes se liraient l'une pour l'autre.
    const pourVolume = p.visualization === "timeseries" ? null : planDeVolume(p);
    const pourRepartition = dimensionRepartition ? planDeRepartition(p, dimensionRepartition) : null;
    planVolume = pourVolume;
    planRepartition = pourRepartition;
    // Les trois lectures PARTENT ensemble : le contexte n'ajoute pas son temps à
    // celui du résultat, et son budget plus court le fait renoncer le premier.
    const volumeLu = pourVolume
      ? lireContexte(() => exploreAnalytics({ query, plan: pourVolume }, { timeoutMs: BUDGET_CONTEXTE_MS }))
      : null;
    const repartitionLue = pourRepartition
      ? lireContexte(() => exploreAnalytics({ query, plan: pourRepartition }, { timeoutMs: BUDGET_CONTEXTE_MS }))
      : null;
    try {
      resultat = await exploreAnalytics({ query, plan: p });
    } catch (e) {
      if (e instanceof ExplorerBudgetError) {
        echec = {
          titre: "Budget de lecture dépassé",
          message: `${e.message}. Aucun chiffre n'est affiché : une série de zéros se lirait comme une absence de trafic.`,
        };
      } else if (e instanceof UnsupportedExplorerDimension) {
        echec = { titre: "Dimension non applicable", message: e.message };
      } else {
        throw e;
      }
    }
    // Toujours attendues, même quand le résultat a échoué : une promesse laissée
    // derrière rejetterait hors de tout rendu (`lireContexte` ne lève jamais).
    contexteVolume = volumeLu ? await volumeLu : null;
    contexteRepartition = repartitionLue ? await repartitionLue : null;
  }

  // cmp=prev (W-E3, W-E5) : la MÊME analyse relue sur la période précédente, pour une
  // valeur ou une série sans groupe. Un classement ne se compare pas (deux ordres côte
  // à côte trompent) ; une série à groupes doublerait ses courbes : `null`, et la
  // figure dit pourquoi. Une lecture précédente en échec ne produit aucun delta.
  let precedent: PrecedentResultat | null | undefined;
  let deploys: Section<DeployRow[]> | null = null;
  if (resultat && plan.ok) {
    const p = plan.value;
    const comparable = p.visualization === "value" || (p.visualization === "timeseries" && p.groupBy.length === 0);
    if (lireComparaison("/explorer", reader).valeur.mode === "prev" && p.visualization !== "table") {
      if (!comparable) {
        precedent = null;
      } else {
        const queryPrecedente: AnalyticsQuery = { ...query, range: previousRange(query.range) };
        const lu = await lire(() => exploreAnalytics({ query: queryPrecedente, plan: { ...p, cursor: null } }));
        const plage = referencePrecedente(query.range);
        precedent = lu.ok
          ? {
              total: lu.data.data.total,
              series: lu.data.data.series,
              plage,
              couverture: await couvertureDeLaPrecedente(query, p, lu.data.meta, lu.data.data.samples),
            }
          : {
              total: null,
              plage,
              couverture: { etat: "inconnue", raison: "la lecture de la période précédente a échoué" },
            };
      }
    }
    // P9 : une série porte les déploiements de sa fenêtre (les 20 derniers marqueurs ;
    // la page les filtre sur [from, to) et les annote).
    if (p.visualization === "timeseries") deploys = await section(() => listDeploys(ecran.filters, 20));
  }

  return {
    etat: "ok",
    query,
    label: ecran.label,
    schema: [...schema].sort(),
    cibles,
    peutEnregistrerVue,
    resultat,
    echec,
    planVolume,
    planRepartition,
    contexteVolume,
    contexteRepartition,
    // `undefined` (aucune comparaison demandée) ne voyage pas : il devient l'absence
    // du champ, que la page relit `undefined` ; `null` (non comparable) voyage.
    precedent,
    deploys,
  } as const;
}) satisfies Chargeur<unknown>;
