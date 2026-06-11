// v0.5 onboarding clients — logique pure (validation, snippet, statut) +
// middleware Express réel : serveur http hôte + ingestion factice, on vérifie
// le span OTLP reçu (même contrat que le middleware FastAPI prouvé en prod).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSnippet,
  deriveStatus,
  formatApiKey,
  parseOrigins,
  validateAppId,
} from "../../apps/console/lib/onboarding";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import mipRum = require("../../apps/console/public/integrations/mip-rum-express.js");

describe("validateAppId", () => {
  it("accepte un slug propre", () => expect(validateAppId("client-pilote")).toBe("client-pilote"));
  it("normalise la casse et les espaces", () => expect(validateAppId("  Client-A  ")).toBe("client-a"));
  it("rejette caractères interdits / trop court", () => {
    expect(validateAppId("a")).toBeNull();
    expect(validateAppId("mon app")).toBeNull();
    expect(validateAppId("-debut")).toBeNull();
    expect(validateAppId("fin-")).toBeNull();
  });
});

describe("parseOrigins", () => {
  it("normalise en origin strict (scheme+host+port) et dédoublonne", () => {
    const { origins, invalid } = parseOrigins(
      "https://app.client.fr/chemin?x=1, https://app.client.fr , http://localhost:5173",
    );
    expect(origins).toEqual(["https://app.client.fr", "http://localhost:5173"]);
    expect(invalid).toEqual([]);
  });
  it("rejette ce qui n'est pas http(s) absolu", () => {
    const { origins, invalid } = parseOrigins("app.client.fr, ftp://x.fr, https://ok.fr");
    expect(origins).toEqual(["https://ok.fr"]);
    expect(invalid).toEqual(["app.client.fr", "ftp://x.fr"]);
  });
});

describe("formatApiKey / deriveStatus / buildSnippet", () => {
  it("clé au format historique mip_<32hex>", () => {
    expect(formatApiKey("a".repeat(32))).toMatch(/^mip_[0-9a-f]{32}$/);
  });
  it("statut : rien reçu -> tout waiting, pas live", () => {
    const s = deriveStatus({
      first_metric_at: null,
      last_metric_at: null,
      sessions_24h: 0,
      first_front_span_at: null,
      first_back_span_at: null,
      errors_24h: 0,
    });
    expect(s).toMatchObject({ snippet: "waiting", traffic: "waiting", live: false });
  });
  it("statut : vitals + sessions -> live, back en attente", () => {
    const s = deriveStatus({
      first_metric_at: new Date(),
      last_metric_at: new Date(),
      sessions_24h: 3,
      first_front_span_at: new Date(),
      first_back_span_at: null,
      errors_24h: 0,
    });
    expect(s).toMatchObject({ snippet: "done", traffic: "done", tracingFront: "done", tracingBack: "waiting", live: true });
  });
  it("snippet : contient endpoint/appId/clé placeholder, consent optionnel", () => {
    const snip = buildSnippet({
      sdkUrl: "https://console/mip-rum.js",
      endpoint: "https://ingest/v1/traces",
      appId: "client-pilote",
      clientId: "groupement-x",
      withConsent: true,
    });
    expect(snip).toContain('appId: "client-pilote"');
    expect(snip).toContain("COLLE_ICI_LA_CLE_API");
    expect(snip).toContain("requireConsent: true");
    expect(snip).not.toContain("mip_"); // jamais de clé réelle dans le snippet
  });
});

describe("middleware Express — span http.server réel", () => {
  let ingest: Server;
  let host: Server;
  let received: unknown[] = [];
  let hostPort = 0;

  beforeAll(async () => {
    received = [];
    ingest = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(200).end("{}");
      });
    });
    await new Promise<void>((r) => ingest.listen(0, () => r()));
    const ingestPort = (ingest.address() as AddressInfo).port;

    // hôte : pile connect minimale (le middleware est framework-agnostique)
    const mw = mipRum({
      endpoint: `http://127.0.0.1:${ingestPort}`,
      appId: "client-pilote",
      apiKey: "mip_test",
      batchSize: 1, // flush immédiat au 1er span
    });
    host = createServer((req, res) => {
      (req as { path?: string }).path = (req.url ?? "/").split("?")[0];
      mw(req, res, () => {
        res.writeHead(req.url?.includes("err") ? 500 : 200, { "content-type": "text/plain" });
        res.end("ok");
      });
    });
    await new Promise<void>((r) => host.listen(0, () => r()));
    hostPort = (host.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((r) => host.close(r));
    await new Promise((r) => ingest.close(r));
  });

  it("traceparent propagé -> span back corrélé, session extraite, parser OK", async () => {
    const traceId = "0123456789abcdef0123456789abcdef";
    await fetch(`http://127.0.0.1:${hostPort}/partners/42`, {
      headers: {
        traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
        tracestate: "mip=s:sess-e2e-1",
      },
    });
    await new Promise((r) => setTimeout(r, 300)); // flush async (batchSize 1)

    expect(received.length).toBe(1);
    const { spans } = flattenOtlp(received[0]);
    expect(spans).toHaveLength(1);
    const s = spans[0];
    expect(s.trace_id).toBe(traceId);
    expect(s.tier).toBe("back");
    expect(s.app_id).toBe("client-pilote");
    expect(s.session_id).toBe("sess-e2e-1");
    expect(s.route).toBe("/partners/:id"); // normalisation :id
    expect(s.status_code).toBe(200);
    expect(s.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("sans traceparent -> trace fraîche ; OPTIONS ignoré", async () => {
    await fetch(`http://127.0.0.1:${hostPort}/health-not-ignored`, { method: "OPTIONS" });
    await fetch(`http://127.0.0.1:${hostPort}/solo`);
    await new Promise((r) => setTimeout(r, 300));

    expect(received.length).toBe(2); // OPTIONS n'a rien produit
    const { spans } = flattenOtlp(received[1]);
    expect(spans[0].trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(spans[0].route).toBe("/solo");
  });

  it("inactif sans endpoint/appId -> passthrough no-op", async () => {
    const noop = mipRum({});
    let called = false;
    noop({} as never, {} as never, () => (called = true));
    expect(called).toBe(true);
  });
});
