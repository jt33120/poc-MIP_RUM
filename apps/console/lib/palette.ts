// Palette de la console — la couleur porte UN sens, et un seul (principe P15 du plan).
//
//   vert / ambre / rouge  → l'état d'une mesure au regard d'un seuil nommé
//                           (`RATING_HEX`, jetons `good` / `warn` / `bad`), ou la
//                           sévérité d'une alerte (`SEVERITE`, toujours doublée d'un motif) ;
//   orange                → la série mesurée principale (le « réel ») ;
//   bleu, pointillé       → le robot ;
//   gris, pointillé       → la période ou la release de référence ;
//   framboise (`signal`)  → un écart défavorable détecté par calcul — pas un seuil ;
//   une teinte, 5 paliers → une intensité sans verdict (heatmap, rétention, concordance) ;
//   deux pôles, milieu gris → un écart à l'attendu (`DIVERGENTE`) ;
//   `CATEGORIELLE`        → des catégories sans ordre ni verdict : jamais de vert,
//                           d'ambre ni de rouge, qui se liraient comme un état.
//
// Aucune couleur de donnée n'est écrite en dur ailleurs : les composants importent
// d'ici, ou emploient les jetons de `app/globals.css` (qui suivent le mode sombre).
import { RATING_HEX } from "./rating";

export { RATING_HEX };

/**
 * Séries temporelles : le réel, la référence, le robot — en JETONS de thème. L'orange
 * de marque `#f89101` ne tenait que 2,32:1 sur le blanc des cartes, sous les 3:1 d'un
 * élément graphique (WCAG 1.4.11, audit A1 T4) : `--c-serie` vaut `#d97b00` en clair
 * (3,10:1, l'`accent-deep` de la marque) et garde `#f89101` en sombre (7,72:1). Le
 * robot suit le bleu `brand`, éclairci la nuit.
 */
export const SERIE = {
  principale: "rgb(var(--c-serie))",
  reference: "rgb(var(--c-ink-faint))",
  robot: "rgb(var(--c-brand))",
} as const;

/**
 * États d'une mesure en JETONS de thème, pour les figures SVG (histogrammes, anneau) :
 * la même teinte que les bandes et les pastilles, éclaircie en sombre. Avec
 * `RATING_HEX` (constant), « Bon » n'avait pas la même teinte selon la figure la nuit.
 */
export const RATING_JETON = {
  good: "rgb(var(--c-good))",
  "needs-improvement": "rgb(var(--c-warn))",
  poor: "rgb(var(--c-bad))",
} as const;

/**
 * Catégories sans verdict (canaux, appareils, segments d'une barre). SIX teintes :
 * sous la contrainte P15 (ni vert, ni ambre, ni rouge, ni orange), huit teintes
 * lisibles dans les deux thèmes n'existent pas ; l'ancienne palette à huit avait deux
 * gris (ardoise, pierre) et deux voisines indiscernables (ciel ↔ ardoise). Chroma
 * OKLab ≥ 0,10, voisines à ΔE ≥ 15, ≥ 3:1 sur `panel` clair ET sombre : vérifié par
 * tests/unit/palette.test.ts. Au-delà de six catégories : `AUTRES`. Une figure se
 * dessine sur `panel`, jamais sur `panel2` (violet et pétrole y passent sous 3:1 la nuit).
 */
export const CATEGORIELLE: readonly string[] = [
  "#db2777", // framboise
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#6366f1", // indigo
  "#0369a1", // pétrole
  "#a855f7", // pourpre
];

/**
 * Le gris du thème : repli des catégories au-delà de six (« Autres »), valeur
 * inconnue (doublée de hachures), ou volume seul, sans catégorie ni verdict.
 */
export const AUTRES = "rgb(var(--c-ink-faint))";

/**
 * Écart à l'attendu ou à une référence : sept pas (−3 mieux … +3 pire), milieu gris.
 * Le pôle « pire » est la teinte `signal` (écart défavorable), pas un verdict de
 * seuil ; le signe s'écrit toujours à côté (les pôles sombres sont proches en
 * deutéranopie).
 */
