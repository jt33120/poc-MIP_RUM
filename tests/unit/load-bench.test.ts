// B2 — bench de charge : on teste les helpers PURS (générateur de payload,
// percentile). Le générateur est validé contre le vrai parser d'ingestion
// (flattenOtlp) : un payload de bench doit produire des lignes propres, 0 rejet.
// `main()` est gardé dans le script -> l'import ne lance aucun bench.
import { describe, expect, it } from "vitest";
import {
  buildPayload,
  eventsInPayload,
  percentile,
} from "../../scripts/load-bench.mjs";
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

describe("percentile", () => {
  it("p50/p95/p100 et tableau vide", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([10, 20, 30, 40], 100)).toBe(40);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("buildPayload — générateur réaliste validé par flattenOtlp", () => {
  it("session nominale (sans erreur) : lignes propres, 0 rejet", () => {
    const p = buildPayload(0, { errorRate: 0 });
    expect(eventsInPayload(p)).toBe(8); // 1 pageview + 5 vitals + 1 resource + 1 longtask
    const rows = flattenOtlp(p);
    expect(rows.rejected).toBe(0);
    expect(rows.sessions).toHaveLength(1);
    expect(rows.sessions[0].app_id).toBe("load-bench");
    expect(rows.pageviews).toHaveLength(1);
    expect(rows.metrics).toHaveLength(5);
    expect(rows.resources).toHaveLength(1);
    expect(rows.longtasks).toHaveLength(1);
    expect(rows.errors).toHaveLength(0);
  });

  it("errorRate=1 ajoute une erreur exploitable", () => {
    const p = buildPayload(0, { errorRate: 1 });
    expect(eventsInPayload(p)).toBe(9);
    const rows = flattenOtlp(p);
    expect(rows.rejected).toBe(0);
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0].error_type).toBe("TypeError");
  });

  it("app_id surchargé + sessions distinctes par index", () => {
    const a = flattenOtlp(buildPayload(1, { app: "x", errorRate: 0 })).sessions[0];
    const b = flattenOtlp(buildPayload(2, { app: "x", errorRate: 0 })).sessions[0];
    expect(a.app_id).toBe("x");
    expect(a.session_id).not.toBe(b.session_id);
  });
});
