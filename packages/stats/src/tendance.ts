// Tendance d'une série quotidienne (§ 5.20, F65) : régression linéaire simple pour
// anticiper la dérive AVANT l'incident (vs les anomalies z-score, réactives).
// Logique PURE, testée par tests/unit/forecast.test.ts. Volontairement
// transparente (moindres carrés), pas de boîte noire : on peut expliquer chaque
// projection. Écran « Tendances » (`/forecast`, jamais « Prévisions » : ce n'est
// pas une prévision), Vue d'ensemble, et `GET /api/v1/trends`.
//
// Ce qui dépend de la CONSOLE est resté dans `apps/console/lib/forecast.ts` : la
// clé de jour d'une ligne node-postgres (`cleJour`) et l'axe de repli dans un
// fuseau (`joursComplets`). Les bornes « Bon » des vitals se lisent dans
// `apps/console/lib/rating.ts` : ici, une borne est un nombre qu'on reçoit.

export interface Fit {
  slope: number; // variation par pas (jour)
  intercept: number;
  n: number; // longueur de la série (le dernier point est à x = n-1)
}

/** Ajuste y = slope·x + intercept par moindres carrés. x = index dans la série
 * (les trous/null sont ignorés mais gardent leur position). null si < 3 points. */
export function linfit(ys: (number | null | undefined)[]): Fit | null {
  const pts: [number, number][] = [];
  ys.forEach((y, i) => {
    if (y != null && Number.isFinite(y)) pts.push([i, y]);
  });
  if (pts.length < 3) return null;
  const n = pts.length;
  const sx = pts.reduce((a, [x]) => a + x, 0);
  const sy = pts.reduce((a, [, y]) => a + y, 0);
  const sxx = pts.reduce((a, [x]) => a + x * x, 0);
  const sxy = pts.reduce((a, [x, y]) => a + x * y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept, n: ys.length };
}

/** Valeur projetée à l'index x. */
export function projectAt(fit: Fit, x: number): number {
  return fit.intercept + fit.slope * x;
}

/** Valeur projetée `stepsAhead` pas après le dernier point. */
export function forecastNext(fit: Fit, stepsAhead: number): number {
  return projectAt(fit, fit.n - 1 + stepsAhead);
}

/**
 * Nombre de pas (jours) avant que la tendance ne franchisse `threshold` dans le
 * sens défavorable. 0 si déjà franchi, null si la tendance s'en éloigne / est plate.
 */
export function etaToThreshold(
  fit: Fit,
  current: number,
  threshold: number,
  higherIsWorse: boolean,
): number | null {
  const worsening = higherIsWorse ? fit.slope > 0 : fit.slope < 0;
  const worseNow = higherIsWorse ? current >= threshold : current <= threshold;
  if (worseNow) return 0;
  if (!worsening) return null;
  const x = (threshold - fit.intercept) / fit.slope;
  const steps = x - (fit.n - 1);
  return Number.isFinite(steps) && steps > 0 ? steps : null;
}

// --- Narration AIOps (déterministe, sans LLM) --------------------------------

/**
 * Horizon de la projection ET de la fenêtre d'alerte, en jours. Un seul nombre :
 * la narration annonçait « horizon de 3 jours » tout en signalant les
 * franchissements jusqu'à J+7, et le graphe s'arrêtait à J+3 — trois horizons
 * pour une seule droite.
 */
export const HORIZON_JOURS = 7;

export interface NarrativeInput {
  label: string;
  thresholdLabel: string;
  /** Sortie d'etaToThreshold : 0 = déjà dépassé, >0 = pas avant franchissement, null = ok. */
  eta: number | null;
  /**
   * F65 (§ 5.20.3, TE1 b) : la tendance d'où vient l'échéance. Une pente dans le
   * bruit, ou trop peu de jours mesurés, n'annoncent AUCUNE échéance — seul un
   * seuil déjà dépassé reste dit, c'est une mesure, pas une projection. Absent : le
   * comportement d'avant.
   */
  tendance?: Pick<Tendance, "etat" | "joursValides" | "joursRequis" | "jours">;
}
export interface Narrative {
  status: "risk" | "watch" | "ok";
  lines: string[];
}

/** L'échéance qu'on a le droit d'écrire : aucune projection sans pente établie. */
function etaEcrite(i: NarrativeInput): number | null {
  if (!i.tendance || i.tendance.etat === "significative") return i.eta;
  return i.eta === 0 ? 0 : null;
}

/** Résume en clair quels indicateurs vont franchir leur seuil et quand. Purement
 * dérivé des projections — explicable, jamais une boîte noire. */
