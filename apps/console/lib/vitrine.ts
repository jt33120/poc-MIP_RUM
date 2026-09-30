// La vitrine publique (/presentation), refondue le 30/09/2026 pour la démo : un film,
// deux entrées (la démo, la connexion), puis un aperçu défilant de la console. Ce
// module ne porte que des données : les médias et les étapes de l'aperçu, lus par
// components/presentation/vitrine/ et par les tests.

/**
 * Le film d'accueil : un clip monté avec ses titres incrustés, et son affiche (image
 * fixe, montrée avant la lecture et à qui a demandé moins de mouvement). `null` tant
 * qu'il n'est pas monté : la vitrine montre alors son titre en texte, sur un fond animé.
 */
export const FILM_ACCUEIL: { mp4: string; affiche: string } | null = null;

/** Une étape de l'aperçu : une capture du compte démo, et ce qu'elle montre. */
export interface EtapeApercu {
  /** Fichier sous public/vitrine/, sans extension (scripts/captures-vitrine.mjs). */
  nom: string;
  /** Libellé court de la navigation entre étapes. */
  onglet: string;
  titre: string;
  texte: string;
  /** Chemin affiché dans la barre d'adresse du cadre. */
  chemin: string;
  /** Ce que montre la capture, pour qui ne la voit pas. */
  alt: string;
}

/** Dimensions des captures (1440 × 900 en densité 2) : le cadre est au ratio 16/10. */
export const CAPTURE = { largeur: 2880, hauteur: 1800 } as const;

/**
 * L'ordre de l'aperçu suit une question qu'on se pose en arrivant : le site va-t-il
 * bien ? où est-il lent ? qu'est-ce qui casse ? que vit un visiteur ? d'où vient la
 * lenteur ? Chaque phrase dit ce que l'écran capturé montre, rien de plus.
 */
export const ETAPES_APERCU: readonly EtapeApercu[] = [
  {
    nom: "sante",
    onglet: "Santé",
    titre: "La santé du site, en une note.",
    texte: "Vitesse d'affichage, erreurs et stabilité des sessions, mesurées chez les vrais visiteurs et résumées sur 100.",
    chemin: "/",
    alt: "Vue d'ensemble de la console : une note de santé sur 100, les sessions, les pages vues, le taux d'erreurs et les Web Vitals.",
  },
  {
    nom: "pages",
    onglet: "Pages",
    titre: "Chaque page, sa vitesse réelle.",
    texte: "Le temps d'affichage mesuré dans les navigateurs des visiteurs, route par route, avec son verdict.",
    chemin: "/pages",
    alt: "Écran Pages : le temps d'affichage du plus grand élément (LCP) au 75e centile, son verdict, et le classement des routes.",
  },
  {
    nom: "erreurs",
    onglet: "Erreurs",
    titre: "Chaque erreur, et qui elle gêne.",
    texte: "Combien de sessions elle touche, depuis quand, et après quelle version.",
    chemin: "/errors",
    alt: "Écran Erreurs : les occurrences, les sessions touchées, leur part et les groupes d'erreurs de la période.",
  },
  {
    nom: "session",
    onglet: "Session",
    titre: "Le récit d'une visite.",
    texte: "Les pages vues dans l'ordre, la durée, et la pire mesure rencontrée en chemin.",
    chemin: "/sessions",
    alt: "Détail d'une session : l'appareil, le navigateur, le récit des pages vues et les compteurs de la visite.",
  },
  {
    nom: "tracing",
    onglet: "Tracing",
    titre: "Du clic jusqu'au serveur.",
    texte: "Quand un appel est lent, la part du serveur et celle du trajet.",
    chemin: "/tracing",
    alt: "Écran Tracing : les appels vus du navigateur, leur durée au 75e centile, les appels les plus lents et leur latence dans le temps.",
  },
];
