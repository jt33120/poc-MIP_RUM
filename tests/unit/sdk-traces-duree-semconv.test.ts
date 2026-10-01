// Les traces du SDK web au standard OpenTelemetry (01/10/2026) — findings 1.4
// et 2.13 de docs/AUDIT_RUM_EXTERNE.md, angle mort « Conventions sémantiques »
// de apps/console/lib/specs.ts.
//
// CE QUI ÉTAIT FAUX. `realEmit` refermait chaque span à son instant d'ouverture :
// un appel de 420 ms partait avec une durée OTLP nulle, sa vraie durée ne voyait
// que l'attribut propriétaire `http.duration_ms`, et un backend tiers dessinait
// une cascade plate. Les attributs HTTP suivaient l'ancienne convention, et une
// erreur n'avait pas d'événement « exception » où un backend tiers la lit.
//
// CE QUE CE FICHIER TIENT, par le VRAI chemin du SDK — `init()`, l'émetteur
// OTLP, les wrappers fetch — jusqu'au corps POSTé, relu par l'ingestion :
//   1. endTime − startTime = durée de l'appel, et la ligne rum_span est inchangée
//      (ts = départ, duration_ms = http.duration_ms : cascade et waterfall de
//      /tracing identiques) ;
//   2. les attributs stables sont là, à côté des anciens, et suivent beforeSend ;
//   3. l'événement exception est encodé, et l'ingestion n'en tire qu'une erreur ;
//   4. un iPad sous iPadOS 13+ part avec l'indice « tablet » et arrive tablette.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../packages/rum-sdk/src/context", () => ({
  currentRoute: () => "/commandes",
  scrubUrl: (value: string) => value.split("?")[0].split("#")[0],
  initNavigation: (callback: (kind: string) => void) => callback("navigate"),
}));
vi.mock("../../packages/rum-sdk/src/session", () => ({
  getOrCreateSession: () => ({ sessionId: "sess-traces", visitorId: "visiteur-traces" }),
  rotateSession: () => ({ sessionId: "sess-traces-2", visitorId: "visiteur-traces" }),
  touchSession: () => {},
}));
vi.mock("../../packages/rum-sdk/src/privacy", () => ({ readPrivacySignals: () => ({}), signalsOptOut: () => false }));
vi.mock("../../packages/rum-sdk/src/sampling", () => ({
  loadMode: () => null, decideMode: () => "full", storeMode: () => {},
  createSampler: () => ({ notifyError: () => {}, passes: () => true }),
}));
vi.mock("../../packages/rum-sdk/src/breadcrumbs", () => ({
  MIP_UI_ATTR: "data-mip-ui",
  initClickBreadcrumbs: () => {},
  createBreadcrumbTrail: () => ({ add: () => {}, cap: { reset: () => {} } }),
}));
vi.mock("../../packages/rum-sdk/src/errors", () => ({
  initErrors: () => ({ drainer: () => {}, reset: () => {}, report: () => {}, dejaCapture: () => false }),
}));
vi.mock("../../packages/rum-sdk/src/forms", () => ({ initForms: () => {} }));
vi.mock("../../packages/rum-sdk/src/frustration", () => ({ initFrustration: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/loaf", () => ({ initLoaf: () => null }));
vi.mock("../../packages/rum-sdk/src/longtasks", () => ({ initLongTasks: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/navtiming", () => ({ initNavTiming: () => {} }));
vi.mock("../../packages/rum-sdk/src/vitals", () => ({ initVitals: () => {} }));
vi.mock("../../packages/rum-sdk/src/resources", () => ({
  DEFAULT_SLOW_RESOURCE_MS: 1000,
  initResources: () => ({ reset: () => {} }),
}));
vi.mock("../../packages/rum-sdk/src/replay", () => ({
  flushReplayBoundary: () => {}, isReplaySampled: () => false, startReplay: () => {},
}));

// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";
import { buildResourceSpans, msToHr, STATUS_CODE, statutPour } from "../../packages/rum-sdk/src/otlp-encode";
import type { MIPRumConfig } from "../../packages/rum-sdk/src/types";

type Attrs = Record<string, unknown>;
type SpanOtlp = {
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
  events?: Array<{ name: string; timeUnixNano: string; attributes: Array<{ key: string; value: Record<string, unknown> }> }>;
  status?: { code: number };
};

const T0 = 1_800_000_000_000;
const UA_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";

/** Valeur scalaire d'un AnyValue OTLP. */
const valeur = (v: Record<string, unknown>) =>
  "intValue" in v ? Number(v.intValue) : "doubleValue" in v ? v.doubleValue : "boolValue" in v ? v.boolValue : v.stringValue;
const attrs = (liste: SpanOtlp["attributes"]): Attrs => Object.fromEntries(liste.map((kv) => [kv.key, valeur(kv.value)]));
const ms = (nanos: string) => Number(BigInt(nanos) / 1_000_000n);

let corps: unknown[] = [];
let horloge = 0;
/** Réponses de l'application, servies dans l'ordre des appels. */
let reponses: Array<() => Promise<{ status: number }>> = [];

beforeEach(() => {
  corps = [];
  horloge = 1_000;
  reponses = [];
  vi.spyOn(Date, "now").mockReturnValue(T0);
  vi.stubGlobal("document", {
    visibilityState: "visible", referrer: "", currentScript: null,
    addEventListener: () => {}, removeEventListener: () => {},
    head: { appendChild: () => {} }, createElement: () => ({}),
  });
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Test", maxTouchPoints: 0 });
  vi.stubGlobal("location", { href: "https://app.test/commandes", origin: "https://app.test", pathname: "/commandes" });
  vi.stubGlobal("addEventListener", () => {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  // Chaque appel de l'application dure ce que la réponse fait avancer l'horloge.
  vi.stubGlobal("performance", { now: () => horloge });
  vi.stubGlobal("window", {
    fetch: () => {
      const suivante = reponses.shift();
      if (!suivante) throw new Error("aucune réponse préparée");
      return suivante();
    },
  });
  // L'export OTLP de l'émetteur : le corps réellement POSTé.
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    corps.push(JSON.parse(init.body));
    return { ok: true, status: 200, headers: { get: () => null } };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** SDK frais : `init()` ne s'exécute qu'une fois par module. */
async function demarrer(cfg: Partial<MIPRumConfig> = {}) {
  vi.resetModules();
  const sdk = await import("../../packages/rum-sdk/src/index");
  sdk.init({ endpoint: "https://ingest.test/v1/traces", appId: "app-traces", ...cfg });
  return sdk;
}

/** Tous les spans postés, dans l'ordre. */
function spansPostes(): SpanOtlp[] {
  return corps.flatMap((c) =>
    (c as { resourceSpans: Array<{ scopeSpans: Array<{ spans: SpanOtlp[] }> }> }).resourceSpans
      .flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans)));
}
const premier = (nom: string) => spansPostes().find((s) => s.name === nom)!;

/** Un appel de l'application qui répond `status` après `dureeMs`. */
function repondre(status: number, dureeMs: number) {
  reponses.push(async () => {
    horloge += dureeMs;
    return { status };
  });
}

describe("1.4 — un appel réseau DURE : son span s'ouvre au départ et se ferme à la réponse", () => {
  it("endTime − startTime = http.duration_ms, et startTime = départ de la requête", async () => {
    const sdk = await demarrer();
    repondre(200, 420);
    await window.fetch("/api/commandes?page=2");
    await sdk.flush();

    const appel = premier("http.client");
    expect(attrs(appel.attributes)["http.duration_ms"]).toBe(420);
    expect(ms(appel.startTimeUnixNano)).toBe(T0);
    expect(ms(appel.endTimeUnixNano) - ms(appel.startTimeUnixNano)).toBe(420);
  });

  it("les autres signaux restent des instants : la page vue racine ne s'allonge pas", async () => {
    const sdk = await demarrer();
    await sdk.flush();
    const pv = premier("pageview");
    expect(pv.endTimeUnixNano).toBe(pv.startTimeUnixNano);
  });

  it("la ligne rum_span ne change pas : ts = départ, duration_ms = attribut (cascade et waterfall de /tracing)", async () => {
    const sdk = await demarrer();
    repondre(200, 420);
    await window.fetch("/api/commandes");
    await sdk.flush();

    const lignes = corps.flatMap((c) => flattenOtlp(c, { now: T0 + 60_000 }).spans);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      tier: "front",
      method: "GET",
      url: "https://app.test/api/commandes",
      status_code: 200,
      duration_ms: 420,
      name: "GET /commandes",
    });
    expect(new Date(lignes[0].ts).getTime()).toBe(T0);
  });
});

describe("conventions HTTP stables d'OpenTelemetry, à côté des anciennes", () => {
  it("http.request.method, url.full et http.response.status_code accompagnent http.method, http.url et http.status_code", async () => {
    const sdk = await demarrer();
    repondre(201, 30);
    await window.fetch("/api/commandes?jeton=secret#ancre", { method: "post" });
    await sdk.flush();

    const a = attrs(premier("http.client").attributes);
    expect(a).toMatchObject({
      "http.method": "POST",
      "http.url": "https://app.test/api/commandes",
      "http.status_code": 201,
      "http.request.method": "POST",
      "url.full": "https://app.test/api/commandes",
      "http.response.status_code": 201,
    });
    // Ni query string ni fragment : url.full est la même URL nettoyée.
    expect(String(a["url.full"])).not.toContain("secret");
    expect(a["error.type"]).toBeUndefined();
  });

  it("une méthode hors convention devient _OTHER, l'originale gardée à part", async () => {
    const sdk = await demarrer();
    repondre(200, 5);
    await window.fetch("/api/x", { method: "PROPFIND" });
    await sdk.flush();
    const a = attrs(premier("http.client").attributes);
    expect(a["http.request.method"]).toBe("_OTHER");
    expect(a["http.request.method_original"]).toBe("PROPFIND");
  });

  it("un 5xx porte error.type et le statut ERROR", async () => {
    const sdk = await demarrer();
    repondre(503, 12);
    await window.fetch("/api/x");
    await sdk.flush();
    const appel = premier("http.client");
    expect(attrs(appel.attributes)["error.type"]).toBe("503");
    expect(appel.status).toEqual({ code: STATUS_CODE.ERROR });
  });

  it("un échec réseau : error.type, statut ERROR, et AUCUN code de réponse inventé", async () => {
    const sdk = await demarrer();
    reponses.push(async () => {
      horloge += 80;
      throw new TypeError("Failed to fetch");
    });
    await expect(window.fetch("/api/x")).rejects.toThrow("Failed to fetch");
    await sdk.flush();
    const appel = premier("http.client");
    const a = attrs(appel.attributes);
    expect(a["error.type"]).toBe("NetworkError");
    expect(a["http.response.status_code"]).toBeUndefined();
    expect(a["http.status_code"]).toBe(0); // l'ancien attribut, inchangé
    expect(appel.status).toEqual({ code: STATUS_CODE.ERROR });
    expect(ms(appel.endTimeUnixNano) - ms(appel.startTimeUnixNano)).toBe(80);
  });

  it("un abandon voulu par l'application n'est ni une erreur ni un succès : statut absent", async () => {
    const sdk = await demarrer();
    reponses.push(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(window.fetch("/api/x")).rejects.toThrow();
    await sdk.flush();
    const appel = premier("http.client");
    expect(attrs(appel.attributes)["error.type"]).toBeUndefined();
    expect(appel.status).toBeUndefined();
  });

  it("dérivés APRÈS beforeSend : une URL réécrite par le hook l'est aussi dans url.full", async () => {
    const sdk = await demarrer({
      beforeSend: (a) => (typeof a["http.url"] === "string"
        ? { ...a, "http.url": a["http.url"].replace(/\/clients\/[^/]+/, "/clients/:client") }
        : a),
    });
    repondre(200, 7);
    await window.fetch("/api/clients/jean.dupont/factures");
    await sdk.flush();
    const a = attrs(premier("http.client").attributes);
    expect(a["http.url"]).toBe("https://app.test/api/clients/:client/factures");
    expect(a["url.full"]).toBe("https://app.test/api/clients/:client/factures");
  });
});

describe("l'erreur porte son événement OpenTelemetry « exception »", () => {
  it("type, message et pile dans l'événement ; une seule erreur à l'ingestion", async () => {
    const sdk = await demarrer();
    const err = new TypeError("montant invalide");
    err.stack = "TypeError: montant invalide\n    at payer (https://app.test/app.js:3:7)";
    sdk.addError(err);
    await sdk.flush();

    const exc = premier("exception");
    expect(exc.events).toHaveLength(1);
    const ev = exc.events![0];
    expect(ev.name).toBe("exception");
    expect(ev.timeUnixNano).toBe(exc.startTimeUnixNano);
    expect(attrs(ev.attributes)).toEqual({
      "exception.type": "TypeError",
      "exception.message": "montant invalide",
      "exception.stacktrace": "TypeError: montant invalide\n    at payer (https://app.test/app.js:3:7)",
    });
    expect(exc.status).toEqual({ code: STATUS_CODE.ERROR });

    const erreurs = corps.flatMap((c) => flattenOtlp(c, { now: T0 + 60_000 }).errors);
    expect(erreurs).toHaveLength(1);
  });

  it("l'événement ne porte rien que le span ne porte : un champ retiré par beforeSend n'y revient pas", async () => {
    const sdk = await demarrer({
      beforeSend: (a, meta) => {
        if (meta?.type !== "error") return a;
        const b = { ...a };
        delete b["exception.stacktrace"];
        return b;
      },
    });
    const err = new Error("boom");
    err.stack = "Error: boom\n    at secret (https://app.test/interne.js:1:1)";
    sdk.addError(err);
    await sdk.flush();
    const ev = premier("exception").events![0];
    expect(attrs(ev.attributes)).toEqual({ "exception.type": "Error", "exception.message": "boom" });
  });

  it("un span qui n'est pas une erreur n'a pas d'événement", async () => {
    const sdk = await demarrer();
    repondre(200, 3);
    await window.fetch("/api/x");
    await sdk.flush();
    expect(premier("pageview").events).toBeUndefined();
    expect(premier("http.client").events).toBeUndefined();
  });
});

describe("2.13 — l'iPad sous iPadOS 13+ part avec l'indice « tablet » et arrive tablette", () => {
  it("user-agent Macintosh + écran tactile : indice tablet, session tablette sous iOS", async () => {
    vi.stubGlobal("navigator", { userAgent: UA_MAC, maxTouchPoints: 5 });
    const sdk = await demarrer();
    await sdk.flush();
    expect(attrs(premier("pageview").attributes)["mip.device_type"]).toBe("tablet");
    const [session] = corps.flatMap((c) => flattenOtlp(c, { now: T0 + 60_000 }).sessions);
    expect(session).toMatchObject({ device_type: "tablet", os: "iOS", os_version: null, browser: "Safari", browser_version: "17" });
  });

  it("le même user-agent sans écran tactile reste un Mac", async () => {
    vi.stubGlobal("navigator", { userAgent: UA_MAC, maxTouchPoints: 0 });
    const sdk = await demarrer();
    await sdk.flush();
    expect(attrs(premier("pageview").attributes)["mip.device_type"]).toBe("desktop");
    const [session] = corps.flatMap((c) => flattenOtlp(c, { now: T0 + 60_000 }).sessions);
    expect(session).toMatchObject({ device_type: "desktop", os: "macOS" });
  });
});

describe("@mip/rum-core — l'issue et les événements, partagés avec le SDK React Native", () => {
  it("statut 0 = aucune réponse : ni OK ni erreur, sauf si error.type le dit", () => {
    expect(statutPour("http.client", { "http.status_code": 0 })).toBeUndefined();
    expect(statutPour("http.client", { "http.status_code": 0, "error.type": "TimeoutError" })).toEqual({ code: STATUS_CODE.ERROR });
  });

  it("le code de réponse stable est lu en premier, l'ancien en repli", () => {
    expect(statutPour("http.client", { "http.response.status_code": 404 })).toEqual({ code: STATUS_CODE.ERROR });
    expect(statutPour("http.client", { "http.status_code": 200 })).toEqual({ code: STATUS_CODE.OK });
  });

  it("un span sans événement s'encode exactement comme avant : pas de clé « events »", () => {
    const debut = msToHr(T0);
    const corpsOtlp = buildResourceSpans({ "mip.app_id": "demo" }, [
      { name: "pageview", traceId: "a".repeat(32), spanId: "b".repeat(16), startTime: debut, endTime: debut, attributes: {} },
      { name: "exception", traceId: "a".repeat(32), spanId: "c".repeat(16), startTime: debut, endTime: debut, attributes: {}, events: [] },
    ]) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Record<string, unknown>[] }> }> };
    for (const s of corpsOtlp.resourceSpans[0].scopeSpans[0].spans) expect("events" in s).toBe(false);
  });
});
