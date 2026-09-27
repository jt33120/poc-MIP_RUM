// SDK web — une identité métier reposée à chaque page ne fragmente plus la session
// (recette du 26/09/2026).
//
// L'intention d'origine (spec rum-browser-context-identity) : « une identité
// DIFFÉRENTE ouvre une session technique distincte sans changer le visiteur ». Mais
// l'identité ne vivait qu'en mémoire : dans une application MULTIPAGE, chaque page
// rappelle `setUser(A)` après `init()`, et le SDK voyait « rien → A » — une session
// neuve par page. Ces tests rejouent plusieurs chargements de page sur le MÊME
// stockage local, avec le vrai module de session.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spans } = vi.hoisted(() => ({ spans: [] as Array<{ name: string; attributes: Record<string, unknown> }> }));

vi.mock("../../packages/rum-sdk/src/otel", () => ({
  currentTraceId: () => "a".repeat(32),
  forceFlush: () => Promise.resolve(),
  discardPendingSpans: () => {},
  newPageTrace: () => "a".repeat(32),
  initOtel: () => ({
    startSpan(name: string) {
      const span = { name, attributes: {} as Record<string, unknown> };
      return {
        setAttributes(a: Record<string, unknown>) { span.attributes = { ...a }; },
        end() { spans.push(span); },
      };
    },
  }),
}));
vi.mock("../../packages/rum-sdk/src/context", () => ({
  currentRoute: () => "/compte",
  scrubUrl: (value: string) => value.split("?")[0],
  initNavigation: () => {},
}));
vi.mock("../../packages/rum-sdk/src/privacy", () => ({ readPrivacySignals: () => ({}), signalsOptOut: () => false }));
vi.mock("../../packages/rum-sdk/src/sampling", () => ({
  loadMode: () => null, decideMode: () => "full", storeMode: () => {},
  createSampler: () => ({ notifyError: () => {}, passes: () => true }),
}));
vi.mock("../../packages/rum-sdk/src/breadcrumbs", () => ({
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
vi.mock("../../packages/rum-sdk/src/apispans", () => ({ initApiSpans: () => null }));
vi.mock("../../packages/rum-sdk/src/replay", () => ({
  flushReplayBoundary: () => {}, isReplaySampled: () => false, startReplay: () => {},
}));
vi.mock("../../packages/rum-sdk/src/retry", () => ({ replayRetryQueue: () => 0, purgeRetryQueue: () => {} }));

/** Le stockage local du navigateur : il SURVIT aux chargements de page, la mémoire non. */
const stockage = new Map<string, string>();

beforeEach(() => {
  spans.length = 0;
  stockage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stockage.get(k) ?? null,
    setItem: (k: string, v: string) => void stockage.set(k, String(v)),
    removeItem: (k: string) => void stockage.delete(k),
  });
  vi.stubGlobal("document", {
    visibilityState: "visible", referrer: "", currentScript: null,
    addEventListener: () => {}, head: { appendChild: () => {} }, createElement: () => ({}),
  });
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("location", { href: "https://app.test/compte", pathname: "/compte" });
  vi.stubGlobal("addEventListener", () => {});
});

/** Un chargement de page : un SDK neuf (mémoire vide), le même stockage local. */
async function chargerPage() {
  vi.resetModules();
  const sdk = await import("../../packages/rum-sdk/src/index");
  sdk.init({ endpoint: "https://ingest.test/v1/traces", appId: "app-multipage", trace: false });
  return sdk;
}

/** La session des événements émis depuis `depuis` (indice dans `spans`). */
function sessionDe(depuis: number): string {
  const ids = new Set(spans.slice(depuis).map((s) => s.attributes["mip.session_id"]));
  expect(ids.size, "une seule session par page").toBe(1);
  return String([...ids][0]);
}

describe("identité métier et session — application multipage", () => {
  it("la même personne sur cinq pages : UNE session, pas cinq", async () => {
    const vues: string[] = [];
    for (let page = 0; page < 5; page++) {
      const sdk = await chargerPage();
      sdk.setUser("alice@example.test");
      sdk.setAccount("compte-42");
      const depuis = spans.length;
      sdk.track("page_vue");
      vues.push(sessionDe(depuis));
    }
    expect(new Set(vues).size).toBe(1);
  });

  it("une connexion en cours de visite rattache l'identité à la session anonyme", async () => {
    let sdk = await chargerPage();
    let depuis = spans.length;
    sdk.track("avant_connexion");
    const anonyme = sessionDe(depuis);
    sdk.setUser("alice@example.test");
    depuis = spans.length;
    sdk.track("apres_connexion");
    expect(sessionDe(depuis)).toBe(anonyme);
    // Et la page suivante, qui repose la même identité, reste dans la même session.
    sdk = await chargerPage();
    sdk.setUser("alice@example.test");
    depuis = spans.length;
    sdk.track("page_suivante");
    expect(sessionDe(depuis)).toBe(anonyme);
  });

  it("une AUTRE personne sur le même poste : nouvelle session, même visiteur (l'intention d'origine)", async () => {
    let sdk = await chargerPage();
    sdk.setUser("alice@example.test");
    let depuis = spans.length;
    sdk.track("alice");
    const deAlice = sessionDe(depuis);
    const visiteur = spans.at(-1)!.attributes["mip.visitor_id"];

    // Bob se connecte sur la page suivante, sans que l'application ait effacé Alice.
    sdk = await chargerPage();
    sdk.setUser("bob@example.test");
    depuis = spans.length;
    sdk.track("bob");
    const deBob = sessionDe(depuis);
    expect(deBob).not.toBe(deAlice);
    expect(spans.at(-1)!.attributes["mip.visitor_id"]).toBe(visiteur);

    // Même page : un changement d'identité sans rechargement tourne aussi.
    sdk.setUser("carole@example.test");
    depuis = spans.length;
    sdk.track("carole");
    expect(sessionDe(depuis)).not.toBe(deBob);
  });

  it("une identité posée AVANT init() se rattache à la session reprise ; une autre la fait tourner", async () => {
    vi.resetModules();
    let sdk = await import("../../packages/rum-sdk/src/index");
    sdk.setUser("alice@example.test");
    sdk.init({ endpoint: "https://ingest.test/v1/traces", appId: "app-multipage", trace: false });
    let depuis = spans.length;
    sdk.track("p1");
    const premiere = sessionDe(depuis);

    vi.resetModules();
    sdk = await import("../../packages/rum-sdk/src/index");
    sdk.setUser("alice@example.test");
    sdk.init({ endpoint: "https://ingest.test/v1/traces", appId: "app-multipage", trace: false });
    depuis = spans.length;
    sdk.track("p2");
    expect(sessionDe(depuis)).toBe(premiere);

    vi.resetModules();
    sdk = await import("../../packages/rum-sdk/src/index");
    sdk.setUser("bob@example.test");
    sdk.init({ endpoint: "https://ingest.test/v1/traces", appId: "app-multipage", trace: false });
    depuis = spans.length;
    sdk.track("p3");
    expect(sessionDe(depuis)).not.toBe(premiere);
  });

  it("déconnexion : l'identité effacée ouvre une nouvelle session ; une entrée refusée ne déconnecte pas", async () => {
    const sdk = await chargerPage();
    sdk.setUser("alice@example.test");
    let depuis = spans.length;
    sdk.track("connectee");
    const connectee = sessionDe(depuis);
    sdk.setUser({ id: "" }); // refusée : rien ne change
    depuis = spans.length;
    sdk.track("toujours_connectee");
    expect(sessionDe(depuis)).toBe(connectee);
    sdk.clearUser();
    depuis = spans.length;
    sdk.track("deconnectee");
    expect(sessionDe(depuis)).not.toBe(connectee);
  });

  it("le stockage ne garde jamais l'identifiant brut, seulement une marque", async () => {
    const sdk = await chargerPage();
    sdk.setUser("alice@example.test");
    sdk.setAccount("compte-42");
    const brut = [...stockage.values()].join(" ");
    expect(brut).not.toContain("alice");
    expect(brut).not.toContain("compte-42");
    expect(JSON.parse(stockage.get("mip_rum_session")!)).toMatchObject({ u: expect.stringMatching(/^[0-9a-f]{8}$/), a: expect.stringMatching(/^[0-9a-f]{8}$/) });
  });
});
