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

  it("sur un schéma v65 sans colonnes v66, écrit et commit les sources et la projection", async () => {
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("information_schema.columns")) {
        const table = params?.[0];
        const columns: Record<string, string[]> = {
          rum_session: [
            "session_id", "app_id", "client_id", "user_hash", "user_agent", "device_type",
            "geo_country", "is_bot", "collection_source", "release", "net_type", "visitor_id",
            "sample_rate", "error_sample_rate", "has_error", "started_at", "last_seen_at", "page_count",
          ],
          rum_event: ["span_id", "session_id", "app_id", "route", "name", "props", "ts"],
          rum_event_index: ["app_id", "session_id", "ts", "route", "kind", "source_name", "source_span_id"],
        };
        return { rows: (columns[String(table)] ?? []).map((column_name) => ({ column_name })) };
      }
      return { rows: [] };
    });

    const now = new Date();
    await expect(writeRows(pool, {
      sessions: [{
        session_id: "session-v65", app_id: "app-v65", client_id: null, user_hash: null,
        user_agent: null, device_type: "desktop", geo_country: null, is_bot: false,
        collection_source: "sdk", last_seen_at: now, user_id_hash: "a".repeat(64), context: { plan: "pro" },
      }],
      pageviews: [], metrics: [], errors: [], resources: [], longtasks: [], breadcrumbs: [],
      events: [{
        span_id: "00000000000000a2", session_id: "session-v65", app_id: "app-v65", route: "/x",
        name: "checkout", props: {}, ts: now, event_type: "action", user_id_hash: "a".repeat(64),
        context: { plan: "pro" },
      }],
      spans: [],
      eventIndex: [{
        app_id: "app-v65", session_id: "session-v65", ts: now, route: "/x", kind: "event",
        source_name: "checkout", source_span_id: "00000000000000a2", event_type: "action",
        user_id_hash: "a".repeat(64), context: { plan: "pro" },
      }],
      sviCalls: [], sviSteps: [], sviLegs: [],
    })).resolves.toBeUndefined();

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.startsWith("insert into rum_session"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("insert into rum_event "))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("insert into rum_event_index"))).toBe(true);
    expect(statements.at(-1)).toBe("commit");
    for (const insert of statements.filter((sql) => sql.startsWith("insert into rum_"))) {
      expect(insert).not.toContain("user_id_hash");
      expect(insert).not.toContain("account_id_hash");
      expect(insert).not.toContain("event_type");
      expect(insert).not.toContain("context");
    }
  });
});