export function buildForecastNarrative(items: NarrativeInput[]): Narrative {
  const breached = items.filter((i) => etaEcrite(i) === 0);
  const soon = items.filter((i) => {
    const eta = etaEcrite(i);
    return eta != null && eta > 0 && eta <= HORIZON_JOURS;
  });
  const lines: string[] = [];
  for (const i of breached) lines.push(`${i.label} dépasse déjà son seuil (${i.thresholdLabel}).`);
  for (const i of soon) lines.push(`${i.label} devrait franchir ${i.thresholdLabel} vers J+${Math.ceil(etaEcrite(i) as number)}.`);
  // Une tendance muette le DIT : sans cette ligne, « aucun indicateur ne devrait
  // franchir » se lirait comme une projection rassurante qu'on n'a pas faite.
  for (const i of items) {
    const t = i.tendance;
    if (!t || t.etat === "significative") continue;
    lines.push(
      t.etat === "bruit"
        ? `${i.label} : tendance non distinguable du bruit sur ${t.jours} jours ; aucune échéance n'est écrite.`
        : `${i.label} : pas assez de jours mesurés (${t.joursValides} sur ${t.jours}, ${t.joursRequis} requis) ; aucune tendance n'est calculée.`,
    );
  }
  if (!lines.length) lines.push(`Aucun indicateur ne devrait franchir son seuil sur l'horizon de ${HORIZON_JOURS} jours.`);
  return { status: breached.length ? "risk" : soon.length ? "watch" : "ok", lines };
}

export type TrendDir = "up" | "down" | "flat";

/** Sens de la tendance, relatif à l'échelle de la mesure (pente/magnitude). */
export function trendDir(fit: Fit, refMagnitude: number): TrendDir {
  const rel = refMagnitude ? fit.slope / Math.abs(refMagnitude) : fit.slope;
  if (rel > 0.02) return "up";
  if (rel < -0.02) return "down";
  return "flat";
}

// --- Tendance et bruit (F65, § 5.20.3, TE5) ----------------------------------
//
// UNE DROITE N'EST PAS UNE TENDANCE. `linfit` trace une droite dès trois points,
// qu'ils s'alignent ou non : sur quatorze jours qui oscillent, elle a toujours une
// pente, et l'ancien écran en tirait une échéance. Ici la pente n'est retenue que
// si la variation qu'elle décrit sur la fenêtre dépasse deux fois la dispersion
// des points autour de la droite — sinon « tendance non distinguable du bruit »,
// et aucune échéance. Règle volontairement simple et écrite à l'écran (TE8) ; le
// test de pente de P*.4 (t de Student, bande de prédiction) la remplacera.

/** Mesures sous lesquelles un jour est creux et n'entre pas dans l'ajustement. */
export const MESURES_MIN_JOUR = 30;

/** Jours valides (≥ `MESURES_MIN_JOUR` mesures) sous lesquels aucune droite n'est tracée. */
export const JOURS_VALIDES_REQUIS = 7;

/** Facteur de la règle de pente : variation sur la fenêtre > k × dispersion des résidus. */
export const K_BRUIT = 2;

/** La règle, écrite à côté du résultat (RM4) — celle que l'écran « Méthode » développe. */
export const REGLE_TENDANCE =
  `droite des moindres carrés sur les jours d'au moins ${MESURES_MIN_JOUR} mesures, ${JOURS_VALIDES_REQUIS} jours valides requis ; ` +
  `pente retenue si la variation qu'elle décrit sur la fenêtre dépasse ${K_BRUIT} écarts types des résidus ; ` +
  `échéance écrite sur ${HORIZON_JOURS} jours au plus, jamais sur une pente dans le bruit ; aucune saisonnalité ; ` +
  `journée en cours exclue ; ce n'est pas une prévision`;

/**
 * Le premier jour où une tendance PEUT être calculée, en clé « AAAA-MM-JJ » : le
 * lendemain du dernier jour complet, plus les jours valides qui manquent — si
 * chaque journée à venir compte assez de mesures. Un état vide qui ne dit pas quand
 * l'écran servira laisse l'utilisateur revenir au hasard (recette du 26/09/2026).
 * `null` sans dernier jour lisible, ou si rien ne manque.
 */
