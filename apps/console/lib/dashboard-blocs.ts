// Catalogue des blocs de la Vue d'ensemble, et lecture du choix de l'utilisateur.
// Logique PURE : aucun accès aux cookies ni à la base ici.
//
// POURQUOI UN COOKIE ET PAS UNE TABLE. Le choix est lu CÔTÉ SERVEUR, ce qui
// permet de ne pas lancer les requêtes d'un bloc désactivé — masquer en CSS
// aurait laissé tout le coût. Un cookie donne cette lecture serveur sans
// migration ; deux migrations attendent déjà d'être appliquées sur la base de
// production, en ajouter une troisième pour une préférence d'affichage serait
// mal arbitré. Contrepartie assumée : la préférence vit par NAVIGATEUR, pas par
// compte. Le jour où elle doit suivre l'utilisateur, seule la couche de lecture
// change — le catalogue et le rendu, non.

/** Nom du cookie portant le choix. Déclaré ICI et non dans le fichier d'action :
 *  un module "use server" ne peut exporter que des fonctions async. */
export const COOKIE_BLOCS = "mip-blocs";

export type BlocId =
  | "briefing"
  | "sante"
  | "vitals"
  | "reseau"
  | "hero"
  | "historique"
  | "anomalies";

export interface Bloc {
  id: BlocId;
  label: string;
  desc: string;
  /** Affiché tant que l'utilisateur n'a rien décidé. */
  defaut: boolean;
}

/** Dans l'ordre de la page, pour que la fenêtre de réglage la reflète. */
export const BLOCS: readonly Bloc[] = [
  {
    id: "briefing",
    label: "Synthèse IA",
    desc: "Ce qui a changé depuis votre dernière connexion, en quelques lignes.",
    defaut: true,
  },
  {
    id: "sante",
    label: "Score de santé",
    desc: "Note sur 100 pondérée par les Core Web Vitals, et son évolution.",
    defaut: true,
  },
  {
    id: "vitals",
    label: "Core Web Vitals",
    desc: "LCP, INP, CLS, FCP et TTFB au p75, face aux seuils Google.",
    defaut: true,
  },
  {
    id: "reseau",
    label: "Décomposition réseau",
    desc: "D'où vient le TTFB : redirection, DNS, connexion, TLS, requête, réponse.",
    defaut: false,
  },
  {
    id: "hero",
    label: "Courbe LCP et volumétrie",
    desc: "LCP p75 dans le temps, sessions, pages vues et taux d'erreur.",
    defaut: true,
  },
  {
    id: "historique",
    label: "Historique de santé 14 jours",
    desc: "Heatmap jour × heure, avec les courbes de volume et de LCP associées.",
    defaut: true,
  },
  {
    id: "anomalies",
    label: "Anomalies détectées",
    desc: "Écarts statistiques sur le LCP, sans seuil à régler.",
    defaut: true,
  },
];

/**
 * Mesures qu'un RUM du marché propose et que ce produit NE COUVRE PAS. Listées
 * grisées, avec la raison — une liste d'indisponibles sans motif se lit comme
 * une promesse, alors que deux de ces trois lignes ne seront jamais tenables.
 */
export const INDISPONIBLES: readonly { label: string; raison: string }[] = [
  {
    label: "Speed Index",
    raison:
      "Exige une capture vidéo du rendu. C'est une mesure de laboratoire : elle n'est pas calculable chez le visiteur, quel que soit le capteur.",
  },
  {
    label: "Opérateur réseau",
    raison:
      "Aucun navigateur ne l'expose. L'obtenir demanderait de résoudre l'adresse IP à l'ingestion — ce que l'engagement « aucune adresse IP stockée » interdit.",
  },
  {
    label: "Comparaison par version d'app",
    raison:
      "La version déployée est désormais collectée sur chaque session, mais aucun écran ne la restitue encore. Celle-ci arrivera.",
  },
];

const DEFAUTS = new Map(BLOCS.map((b) => [b.id, b.defaut]));

/**
 * Relit le cookie, sous la forme `id:0|1` séparée par des virgules.
 *
 * Un identifiant ABSENT retombe sur son défaut — et c'est le point important :
 * un bloc ajouté plus tard apparaît chez les utilisateurs qui ont déjà un
 * cookie, au lieu de rester invisible pour eux seuls. Un identifiant inconnu
 * (bloc retiré depuis) est ignoré.
 */
export function lireChoix(brut: string | undefined | null): Record<BlocId, boolean> {
  const out = Object.fromEntries(BLOCS.map((b) => [b.id, b.defaut])) as Record<BlocId, boolean>;
  for (const paire of (brut ?? "").split(",")) {
    const [id, v] = paire.split(":");
    if (DEFAUTS.has(id as BlocId) && (v === "0" || v === "1")) out[id as BlocId] = v === "1";
  }
  return out;
}

/** Sérialise l'état COMPLET : on ne peut pas distinguer « éteint par défaut »
 *  de « éteint par l'utilisateur » à partir d'une liste partielle. */
export function serialiserChoix(choix: Record<BlocId, boolean>): string {
  return BLOCS.map((b) => `${b.id}:${choix[b.id] ? 1 : 0}`).join(",");
}
