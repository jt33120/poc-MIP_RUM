// Déploiement avant migration v65 : une projection neuve ne doit jamais faire
// rollback les tables sources déjà disponibles.
import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error module .mjs partagé avec l'ingestion Node
import { _resetColonnesCache, writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";

const query = vi.fn();
const pool = { connect: async () => ({ query, release() {} }) };

beforeEach(() => {
  _resetColonnesCache();
  query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("information_schema.columns")) {
      const table = params?.[0];
      if (table === "rum_event_index") return { rows: [] };
      return { rows: [] };
    }
    return { rows: [] };
  });
});

describe("writeRows avant v65", () => {
  it("ignore rum_event_index absent et commit les écritures existantes", async () => {
    await expect(writeRows(pool, {
      sessions: [], pageviews: [], metrics: [], errors: [], resources: [], longtasks: [], breadcrumbs: [], events: [], spans: [],
      eventIndex: [{ app_id: "a", session_id: "s", ts: new Date(), route: "/x", kind: "event", source_name: "track", source_span_id: "00000000000000a1" }],
      sviCalls: [], sviSteps: [], sviLegs: [],
    })).resolves.toBeUndefined();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("insert into rum_event_index"))).toBe(false);
    expect(query.mock.calls.map(([sql]) => sql).join("\n")).toContain("commit");
  });
});