export const DIVERGENTE: readonly string[] = ["m3", "m2", "m1", "0", "p1", "p2", "p3"].map((k) => `rgb(var(--c-div-${k}))`);

/**
 * Le rang « Autres » : `categorie(INDEX_AUTRES)` rend le gris du thème. Pour une série
 * de volume sans catégorie ni verdict, ou une origine inconnue.
 */
export const INDEX_AUTRES = CATEGORIELLE.length;

/**
 * La couleur catégorielle d'un index ; au-delà de six (ou hors bornes), le gris
 * « Autres ». Plus de boucle : deux catégories de la même teinte se liraient comme
 * une seule.
 */
export function categorie(index: number): string {
  return Number.isInteger(index) && index >= 0 && index < CATEGORIELLE.length ? CATEGORIELLE[index] : AUTRES;
}

/** Cinq paliers d'une seule teinte, du plus pâle au plus soutenu. */
const PALIERS_SEQUENTIELS = ["#e0e7ff", "#a5b4fc", "#818cf8", "#6366f1", "#4338ca"] as const;

/**
 * Intensité sans verdict : t ∈ [0 ; 1] → un des cinq paliers. Une part « Bon »
 * de 90 % n'est pas « verte » : 0,9 et 0,5 ne sont pas des seuils publiés (R-S).
 */
export function SEQUENTIELLE(t: number): string {
  return PALIERS_SEQUENTIELS[palierSequentiel(t)];
}

/** Le rang du palier (0 à 4) d'une intensité t ∈ [0 ; 1], bornée hors de l'intervalle. */
export function palierSequentiel(t: number): number {
  const borne = Number.isFinite(t) ? Math.min(Math.max(t, 0), 1) : 0;
  return Math.min(PALIERS_SEQUENTIELS.length - 1, Math.floor(borne * PALIERS_SEQUENTIELS.length));
}

/** Les paliers eux-mêmes, pour une légende. */
export const PALIERS_SEQUENTIELLE: readonly string[] = PALIERS_SEQUENTIELS;

/**
 * Les mêmes paliers en JETONS de `app/globals.css` (`--c-seq-0` … `--c-seq-4`) :
 * ils suivent le thème. En sombre, la rampe est inversée en luminance — le palier
 * le plus fort reste le plus contrasté sur le fond, au lieu de s'y fondre.
 */
export const PALIERS_SEQUENTIELLE_JETONS: readonly string[] = PALIERS_SEQUENTIELS.map((_c, i) => `rgb(var(--c-seq-${i}))`);

/** L'intensité t en jeton de thème (voir `PALIERS_SEQUENTIELLE_JETONS`). */
export function sequentielleJeton(t: number): string {
  return PALIERS_SEQUENTIELLE_JETONS[palierSequentiel(t)];
}

/**
 * Sévérités d'alerte : un jeton de couleur ET un motif, parce qu'aucune
 * information ne doit tenir à la seule couleur (§ 3.9).
 */
export const SEVERITE = {
  critical: { jeton: "bad", motif: "plein", libelle: "critique" },
  warning: { jeton: "warn", motif: "hachures", libelle: "avertissement" },
  info: { jeton: "ink-soft", motif: "points", libelle: "information" },
} as const;

/**
 * Rôle d'une série dans une figure temporelle (F03 pour `LineTrend`, repris par
 * `SerieDef` de `ThresholdSeries` en F04) : c'est le rôle qui choisit la couleur
 * et le trait, jamais l'appelant — une référence est grise et pointillée partout.
 */
export type RoleSerie = "principale" | "reference" | "robot" | "categorie" | "projection";

/** Couleur et trait d'une série selon son rôle (P15). */
export function styleDeRole(role: RoleSerie, categorieIndex = 0): { couleur: string; pointille: boolean } {
  switch (role) {
    case "principale":
      return { couleur: SERIE.principale, pointille: false };
    case "reference":
      return { couleur: SERIE.reference, pointille: true };
    case "robot":
      return { couleur: SERIE.robot, pointille: true };
    case "projection":
      return { couleur: SERIE.principale, pointille: true };
    case "categorie":
      return { couleur: categorie(categorieIndex), pointille: false };
  }
}
