// Pont de journalisation de l'agent Node (signal LOGS).
//
// Enjeu couvert ici : le contrat d'ingestion. flattenOtlpLogs (côté edge) lit
// resourceLogs[].scopeLogs[].logRecords[] et prend le contexte de trace dans les
// champs NATIFS rec.traceId / rec.spanId. Un écart silencieux sur cette forme
// produirait des logs ingérés mais non corrélés — exactement l'état que ce
// chantier corrige. On vérifie donc la forme ET la corrélation, pas juste
// « ça produit du JSON ».
import { describe, expect, it } from "vitest";
import {
  buildLogPayload,
  buildLogRecord,
  logsEndpoint,
  passesLevel,
  resolveLogLevel,
  SEVERITY,
} from "../../packages/agent-node/src/core";
import { flattenOtlpLogs } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const cfg = {
  enabled: true,
  endpoint: "https://x.supabase.co/functions/v1/v1-traces",
  appId: "app-test",
  apiKey: "mip_secret",
  env: "prod",
  service: "backend-api",
};

describe("niveaux de journalisation", () => {
  it("mappe les niveaux sur les severityNumber OTLP", () => {
    expect(SEVERITY.info).toBe(9);
    expect(SEVERITY.warn).toBe(13);
    expect(SEVERITY.error).toBe(17);
    expect(SEVERITY.fatal).toBe(21);
  });

  it("plancher par défaut = warn (l'agent ne double pas le volume de journaux)", () => {
    expect(resolveLogLevel(undefined)).toBe("warn");
    expect(resolveLogLevel("")).toBe("warn");
    expect(resolveLogLevel("nimportequoi")).toBe("warn");
    expect(resolveLogLevel("DEBUG")).toBe("debug");
  });

  it("filtre sous le plancher, laisse passer au-dessus", () => {
    expect(passesLevel("info", "warn")).toBe(false);
    expect(passesLevel("warn", "warn")).toBe(true);
    expect(passesLevel("error", "warn")).toBe(true);
    expect(passesLevel("debug", "trace")).toBe(true);
  });
});

describe("dérivation de l'endpoint logs", () => {
  it("edge function : v1-traces -> v1-logs", () => {
    expect(logsEndpoint("https://x.supabase.co/functions/v1/v1-traces")).toBe(
      "https://x.supabase.co/functions/v1/v1-logs",
    );
  });

  it("auto-hébergé : /v1/traces -> /v1/logs", () => {
    expect(logsEndpoint("http://collector:4318/v1/traces")).toBe("http://collector:4318/v1/logs");
  });

  it("un override explicite gagne toujours", () => {
    expect(logsEndpoint("http://a/v1/traces", "http://ailleurs/logs")).toBe("http://ailleurs/logs");
  });
});

describe("contrat d'ingestion : agent -> flattenOtlpLogs", () => {
  const record = buildLogRecord({
    level: "error",
    body: "paiement refusé pour la commande 4711",
    tsMs: Date.UTC(2026, 6, 29, 12, 0, 0),
    traceId: "0000000000000000000000000000a001",
    spanId: "00000000000000a2",
    sessionId: "sess-42",
    route: "/api/checkout",
  });
  const { logs, apiKeys, rejected } = flattenOtlpLogs(buildLogPayload(cfg, [record]));

  it("produit exactement une ligne, aucune rejetée", () => {
    expect(rejected).toBe(0);
    expect(logs).toHaveLength(1);
  });

  it("le log est CORRÉLÉ à sa trace et à sa session — la raison d'être du pont", () => {
    expect(logs[0].trace_id).toBe("0000000000000000000000000000a001");
    expect(logs[0].span_id).toBe("00000000000000a2");
    expect(logs[0].session_id).toBe("sess-42");
    expect(logs[0].route).toBe("/api/checkout");
  });

  it("sévérité, corps et source arrivent intacts", () => {
    expect(logs[0].severity_num).toBe(17);
    expect(logs[0].severity_text).toBe("ERROR");
    expect(logs[0].body).toBe("paiement refusé pour la commande 4711");
    expect(logs[0].source).toBe("backend");
    expect(logs[0].app_id).toBe("app-test");
  });

  it("la clé d'API voyage au niveau resource, jamais dans le log", () => {
    expect(apiKeys).toEqual([{ app_id: "app-test", api_key: "mip_secret" }]);
    expect(JSON.stringify(logs[0])).not.toContain("mip_secret");
  });

  it("hors requête HTTP, le log passe sans contexte plutôt que d'être perdu", () => {
    const orphan = buildLogRecord({
      level: "warn",
      body: "tâche de fond en retard",
      tsMs: Date.now(),
      traceId: null,
      spanId: null,
      sessionId: null,
      route: null,
    });
    const out = flattenOtlpLogs(buildLogPayload(cfg, [orphan]));
    expect(out.rejected).toBe(0);
    expect(out.logs[0].trace_id).toBeNull();
    expect(out.logs[0].severity_num).toBe(13);
  });

  it("un corps très long est tronqué avant l'envoi (garde-fou de charge)", () => {
    const rec = buildLogRecord({
      level: "error",
      body: "x".repeat(9000),
      tsMs: Date.now(),
      traceId: null,
      spanId: null,
      sessionId: null,
      route: null,
    });
    expect((rec.body as { stringValue: string }).stringValue).toHaveLength(4000);
  });
});
