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

export type TrendDir = "up" | "down" | "flat";

/** Sens de la tendance, relatif à l'échelle de la mesure (pente/magnitude). */
export function trendDir(fit: Fit, refMagnitude: number): TrendDir {
  const rel = refMagnitude ? fit.slope / Math.abs(refMagnitude) : fit.slope;
  if (rel > 0.02) return "up";
  if (rel < -0.02) return "down";
  return "flat";
}
