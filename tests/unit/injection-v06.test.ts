// v0.6 déploiement zéro-touch — logique pure d'injection front (Worker/nginx/GTM
// + fusion CSP) et ingestion des spans serveur OpenTelemetry standard (backend
// codeless via agent + Collector, sans middleware ni code applicatif).
import { describe, expect, it } from "vitest";
import { buildInjectionArtifacts, mergeCsp } from "../../apps/console/lib/onboarding";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const SDK = "https://mip-rum-console.vercel.app/mip-rum.js";
const ENDPOINT = "https://ingest.example/functions/v1/v1-traces";

describe("mergeCsp — relâcher une CSP existante sans la casser", () => {
  it("ajoute les origines aux directives présentes", () => {
    const out = mergeCsp("default-src 'self'; script-src 'self'; connect-src 'self'", {
      "script-src": ["https://sdk.example"],
      "connect-src": ["https://ingest.example"],
    });
    expect(out).toContain("script-src 'self' https://sdk.example");
    expect(out).toContain("connect-src 'self' https://ingest.example");
  });

  it("crée connect-src par fallback sur default-src quand absente", () => {
    const out = mergeCsp("default-src 'self' https://a.example", {
      "connect-src": ["https://ingest.example"],
    });
    // hérite de default-src puis ajoute l'ingestion
    expect(out).toContain("connect-src 'self' https://a.example https://ingest.example");
  });

  it("ne duplique pas une origine déjà autorisée et respecte un * existant", () => {
    const out = mergeCsp("script-src https://sdk.example; connect-src *", {
      "script-src": ["https://sdk.example"],
      "connect-src": ["https://ingest.example"],
    });
    expect(out).toBe("script-src https://sdk.example; connect-src *");
  });

  it("crée la directive si la CSP ne la contient pas et n'a pas de default-src", () => {
    const out = mergeCsp("img-src 'self'", { "script-src": ["https://sdk.example"] });
    expect(out).toContain("img-src 'self'");
    expect(out).toContain("script-src https://sdk.example");
  });
});

describe("buildInjectionArtifacts — configs préremplies, sans clé", () => {
  const art = buildInjectionArtifacts({
    sdkUrl: SDK,
    endpoint: ENDPOINT,
    appId: "client-pilote",
    clientId: "groupement-x",
  });

  it("expose les origines à autoriser", () => {
    expect(art.scriptOrigin).toBe("https://mip-rum-console.vercel.app");
    expect(art.connectOrigin).toBe("https://ingest.example");
  });

  it("Cloudflare Worker : HTMLRewriter sur <head>, garde text/html, relâche la CSP", () => {
    expect(art.worker).toContain("new HTMLRewriter()");
    expect(art.worker).toContain('"head"');
    expect(art.worker).toContain("text/html");
    expect(art.worker).toContain("content-security-policy");
    expect(art.worker).toContain("https://mip-rum-console.vercel.app");
    expect(art.worker).toContain("https://ingest.example");
    // les balises sont embarquées en chaîne JSON (guillemets échappés) : on vérifie
    // que l'appId et l'init y sont, sans dépendre de l'échappement exact
    expect(art.worker).toContain("client-pilote");
    expect(art.worker).toContain("MIPRum.init(");
  });

  it("Cloudflare Worker : JavaScript syntaxiquement valide (généré, non compilé)", () => {
    // l'export ESM n'est pas parsable par new Function -> on le neutralise, puis
    // on vérifie que tout le corps parse (les globals Worker ne sont jamais exécutés)
    const body = art.worker.replace("export default", "const handler =");
    expect(() => new Function(body)).not.toThrow();
  });

  it("nginx : sub_filter avant </head> + neutralise la compression amont", () => {
    expect(art.nginx).toContain("sub_filter '</head>'");
    expect(art.nginx).toContain('proxy_set_header Accept-Encoding ""');
    expect(art.nginx).toContain("sub_filter_types text/html");
    expect(art.nginx).toContain(SDK);
  });

  it("GTM : les deux balises, avec l'avertissement CSP/async", () => {
    expect(art.gtm).toContain(`<script src="${SDK}"></script>`);
    expect(art.gtm).toContain('appId:"client-pilote"');
    expect(art.gtm).toMatch(/CSP/i);
  });

  it("aucune config n'embarque de clé d'API réelle", () => {
    for (const code of [art.worker, art.nginx, art.gtm]) {
      expect(code).not.toMatch(/mip_[0-9a-f]{32}/);
      expect(code).not.toContain("api_key");
    }
  });

  it("clientId optionnel : omis s'il est null", () => {
    const noClient = buildInjectionArtifacts({
      sdkUrl: SDK,
      endpoint: ENDPOINT,
      appId: "solo",
      clientId: null,
    });
    expect(noClient.gtm).not.toContain("clientId");
  });
});

