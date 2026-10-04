// SDK web — retour depuis le cache du navigateur et page prérendue (finding 2.5).
//
// CE QUI ÉTAIT FAUX. Le SDK n'écoutait ni `pageshow` ni `prerenderingchange` :
//   - un retour arrière servi par le bfcache n'ouvrait ni trace ni page vue, et
//     les mesures que web-vitals rapporte après la restauration s'accrochaient à
//     la trace de la visite précédente ;
//   - une page prérendue (Speculation Rules) démarrait la collecte sans être
//     affichée : session et page vue existaient pour une page que personne n'a vue.
//
// Le VRAI SDK (navigation, session, consentement) tourne ici sur un navigateur
// simulé dont on déclenche les événements à la main.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Attrs = Record<string, unknown>;
type Ecouteur = (event: Record<string, unknown>) => void;
const { etat } = vi.hoisted(() => ({
  etat: { spans: [] as Array<{ name: string; attributes: Attrs }>, traces: 0 },
}));

vi.mock("../../packages/rum-sdk/src/otel", () => ({
  currentTraceId: () => "a".repeat(32),
  forceFlush: () => Promise.resolve(),
  discardPendingSpans: () => {},
  newPageTrace: () => {
    etat.traces++;
    return "a".repeat(32);
  },
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
vi.mock("../../packages/rum-sdk/src/errors", () => ({
  initErrors: () => ({ drainer: () => {}, reset: () => {}, report: () => {}, dejaCapture: () => false, compteurs: () => ({}) }),
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
vi.mock("../../packages/rum-sdk/src/apispans", () => ({ initApiSpans: () => null }));
vi.mock("../../packages/rum-sdk/src/replay", () => ({
  flushReplayBoundary: () => {}, isReplaySampled: () => false, startReplay: () => {},
}));

// ═══════════════════════════════ Navigateur simulé ═════════════════════════════

const stockage = new Map<string, string>();
let accesStockage = 0;
const ecouteursFenetre = new Map<string, Ecouteur[]>();
const ecouteursDocument = new Map<string, Ecouteur[]>();
let doc: { prerendering?: boolean } & Record<string, unknown>;
let entreeNavigation: Record<string, unknown>;

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
let maintenant = T0;

function ecouter(table: Map<string, Ecouteur[]>) {
  return (type: string, fn: Ecouteur) => {
    table.set(type, [...(table.get(type) ?? []), fn]);
  };
}
function declencher(table: Map<string, Ecouteur[]>, type: string, event: Record<string, unknown> = {}) {
  for (const fn of table.get(type) ?? []) fn({ type, ...event });
}

beforeEach(() => {
  etat.spans.length = 0;
  etat.traces = 0;
  stockage.clear();
  accesStockage = 0;
  ecouteursFenetre.clear();
  ecouteursDocument.clear();
  maintenant = T0;
  entreeNavigation = { type: "navigate" };
  vi.spyOn(Date, "now").mockImplementation(() => maintenant);
  vi.stubGlobal("localStorage", {
    getItem: (cle: string) => (accesStockage++, stockage.get(cle) ?? null),
    setItem: (cle: string, v: string) => void (accesStockage++, stockage.set(cle, String(v))),
    removeItem: (cle: string) => void (accesStockage++, stockage.delete(cle)),
  });
  doc = {
    visibilityState: "visible", referrer: "", currentScript: null,
    addEventListener: ecouter(ecouteursDocument), head: { appendChild: () => {} }, createElement: () => ({}),
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("location", { href: "https://app.test/dossiers/42", pathname: "/dossiers/42" });
  vi.stubGlobal("history", { pushState: () => {}, replaceState: () => {} });
  // `now` : chaque page vue date le début de sa vue (temps passé, SPA_LOAD).
  vi.stubGlobal("performance", { getEntriesByType: () => [entreeNavigation], now: () => 0 });
  vi.stubGlobal("addEventListener", ecouter(ecouteursFenetre));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Sdk = typeof import("../../packages/rum-sdk/src/index");

async function chargerPage(cfg: Partial<Parameters<Sdk["init"]>[0]> = {}): Promise<Sdk> {
  vi.resetModules();
  const sdk = await import("../../packages/rum-sdk/src/index");
  sdk.init({ endpoint: "https://ingest.test/v1/traces", appId: "app-navigation", trace: false, ...cfg });
  return sdk;
}

const pagesVues = () => etat.spans.filter((s) => s.name === "pageview");

// ═══════════════════════════════ bfcache ═══════════════════════════════════════

describe("retour depuis le cache avant/arrière (bfcache)", () => {
  it("pageshow persisted : une trace neuve et une page vue marquée bfcache", async () => {
    const sdk = await chargerPage();
    expect(pagesVues().map((p) => p.attributes["mip.nav_type"])).toEqual(["navigate"]);
    expect(etat.traces).toBe(1);

    // Un chargement ordinaire émet aussi pageshow, sans persisted : rien de plus.
    declencher(ecouteursFenetre, "pageshow", { persisted: false });
    expect(pagesVues()).toHaveLength(1);

    maintenant += 2 * MINUTE;
    declencher(ecouteursFenetre, "pageshow", { persisted: true });
    expect(etat.traces, "la restauration doit ouvrir une nouvelle trace").toBe(2);
    const vues = pagesVues();
    expect(vues.map((p) => p.attributes["mip.nav_type"])).toEqual(["navigate", "bfcache"]);
    // Revenue vite : même session, même visiteur.
    expect(vues[1].attributes["mip.session_id"]).toBe(vues[0].attributes["mip.session_id"]);
    // Les événements qui suivent appartiennent à la page restaurée.
    sdk.track("apres_retour");
    expect(etat.spans.at(-1)!.attributes["mip.session_id"]).toBe(vues[0].attributes["mip.session_id"]);
  });

  it("restaurée après 45 minutes d'absence : la page vue ouvre une session neuve, même visiteur", async () => {
    await chargerPage();
    const [premiere] = pagesVues();
    maintenant += 45 * MINUTE;
    declencher(ecouteursFenetre, "pageshow", { persisted: true });
    const restauree = pagesVues()[1];
    expect(restauree.attributes["mip.nav_type"]).toBe("bfcache");
    expect(restauree.attributes["mip.session_id"]).not.toBe(premiere.attributes["mip.session_id"]);
    expect(restauree.attributes["mip.visitor_id"]).toBe(premiere.attributes["mip.visitor_id"]);
  });
});

// ═══════════════════════════════ prérendu ══════════════════════════════════════

describe("page prérendue : la collecte attend l'affichage", () => {
  it("rien n'est émis ni écrit tant que document.prerendering vaut true", async () => {
    doc.prerendering = true;
    entreeNavigation = { type: "navigate", activationStart: 180 };
    const sdk = await chargerPage();
    expect(sdk.track("pendant_prerendu")).toBe(false);
    expect(etat.spans, "un prérendu jamais affiché ne doit laisser aucune page vue").toEqual([]);
    expect(accesStockage, "ni session ni visiteur pour un prérendu").toBe(0);
    expect(ecouteursFenetre.size, "aucun écouteur posé avant l'affichage").toBe(0);
    expect(ecouteursDocument.get("prerenderingchange")).toHaveLength(1);
    // Un second init() pendant le prérendu ne double pas l'attente.
    sdk.init({ endpoint: "https://ingest.test/v1/traces", appId: "app-navigation", trace: false });
    expect(ecouteursDocument.get("prerenderingchange")).toHaveLength(1);

    // L'utilisateur clique : la page s'affiche.
    doc.prerendering = false;
    declencher(ecouteursDocument, "prerenderingchange");
    const vues = pagesVues();
    expect(vues).toHaveLength(1);
    expect(vues[0].attributes["mip.nav_type"]).toBe("prerender");
    expect(stockage.has("mip_rum_session")).toBe(true);
    expect(sdk.track("apres_affichage")).toBe(true);
  });

  it("un accord donné pendant le prérendu s'applique à l'affichage", async () => {
    doc.prerendering = true;
    const sdk = await chargerPage({ requireConsent: true });
    sdk.consent(true); // l'outil de consentement tourne, lui, dans le prérendu
    expect(etat.spans).toEqual([]);
    doc.prerendering = false;
    declencher(ecouteursDocument, "prerenderingchange");
    expect(pagesVues(), "la page vue est restée bloquée dans le tampon de consentement").toHaveLength(1);
    expect(stockage.has("mip_rum_session")).toBe(true);
  });
});
