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

import { CADENCE_TICK_MIN } from "./etat-latence";

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
      // « et son évolution » est retiré (F11) : le score n'est pas comparé — une
      // variation de score composite n'a pas d'unité interprétable (§ 5.1.2).
      { id: "sante", label: "Score de santé", defaut: true, desc: "Note sur 100 à formule affichée : Web Vitals, erreurs navigateur, stabilité des sessions, anomalies 24 h." },
      // Bloc ajouté par F11 : les tuiles de trafic quittent le hero pour la rangée de
      // la santé. Absent d'un cookie existant, il retombe sur son défaut (allumé).
      { id: "trafic", label: "Trafic", defaut: true, desc: "Sessions commencées, pages vues et occurrences d'erreurs navigateur pour 100 pages vues, avec leur évolution." },
      { id: "vitals", label: "Core Web Vitals", defaut: true, desc: "LCP, INP, CLS, FCP et TTFB au p75, face aux seuils Google." },
      // « Décomposition réseau » a quitté la Vue d'ensemble (F13, § 5.1.3) : la question
      // du TTFB se pose sur Pages, où ses phases sont lues. Un cookie qui la porte
      // encore l'ignore (identifiant inconnu).
      { id: "hero", label: "Core Web Vitals dans le temps", defaut: true, desc: "LCP, INP et CLS au p75, un petit graphique par vital sur ses zones de seuil, avec les déploiements." },
      // Bloc ajouté par F12 (zone 6 du § 5.1) : trois panneaux empilés, un axe chacun.
      { id: "charge", label: "Charge, erreurs et LCP", defaut: true, desc: "Pages vues (chargements et changements de route SPA), occurrences d'erreurs navigateur et LCP p75 sur la même échelle de temps, sans double axe." },
      // Bloc ajouté par F13 (zone 6) : la tuile d'angle mort, qui lit le robot (F57).
      { id: "angles", label: "Heures × route en angle mort", defaut: true, desc: "Heures où le robot synthétique dit « ok » alors que le LCP p75 des vrais visiteurs de la même route dépasse la borne Bon." },
      { id: "decoupage", label: "Segments les plus dégradés", defaut: true, desc: "Routes, navigateurs, systèmes, pays estimés, appareils ou releases classés du plus dégradé au moins dégradé (p75 du vital choisi), avec l'effectif et l'écart à l'ensemble. Chaque ligne ouvre le détail." },
      { id: "historique", label: "Historique 14 jours", defaut: true, desc: "Heatmap jour × heure dans le fuseau de l'app : part de mesures « Bon », sur 14 jours fixes." },
      { id: "anomalies", label: "Anomalies détectées", defaut: true, desc: "Écarts statistiques sur le LCP, sans seuil à régler." },
      { id: "versions", label: "Nouvelle release face à la précédente", defaut: true, desc: "Dernière release déployée face à la précédente, même fenêtre : sessions, LCP, INP et part de sessions en erreur. La règle de choix est écrite ; sous deux releases, la comparaison se tait et dit pourquoi." },
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
        // La ligne d'avant — « aucun écran ne la restitue encore » — a été tenue
        // le 09/09/2026 : le bloc « Comparaison par version » existe. Ce qui
        // reste, c'est la comparabilité elle-même.
        label: "Comparaison de versions à trafic comparable",
        raison:
          "Les versions sont comparées sur la MÊME fenêtre de temps, sans normalisation. Une version qui n'a tourné que la nuit est donc jugée sur un autre public, une autre répartition d'appareils et d'autres routes que celle qui a tourné aux heures de pointe. L'écart affiché mêle le code et le contexte ; les séparer demanderait une pondération par route et par appareil, qui n'existe pas.",
      },
    ],
  },
  {
    href: "/sessions",
    titre: "Sessions",
    cookie: "mip-blocs-sessions",
    // Dans l'ordre de l'écran (F41, § 5.11.3). Les identifiants d'avant sont
    // GARDÉS (`resume`, `visiteurs`, `engagement`, `liste`) : un cookie déjà posé
    // continue de valoir pour le bloc qui a pris sa place. Rangée de KPI et
    // bandeau d'échantillonnage ne sont pas des blocs : ils qualifient tout
    // l'écran, ils ne s'éteignent pas.
    blocs: [
      { id: "priorite", label: "À regarder d'abord", defaut: true, desc: "Les dix sessions qui cumulent le plus d'occurrences d'erreur, de signaux de frustration et d'appels en échec, chacune avec sa raison écrite." },
      { id: "repartition", label: "Qui sont ces sessions", defaut: true, desc: "Sessions commencées réparties par appareil, navigateur, système, pays estimé ou capteur, avec leur part du tout. Chaque groupe filtre l'écran." },
      { id: "visiteurs", label: "Volume dans le temps", defaut: true, desc: "Sessions commencées et visiteurs distincts par seau de temps, en deux panneaux. Les visiteurs ne s'additionnent pas : un visiteur présent dans trois seaux y est compté trois fois." },
      { id: "engagement", label: "Engagement", defaut: true, desc: "Durée observée médiane et p75, et part des sessions qui n'ont vu qu'une page. Affiché seulement si la fenêtre porte assez de sessions." },
      // « exacte » était vrai de l'agrégat (il balaie toute la fenêtre, là où la
      // liste s'arrête à 50 lignes) et faux de la POPULATION : le partage ne
      // porte que sur les sessions qui ont un identifiant de visiteur. On dit
      // désormais les deux, et la troisième part (F41) : les non identifiées.
      { id: "resume", label: "Nouveaux, revenants, non identifiés", defaut: true, desc: "Sessions actives de la fenêtre : visiteurs IDENTIFIÉS nouveaux ou revenants, et sessions sans identifiant comptées à part — trois parts, aucune répartie au jugé." },
      { id: "liste", label: "Liste des sessions", defaut: true, desc: "Les dernières sessions, avec appareil, navigateur, pages vues et erreurs. Recherche bornée à l'identifiant technique exact, à la route normalisée ou à la release." },
    ],
    indisponibles: [
      {
        // Cette ligne disait « rattachées à un user_hash anonyme ». Le hash
        // n'était pas anonyme au sens où on l'entendait : il était DÉRIVÉ du
        // terminal, donc réidentifiant par recoupement et partagé entre
        // plusieurs personnes. Le SDK ne l'émet plus (migration-v57).
        label: "Identité du visiteur",
        raison:
          "Jamais de personne nommée. Une session porte un identifiant de visiteur TIRÉ AU HASARD, sans lien avec le terminal ni avec un compte, et la PII est retirée à la collecte comme à l'ingestion. C'est un engagement du produit, pas une fonctionnalité manquante.",
      },
      {
        // La ligne d'avant — « ne masque encore ni le texte ni les images » —
        // est devenue fausse le 09/09/2026 : le rejeu masque par défaut les
        // saisies, le texte ET les médias, vérifié dans un vrai navigateur.
        // Ce qui manque à sa place, c'est le mouvement INVERSE.
        label: "Démasquage sélectif au rejeu",
        raison:
          "Le masquage se règle par application — tout, les médias seuls, ou les saisies seules — mais pas élément par élément : on ne peut pas demander « montre ce tableau, cache cette colonne ». La version de rrweb utilisée n'expose pas de sélecteur de démasquage, seulement de masquage.",
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
        // « 60 minutes » était un VESTIGE de Vercel Cron, dont le plan Hobby ne
        // descendait pas sous le quotidien et qu'on relayait à l'heure par
        // GitHub Actions. Le déclencheur dédié (services/scheduler) passe toutes
        // les CADENCE_TICK_MIN minutes depuis son déploiement sur Railway ; la
        // phrase est restée fausse le temps que quelqu'un la relise. D'où le
        // nombre IMPORTÉ, et non retapé : la vitrine mesure déjà cette cadence
        // (lib/etat-latence), les deux ne peuvent plus se contredire.
        // Le NOMBRE réel vit en base depuis le 24/09/2026 (cadence publiée par le
        // scheduler, plus lente sur l'offre gratuite de Neon) : ce catalogue
        // statique dit la cible et renvoie à la ligne qui lit la vraie valeur.
        raison: `Le déclencheur des tâches planifiées passe à cadence fixe — ${CADENCE_TICK_MIN} minutes visées, davantage tant que la base reste sur son offre gratuite (la ligne « Latence d'alerte » de la présentation dit la cadence réelle) : un budget peut donc être consommé pendant tout un intervalle avant que l'alerte ne parte. C'est une cadence, pas du temps réel — évaluer le SLO à chaque mesure écrite demanderait un déclencheur en base, pas un passage périodique.`,
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