// --- ingestion des spans serveur OpenTelemetry standard (backend codeless) -------
const SID = "11111111-2222-3333-4444-555555555555";

function payload(spans: object[], resAttrs: object[] = []) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "mip.app_id", value: { stringValue: "demo-app" } },
            ...resAttrs,
          ],
        },
        scopeSpans: [{ spans }],
      },
    ],
  };
}

// span SERVER émis par un agent d'auto-instrumentation OTel : trace/span/parent
// au niveau du span, attributs semconv, session via tracestate, route en {…}.
const otelServer = {
  traceId: "ab".repeat(16),
  spanId: "99".repeat(8),
  parentSpanId: "cd".repeat(8),
  name: "GET /aos/{ao_id}",
  kind: 2,
  startTimeUnixNano: "1760000000000000000",
  endTimeUnixNano: "1760000000211000000", // +211 ms
  traceState: `mip=s:${SID}`,
  attributes: [
    { key: "http.request.method", value: { stringValue: "GET" } },
    { key: "http.route", value: { stringValue: "/aos/{ao_id}" } },
    { key: "http.response.status_code", value: { intValue: 200 } },
    { key: "url.path", value: { stringValue: "/aos/12" } },
    { key: "url.full", value: { stringValue: "https://api.client.fr/aos/12?token=x" } },
  ],
};

describe("flattenOtlp — spans serveur OpenTelemetry standard (v0.6)", () => {
  it("kind=2 + semconv -> span back, route {id}->:id, session via tracestate, durée calculée", () => {
    const rows = flattenOtlp(payload([otelServer]));
    expect(rows.spans).toHaveLength(1);
    const s = rows.spans[0];
    expect(s.tier).toBe("back");
    expect(s.trace_id).toBe("ab".repeat(16));
    expect(s.span_id).toBe("99".repeat(8));
    expect(s.parent_span_id).toBe("cd".repeat(8));
    expect(s.session_id).toBe(SID); // extraite du tracestate
    expect(s.route).toBe("/aos/:ao_id"); // {ao_id} normalisé
    expect(s.method).toBe("GET");
    expect(s.status_code).toBe(200);
    expect(s.duration_ms).toBe(211);
    expect(s.url).toBe("https://api.client.fr/aos/12"); // query scrubée
    expect(rows.sessions).toHaveLength(0); // le back ne crée jamais de session
    expect(rows.rejected).toBe(0);
  });

  it("kind encodé en chaîne SPAN_KIND_SERVER -> accepté aussi", () => {
    const rows = flattenOtlp(payload([{ ...otelServer, kind: "SPAN_KIND_SERVER" }]));
    expect(rows.spans).toHaveLength(1);
    expect(rows.spans[0].tier).toBe("back");
  });

  it("attributs hérités (http.method/http.status_code) -> acceptés", () => {
    const legacy = {
      ...otelServer,
      attributes: [
        { key: "http.method", value: { stringValue: "POST" } },
        { key: "http.status_code", value: { intValue: 503 } },
        { key: "http.route", value: { stringValue: "/login" } },
      ],
    };
    const s = flattenOtlp(payload([legacy])).spans[0];
    expect(s.method).toBe("POST");
    expect(s.status_code).toBe(503);
    expect(s.route).toBe("/login");
  });

  it("span client/interne (kind != SERVER) -> jamais un span back", () => {
    const client = { ...otelServer, kind: 3, name: "GET /downstream" };
    const rows = flattenOtlp(payload([client]));
    expect(rows.spans).toHaveLength(0);
  });

  it("sans timestamps -> rejeté (durée incalculable)", () => {
    const noTime = { ...otelServer, startTimeUnixNano: undefined, endTimeUnixNano: undefined };
    const rows = flattenOtlp(payload([noTime]));
    expect(rows.spans).toHaveLength(0);
    expect(rows.rejected).toBe(1);
  });

  it("corrélation front (http.client) <-> back (serveur OTel) par trace_id", () => {
    const front = {
      spanId: "f1".repeat(8),
      startTimeUnixNano: "1760000000000000000",
      name: "http.client",
      attributes: [
        { key: "mip.session_id", value: { stringValue: SID } },
        { key: "mip.trace_id", value: { stringValue: "ab".repeat(16) } },
        { key: "mip.span_id", value: { stringValue: "f1".repeat(8) } },
        { key: "http.duration_ms", value: { intValue: 300 } },
      ],
    };
    const rows = flattenOtlp(payload([front, otelServer]));
    expect(rows.spans).toHaveLength(2);
    expect(rows.spans[0].trace_id).toBe(rows.spans[1].trace_id);
    expect(new Set(rows.spans.map((s: { tier: string }) => s.tier))).toEqual(
      new Set(["front", "back"]),
    );
  });
});
