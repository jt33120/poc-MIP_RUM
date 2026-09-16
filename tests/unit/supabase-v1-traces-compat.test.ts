import { describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé avec le receiver Supabase/Deno
import { createSchemaCompatibleWriter } from "../../apps/ingest/supabase/functions/_shared/write-causal.mjs";

const ACTION = "11111111-2222-4333-8444-555555555555";
const retry = async <T>(fn: () => Promise<T>) => fn();

function fakeSupabase(version: 65 | 66 | 67) {
  const calls: Array<{ table: string; batch: Record<string, unknown>[]; options: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      from(table: string) {
        return {
          async upsert(batch: Record<string, unknown>[], options: Record<string, unknown>) {
            calls.push({ table, batch, options });
            const p2 = [
              "event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name",
              "action_id", "timing_ms", "feature_flag_value",
            ];
            const eventOnly = p2.filter((key) => key !== "action_id");
            if (!["rum_action", "rum_event", "rum_event_index"].includes(table) && eventOnly.some((key) => key in batch[0])) {
              const key = eventOnly.find((candidate) => candidate in batch[0]);
              return { error: { code: "PGRST204", message: `could not find ${key} column` } };
            }
            if (version < 67 && table === "rum_action") {
              return { error: { code: "PGRST205", message: "table rum_action absent from schema cache" } };
            }
            if (version < 67 && ["rum_error", "rum_resource", "rum_span"].includes(table) && "action_id" in batch[0]) {
              return { error: { code: "PGRST204", message: "could not find action_id column" } };
            }
            if (version < 67 && table === "rum_breadcrumb" && ("action_id" in batch[0] || "route" in batch[0])) {
              return { error: { code: "PGRST204", message: "could not find route column" } };
            }
            if (version < 66 && ["rum_event", "rum_event_index"].includes(table) && p2.some((key) => key in batch[0])) {
              const key = p2.find((candidate) => candidate in batch[0]);
              return { error: { code: "PGRST204", message: `could not find ${key} column` } };
            }
            if (version < 67 && table === "rum_event_index" && batch[0]?.source_name === "frustration.error") {
              return { error: { code: "23514", message: "rum_event_index_source_name_check" } };
            }
            return { error: null };
          },
        };
      },
    },
  };
}

function collections() {
  const common = {
    span_id: "00000000000000a1",
    action_id: ACTION,
    context: { dossier: "client" },
    user_id_hash: "a".repeat(64),
  };
  return {
    actions: [{ ...common, name: "Payer" }],
    errors: [{ ...common, message: "boom" }],
    resources: [{ ...common, url: "https://app.test/pay.js" }],
    breadcrumbs: [{ ...common, route: "/checkout", label: "Payer" }],
    spans: [{ ...common, name: "POST /pay" }],
    events: [{ ...common, name: "checkout", props: {}, event_type: "custom" }],
    eventIndex: [{ ...common, source_name: "frustration.error" }],
  };
}

describe("receiver Supabase v1-traces — compatibilité causale", () => {
  it("sur v66 conserve les sources P2 sans table, colonnes ni taxonomie P3", async () => {
    const db = fakeSupabase(66);
    const writer = createSchemaCompatibleWriter(db.client, { retry, onRetry() {} });
    const rows = collections();

    await writer.writeTraceCollections(rows);

    expect(db.calls[0].table).toBe("rum_action");
    expect(db.calls.filter((call) => call.table === "rum_action")).toHaveLength(1);
    for (const table of ["rum_error", "rum_resource", "rum_breadcrumb", "rum_span"]) {
      const attempts = db.calls.filter((call) => call.table === table);
      expect(attempts).toHaveLength(2);
      expect(attempts[0].batch[0]).toHaveProperty("action_id", ACTION);
      expect(attempts[1].batch[0]).not.toHaveProperty("action_id");
      expect(attempts[0].batch[0]).not.toHaveProperty("context");
      expect(attempts[0].batch[0]).not.toHaveProperty("user_id_hash");
    }
    expect(db.calls.find((call) => call.table === "rum_event")?.batch[0])
      .toMatchObject({ event_type: "custom", context: { dossier: "client" } });
    const breadcrumbFallback = db.calls.filter((call) => call.table === "rum_breadcrumb")[1];
    expect(breadcrumbFallback.batch[0]).not.toHaveProperty("route");
    const indexAttempts = db.calls.filter((call) => call.table === "rum_event_index");
    expect(indexAttempts.map((call) => call.batch[0].source_name))
      .toEqual(["frustration.error", "track"]);
  });

  it("sur v65 replie aussi les colonnes P2 de rum_event et rum_event_index", async () => {
    const db = fakeSupabase(65);
    const writer = createSchemaCompatibleWriter(db.client, { retry, onRetry() {} });
    await writer.writeTraceCollections(collections());

    const events = db.calls.filter((call) => call.table === "rum_event");
    expect(events).toHaveLength(2);
    expect(events[0].batch[0]).toHaveProperty("context");
    for (const key of ["event_type", "context", "user_id_hash", "action_id"]) {
      expect(events[1].batch[0]).not.toHaveProperty(key);
    }
    const indexes = db.calls.filter((call) => call.table === "rum_event_index");
    expect(indexes).toHaveLength(2);
    expect(indexes[1].batch[0]).toMatchObject({ source_name: "track" });
    expect(indexes[1].batch[0]).not.toHaveProperty("context");
    expect(indexes[1].batch[0]).not.toHaveProperty("action_id");
  });

  it("sur v67 écrit d'abord la racine et conserve tous les liens et la route", async () => {
    const db = fakeSupabase(67);
    const writer = createSchemaCompatibleWriter(db.client, { retry, onRetry() {} });
    const rows = collections();

    await writer.writeTraceCollections(rows);

    expect(db.calls.map((call) => call.table)).toEqual([
      "rum_action", "rum_event", "rum_error", "rum_resource", "rum_breadcrumb", "rum_span", "rum_event_index",
    ]);
    expect(db.calls.find((call) => call.table === "rum_breadcrumb")?.batch[0])
      .toMatchObject({ action_id: ACTION, route: "/checkout" });
    expect(db.calls.find((call) => call.table === "rum_action")?.options)
      .toMatchObject({ onConflict: "action_id", ignoreDuplicates: true });
    expect(db.calls.find((call) => call.table === "rum_event_index")?.batch[0])
      .toMatchObject({ action_id: ACTION, source_name: "frustration.error" });
  });
});
