// Déploiement avant migration v65 : une projection neuve ne doit jamais faire
// rollback les tables sources déjà disponibles.
import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error module .mjs partagé avec l'ingestion Node
import { _resetColonnesCache, writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";

const query = vi.fn();
const pool = { connect: async () => ({ query, release() {} }) };

beforeEach(() => {
  _resetColonnesCache();
  query.mockClear();
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
      pageviews: [], metrics: [],
      errors: [{
        span_id: "00000000000000e1", session_id: "session-v65", app_id: "app-v65", route: "/x",
        kind: "error", message: "boom", error_type: "Error", stack: "", source: null,
        lineno: null, colno: null, release: null, fingerprint: "f", occurrences: 1,
        action_id: "11111111-2222-4333-8444-555555555555", ts: now,
      }],
      resources: [], longtasks: [], breadcrumbs: [],
      events: [{
        span_id: "00000000000000a2", session_id: "session-v65", app_id: "app-v65", route: "/x",
        name: "checkout", props: {}, ts: now, event_type: "action", user_id_hash: "a".repeat(64),
        context: { plan: "pro" },
      }],
      spans: [],
      actions: [{
        action_id: "11111111-2222-4333-8444-555555555555", span_id: "00000000000000a1",
        session_id: "session-v65", app_id: "app-v65", type: "click", name: "Payer",
        route: "/x", context: {}, ts: now,
      }],
      eventIndex: [{
        app_id: "app-v65", session_id: "session-v65", ts: now, route: "/x", kind: "event",
        source_name: "frustration.error", source_span_id: "00000000000000a2", event_type: "action",
        user_id_hash: "a".repeat(64), context: { plan: "pro" },
      }],
      sviCalls: [], sviSteps: [], sviLegs: [],
    })).resolves.toBeUndefined();

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.startsWith("insert into rum_session"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("insert into rum_event "))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("insert into rum_event_index"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("insert into rum_action"))).toBe(false);
    expect(statements.find((sql) => sql.startsWith("insert into rum_error"))).not.toContain("action_id");
    const indexCall = query.mock.calls.find(([sql]) => String(sql).startsWith("insert into rum_event_index"));
    expect(indexCall?.[1]).toContain("track");
    expect(indexCall?.[1]).not.toContain("frustration.error");
    expect(statements.at(-1)).toBe("commit");
    for (const insert of statements.filter((sql) => sql.startsWith("insert into rum_"))) {
      expect(insert).not.toContain("user_id_hash");
      expect(insert).not.toContain("account_id_hash");
      expect(insert).not.toContain("event_type");
      expect(insert).not.toContain("context");
    }
  });

  it("sur v67 écrit la racine avant les enfants et garde la taxonomie error click", async () => {
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("information_schema.columns")) {
        const table = String(params?.[0]);
        const columns: Record<string, string[]> = {
          rum_session: ["session_id", "app_id", "client_id", "user_hash", "user_agent", "device_type", "geo_country", "is_bot", "started_at", "last_seen_at", "page_count"],
          rum_action: ["action_id"],
          rum_error: ["action_id", "occurrences"],
          rum_resource: ["action_id"],
          rum_breadcrumb: ["action_id", "route"],
          rum_span: ["action_id"],
          rum_event: ["action_id"],
          rum_event_index: ["source_span_id", "action_id"],
        };
        return { rows: (columns[table] ?? []).map((column_name) => ({ column_name })) };
      }
      return { rows: [] };
    });
    const now = new Date();
    const actionId = "11111111-2222-4333-8444-555555555555";
    await writeRows(pool, {
      sessions: [], pageviews: [], metrics: [], resources: [], longtasks: [], breadcrumbs: [], events: [], spans: [],
      actions: [{ action_id: actionId, span_id: "00000000000000a1", session_id: "s", app_id: "a", type: "click", name: "Payer", route: "/", context: {}, ts: now }],
      errors: [{ span_id: "00000000000000e1", session_id: "s", app_id: "a", route: "/", kind: "error", message: "boom", error_type: "Error", stack: "", source: null, lineno: null, colno: null, release: null, fingerprint: "f", occurrences: 1, action_id: actionId, ts: now }],
      eventIndex: [{ app_id: "a", session_id: "s", ts: now, route: "/", kind: "event", source_name: "frustration.error", source_span_id: "00000000000000f1", action_id: actionId }],
      sviCalls: [], sviSteps: [], sviLegs: [],
    });
    const statements = query.mock.calls.map(([sql]) => String(sql));
    const root = statements.findIndex((sql) => sql.startsWith("insert into rum_action"));
    const child = statements.findIndex((sql) => sql.startsWith("insert into rum_error"));
    expect(root).toBeGreaterThan(-1);
    expect(child).toBeGreaterThan(root);
    expect(statements[root]).toContain("action_id");
    expect(statements[child]).toContain("action_id");
    const indexCall = query.mock.calls.find(([sql]) => String(sql).startsWith("insert into rum_event_index"));
    expect(indexCall?.[1]).toContain("frustration.error");
  });
});
