// v0.5 onboarding clients — logique pure (validation, snippet, statut).
//
// Le bloc qui éprouvait le middleware Express maison est parti avec lui (29/09/2026) :
// côté serveur, l'assistant ne propose plus que les agents OpenTelemetry officiels
// (tests/unit/recettes-agents-otel.test.tsx), et l'ingestion de leurs spans serveur
// est éprouvée à part (tests/integration/otlp-protobuf-agent-sql.test.ts).
import { describe, expect, it } from "vitest";
import {
  buildSnippet,
  deriveStatus,
  formatApiKey,
  parseOrigins,
  validateAppId,
} from "../../apps/console/lib/onboarding";

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

  it("snippet, collecte directe (P6b.G) : l'en-tête dit la voie, sans `voie` rien ne bouge", () => {
    const base = {
      sdkUrl: "https://console/mip-rum.js",
      appId: "client-pilote",
      clientId: null,
      withConsent: false,
    };
    const avant = buildSnippet({ ...base, endpoint: "https://console/api/ingest/v1/traces" });
    // Paramètre facultatif : un appelant qui l'ignore (la page d'installation) reçoit le code d'avant.
    expect(buildSnippet({ ...base, endpoint: "https://console/api/ingest/v1/traces", voie: "console" })).toBe(avant);
    expect(avant.split("\n")[0]).toBe("<!-- MIP RUM -->");

    const directe = buildSnippet({ ...base, endpoint: "https://collector.test/v1/traces", voie: "directe" });
    expect(directe.split("\n")[0]).toContain("collecte directe");
    expect(directe).toContain('endpoint: "https://collector.test/v1/traces"');
  });
});
