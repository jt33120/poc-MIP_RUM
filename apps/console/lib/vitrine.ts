// La vitrine publique (/presentation), refondue le 30/09/2026 pour la démo : un film,
// deux entrées (la démo, la connexion), puis un aperçu défilant de la console. Ce
// module ne porte que des données : le film et les étapes de l'aperçu, lus par
// components/presentation/vitrine/ et par les tests.


/**
 * Le film d'accueil : un clip monté avec ses titres incrustés, et son affiche (image
 * fixe, montrée avant la lecture et à qui a demandé moins de mouvement). `null` tant
 * qu'il n'est pas monté : la vitrine montre alors son titre en texte, sur un fond animé.
 */
// Monté le 30/09/2026 par scripts/monter-film-accueil.mjs sur un clip Grok de 15 s
// fourni par l'utilisateur (hors dépôt) : un visiteur navigue sur une boutique, les
// mesures montent de l'écran et deviennent un tableau de bord.
export const FILM_ACCUEIL: { mp4: string; affiche: string } | null = {
  mp4: "/vitrine/film-accueil.mp4",
  affiche: "/vitrine/film-accueil.jpg",
};

/**
 * Le film de présentation : le produit, ce qui le distingue et sa stack, en une minute
 * et demie. Il s'ouvre en grand depuis le premier écran (FilmPresentation.tsx), ou
 * directement par /presentation#film. Comment il est fait et d'où vient chaque
 * affirmation : docs/product/film-presentation.md. `null` : pas de bouton.
 */
export const FILM_PRESENTATION: { mp4: string; affiche: string; duree: string } | null = {
  mp4: "/vitrine/film-presentation.mp4",
  affiche: "/vitrine/film-presentation.jpg",
  duree: "1 min 29",
};

/** Les écrans de la scène animée de l'aperçu (components/presentation/vitrine/SceneConsole.tsx). */
export type VueScene = "sante" | "pages" | "erreurs" | "session" | "tracing" | "assistant";

/** Une étape de l'aperçu : un écran de la scène animée (SceneConsole), et ce qu'il montre. */
export interface EtapeApercu {
  /** L'écran de la scène. */
  nom: VueScene;
  /** Libellé court de la navigation entre étapes. */
  onglet: string;
  titre: string;
  texte: string;
  /** Chemin affiché dans la barre d'adresse du cadre : celui de l'écran dans la console. */
  chemin: string;
}

/**
 * L'ordre suit une question qu'on se pose en arrivant : le site va-t-il bien ? où
 * est-il lent ? qu'est-ce qui casse ? qu'a vécu un visiteur ? d'où vient la lenteur ?
 * et, pour finir, la même question posée à un assistant IA. Chaque phrase dit ce que
 * la console fait vraiment ; les chiffres de la scène, eux, sont d'illustration.
 */
export const ETAPES_APERCU: readonly EtapeApercu[] = [
  {
    nom: "sante",
    onglet: "Santé",
    titre: "La santé du site, en une note.",
    texte: "Vitesse d'affichage, erreurs et stabilité des sessions, mesurées chez les vrais visiteurs et résumées sur 100.",
    chemin: "/",
  },
  {
    nom: "pages",
    onglet: "Pages",
    titre: "Chaque page, sa vitesse réelle.",
    texte: "Le temps d'affichage de chaque route, mesuré dans les navigateurs des visiteurs, avec son verdict.",
    chemin: "/pages",
  },
  {
    nom: "erreurs",
    onglet: "Erreurs",
    titre: "Les erreurs, dans le temps.",
    texte: "Quand elles arrivent, combien de sessions elles touchent, et après quelle version.",
    chemin: "/errors",
  },
  {
    nom: "session",
    onglet: "Session",
    titre: "Revoir la visite.",
    texte: "Le parcours, le clic, et l'erreur au moment où le visiteur l'a vue.",
    chemin: "/sessions",
  },
  {
    nom: "tracing",
    onglet: "Tracing",
    titre: "Du clic jusqu'au serveur.",
    texte: "Un appel lent, décomposé : le trajet d'un côté, le serveur de l'autre.",
    chemin: "/tracing",
  },
  {
    nom: "assistant",
    onglet: "Assistant",
    titre: "Et demandez à votre assistant IA.",
    texte: "Par le serveur MCP, un assistant interroge vos mesures, en lecture seule.",
    chemin: "/api-docs",
  },
];
