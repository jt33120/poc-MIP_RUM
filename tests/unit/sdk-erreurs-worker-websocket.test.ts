// SDK web — erreurs des Web Workers et des WebSockets (04/10/2026).
//
// Deux voies ACTIVES par défaut (captureErrors.workers / .websockets à false pour
// couper), qui passent par le même collecteur que les autres : plafond de 10
// erreurs distinctes par page et par voie, déduplication, compteurs de
// getErrorCollectionStats. En base, la source d'erreur est browser_js (worker) et
// browser_network (WebSocket) ; jamais l'URL complète ni sa requête.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cibleWebSocket,
  FERMETURES_ANORMALES,
  initWebSocketErrors,
  initWorkerErrors,
} from "../../packages/rum-sdk/src/error-capture";
import { initErrors, PLAFONDS_PAR_VOIE, type ErrorCollector } from "../../packages/rum-sdk/src/errors";
import { buildResourceSpans, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

type Attrs = Record<string, string | number | boolean>;

let emis: Array<{ name: string; attrs: Attrs; ts?: number }> = [];
let horloge = 1_760_000_000_000;

class FakeWorker extends EventTarget {
  static marque = "natif";
  constructor(public url: string | URL, public options?: unknown) {
    super();
  }
  postMessage() {}
}
class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  constructor(public url: string | URL, public protocols?: string | string[]) {
    super();
  }
}
const evenement = (type: string, champs: Record<string, unknown> = {}) => Object.assign(new Event(type), champs);

let collecteur: ErrorCollector;

