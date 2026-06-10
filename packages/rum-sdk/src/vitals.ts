import type { Tracer } from "@opentelemetry/api";
import { onLCP, type MetricWithAttribution } from "web-vitals/attribution";
import type { VitalName } from "./types";

// 2026 thresholds (PLAN annexe B): [good, needs-improvement] upper bounds
const THRESHOLDS: Record<VitalName, [number, number]> = {
  LCP: [2000, 2500],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function rating2026(name: VitalName, value: number): string {
  const [good, ni] = THRESHOLDS[name];
  return value <= good ? "good" : value <= ni ? "needs-improvement" : "poor";
}

export type AttrProvider = () => Record<string, string | number>;

export function initVitals(tracer: Tracer, baseAttrs: AttrProvider): void {
  const report = (metric: MetricWithAttribution) => {
    const name = metric.name as VitalName;
    const span = tracer.startSpan(`webvital.${name}`);
    span.setAttributes({
      ...baseAttrs(),
      "webvital.name": name,
      "webvital.value": metric.value,
      "webvital.rating": rating2026(name, metric.value),
      "webvital.id": metric.id,
      "webvital.navigation_type": metric.navigationType,
    });
    span.end();
  };
  onLCP(report);
}