export function premiereTendancePossible(
  dernierJour: string | undefined,
  joursValides: number,
  requis = JOURS_VALIDES_REQUIS,
): string | null {
  const manque = requis - joursValides;
  if (!dernierJour || manque <= 0) return null;
  const ms = Date.parse(`${dernierJour}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + (1 + manque) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Écart type des résidus autour de la droite, sur les points mesurés :
 * `√(Σ résidus² / (m − 2))` — deux degrés de liberté pris par la droite. `null`
 * sous trois points (la dispersion d'une droite qui passe par deux points n'existe pas).
 */
export function dispersionResidus(fit: Fit, ys: (number | null | undefined)[]): number | null {
  let somme = 0;
  let m = 0;
  ys.forEach((y, i) => {
    if (y == null || !Number.isFinite(y)) return;
    const r = y - projectAt(fit, i);
    somme += r * r;
    m++;
  });
  return m < 3 ? null : Math.sqrt(somme / (m - 2));
}

/**
 * La pente se distingue-t-elle du bruit ? Vrai si la variation qu'elle décrit sur
 * la fenêtre (`|pente| × nombre de jours`) dépasse `k` fois la dispersion des
 * résidus. Une droite parfaite (dispersion nulle) de pente non nulle l'est ; une
 * série plate ne l'est jamais.
 */
export function penteSignificative(fit: Fit, ys: (number | null | undefined)[], k = K_BRUIT): boolean {
  const dispersion = dispersionResidus(fit, ys);
  if (dispersion === null) return false;
  return Math.abs(fit.slope) * ys.length > k * dispersion;
}

export interface Tendance {
  /** `insuffisante` : pas de droite ; `bruit` : droite tracée, aucune échéance ; `significative` : échéance et projection. */
  etat: "insuffisante" | "bruit" | "significative";
  /** Jours retenus pour l'ajustement (valeur mesurée et au moins `MESURES_MIN_JOUR` mesures). */
  joursValides: number;
  joursRequis: number;
  /** Longueur de la fenêtre (14 jours). */
  jours: number;
  /** Droite ajustée sur les jours valides ; `null` si insuffisante. Indices = rangs de jour de la fenêtre. */
  fit: Fit | null;
  dispersion: number | null;
  /** Les valeurs retenues (les autres à `null`), dans l'ordre de la fenêtre. */
  retenues: (number | null)[];
}

/**
 * Tendance d'une série quotidienne. `effectifs` : mesures par jour ; un jour sous
 * `min` est exclu de l'ajustement (il reste dessiné, creux). Sans effectifs, toute
 * valeur mesurée est retenue.
 */
export function tendance(
  ys: (number | null)[],
  effectifs: (number | null)[] | null = null,
  { min = MESURES_MIN_JOUR, requis = JOURS_VALIDES_REQUIS }: { min?: number; requis?: number } = {},
): Tendance {
  const retenues = ys.map((y, i) => {
    if (y == null || !Number.isFinite(y)) return null;
    if (effectifs && !((effectifs[i] ?? 0) >= min)) return null;
    return y;
  });
  const joursValides = retenues.filter((y) => y !== null).length;
  const base = { joursValides, joursRequis: requis, jours: ys.length, retenues };
  if (joursValides < requis) return { ...base, etat: "insuffisante", fit: null, dispersion: null };
  const fit = linfit(retenues);
  if (!fit) return { ...base, etat: "insuffisante", fit: null, dispersion: null };
  const dispersion = dispersionResidus(fit, retenues);
  return { ...base, etat: penteSignificative(fit, retenues) ? "significative" : "bruit", fit, dispersion };
}

/** Le jour « AAAA-MM-JJ » décalé de `k` jours (calendrier, sans fuseau : c'est une étiquette). */
export function jourDecale(jour: string, k: number): string {
  const [a, m, j] = jour.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j + k)).toISOString().slice(0, 10);
}

/**
 * Un point du hero des Tendances (clés lues par `ThresholdSeries`). Un alias de
 * type, pas une interface : il doit s'affecter à `PointSerie` (signature d'index).
 */
export type PointTendance = {
  t: string;
  observe: number | null;
  n: number | null;
  ajuste: number | null;
  projection: number | null;
  bas: number | null;
  haut: number | null;
};

/**
 * Points du hero « LCP p75 quotidien et sa tendance » : les jours observés, la
 * droite ajustée tracée SUR les jours observés (pour voir si elle colle aux
 * points), et — seulement si la pente dépasse le bruit — la projection sur
 * `horizon` jours après le dernier, dans une bande de ± 1 écart type des résidus.
 * La projection part du dernier jour observé (même valeur que la droite) : le
 * pointillé prolonge la droite sans saut.
 */
export function pointsTendance(
  jours: string[],
  ys: (number | null)[],
  effectifs: (number | null)[] | null,
  t: Tendance,
  horizon = HORIZON_JOURS,
): { grille: string[]; points: PointTendance[] } {
  const dernier = jours.length - 1;
  const fit = t.etat === "significative" ? t.fit : null;
  const d = t.dispersion ?? 0;
  const points: PointTendance[] = jours.map((jour, i) => {
    const ajuste = t.fit ? projectAt(t.fit, i) : null;
    const projection = fit && i === dernier ? ajuste : null;
    return {
      t: jour,
      observe: ys[i] ?? null,
      n: effectifs ? (effectifs[i] ?? 0) : null,
      ajuste,
      projection,
      bas: projection === null ? null : projection - d,
      haut: projection === null ? null : projection + d,
    };
  });
  if (fit && dernier >= 0) {
    for (let k = 1; k <= horizon; k++) {
      const projection = forecastNext(fit, k);
      points.push({ t: jourDecale(jours[dernier], k), observe: null, n: null, ajuste: null, projection, bas: projection - d, haut: projection + d });
    }
  }
  return { grille: points.map((p) => p.t), points };
}

/**
 * Échéance de franchissement d'une borne « Bon » INCLUSE (TE1), pour une mesure
 * dont une valeur plus haute est pire (les cinq Core Web Vitals) : « franchie »
 * veut dire que la valeur DÉPASSE la borne — 2 500 ms est encore « Bon » pour le
 * LCP, comme dans `rating2026` de la console. `etaToThreshold` compte l'égalité
 * comme franchie (`>=`) : il n'est pas employé pour ces seuils.
 *
 *   - `0` : la dernière valeur retenue dépasse déjà la borne (c'est une mesure) ;
 *   - `k > 0` : pas (jours) avant que la droite dépasse la borne ; une droite qui
 *     l'atteint déjà au dernier jour alors que la mesure est encore « Bon » donne
 *     J+1 (le premier jour projeté) ;
 *   - `null` : pas de droite, droite plate ou descendante, ou aucune valeur.
 */
export function echeanceSeuil(fit: Fit | null, courant: number | null, borne: number): number | null {
  if (courant === null || !Number.isFinite(courant)) return null;
  if (courant > borne) return 0;
  if (!fit || !(fit.slope > 0)) return null;
  const pas = (borne - fit.intercept) / fit.slope - (fit.n - 1);
  return Number.isFinite(pas) ? Math.max(pas, 1) : null;
}

/** Ce que l'échéance permet d'ÉCRIRE, dans les termes de la synthèse (TE1). */
export type EtatEcheance =
  /** La dernière valeur retenue dépasse déjà la borne : une mesure, écrite même sans pente. */
  | "depasse"
  /** Pente établie, franchissement dans l'horizon. */
  | "prevu"
  /** Pente établie, aucun franchissement dans l'horizon (droite plate, descendante ou trop lente). */
  | "aucun"
  /** Pente dans le bruit, ou pas assez de jours : AUCUNE projection n'est écrite. */
  | "non_ecrit";

export interface Echeance {
  etat: EtatEcheance;
  /** Jours après le dernier jour de la série, arrondis au jour supérieur (`J+k`) ; `0` si déjà dépassée ; `null` sinon. */
  dans: number | null;
  /** « AAAA-MM-JJ » du franchissement (le dernier jour de la série si déjà dépassée) ; `null` sinon. */
  jour: string | null;
  /** La borne « Bon » contre laquelle l'échéance est calculée (incluse : l'égalité est encore « Bon »). */
  borne: number;
  /** L'horizon au-delà duquel rien n'est annoncé (`HORIZON_JOURS`). */
  horizon: number;
}

/**
 * L'échéance ÉCRITE, avec la même règle que `buildForecastNarrative` : un seuil déjà
 * dépassé se dit toujours ; un franchissement à venir, seulement si la pente dépasse
 * le bruit ET qu'il tombe dans l'horizon. Sans cette règle, une droite dans le bruit
 * annoncerait une date — c'est ce que F65 a retiré de l'écran.
 *
 * @param eta sortie d'`echeanceSeuil`
 * @param dernierJour « AAAA-MM-JJ » du dernier jour de la série (la date d'un dépassement)
 */
export function echeanceEcrite(
  eta: number | null,
  t: Pick<Tendance, "etat">,
  borne: number,
  dernierJour: string | undefined,
  horizon = HORIZON_JOURS,
): Echeance {
  const base = { borne, horizon };
  if (eta === 0) return { etat: "depasse", dans: 0, jour: dernierJour ?? null, ...base };
  if (t.etat !== "significative") return { etat: "non_ecrit", dans: null, jour: null, ...base };
  if (eta === null || !(eta <= horizon)) return { etat: "aucun", dans: null, jour: null, ...base };
  const dans = Math.ceil(eta);
  return { etat: "prevu", dans, jour: dernierJour ? jourDecale(dernierJour, dans) : null, ...base };
}
