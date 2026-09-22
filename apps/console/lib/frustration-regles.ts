// Règles de détection des signaux de frustration, telles que la console les ÉCRIT
// (F22, plan § 5.4.2) — logique PURE, testée contre les constantes du SDK
// (tests/unit/frustration-regles.test.ts).
//
// POURQUOI UNE COPIE. La console ne dépend pas du SDK navigateur (aucun paquet
// `@mip/rum-sdk` dans ses dépendances) : elle ne peut pas importer ses constantes.
// Écrire « 3 clics en 1 s » en dur dans l'écran finirait par diverger du code qui
// détecte ; ces valeurs vivent donc ICI, une fois, et le test échoue dès qu'une
// constante du SDK bouge sans elles (même patron qu'`ERROR_SOURCES`).
//
// Datadog ne publie aucune fenêtre pour le dead click : l'écrire est un choix de
// vérité, pas une coquetterie — un « 0 » ne se lit qu'avec la règle qui l'a produit.

/** Clics sur la même cible qui font une rafale (`packages/rum-sdk/src/frustration.ts`). */
export const RAGE_MIN_CLICKS = 3;
/** Fenêtre de la rafale, en ms. */
export const RAGE_WINDOW_MS = 1000;
/** Délai sans réaction (mutation, navigation, défilement) après lequel un clic est mort, en ms. */
export const DEAD_CLICK_WINDOW_MS = 1500;
/**
 * Fenêtre causale d'une action (`ACTION_WINDOW_MS`, packages/rum-sdk/src/actions.ts) :
 * la première exception rattachée à l'action dans ce délai fait un « error click ».
 */
export const ERROR_CLICK_WINDOW_MS = 5000;
/** Signaux au plus par page vue (`FRUSTRATION_CAP_PER_PAGE`) : au-delà, rien n'est émis. */
export const FRUSTRATION_CAP_PER_PAGE = 20;

/** Espace insécable entre la valeur et l'unité (écrite par son code : invisible dans une source). */
const INSECABLE = String.fromCharCode(0xa0);

/** Une durée de règle en secondes lisibles : 1000 → « 1 s », 1500 → « 1,5 s ». */
function secondes(ms: number): string {
  return `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${INSECABLE}s`;
}

export interface RegleFrustration {
  kind: "rage" | "dead" | "error";
  libelle: string;
  texte: string;
}

/** Les trois règles, dans l'ordre des tuiles. */
export function reglesFrustration(): RegleFrustration[] {
  return [
    {
      kind: "rage",
      libelle: "Rage",
      texte: `${RAGE_MIN_CLICKS} clics sur la même cible en ${secondes(RAGE_WINDOW_MS)}.`,
    },
    {
      kind: "dead",
      libelle: "Dead",
      texte: `élément d'aspect actionnable sans mutation, navigation ni défilement en ${secondes(DEAD_CLICK_WINDOW_MS)}.`,
    },
    {
      kind: "error",
      libelle: "Error",
      texte: `première exception rattachée à l'action dans les ${secondes(ERROR_CLICK_WINDOW_MS)}.`,
    },
  ];
}

/**
 * Ce que les règles laissent de côté, écrit sous elles : le sous-report est un
 * choix (un dead click faux coûte plus cher qu'un dead click manqué).
 */
export const LIMITES_FRUSTRATION =
  `Seuls les clics sont observés : les frappes au clavier ne sont pas comptées. Règles conservatrices, sous-report assumé ; au plus ${FRUSTRATION_CAP_PER_PAGE} signaux par page vue.`;
