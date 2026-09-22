// AIOps — prévision : régression linéaire simple sur une série temporelle pour
// anticiper la dérive AVANT l'incident (vs les anomalies z-score, réactives).
// Logique PURE, testée. Volontairement transparente (moindres carrés), pas de
// boîte noire : on peut expliquer chaque projection.

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

// --- Axe des jours -----------------------------------------------------------

/**
 * Clé « AAAA-MM-JJ » d'un jour rendu par PostgreSQL. node-postgres rend un
 * `date` (et un `timestamp` sans fuseau) comme un `Date` à minuit LOCAL :
 * `String(date).slice(0, 10)` donnait « Tue Sep 22 », et l'axe affichait
 * « undefined/undefined ». On lit donc les composantes locales, qui sont
 * justement celles que le pilote a posées.
 */
export function cleJour(v: unknown): string {
  if (v instanceof Date) {
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const jj = String(v.getDate()).padStart(2, "0");
    return `${v.getFullYear()}-${mm}-${jj}`;
  }
  return String(v).slice(0, 10);
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

/** « AAAA-MM-JJ » d'un instant dans un fuseau ; un fuseau inconnu retombe sur UTC plutôt que de planter. */
function jourDansFuseau(ms: number, tz: string): string {
  const options = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: tz });
  } catch {
    f = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" });
  }
  const parts = f.formatToParts(ms);
  const v = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/**
 * Les `n` jours COMPLETS de la fenêtre des Tendances dans le fuseau `tz` : de J−n
 * à J−1, J = aujourd'hui dans ce fuseau. La journée en cours n'y est jamais : un
 * jour entamé n'a qu'une partie de son trafic, sa p75 et ses comptes ne se
 * comparent pas aux autres. Axe de repli quand aucune lecture n'a répondu.
 */
export function joursComplets(tz: string, maintenantMs: number, n = 14): string[] {
  const aujourdhui = jourDansFuseau(maintenantMs, tz);
  return Array.from({ length: n }, (_v, i) => jourDecale(aujourdhui, i - n));
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
