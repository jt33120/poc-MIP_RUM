import { beforeEach, describe, expect, it, vi } from "vitest";

const { q, tx } = vi.hoisted(() => {
  const q = vi.fn();
  const tx = vi.fn(async (fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => unknown) =>
    fn({
      query: async (sql: string, params?: unknown[]) =>
        /^set transaction/i.test(sql) ? { rows: [] } : { rows: await q(sql, params) },
    }));
  return { q, tx };
});
vi.mock("@/lib/db", () => ({ q, tx }));

import { exploreEvents, eventCount } from "../../apps/console/lib/queries-events";

const filters = {
  app: "app-a", period: "24h" as const, device: "mobile" as const,
  segment: [], includeBots: false, includeInternal: false,
};

beforeEach(() => vi.clearAllMocks());

describe("Explorer d'événements — SQL borné et scopé", () => {
  it("partage le même CTE app+période+device+attribut pour liste, total, tendance et facettes", async () => {
    q.mockResolvedValueOnce([{ p1: true, p4: true }]);
    q.mockResolvedValueOnce([{ id: "2", app_id: "app-a", ts: new Date(), kind: "event" }]);
    q.mockResolvedValueOnce([{ total: 3, min_sample_rate: 0.2 }]);
    q.mockResolvedValueOnce([{ bucket: new Date(), count: 3 }]);
    q.mockResolvedValueOnce([{ value: "checkout", count: 3 }]);
    q.mockResolvedValueOnce([{ source: "props", key: "plan", count: 3 }]);
    q.mockResolvedValueOnce([{ type: "string", value: '"pro"', count: 3 }]);

    const result = await exploreEvents(filters, {
      kind: "event", name: "checkout",
      attribute: { source: "props", key: "plan", type: "string", value: "pro" },
    }, { limit: 20, offset: 0 }, null);

    expect(result.total).toBe(3);
    expect(tx).toHaveBeenCalledOnce();
    expect(result.sampling_notice?.message).toContain("Aucune extrapolation");
    const dataCalls = q.mock.calls.slice(1);
    for (const [sql, params] of dataCalls.slice(0, 5)) {
      expect(String(sql)).toContain("i.app_id = $1");
      expect(String(sql)).toContain("s.app_id = i.app_id");
      expect(String(sql)).toContain("interval '24 hours'");
      expect(String(sql)).toContain("e.props @> jsonb_build_object");
      expect(String(sql)).toContain("coalesce(e.event_type, 'custom') = 'custom'");
      expect(params).toContain("app-a");
      expect(params).toContain("plan");
      expect(params).toContain('"pro"');
      expect(String(sql)).not.toContain("checkout");
    }
    const [valuesSql, valuesParams] = dataCalls[5];
    expect(String(valuesSql)).not.toContain("e.props @> jsonb_build_object");
    expect(valuesParams).toContain("plan");
    expect(valuesParams).not.toContain('"pro"');
  });

  it("le widget event_count réutilise la même primitive et échoue doux avant v68", async () => {
    q.mockResolvedValueOnce([{ p1: true, p4: false }]);
    await expect(eventCount(filters, "checkout")).resolves.toEqual({
      count: null,
      sampling_notice: null,
      available: false,
      diagnostic: "migration v68 absente : compteur indisponible",
    });
    expect(q).toHaveBeenCalledTimes(1);
  });

  it("conserve le journal P1 avant v68 mais désactive les enrichissements", async () => {
    q.mockResolvedValueOnce([{ p1: true, p4: false }]);
    q.mockResolvedValueOnce([{ id: "1", app_id: "app-a", kind: "event", ts: new Date() }]);
    q.mockResolvedValueOnce([{ total: 42 }]);
    const result = await exploreEvents(filters, {
      kind: "event", name: null, attribute: null,
    }, { limit: 20, offset: 0 }, null);
    expect(result.events).toHaveLength(1);
    expect(result.total).toBe(42);
    expect(result.trend).toEqual([]);
    expect(result.enrichment).toEqual(expect.objectContaining({ available: false }));
  });

  it("applique le curseur keyset sans cumuler de SQL utilisateur", async () => {
    q.mockResolvedValueOnce([{ p1: true, p4: true }]);
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce([{ total: 0, min_sample_rate: null }]);
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce([]);
    await exploreEvents(filters, {
      kind: "event", name: null, attribute: null,
    }, { limit: 20, offset: 0 }, { ts: "2026-09-16T10:00:00.000Z", id: "42" });
    const [sql, params] = q.mock.calls[1];
    expect(String(sql)).toContain("(i.ts, i.id) < ($8::timestamptz, $9::bigint)");
    expect(params).toContain("2026-09-16T10:00:00.000Z");
    expect(params).toContain("42");
  });

  it("borne la fenêtre au même now, protège les facettes legacy et applique segment/bots/interne", async () => {
    q.mockResolvedValueOnce([{ p1: true, p4: true }]);
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce([{ total: 0, min_sample_rate: null }]);
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce([]);
    await exploreEvents({
      ...filters,
      app: null,
      segment: [{ dim: "geo", op: "==", value: "FR" }],
    }, { kind: "event", name: null, attribute: null }, { limit: 20, offset: 0 }, null);

    const dataCalls = q.mock.calls.slice(1);
    for (const [sql] of dataCalls) {
      expect(String(sql)).toContain("i.ts <= now()");
      expect(String(sql)).toContain("s.geo_country =");
      expect(String(sql)).toContain("not coalesce(s.is_bot, false)");
      expect(String(sql)).toContain("app_registry where internal");
    }
    expect(String(dataCalls[2][0])).toContain("generate_series(start, stop");
    expect(String(dataCalls[4][0])).toContain("jsonb_typeof(f.props) = 'object'");
  });
});