beforeEach(() => {
  emis = [];
  horloge = 1_760_000_000_000;
  vi.stubGlobal("window", { Worker: FakeWorker, SharedWorker: FakeWorker, WebSocket: FakeWebSocket });
  vi.stubGlobal("location", { href: "https://app.test/tableau", pathname: "/tableau", origin: "https://app.test" });
  vi.stubGlobal("addEventListener", () => {});
  collecteur = initErrors(
    (name, attrs, ts) => {
      emis.push({ name, attrs, ts });
      return true;
    },
    () => horloge,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const racine = () => window as unknown as Record<string, new (...a: unknown[]) => EventTarget>;
const erreurs = () => emis.filter((e) => e.name === "exception").map((e) => e.attrs);

/** Ce que l'ingestion écrirait, avec la resource du SDK web. */
function enBase(attrs: Attrs) {
  const debut: [number, number] = [1_760_000_000, 0];
  const span: EmitSpan = {
    name: "exception",
    traceId: "ab".repeat(16),
    spanId: "0000000000000001",
    startTime: debut,
    endTime: debut,
    attributes: { "mip.session_id": "session-ws", ...attrs },
  };
  const payload = buildResourceSpans(
    { "mip.app_id": "app-ws", "service.name": "mip-rum-web", "deployment.environment.name": "production" },
    [span],
  );
  return flattenOtlp(payload, { now: 1_760_000_000_000 }).errors[0];
}

describe("Web Workers", () => {
  it("une erreur non interceptée dans le worker → exception [Worker], fichier sans requête, ligne", () => {
    expect(initWorkerErrors(collecteur)).toEqual([]);
    const w = new (racine().Worker)("/workers/calcul.js?jeton=secret");
    expect(w).toBeInstanceOf(FakeWorker);
    expect((racine().Worker as unknown as { marque: string }).marque, "les statiques restent").toBe("natif");
    w.dispatchEvent(
      evenement("error", {
        message: "Uncaught TypeError: x is not a function",
        filename: "https://app.test/workers/calcul.js?jeton=secret",
        lineno: 12,
        colno: 7,
      }),
    );
    expect(erreurs()).toHaveLength(1);
    const e = erreurs()[0];
    expect(e).toMatchObject({
      "mip.error_kind": "error",
      "exception.type": "TypeError",
      "exception.message": "[Worker] Uncaught TypeError: x is not a function",
      "mip.error_source": "https://app.test/workers/calcul.js",
      "mip.error_lineno": 12,
      "mip.error_colno": 7,
    });
    expect(JSON.stringify(e)).not.toContain("secret");
    const ligne = enBase(e);
    expect(ligne.error_source).toBe("browser_js");
    expect(ligne.message).toBe("[Worker] Uncaught TypeError: x is not a function");
  });

  it("échec de chargement du script : message explicite, sans URL complète", () => {
    initWorkerErrors(collecteur);
    const w = new (racine().Worker)("https://cdn.test/w.js?k=v");
    w.dispatchEvent(new Event("error"));
    expect(erreurs()[0]).toMatchObject({
      "exception.type": "Error",
      "exception.message": "[Worker] Échec de chargement cdn.test/w.js",
      "mip.error_source": "https://cdn.test/w.js",
    });
  });

  it("SharedWorker enveloppé aussi, même préfixe ; API absentes rendues", () => {
    initWorkerErrors(collecteur);
    const sw = new (racine().SharedWorker)("/partage.js");
    sw.dispatchEvent(evenement("error", { message: "boom" }));
    expect(erreurs()[0]["exception.message"]).toBe("[Worker] boom");

    vi.stubGlobal("window", {});
    expect(initWorkerErrors(collecteur)).toEqual(["Worker", "SharedWorker"]);
  });

  it("plafond de 10 erreurs distinctes par page, compté dans les statistiques", () => {
    expect(PLAFONDS_PAR_VOIE.workers).toBe(10);
    initWorkerErrors(collecteur);
    const w = new (racine().Worker)("/w.js");
    const mots = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu"];
    for (const mot of mots) w.dispatchEvent(evenement("error", { message: `Uncaught Error: ${mot}` }));
    expect(erreurs()).toHaveLength(10);
    expect(collecteur.compteurs().workers).toEqual({ emitted: 10, capped: 2, rejected: 0 });
  });
});

describe("WebSockets", () => {
  it("fermeture anormale (1006) → erreur réseau, hôte et chemin seulement", () => {
    expect(initWebSocketErrors(collecteur, [])).toEqual([]);
    const ws = new (racine().WebSocket)("wss://temps-reel.app.test/socket/flux?token=abc.def");
    expect(ws).toBeInstanceOf(FakeWebSocket);
    expect((racine().WebSocket as unknown as { OPEN: number }).OPEN).toBe(1);
    ws.dispatchEvent(evenement("close", { code: 1006 }));
    expect(erreurs()).toHaveLength(1);
    const e = erreurs()[0];
    expect(e).toEqual(
      expect.objectContaining({
        "mip.error_kind": "network",
        "exception.type": "WebSocketError",
        "exception.message": "WebSocket temps-reel.app.test/socket/flux : 1006",
        "mip.error_source": "wss://temps-reel.app.test/socket/flux",
      }),
    );
    expect(JSON.stringify(e)).not.toContain("token");
    expect(enBase(e).error_source).toBe("browser_network");
  });

  it("error puis close : une seule erreur par connexion, avec le code", () => {
    initWebSocketErrors(collecteur, []);
    const ws = new (racine().WebSocket)("ws://app.test/ws");
    ws.dispatchEvent(new Event("error"));
    ws.dispatchEvent(evenement("close", { code: 1006 }));
    expect(erreurs().map((e) => e["exception.message"])).toEqual(["WebSocket app.test/ws : 1006"]);
  });

  it("fermetures normales (1000, 1001) : rien", () => {
    initWebSocketErrors(collecteur, []);
    for (const code of [1000, 1001]) {
      const ws = new (racine().WebSocket)("wss://app.test/ws");
      ws.dispatchEvent(evenement("close", { code }));
    }
    expect(erreurs()).toEqual([]);
    expect([...FERMETURES_ANORMALES].sort()).toEqual([1002, 1003, 1006, 1007, 1008, 1009, 1010, 1011, 1015]);
  });

  it("l'ingestion MIP n'est jamais concernée", () => {
    initWebSocketErrors(collecteur, ["https://ingest.mip.test"]);
    const ws = new (racine().WebSocket)("wss://ingest.mip.test/live");
    ws.dispatchEvent(evenement("close", { code: 1011 }));
    expect(erreurs()).toEqual([]);
  });

  it("URL nettoyée : ni requête, ni fragment, ni identifiants", () => {
    expect(cibleWebSocket("wss://moi:motdepasse@rt.app.test:8443/a/b?x=1#f")).toEqual({
      source: "wss://rt.app.test:8443/a/b",
      cible: "rt.app.test:8443/a/b",
      origin: "https://rt.app.test:8443",
    });
    expect(cibleWebSocket("ftp://x.test/")).toBeNull();
  });

  it("plafond de 10 par page ; API absente rendue", () => {
    expect(PLAFONDS_PAR_VOIE.websockets).toBe(10);
    initWebSocketErrors(collecteur, []);
    for (let i = 0; i < 12; i++) {
      const ws = new (racine().WebSocket)(`wss://app.test/canal-${String.fromCharCode(97 + i)}`);
      ws.dispatchEvent(evenement("close", { code: 1011 }));
    }
    expect(erreurs()).toHaveLength(10);
    expect(collecteur.compteurs().websockets).toMatchObject({ emitted: 10, capped: 2 });

    vi.stubGlobal("window", {});
    expect(initWebSocketErrors(collecteur, [])).toEqual(["WebSocket"]);
  });
});
