// Palette de la console — la couleur porte UN sens, et un seul (principe P15 du plan).
//
//   vert / ambre / rouge  → l'état d'une mesure au regard d'un seuil nommé
//                           (`RATING_HEX`, jetons `good` / `warn` / `bad`), ou la
//                           sévérité d'une alerte (`SEVERITE`, toujours doublée d'un motif) ;
//   orange                → la série mesurée principale (le « réel ») ;
//   bleu, pointillé       → le robot ;
//   gris, pointillé       → la période ou la release de référence ;
//   une teinte, 5 paliers → une intensité sans verdict (heatmap, rétention, concordance) ;
//   `CATEGORIELLE`        → des catégories sans ordre ni verdict : jamais de vert,
//                           d'ambre ni de rouge, qui se liraient comme un état.
//
// Aucune couleur de donnée n'est écrite en dur ailleurs : les composants importent
// d'ici, ou emploient les jetons de `app/globals.css` (qui suivent le mode sombre).
import { RATING_HEX } from "./rating";

export { RATING_HEX };

/** Séries temporelles : le réel, la référence, le robot. */
export const SERIE = {
  principale: "#f89101",
  reference: "rgb(var(--c-ink-faint))",
  robot: "#2563eb",
} as const;

/**
 * Catégories sans verdict (canaux, appareils, segments d'une barre). Huit teintes
 * de luminance moyenne, choisies pour rester lisibles (≥ 3:1, seuil des éléments
 * graphiques) sur le fond clair ET sur le fond sombre ; aucune n'est un vert, un
 * ambre ou un rouge. Vérifié par tests/unit/palette.test.ts.
 */
export const CATEGORIELLE: readonly string[] = [
  "#0891b2", // cyan
  "#8b5cf6", // violet
  "#c026d3", // fuchsia
  "#6366f1", // indigo
  "#64748b", // ardoise
  "#0284c7", // ciel
  "#78716c", // pierre
  "#a855f7", // pourpre
];

/** La couleur catégorielle d'un index, en boucle. */
export function categorie(index: number): string {
  const n = CATEGORIELLE.length;
  return CATEGORIELLE[((index % n) + n) % n];
}

/** Cinq paliers d'une seule teinte, du plus pâle au plus soutenu. */
const PALIERS_SEQUENTIELS = ["#e0e7ff", "#a5b4fc", "#818cf8", "#6366f1", "#4338ca"] as const;

/**
 * Intensité sans verdict : t ∈ [0 ; 1] → un des cinq paliers. Une part « Bon »
 * de 90 % n'est pas « verte » : 0,9 et 0,5 ne sont pas des seuils publiés (R-S).
 */
export function SEQUENTIELLE(t: number): string {
  const borne = Number.isFinite(t) ? Math.min(Math.max(t, 0), 1) : 0;
  return PALIERS_SEQUENTIELS[Math.min(PALIERS_SEQUENTIELS.length - 1, Math.floor(borne * PALIERS_SEQUENTIELS.length))];
}

/** Les paliers eux-mêmes, pour une légende. */
export const PALIERS_SEQUENTIELLE: readonly string[] = PALIERS_SEQUENTIELS;

/**
 * Sévérités d'alerte : un jeton de couleur ET un motif, parce qu'aucune
 * information ne doit tenir à la seule couleur (§ 3.9).
 */
export const SEVERITE = {
  critical: { jeton: "bad", motif: "plein", libelle: "critique" },
  warning: { jeton: "warn", motif: "hachures", libelle: "avertissement" },
  info: { jeton: "ink-soft", motif: "points", libelle: "information" },
} as const;
