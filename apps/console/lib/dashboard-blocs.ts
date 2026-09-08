// Catalogues de composition : quels blocs chaque tableau de bord peut afficher,
// et quelles mesures il ne couvre pas. Logique PURE — ni cookies, ni base.
//
// UN CATALOGUE PAR CATÉGORIE DE NAVIGATION, et un cookie par catalogue : les
// choix sont indépendants, et éteindre la liste des sessions ne doit rien
// changer à la Vue d'ensemble.
//
// POURQUOI UN COOKIE ET PAS UNE TABLE. Le choix est lu CÔTÉ SERVEUR, ce qui
// permet de ne pas lancer les requêtes d'un bloc désactivé — masquer en CSS
// aurait laissé tout le coût. Un cookie donne cette lecture serveur sans
// migration ; deux migrations attendent déjà d'être appliquées en production.
// Contrepartie assumée : la préférence vit par NAVIGATEUR, pas par compte.

export interface Bloc {
  id: string;
  label: string;
  desc: string;
  /** Affiché tant que l'utilisateur n'a rien décidé. */
  defaut: boolean;
}

/** Mesure qu'un RUM du marché propose et que ce produit ne couvre pas. */
export interface Indisponible {
  label: string;
  /** Le motif est OBLIGATOIRE : une liste grisée sans raison se lit comme une
   *  feuille de route, alors que plusieurs de ces lignes ne seront jamais tenables. */
  raison: string;
}

export interface Catalogue {
  /** href de la catégorie de navigation qui porte la roue. */
  href: string;
  titre: string;
  cookie: string;
  blocs: readonly Bloc[];
  indisponibles: readonly Indisponible[];
}

export const CATALOGUES: readonly Catalogue[] = [
  {
    href: "/",
    titre: "Vue d'ensemble",
    cookie: "mip-blocs",
    blocs: [
      { id: "briefing", label: "Synthèse IA", defaut: true, desc: "Ce qui a changé depuis votre dernière connexion, en quelques lignes." },
      { id: "sante", label: "Score de santé", defaut: true, desc: "Note sur 100 pondérée par les Core Web Vitals, et son évolution." },
      { id: "vitals", label: "Core Web Vitals", defaut: true, desc: "LCP, INP, CLS, FCP et TTFB au p75, face aux seuils Google." },
      { id: "reseau", label: "Décomposition réseau", defaut: false, desc: "D'où vient le TTFB : redirection, DNS, connexion, TLS, requête, réponse." },
      { id: "hero", label: "Courbe LCP et volumétrie", defaut: true, desc: "LCP p75 dans le temps, sessions, pages vues et taux d'erreur." },
      { id: "historique", label: "Historique de santé 14 jours", defaut: true, desc: "Heatmap jour × heure, avec les courbes de volume et de LCP associées." },
      { id: "anomalies", label: "Anomalies détectées", defaut: true, desc: "Écarts statistiques sur le LCP, sans seuil à régler." },
    ],
    indisponibles: [
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
    ],
  },
  {
    href: "/sessions",
    titre: "Sessions",
    cookie: "mip-blocs-sessions",
    blocs: [
      { id: "resume", label: "Nouveaux vs revenants", defaut: true, desc: "Répartition des visiteurs sur la fenêtre, exacte — contrairement à la liste, plafonnée." },
      { id: "liste", label: "Liste des sessions", defaut: true, desc: "Les dernières sessions, avec appareil, navigateur, pages vues et erreurs." },
    ],
    indisponibles: [
      {
        label: "Identité du visiteur",
        raison:
          "Jamais. Les sessions sont rattachées à un `user_hash` anonyme et la PII est retirée à la collecte comme à l'ingestion — c'est un engagement du produit, pas une fonctionnalité manquante.",
      },
      {
        label: "Enregistrement du texte et des médias",
        raison:
          "Le rejeu masque les saisies et exclut les blocs marqués, mais ne masque encore ni le texte ni les images — le standard 2026 le demande, ce n'est pas fait.",
      },
    ],
  },
  {
    href: "/slo",
    titre: "SLO",
    cookie: "mip-blocs-slo",
    blocs: [
      { id: "budget", label: "Budget d'erreur consommé", defaut: true, desc: "Part du budget brûlée par SLO, et détection de consommation rapide." },
      { id: "creation", label: "Formulaire de création", defaut: true, desc: "Déclarer un nouvel objectif : app, métrique, cible et fenêtre." },
      { id: "liste", label: "Liste des objectifs", defaut: true, desc: "Tous les SLO déclarés, avec leur état courant." },
    ],
    indisponibles: [
      {
        label: "Alerte en temps réel sur un budget brûlé",
        raison:
          "Le déclencheur des tâches planifiées tourne au mieux à l'heure sur cet environnement : la latence d'alerte est de 60 minutes, pas de quelques secondes.",
      },
      {
        label: "Politique d'escalade",
        raison:
          "Les alertes partent en webhook sortant, sans niveaux, ni astreinte, ni accusé de réception. Il n'y a pas de couche d'escalade dans ce POC.",
      },
    ],
  },
];

export function catalogueDe(href: string): Catalogue | undefined {
  return CATALOGUES.find((c) => c.href === href);
}

/**
 * Relit un cookie, sous la forme `id:0|1` séparée par des virgules.
 *
 * Un identifiant ABSENT retombe sur son défaut — et c'est le point important :
 * un bloc ajouté plus tard apparaît chez les utilisateurs qui ont déjà un
 * cookie, au lieu de rester invisible pour eux seuls. Un identifiant inconnu
 * (bloc retiré depuis) est ignoré.
 */
export function lireChoix(cat: Catalogue, brut: string | undefined | null): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const b of cat.blocs) out[b.id] = b.defaut;
  const connus = new Set(cat.blocs.map((b) => b.id));
  for (const paire of (brut ?? "").split(",")) {
    const [id, v] = paire.split(":");
    if (connus.has(id) && (v === "0" || v === "1")) out[id] = v === "1";
  }
  return out;
}

/** Sérialise l'état COMPLET : une liste des seuls blocs actifs ne permettrait
 *  pas de distinguer « éteint par l'utilisateur » de « éteint par défaut ». */
export function serialiserChoix(cat: Catalogue, choix: Record<string, boolean>): string {
  return cat.blocs.map((b) => `${b.id}:${choix[b.id] ? 1 : 0}`).join(",");
}
