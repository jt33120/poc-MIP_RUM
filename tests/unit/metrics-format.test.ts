// P1 — auto-observabilité : sérialisation Prometheus (lib/metrics-format.ts, pur).
import { describe, expect, it } from "vitest";
import { healthToMetrics, toPrometheus, type HealthSnapshot } from "../../apps/console/lib/metrics-format";

const SNAP: HealthSnapshot = {
  ingest_metrics_5m: 12,
  ingest_pageviews_5m: 5,
  ingest_errors_5m: 1,
  ingest_sessions_5m: 4,
  apps_active: 3,
  alerts_unacked: 2,
  deliveries_queued: 1,
  deliveries_failed: 0,
  deliveries_dead: 0,
  metering_lag_hours: 26.5,
};

describe("toPrometheus", () => {
  it("émet HELP/TYPE une seule fois par nom, avec labels", () => {
    const out = toPrometheus(healthToMetrics(SNAP));
    expect(out.match(/# HELP miprum_ingest_events_5m/g)).toHaveLength(1);
    expect(out.match(/# TYPE miprum_ingest_events_5m gauge/g)).toHaveLength(1);
    expect(out).toContain('miprum_ingest_events_5m{kind="metric"} 12');
    expect(out).toContain('miprum_alert_deliveries{status="queued"} 1');
    expect(out).toContain("miprum_metering_lag_hours 26.5");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("omet les échantillons à valeur null (mais garde HELP/TYPE)", () => {
    const out = toPrometheus(healthToMetrics({ ...SNAP, metering_lag_hours: null }));
    expect(out).toContain("# TYPE miprum_metering_lag_hours gauge");
    expect(out).not.toMatch(/^miprum_metering_lag_hours /m);
  });

  it("échappe les guillemets/backslash dans les labels", () => {
    const out = toPrometheus([
      { name: "x", help: "h", type: "gauge", value: 1, labels: { l: 'a"b\\c' } },
    ]);
    expect(out).toContain('x{l="a\\"b\\\\c"} 1');
  });

  it("ignore les valeurs non finies", () => {
    const out = toPrometheus([{ name: "y", help: "h", type: "gauge", value: Infinity }]);
    expect(out).not.toMatch(/^y /m);
  });
});
