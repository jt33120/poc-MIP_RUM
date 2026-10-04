import {
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
  type MetricWithAttribution,
} from "web-vitals/attribution";
import type { Emit } from "./errors";
import type { VitalName } from "./types";

// Bornes [good, needs-improvement] de web.dev, pour des notes cohérentes avec
// PageSpeed/CrUX (miroirs : shared/otlp.mjs, lib/rating.ts).
const THRESHOLDS: Record<VitalName, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function rating2026(name: VitalName, value: number): string {
  const [good, ni] = THRESHOLDS[name];
  return value <= good ? "good" : value <= ni ? "needs-improvement" : "poor";
}

/** Attribution compacte : on ne garde que les champs primitifs (debug lisible, payload léger). */
function compactAttribution(attribution: object): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(attribution).filter(
        ([, v]) => typeof v === "string" || typeof v === "number",
      ),
    ),
  );
}

export function initVitals(emit: Emit): void {
  const report = (metric: MetricWithAttribution) => {
    const name = metric.name as VitalName;
    emit(`webvital.${name}`, {
      "webvital.name": name,
      "webvital.value": metric.value,
      // Écart depuis le dernier rapport (CLS et INP sont rapportés plusieurs
      // fois) : seul moyen de sommer sans double-compter.
      "webvital.delta": metric.delta,
      "webvital.rating": rating2026(name, metric.value),
      "webvital.id": metric.id,
      "webvital.navigation_type": metric.navigationType,
      "webvital.attribution": compactAttribution(metric.attribution),
    });
  };
  onLCP(report);
  onINP(report);
  onCLS(report);
  onFCP(report);
  onTTFB(report);
}
