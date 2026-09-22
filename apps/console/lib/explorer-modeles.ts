// Analyses de départ de l'Explorer (F31, W-E1) — logique PURE, testée.
//
// POURQUOI. Sans exécution, l'Explorer s'ouvrait sur « Rien n'a encore été
// mesuré » : un écran vide, qui laisse deviner quoi demander. Six analyses
// NOMMÉES par leur question (idée des vues préréglées d'IP-Label) donnent un
// point de départ — sans rien lire : ce sont des liens, et l'exécution reste
// explicite (un clic, qui porte `run=1`). Une carte ne lit rien tant que
// personne n'a demandé.
//
// CHAQUE MODÈLE EST UN PLAN EXPLORER ORDINAIRE. Il passe le même
// `parseExplorerPlan` que l'URL, l'API et les tableaux de bord (test unitaire) :
// aucune mesure n'existe ici qui ne serait pas composable dans le formulaire.
//
// UN MODÈLE INAPPLICABLE EST MONTRÉ, JAMAIS MASQUÉ. Si le jeu d'un modèle ne porte
// pas une dimension de son regroupement, ou un filtre de population actif (le
// service n'existe que sur les erreurs et les appels tracés), le lien mènerait à
// un refus : la carte est rendue désactivée, avec la raison de `dimensionSupport`.
import { datasetDefinition, type ExplorerPlan } from "./analytics-schema";
import { explorerHref } from "./explorer-page-params";
import { dimensionSupport, type DimensionSchema } from "./query-compiler";
import { dimensionsUsed, type AnalyticsQuery } from "./query-contract";

export interface ModeleExplorer {
  cle: string;
  titre: string;
  /** La question à laquelle le modèle répond, telle qu'on se la pose. */
  question: string;
  plan: Omit<ExplorerPlan, "cursor">;
}

/** Ce que `ModelesDepart` affiche : un lien, ou l'absence de lien et sa raison. */
export interface ModeleDepart {
  cle: string;
  titre: string;
  question: string;
  href: string | null;
  raison?: string;
}

// Les six plans du § 5.21.4 (W-E1). Une série temporelle superpose au plus cinq
// groupes (P14) : son `limit` reste dans les options du formulaire (1, 3, 5).
export const MODELES_EXPLORER: ModeleExplorer[] = [
  {
    cle: "lcp-par-route",
    titre: "LCP p75 par route",
    question: "Quelles routes affichent leur contenu principal le plus lentement ?",
    plan: {
      version: 1,
      dataset: "vitals",
      measure: { field: "value", aggregation: "p75" },
      variant: "LCP",
      groupBy: ["route"],
      visualization: "toplist",
      limit: 10,
    },
  },
  {
    cle: "erreurs-dans-le-temps",
    titre: "Occurrences d’erreurs dans le temps",
    question: "Les erreurs augmentent-elles, et depuis quand ?",
    plan: {
      version: 1,
      dataset: "errors",
      // V1 : des occurrences se comptent par leur somme, jamais par les lignes.
      measure: { field: "occurrences", aggregation: "sum" },
      variant: null,
      groupBy: [],
      visualization: "timeseries",
      limit: 5,
    },
  },
  {
    cle: "sessions-par-appareil",
    titre: "Sessions commencées par appareil",
    question: "Sur quels appareils les sessions commencent-elles ?",
    plan: {
      version: 1,
      dataset: "sessions",
      measure: { field: "started", aggregation: "count" },
      variant: null,
      groupBy: ["device"],
      visualization: "toplist",
      limit: 10,
    },
  },
  {
    cle: "inp-par-navigateur",
    titre: "INP p75 par navigateur",
    question: "Quels navigateurs répondent le plus lentement aux interactions ?",
    plan: {
      version: 1,
      dataset: "vitals",
      measure: { field: "value", aggregation: "p75" },
      variant: "INP",
      groupBy: ["browser"],
      visualization: "toplist",
      limit: 10,
    },
  },
  {
    cle: "ressources-par-route",
    titre: "Ressources : durée p75 par route",
    question: "Sur quelles routes les ressources mettent-elles le plus de temps à arriver ?",
    plan: {
      version: 1,
      dataset: "resources",
      measure: { field: "duration_ms", aggregation: "p75" },
      variant: null,
      groupBy: ["route"],
      visualization: "toplist",
      limit: 10,
    },
  },
  {
    cle: "loaf-par-route",
    titre: "Blocages LoAF p95 par route",
    question: "Où le fil principal reste-t-il bloqué le plus longtemps ?",
    plan: {
      version: 1,
      dataset: "longtasks",
      measure: { field: "blocking_ms", aggregation: "p95" },
      // Une seule API : Long Task et LoAF décrivent le même blocage de deux façons.
      variant: "loaf",
      groupBy: ["route"],
      visualization: "toplist",
      limit: 10,
    },
  },
];

/**
 * Pourquoi un modèle ne s'applique pas à la requête courante, ou `null`. Le
 * regroupement d'abord (c'est le modèle lui-même), puis les filtres de population
 * actifs (c'est l'écran) — la raison dit lequel des deux bloque.
 */
function raisonIndisponible(modele: ModeleExplorer, query: AnalyticsQuery, schema: DimensionSchema): string | null {
  const jeu = datasetDefinition(modele.plan.dataset).dataset;
  for (const dimension of modele.plan.groupBy) {
    const support = dimensionSupport(jeu, dimension, schema);
    if (!support.supported) return support.message;
  }
  for (const dimension of dimensionsUsed(query.filters)) {
    const support = dimensionSupport(jeu, dimension, schema);
    if (!support.supported) return `filtre actif inapplicable : ${support.message}`;
  }
  return null;
}

/**
 * Les modèles tels que l'écran les rend : chaque lien ouvre l'Explorer EXÉCUTÉ
 * (`run=1`) sur ce plan, population et plage de l'écran conservées ; `extra`
 * reporte les paramètres de vue qui suivent la navigation (`cmp`…).
 */
export function modelesDeDepart(
  query: AnalyticsQuery,
  schema: DimensionSchema,
  extra: Record<string, string | null> = {},
): ModeleDepart[] {
  return MODELES_EXPLORER.map((modele) => {
    const raison = raisonIndisponible(modele, query, schema);
    const base = { cle: modele.cle, titre: modele.titre, question: modele.question };
    if (raison) return { ...base, href: null, raison };
    return { ...base, href: explorerHref(query, { ...modele.plan, cursor: null }, { ...extra, run: "1" }) };
  });
}
