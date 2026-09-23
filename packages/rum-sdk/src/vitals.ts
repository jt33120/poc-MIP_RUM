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

// Seuils Core Web Vitals — bornes [good, needs-improvement].
// ALIGNÉS sur la référence web.dev (E0) : le LCP était noté [2000, 2500], ce qui
// classait « à améliorer » des pages que Google classe « bonnes ». Toute
// divergence ici rend nos notes inexplicables face à PageSpeed/CrUX.
// Miroir strict de shared/otlp.mjs (ingestion) et lib/rating.ts (console).
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
      // delta = écart depuis le DERNIER rapport de cette métrique (web-vitals
      // rapporte plusieurs fois : CLS et INP s'aggravent au fil de la page).
      // Sans lui, un consommateur ne peut pas sommer les rapports successifs
      // sans double-comptage — c'est le champ que la bibliothèque expose
      // explicitement pour l'agrégation (E0).
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
