// SDK web — câblage des six signaux du 04/10/2026 dans init() : le VRAI index.ts,
// ses vraies voies d'erreur et ses vrais modules de vue, sur un navigateur simulé.
// Ce que les tests par module ne voient pas : l'ordre à la navigation (la vue qui
// finit part AVANT la page vue suivante, avec sa route), l'identifiant partagé
// entre SPA_LOAD et le temps passé, et les options de coupure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Attrs = Record<string, unknown>;
type Ecouteur = (event: Record<string, unknown>) => void;

const { etat } = vi.hoisted(() => ({ etat: { spans: [] as Array<{ name: string; attributes: Attrs }> } }));

vi.mock("../../packages/rum-sdk/src/otel", () => ({
  currentTraceId: () => "a".repeat(32),
  forceFlush: () => Promise.resolve(),
  discardPendingSpans: () => {},
  newPageTrace: () => "a".repeat(32),
  initOtel: () => ({
    startSpan(name: string) {
      const span = { name, attributes: {} as Attrs };
      return {
        setAttributes(a: Attrs) { span.attributes = { ...a }; },
        end() { etat.spans.push(span); },
      };
    },
  }),
}));
vi.mock("../../packages/rum-sdk/src/session", () => ({
  getOrCreateSession: () => ({ sessionId: "session-vue", visitorId: "visiteur-vue" }),
  rotateSession: () => ({ sessionId: "session-vue-2", visitorId: "visiteur-vue" }),
  touchSession: () => {},
  echue: () => false,
}));
vi.mock("../../packages/rum-sdk/src/privacy", () => ({ readPrivacySignals: () => ({}), signalsOptOut: () => false }));
vi.mock("../../packages/rum-sdk/src/sampling", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/rum-sdk/src/sampling")>()),
  loadMode: () => null,
  storeMode: () => {},
  decideMode: () => "full",
}));
vi.mock("../../packages/rum-sdk/src/forms", () => ({ initForms: () => {} }));
vi.mock("../../packages/rum-sdk/src/frustration", () => ({ initFrustration: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/loaf", () => ({ initLoaf: () => null }));
vi.mock("../../packages/rum-sdk/src/longtasks", () => ({ initLongTasks: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/navtiming", () => ({ initNavTiming: () => {} }));
vi.mock("../../packages/rum-sdk/src/vitals", () => ({ initVitals: () => {} }));
vi.mock("../../packages/rum-sdk/src/replay", () => ({
  flushReplayBoundary: () => {}, isReplaySampled: () => false, startReplay: () => {},
}));
vi.mock("../../packages/rum-sdk/src/retry", () => ({ replayRetryQueue: () => 0, purgeRetryQueue: () => {} }));

// ═══════════════════════════════ Navigateur simulé ═════════════════════════════

const T0 = Date.UTC(2026, 9, 4, 8, 0, 0);
const surFenetre = new Map<string, Ecouteur[]>();
const surDocument = new Map<string, Ecouteur[]>();
const observateurs = new Map<string, (entrees: unknown[]) => void>();
let muter: (() => void) | null = null;
let doc: Record<string, unknown>;
let loc: Record<string, string>;

const ecouter = (table: Map<string, Ecouteur[]>) => (type: string, fn: Ecouteur) =>
  table.set(type, [...(table.get(type) ?? []), fn]);
const declencher = (table: Map<string, Ecouteur[]>, type: string) => {
  for (const fn of table.get(type) ?? []) fn({ type, target: doc });
};

class FakeWorker extends EventTarget {}
class FakeWebSocket extends EventTarget {}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  etat.spans.length = 0;
  surFenetre.clear();
  surDocument.clear();
  observateurs.clear();
  muter = null;
  const racine = { scrollTop: 0, scrollHeight: 800, clientHeight: 800 };
  doc = {
    visibilityState: "visible",
    referrer: "",
    currentScript: null,
    documentElement: racine,
    scrollingElement: racine,
    querySelector: () => null,
    addEventListener: ecouter(surDocument),
    head: { appendChild: () => {} },
    createElement: () => ({ setAttribute: () => {} }),
  };
  loc = { href: "https://app.test/liste", pathname: "/liste", origin: "https://app.test" };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", loc);
  vi.stubGlobal("window", { Worker: FakeWorker, WebSocket: FakeWebSocket });
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("history", { pushState: () => {}, replaceState: () => {} });
  vi.stubGlobal("performance", {
    timeOrigin: T0,
    now: () => Date.now() - T0,
    getEntriesByType: () => [{ type: "navigate" }],
  });
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("scrollY", 0);
  vi.stubGlobal("addEventListener", ecouter(surFenetre));
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      constructor(private rappel: (l: { getEntries: () => unknown[] }) => void) {}
      observe(o: { type: string }) {
        observateurs.set(o.type, (entrees) => this.rappel({ getEntries: () => entrees }));
      }
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(rappel: () => void) {
        muter = rappel;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Sdk = typeof import("../../packages/rum-sdk/src/index");
async function charger(cfg: Partial<Parameters<Sdk["init"]>[0]> = {}): Promise<Sdk> {
  vi.resetModules();
  const sdk = await import("../../packages/rum-sdk/src/index");
  sdk.init({ endpoint: "https://ingest.mip.test/v1/traces", appId: "app-vue", trace: false, ...cfg });
  return sdk;
}
const noms = () => etat.spans.map((s) => s.name);
const span = (nom: string, route?: string) =>
  etat.spans.find((s) => s.name === nom && (route == null || s.attributes["mip.route"] === route))?.attributes;

describe("à la navigation SPA", () => {
  it("la vue qui finit part d'abord, avec sa route ; SPA_LOAD et la vue suivante partagent un identifiant", async () => {
    await charger();
    observateurs.get("resource")!([{ name: "https://app.test/app.js", startTime: 5, duration: 40, transferSize: 4096, initiatorType: "script" }]);
    vi.advanceTimersByTime(3_000);

    loc.pathname = "/detail/42";
    loc.href = "https://app.test/detail/42";
    (history as unknown as { pushState: (...a: unknown[]) => void }).pushState({}, "", "/detail/42");

    const iFin = noms().indexOf("webvital.TIME_SPENT");
    const iPageVue = noms().lastIndexOf("pageview");
    expect(iFin).toBeGreaterThan(-1);
    expect(iFin, "le cumul de la vue close précède la page vue suivante").toBeLessThan(iPageVue);
    expect(span("webvital.TIME_SPENT")).toMatchObject({ "webvital.value": 3_000, "mip.route": "/liste" });
    expect(span("webvital.SCROLL_DEPTH")).toMatchObject({ "webvital.value": 100, "mip.route": "/liste" });
    expect(span("webvital.RESOURCE_COUNT")).toMatchObject({ "webvital.value": 1, "mip.route": "/liste" });
    expect(span("webvital.RESOURCE_BYTES")).toMatchObject({ "webvital.value": 4096, "mip.route": "/liste" });

    vi.advanceTimersByTime(40);
    muter!();
    vi.advanceTimersByTime(100);
    const chargement = span("webvital.SPA_LOAD");
    expect(chargement).toMatchObject({ "webvital.name": "SPA_LOAD", "webvital.value": 40, "mip.route": "/detail/:id" });

    vi.advanceTimersByTime(1_000);
    doc.visibilityState = "hidden";
    declencher(surDocument, "visibilitychange");
    const tempsDetail = span("webvital.TIME_SPENT", "/detail/:id");
    expect(tempsDetail?.["webvital.value"]).toBe(1_140);
    expect(tempsDetail?.["webvital.id"]).toBe(chargement?.["webvital.id"]);
    expect(tempsDetail?.["webvital.id"]).not.toBe(span("webvital.TIME_SPENT", "/liste")?.["webvital.id"]);
  });

  it("la page vue initiale ne produit pas de SPA_LOAD", async () => {
    await charger();
    muter?.();
    vi.advanceTimersByTime(500);
    expect(noms()).not.toContain("webvital.SPA_LOAD");
  });
});

describe("options", () => {
  it("repères relevés par défaut ; userTimings: false les coupe", async () => {
    await charger();
    observateurs.get("mark")!([{ name: "liste-prete", entryType: "mark", startTime: 820, duration: 0 }]);
    expect(span("rum.timing")).toMatchObject({ "mip.event_name": "mark:liste-prete", "mip.timing_ms": 820 });

    etat.spans.length = 0;
    observateurs.clear();
    await charger({ userTimings: false });
    expect(observateurs.has("mark")).toBe(false);
    expect(observateurs.has("measure")).toBe(false);
  });

  it('resources: "all" : une ressource rapide devient un span resource', async () => {
    const rapide = { name: "https://app.test/icone.svg", startTime: 5, duration: 12, transferSize: 300, initiatorType: "img" };
    await charger();
    observateurs.get("resource")!([rapide]);
    expect(noms()).not.toContain("resource");
    await charger({ resources: "all" });
    observateurs.get("resource")!([rapide]);
    expect(span("resource")).toMatchObject({ "resource.url": "https://app.test/icone.svg" });
  });

  it("workers et WebSockets actifs par défaut, comptés dans getErrorCollectionStats", async () => {
    const sdk = await charger();
    const stats = sdk.getErrorCollectionStats()!;
    expect(stats.workers).toEqual({ enabled: true, unsupported: ["SharedWorker"], emitted: 0, capped: 0, rejected: 0 });
    expect(stats.websockets).toEqual({ enabled: true, unsupported: [], emitted: 0, capped: 0, rejected: 0 });
    const racine = window as unknown as Record<string, new (u: string) => EventTarget>;
    expect(racine.Worker).not.toBe(FakeWorker);
    const ws = new racine.WebSocket("wss://app.test/flux?jeton=1");
    ws.dispatchEvent(Object.assign(new Event("close"), { code: 1006 }));
    expect(sdk.getErrorCollectionStats()!.websockets.emitted).toBe(1);
    expect(span("exception")).toMatchObject({ "exception.message": "WebSocket app.test/flux : 1006" });
  });

  it("captureErrors.workers / .websockets à false : constructeurs intacts, voies coupées", async () => {
    const sdk = await charger({ captureErrors: { workers: false, websockets: false } });
    const racine = window as unknown as Record<string, unknown>;
    expect(racine.Worker).toBe(FakeWorker);
    expect(racine.WebSocket).toBe(FakeWebSocket);
    const stats = sdk.getErrorCollectionStats()!;
    expect(stats.workers.enabled).toBe(false);
    expect(stats.websockets.enabled).toBe(false);
  });
});
