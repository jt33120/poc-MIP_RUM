// LA HEATMAP DE LATENCE (A2 § 6.2, vague 3b) — logique pure, testée sans base.
//
// La forme de l'expérience dans le temps, que la p75 seule cache : une colonne par
// heure, une ligne par tranche de latence (24 tranches LOGARITHMIQUES), la couleur
// dit la PART de la colonne — normalisée par heure, sinon les heures chargées
// écrasent tout. Lue dans `metric_histogram_hourly` (seaux γ = 1,02, `histogramme.ts`),
// jamais recalculée sur les mesures brutes.
//
// Règles (A2 § 6.2, § 8.11) : une rampe séquentielle, jamais arc-en-ciel ; une case
// sans mesure reste vide (pas « 0 % ») ; une colonne sous 13 mesures est hachurée ;
// la p75 de chaque heure se lit sur les mêmes seaux (`percentileDepuisSeaux`).
import { percentileDepuisSeaux, valeurDuSeau, type SeauPondere } from "./histogramme";

/** Les bornes de la heatmap par vital, dans UN fichier (A2 § 6.2). Durées en ms. */
export const BORNES_HEATMAP: Record<string, { bas: number; haut: number }> = {
  LCP: { bas: 100, haut: 20_000 },
  INP: { bas: 16, haut: 2_000 },
  FCP: { bas: 100, haut: 20_000 },
  TTFB: { bas: 10, haut: 10_000 },
};

/**
 * Les vitaux que la carte propose, dans l'ordre du sélecteur. Le CLS n'y est pas :
 * c'est un score sans unité, pas une durée — des tranches de latence en
 * millisecondes n'ont pas de sens pour lui (il n'a pas de bornes ci-dessus).
 */
export const VITAUX_HEATMAP = ["LCP", "INP", "FCP", "TTFB"] as const;

export const TRANCHES = 24;
/** Sous ce nombre de mesures, la colonne est hachurée (A2 § 6.1 et § 6.2). */
export const MESURES_MIN_COLONNE = 13;

export interface LigneHistogramme {
  /**
   * Le vital de la ligne. Absent : une lecture d'UN seul vital (celui demandé à
   * `construireHeatmap`). Présent : une lecture de plusieurs, triée ici.
   */
  vital?: string;
  /** Début de l'heure, ISO UTC. */
  heure: string;
  bucket: number;
  poids: number;
  mesures: number;
}

export interface ColonneHeatmap {
  t: string;
  /** Part de la colonne par tranche (somme = 1), `null` pour une tranche sans mesure. */
  parts: (number | null)[];
  /** Mesures observées dans l'heure (0 : colonne vide). */
  n: number;
  p75: number | null;
  faible: boolean;
}

export interface Heatmap {
  vital: string;
  /** Les 25 bornes des 24 tranches, en ms. */
  bornes: number[];
  colonnes: ColonneHeatmap[];
  /** La plus forte part réelle d'une case (légende de la rampe). */
  partMax: number;
  /**
   * Les heatmaps de chaque vital proposé (`VITAUX_HEATMAP`, celle-ci comprise), sur
   * la même grille, quand la lecture les portait tous : la carte en offre le choix.
   * Absent : un seul vital lu, pas de sélecteur.
   */
  choix?: Heatmap[];
}

/** Les bornes logarithmiques des tranches : `TRANCHES + 1` valeurs de `bas` à `haut`. */
export function bornesTranches(bas: number, haut: number, n = TRANCHES): number[] {
  return Array.from({ length: n + 1 }, (_, k) => bas * (haut / bas) ** (k / n));
}

/** La tranche d'une valeur ; sous la première borne → 0, au-delà de la dernière → la dernière. */
export function trancheDe(valeur: number, bornes: readonly number[]): number {
  const n = bornes.length - 1;
  if (!(valeur > bornes[0])) return 0;
  if (valeur >= bornes[n]) return n - 1;
  const k = Math.floor((Math.log(valeur / bornes[0]) / Math.log(bornes[n] / bornes[0])) * n);
  return Math.min(n - 1, Math.max(0, k));
}

/**
 * La heatmap d'un vital sur une grille horaire. Les heures de la grille sans ligne
 * sont des colonnes vides (`n = 0`) : rien n'est comblé.
 *
 * Des lignes qui disent leur vital (`histogrammesHoraires` lit tous ceux de
 * `VITAUX_HEATMAP` d'une requête) donnent en plus `choix` : une heatmap par vital
 * proposé, `vital` étant celle affichée d'abord. Un vital sans ligne reste une
 * heatmap vide — la carte le dit, elle ne le retire pas du choix.
 */
export function construireHeatmap(vital: string, grille: readonly string[], lignes: readonly LigneHistogramme[]): Heatmap | null {
  const plusieurs = lignes.some((l) => l.vital !== undefined);
  const principale = heatmapDUnVital(vital, grille, plusieurs ? lignes.filter((l) => l.vital === vital) : lignes);
  if (!principale || !plusieurs) return principale;
  const autres = VITAUX_HEATMAP.filter((v) => v !== vital).map((v) => heatmapDUnVital(v, grille, lignes.filter((l) => l.vital === v))!);
  // L'ordre du sélecteur est celui de `VITAUX_HEATMAP`, le vital demandé à sa place.
  const choix = [principale, ...autres].sort((a, b) => rang(a.vital) - rang(b.vital));
  return { ...principale, choix };
}

function rang(vital: string): number {
  const i = (VITAUX_HEATMAP as readonly string[]).indexOf(vital);
  return i < 0 ? -1 : i;
}

function heatmapDUnVital(vital: string, grille: readonly string[], lignes: readonly LigneHistogramme[]): Heatmap | null {
  const b = BORNES_HEATMAP[vital];
  if (!b) return null;
  const bornes = bornesTranches(b.bas, b.haut);
  const parHeure = new Map<number, LigneHistogramme[]>();
  for (const l of lignes) {
    const k = Date.parse(l.heure);
    if (!parHeure.has(k)) parHeure.set(k, []);
    parHeure.get(k)!.push(l);
  }
  let partMax = 0;
  const colonnes = grille.map((t): ColonneHeatmap => {
    const ls = parHeure.get(Date.parse(t)) ?? [];
    const poids = new Array<number>(TRANCHES).fill(0);
    let total = 0;
    let n = 0;
    const seaux: SeauPondere[] = [];
    for (const l of ls) {
      if (!(l.poids > 0)) continue;
      poids[trancheDe(valeurDuSeau(l.bucket), bornes)] += l.poids;
      total += l.poids;
      n += l.mesures;
      seaux.push({ bucket: l.bucket, weighted_count: l.poids });
    }
    const parts = poids.map((w) => (total > 0 && w > 0 ? w / total : null));
    for (const p of parts) if (p != null && p > partMax) partMax = p;
    return { t, parts, n, p75: percentileDepuisSeaux(seaux, 0.75), faible: n > 0 && n < MESURES_MIN_COLONNE };
  });
  return { vital, bornes, colonnes, partMax };
}

/** La position verticale (0 en bas, 1 en haut) d'une valeur sur l'échelle logarithmique des tranches. */
export function positionLog(valeur: number, bornes: readonly number[]): number {
  const bas = bornes[0];
  const haut = bornes[bornes.length - 1];
  if (!(valeur > bas)) return 0;
  if (valeur >= haut) return 1;
  return Math.log(valeur / bas) / Math.log(haut / bas);
}
