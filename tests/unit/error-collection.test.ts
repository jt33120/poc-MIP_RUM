// P5.2 — collecte d'erreurs navigateur élargie, opt-in : console, ressources, CSP,
// réseau, et clé de regroupement opaque d'addError.
//
// Le SDK tourne ENTIER : errors, error-capture, apispans, consentement, actions
// causales, sampling, contexte et fil d'Ariane sont les vrais modules. Seuls
// l'émetteur OTLP (spans capturés en mémoire, avec les mêmes champs natifs
// qu'otel.ts), la session, les signaux de vie privée et les capteurs sans
// rapport sont remplacés. Ce qui est vérifié « en base » repasse par l'encodeur,
// flattenOtlp puis writeRows : c'est ce que l'ingestion écrirait réellement.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { boundedWireLabel } from "../../packages/rum-sdk/src/breadcrumbs";
import { CONSOLE_MESSAGE_MAX, CONSOLE_PROFONDEUR_MAX } from "../../packages/rum-sdk/src/error-capture";
import { PLAFONDS_PAR_VOIE } from "../../packages/rum-sdk/src/errors";
import { buildResourceSpans, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";
import type { ErrorCategory, MIPRumConfig } from "../../packages/rum-sdk/src/types";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { errorFingerprint, flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

const etat = vi.hoisted(() => ({
  spans: [] as EmitSpan[],
  mode: "full" as "full" | "error-biased",
}));

vi.mock("../../packages/rum-sdk/src/otel", () => {
  let n = 0;
  const hr = (ms: number): [number, number] => [Math.floor(ms / 1000), (ms % 1000) * 1_000_000];
  return {
    currentTraceId: () => "ab".repeat(16),
    newPageTrace: () => "ab".repeat(16),
    forceFlush: () => Promise.resolve(),
    discardPendingSpans: () => {},
    initOtel: () => ({
      startSpan(name: string, opts?: { startTime?: number }) {
        const debut = opts?.startTime ?? Date.now();
        const span: EmitSpan = {
          name,
          traceId: "ab".repeat(16),
          spanId: (++n).toString(16).padStart(16, "0"),
          startTime: hr(debut),
          endTime: hr(debut),
          attributes: {},
        };
        return {
          setAttributes(attributes: Record<string, unknown>) {
            Object.assign(span.attributes, attributes);
          },
          // Mêmes recopies natives qu'otel.ts à la fermeture du span.
          end(fin?: number) {
            const a = span.attributes;
            if (typeof a["mip.trace_id"] === "string") span.traceId = a["mip.trace_id"];
            if (typeof a["mip.span_id"] === "string") span.spanId = a["mip.span_id"];
            if (typeof a["mip.parent_span_id"] === "string") span.parentSpanId = a["mip.parent_span_id"];
            span.endTime = hr(fin ?? Date.now());
            etat.spans.push(span);
          },
        };
      },
    }),
  };
});
vi.mock("../../packages/rum-sdk/src/session", () => ({
  getOrCreateSession: () => ({ sessionId: "session-p52", visitorId: "visiteur-p52" }),
  rotateSession: () => ({ sessionId: "session-p52-bis", visitorId: "visiteur-p52" }),
  touchSession: () => {},
}));
vi.mock("../../packages/rum-sdk/src/privacy", () => ({ readPrivacySignals: () => ({}), signalsOptOut: () => false }));
vi.mock("../../packages/rum-sdk/src/sampling", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/rum-sdk/src/sampling")>()),
  loadMode: () => null,
  storeMode: () => {},
  decideMode: () => etat.mode,
}));
vi.mock("../../packages/rum-sdk/src/forms", () => ({ initForms: () => {} }));
vi.mock("../../packages/rum-sdk/src/loaf", () => ({ initLoaf: () => null }));
vi.mock("../../packages/rum-sdk/src/longtasks", () => ({ initLongTasks: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/navtiming", () => ({ initNavTiming: () => {} }));
vi.mock("../../packages/rum-sdk/src/vitals", () => ({ initVitals: () => {} }));
vi.mock("../../packages/rum-sdk/src/resources", () => ({
  DEFAULT_SLOW_RESOURCE_MS: 300,
  initResources: () => ({ reset: () => {} }),
}));
vi.mock("../../packages/rum-sdk/src/replay", () => ({
  flushReplayBoundary: () => {},
  isReplaySampled: () => false,
  startReplay: () => {},
}));
vi.mock("../../packages/rum-sdk/src/retry", () => ({ replayRetryQueue: () => 0, purgeRetryQueue: () => {} }));

// ═══════════════════════════════ Navigateur simulé ═════════════════════════════

type Attrs = Record<string, unknown>;
type Row = Record<string, unknown>;
interface Ecouteur {
  type: string;
  fn: (event: unknown) => void;
  capture: boolean;
}
interface AppelFetch {
  input: unknown;
  init?: RequestInit;
  resolve: (reponse: Response) => void;
  reject: (raison: unknown) => void;
}

const WEB_RESOURCE = {
  "mip.app_id": "app-p52",
  "service.name": "mip-rum-web",
  "deployment.environment.name": "production",
};
const ENDPOINT = "https://ingest.test/v1/traces";

const enCapture = (options: unknown) =>
  options === true || (typeof options === "object" && options !== null && (options as AddEventListenerOptions).capture === true);

/** Une classe NEUVE par démarrage : apispans patche son prototype, qui ne doit pas s'empiler d'un test à l'autre. */
function classeXhr() {
  return class FakeXhr {
    status = 0;
    entetes: Record<string, string> = {};
    ecouteurs = new Map<string, Array<() => void>>();
    open(_method: string, _url: string | URL) {}
    send(_body?: unknown) {}
    setRequestHeader(nom: string, valeur: string) {
      this.entetes[nom] = valeur;
    }
    addEventListener(type: string, fn: () => void) {
      this.ecouteurs.set(type, [...(this.ecouteurs.get(type) ?? []), fn]);
    }
    /** Fin d'échange : l'événement d'issue éventuel, puis loadend, comme un navigateur. */
    terminer(status: number, issue?: "error" | "timeout" | "abort") {
      this.status = status;
      if (issue) for (const fn of this.ecouteurs.get(issue) ?? []) fn();
      for (const fn of this.ecouteurs.get("loadend") ?? []) fn();
    }
  };
}

async function demarrer(
  cfg: Partial<MIPRumConfig> = {},
  navigateur: { reportingObserver?: boolean; cspEvent?: boolean; consoleError?: boolean } = {},
) {
  vi.resetModules();
  const fenetre: Ecouteur[] = [];
  const doc: Ecouteur[] = [];
  const appels: AppelFetch[] = [];
  const observateurs: Array<(reports: unknown[]) => void> = [];
  const natif = { error: vi.fn(), warn: vi.fn() };
  const consoleFactice: { error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void } = {
    error: navigateur.consoleError === false ? (undefined as never) : natif.error,
    warn: natif.warn,
  };
  const fetchNatif = vi.fn(
    (input: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => appels.push({ input, init, resolve, reject })),
  );
  const Xhr = classeXhr();
  const racine = { fetch: fetchNatif };
  vi.stubGlobal("window", racine);
  vi.stubGlobal("document", {
    visibilityState: "visible",
    referrer: "",
    currentScript: null,
    addEventListener: (type: string, fn: (event: unknown) => void, options?: unknown) =>
      doc.push({ type, fn, capture: enCapture(options) }),
    removeEventListener: () => {},
    head: { appendChild: () => {} },
    createElement: () => ({ setAttribute: () => {} }),
  });
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("location", {
    href: "https://app.test/commandes/42",
    pathname: "/commandes/42",
    origin: "https://app.test",
  });
  vi.stubGlobal("history", { pushState: () => {}, replaceState: () => {} });
  vi.stubGlobal("addEventListener", (type: string, fn: (event: unknown) => void, options?: unknown) =>
    fenetre.push({ type, fn, capture: enCapture(options) }),
  );
  vi.stubGlobal("console", consoleFactice);
  vi.stubGlobal("XMLHttpRequest", Xhr);
  vi.stubGlobal(
    "ReportingObserver",
    navigateur.reportingObserver === false
      ? undefined
      : class {
          constructor(rappel: (reports: unknown[]) => void) {
            observateurs.push(rappel);
          }
          observe() {}
        },
  );
  vi.stubGlobal(
    "SecurityPolicyViolationEvent",
    navigateur.cspEvent === false ? undefined : function SecurityPolicyViolationEvent() {},
  );

  const sdk = await import("../../packages/rum-sdk/src/index");
  sdk.init({ endpoint: ENDPOINT, appId: "app-p52", ...cfg });
  return {
    sdk,
    natif,
    consoleFactice,
    fenetre,
    doc,
    appels,
    observateurs,
    fetchNatif,
    Xhr,
    /** Exception non interceptée : ErrorEvent sur window, capture ET bulle. */
    erreurJs(error: Error) {
      const event = { target: racine, error, message: error.message, filename: "https://app.test/app.js", lineno: 1, colno: 2 };
      for (const e of fenetre.filter((l) => l.type === "error")) e.fn(event);
    },
    /** Échec de chargement : l'événement ne remonte pas, seuls les écouteurs en capture le voient. */
    erreurRessource(cible: object) {
      for (const e of fenetre.filter((l) => l.type === "error" && l.capture)) e.fn({ target: cible });
    },
    violationCsp(champs: Attrs) {
      for (const e of doc.filter((l) => l.type === "securitypolicyviolation")) e.fn(champs);
    },
    rapportCsp(body: Attrs) {
      for (const rappel of observateurs) rappel([{ type: "csp-violation", body }]);
    },
  };
}

function element(tagName: string, proprietes: Attrs = {}, interfaceMip = false) {
  return {
    tagName,
    ...proprietes,
    closest: (selecteur: string) => (interfaceMip && selecteur === "[data-mip-rum-ui]" ? {} : null),
  };
}

const exceptions = () => etat.spans.filter((s) => s.name === "exception").map((s) => s.attributes);
const noms = () => etat.spans.map((s) => s.name);
const lignes = () => flattenOtlp(buildResourceSpans(WEB_RESOURCE, etat.spans));
const tacheSuivante = () => new Promise((resolve) => setTimeout(resolve, 0));
const reponse = (status: number) => ({ status }) as Response;

beforeEach(() => {
  etat.spans.length = 0;
  etat.mode = "full";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═══════════════════════════════════ addError ═════════════════════════════════

describe("addError — clé de regroupement opaque", () => {
  it("transmet la clé bornée sans changer le retour, le contexte local ni le regroupement", async () => {
    const { sdk } = await demarrer();
    const erreur = new Error("carte refusée");
    erreur.name = "PaymentError";
    erreur.stack = "PaymentError: carte refusée\n    at payer (https://app.test/app.js:1:2)";
    expect(sdk.addError(erreur, { panier: "p-1" }, { fingerprint: "  paiement.refus  " })).toBe(true);
    expect(sdk.addError(new Error("sans option"), { etape: "b" })).toBe(true);
    for (const invalide of ["", "   ", "x".repeat(101), 42, null]) {
      expect(sdk.addError(new Error("clé invalide"), {}, { fingerprint: invalide as string })).toBe(true);
    }
    expect(sdk.addError("options nulles", {}, null as never)).toBe(true);

    const [avecCle, ...sansCle] = exceptions();
    expect(avecCle).toMatchObject({
      "mip.error_fingerprint": "paiement.refus",
      "mip.context": JSON.stringify({ panier: "p-1" }),
      "exception.type": "PaymentError",
    });
    expect(sansCle).toHaveLength(7);
    for (const attrs of sansCle) expect(attrs).not.toHaveProperty("mip.error_fingerprint");

    const rows = lignes();
    const ligne = (rows.errors as Row[]).find((r) => r.error_type === "PaymentError")!;
    // Regroupement inchangé : l'empreinte ne dépend que de type, message et pile.
    expect(ligne.fingerprint).toBe(errorFingerprint("PaymentError", ligne.message, ligne.stack));
    // Clé transportée pour P5.5, jamais recopiée en colonne, contexte ou projection.
    expect(JSON.stringify(rows)).not.toContain("paiement.refus");
  });
});

// ════════════════════════════════ Opt-in strict ═══════════════════════════════

describe("captureErrors — rien sans demande explicite", () => {
  it("ne pose ni enveloppe console, ni écouteur de capture, ni CSP, ni erreur réseau", async () => {
    const env = await demarrer();
    expect(env.consoleFactice.error).toBe(env.natif.error);
    expect(env.fenetre.filter((l) => l.type === "error" && l.capture)).toEqual([]);
    expect(env.doc.some((l) => l.type === "securitypolicyviolation")).toBe(false);
    expect(env.observateurs).toEqual([]);

    const appel = window.fetch("/api/commandes");
    env.appels[0].resolve(reponse(503));
    await appel;
    expect(noms()).toContain("http.client");
    expect(exceptions()).toEqual([]);
    expect(env.sdk.getErrorCollectionStats()).toMatchObject({
      uncaught: { enabled: true },
      console: { enabled: false },
      resources: { enabled: false },
      csp: { enabled: false },
      network: { enabled: false },
    });
  });

  it("la voie réseau n'existe pas sans les wrappers du tracing", async () => {
    const env = await demarrer({ trace: false, captureErrors: { network: true } });
    expect(window.fetch).toBe(env.fetchNatif);
    expect(env.sdk.getErrorCollectionStats()!.network.enabled).toBe(false);
  });
});

// ══════════════════════════════════ Console ═══════════════════════════════════

describe("console.error", () => {
  it("appelle l'original une seule fois et capture une erreur gérée, avec sa pile", async () => {
    const env = await demarrer({ captureErrors: { console: true } });
    const erreur = new TypeError("total indéfini");
    erreur.stack = "TypeError: total indéfini\n    at valider (https://app.test/panier.js:3:7)";
    const cible = { nom: "console appelante" };
    env.consoleFactice.error.call(cible, "Échec du panier", erreur, { id: 7 });

    expect(env.natif.error).toHaveBeenCalledTimes(1);
    expect(env.natif.error.mock.contexts[0]).toBe(cible);
    expect(env.natif.error.mock.calls[0]).toEqual(["Échec du panier", erreur, { id: 7 }]);
    expect(exceptions()).toEqual([
      expect.objectContaining({
        "mip.error_kind": "console",
        "mip.error_handled": true,
        "exception.type": "TypeError",
        "exception.message": 'Échec du panier TypeError: total indéfini {"id":7}',
        "exception.stacktrace": erreur.stack,
      }),
    ]);
    // Seul console.error est enveloppé : les avertissements du SDK ne sont pas des erreurs.
    expect(env.consoleFactice.warn).toBe(env.natif.warn);
  });

  it("console récursive : ce qu'on journalise pendant la capture passe, sans être capturé", async () => {
    const env = await demarrer({
      captureErrors: { console: true },
      beforeSend(attributes, meta) {
        if (meta?.type === "error" && attributes["exception.message"] === "première") console.error("journal du hook");
        return attributes;
      },
    });
    console.error("première");
    expect(env.natif.error.mock.calls.map((appel) => appel[0])).toEqual(["journal du hook", "première"]);
    expect(exceptions().map((a) => a["exception.message"])).toEqual(["première"]);

    // Un original qui jette : appelé une fois, son exception rendue à l'application,
    // et l'enveloppe reste utilisable ensuite.
    env.natif.error.mockImplementationOnce(() => {
      throw new Error("console indisponible");
    });
    expect(() => console.error("deuxième")).toThrow("console indisponible");
    console.error("troisième");
    expect(env.natif.error).toHaveBeenCalledTimes(4);
    expect(exceptions().map((a) => a["exception.message"])).toEqual(["première", "deuxième", "troisième"]);
  });

  it("objets cycliques, profonds, larges ou piégés : sérialisation bornée et clés sensibles masquées", async () => {
    await demarrer({ captureErrors: { console: true } });
    const cyclique: Attrs = { nom: "commande" };
    cyclique.moi = cyclique;
    cyclique.liste = [cyclique, 1, "deux"];
    const piege = {
      get casse(): never {
        throw new Error("getter");
      },
      ok: true,
    };
    console.error("cycle", cyclique);
    console.error("profond", { a: { b: { c: { d: 1 } } } }, { password: "hunter2", authorization: "Bearer abc" });
    console.error(
      "large",
      Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])),
      piege,
      { nodeType: 1, nodeName: "DIV" },
      () => 1,
      Symbol("s"),
      10n,
      undefined,
      null,
      new Uint8Array(1_000_000),
    );
    console.error("x".repeat(5_000), { long: "y".repeat(5_000) });

    const messages = exceptions().map((a) => String(a["exception.message"]));
    expect(messages[0]).toBe('cycle {"nom":"commande","moi":[Circular],"liste":[[Circular],1,"deux"]}');
    expect(CONSOLE_PROFONDEUR_MAX).toBe(3);
    expect(messages[1]).toBe(
      'profond {"a":{"b":{"c":[Object]}}} {"password":"[redacted]","authorization":"[redacted]"}',
    );
    expect(messages[2]).toContain('"k19":19,…}');
    expect(messages[2]).toContain('{"casse":[?],"ok":true} [DIV] [Function] Symbol(s) 10 undefined null [Object]');
    expect(messages[3]).toHaveLength(CONSOLE_MESSAGE_MAX);
    expect(messages.join("")).not.toContain("hunter2");
  });

  it("un même objet dans une même tâche fait un seul incident, quelle que soit la voie", async () => {
    const env = await demarrer({ captureErrors: { console: true } });
    const journalisee = new Error("paiement refusé");
    console.error(journalisee);
    console.error("contexte :", journalisee);
    env.erreurJs(journalisee); // relancée, puis non interceptée
    const relancee = new Error("stock épuisé");
    env.erreurJs(relancee);
    console.error("après coup :", relancee);
    const manuelle = new Error("saisie invalide");
    expect(env.sdk.addError(manuelle)).toBe(true);
    console.error(manuelle);
    expect(env.natif.error).toHaveBeenCalledTimes(4);
    expect(exceptions().map((a) => [a["mip.error_kind"] ?? a["mip.event_type"], a["exception.message"]])).toEqual([
      ["console", "Error: paiement refusé"],
      ["error", "stock épuisé"],
      ["error", "saisie invalide"],
    ]);

    // Tâche suivante : une nouvelle journalisation est une nouvelle occurrence,
    // comptée sur l'incident déjà émis.
    await tacheSuivante();
    console.error(journalisee);
    env.sdk.flush();
    expect(exceptions()).toHaveLength(4);
    expect(exceptions()[3]).toMatchObject({ "exception.message": "Error: paiement refusé", "mip.error_count": 1 });
  });

  it("sans console.error, la voie se déclare non supportée et n'enveloppe rien", async () => {
    const env = await demarrer({ captureErrors: { console: true } }, { consoleError: false });
    expect(env.consoleFactice.error).toBeUndefined();
    expect(env.sdk.getErrorCollectionStats()!.console).toMatchObject({
      enabled: true,
      unsupported: ["console.error"],
    });
  });
});

// ═════════════════════════════════ Ressources ═════════════════════════════════

describe("ressources", () => {
  it("capture l'échec en phase de capture : URL nettoyée, jamais de statut", async () => {
    const env = await demarrer({ captureErrors: { resources: true } });
    env.erreurRessource(element("IMG", { currentSrc: "", src: "https://jean:secret@cdn.test/produits/42.png?token=abc#zoom" }));
    env.erreurRessource(element("SCRIPT", { src: "data:text/javascript;base64,YWxlcnQoMSk=" }));
    env.erreurRessource(element("image", { href: { baseVal: "/icones/panier.svg?v=3" } }));
    env.erreurRessource(element("SCRIPT", { src: "https://console.test/mip-rum-replay.js" }, true));
    env.erreurRessource(element("DIV"));
    // Une exception JS arrive sur window : elle reste à la voie uncaught.
    env.erreurJs(new Error("boom"));

    expect(exceptions()).toEqual([
      expect.objectContaining({
        "mip.error_kind": "resource",
        "exception.type": "ResourceError",
        "exception.message": "Échec de chargement img cdn.test/produits/42.png",
        "mip.error_source": "https://cdn.test/produits/42.png",
      }),
      expect.objectContaining({ "exception.message": "Échec de chargement script data:", "mip.error_source": "data:" }),
      expect.objectContaining({
        "exception.message": "Échec de chargement image app.test/icones/panier.svg",
        "mip.error_source": "https://app.test/icones/panier.svg",
      }),
      expect.objectContaining({ "mip.error_kind": "error", "exception.message": "boom" }),
    ]);
    for (const attrs of exceptions().slice(0, 3)) {
      expect(attrs).not.toHaveProperty("http.status_code");
      expect(attrs).not.toHaveProperty("mip.error_handled");
      expect(`${attrs["exception.message"]} ${attrs["mip.error_source"]}`).not.toMatch(/404|token|secret|zoom|YWxl|v=3/);
    }

    const [ressource] = lignes().errors as Row[];
    expect(ressource).toMatchObject({
      kind: "resource",
      error_source: "browser_resource",
      handled: null,
      is_fatal: null,
      source: "https://cdn.test/produits/42.png",
    });
  });
});

// ═════════════════════════════════════ CSP ════════════════════════════════════

describe("CSP", () => {
  const violation = {
    effectiveDirective: "script-src-elem",
    violatedDirective: "script-src",
    blockedURI: "https://tiers.test/pixel.js?uid=jean@client.fr",
    sourceFile: "https://app.test/commandes/42?session=abc",
    lineNumber: 12,
    columnNumber: 4,
    disposition: "enforce",
    sample: "alert(document.cookie)",
    originalPolicy: "script-src 'self'; report-uri /csp",
  };
  const rapport = { ...violation, blockedURL: violation.blockedURI, blockedURI: undefined };

  it("un signal dupliqué par l'événement et ReportingObserver ne fait qu'un incident", async () => {
    const env = await demarrer({ captureErrors: { csp: true } });
    env.violationCsp(violation);
    env.rapportCsp(rapport);
    expect(exceptions()).toEqual([
      expect.objectContaining({
        "mip.error_kind": "csp",
        "exception.type": "CSPViolation",
        "exception.message": "Violation CSP script-src-elem : tiers.test",
        "mip.error_source": "https://app.test/commandes/42",
        "mip.error_lineno": 12,
        "mip.error_colno": 4,
      }),
    ]);
    // Ni extrait inline, ni politique, ni query de la ressource bloquée.
    expect(JSON.stringify(exceptions())).not.toMatch(/alert|cookie|report-uri|uid=|jean@|session=/);

    // Une deuxième occurrence réelle, rapport d'abord cette fois : comptée une fois.
    env.rapportCsp(rapport);
    env.violationCsp(violation);
    env.sdk.flush();
    expect(exceptions()).toHaveLength(2);
    expect(exceptions()[1]).toMatchObject({ "mip.error_count": 1 });
    expect(env.sdk.getErrorCollectionStats()!.csp).toMatchObject({ enabled: true, unsupported: [], emitted: 2 });

    const [ligne] = lignes().errors as Row[];
    expect(ligne).toMatchObject({ kind: "csp", error_source: "browser_csp", handled: null, lineno: 12, colno: 4 });
  });

  it("mot-clé, report-only et schéma seul ; le blocage de l'ingestion MIP n'est jamais signalé", async () => {
    const env = await demarrer({ captureErrors: { csp: true } });
    env.violationCsp({ effectiveDirective: "script-src", blockedURI: "inline", disposition: "report" });
    env.violationCsp({ effectiveDirective: "img-src", blockedURI: "data:image/png;base64,iVBORw0KGgo=", disposition: "enforce" });
    env.violationCsp({ effectiveDirective: "connect-src", blockedURI: `${ENDPOINT}?batch=1`, disposition: "enforce" });
    env.rapportCsp({ effectiveDirective: "connect-src", blockedURL: "https://ingest.test/v1/replay", disposition: "enforce" });
    expect(exceptions().map((a) => a["exception.message"])).toEqual([
      "Violation CSP script-src (report-only) : inline",
      "Violation CSP img-src : data",
    ]);
  });

  it("déclare les API absentes du navigateur", async () => {
    const env = await demarrer({ captureErrors: { csp: true } }, { reportingObserver: false, cspEvent: false });
    expect(env.sdk.getErrorCollectionStats()!.csp).toEqual({
      enabled: true,
      unsupported: ["securitypolicyviolation", "ReportingObserver"],
      emitted: 0,
      capped: 0,
      rejected: 0,
    });
  });
});

// ═══════════════════════════════════ Réseau ═══════════════════════════════════

describe("réseau", () => {
  it("fetch 500 : erreur liée au span de l'appel ; 404 et abandon ignorés par défaut", async () => {
    const env = await demarrer({ captureErrors: { network: true } });
    const p500 = window.fetch("/api/commandes/42?token=abc#x", { method: "POST" });
    const p404 = window.fetch("/api/introuvable");
    const controleur = new AbortController();
    const pAbandon = window.fetch("/api/annulee", { signal: controleur.signal });
    env.appels[0].resolve(reponse(500));
    env.appels[1].resolve(reponse(404));
    controleur.abort();
    env.appels[2].reject(new DOMException("The user aborted a request.", "AbortError"));
    await p500;
    await p404;
    await expect(pAbandon).rejects.toThrow("aborted");

    expect(exceptions()).toEqual([
      expect.objectContaining({
        "mip.error_kind": "network",
        "exception.type": "HTTP 500",
        "exception.message": "POST app.test/api/commandes/42 : HTTP 500",
        "mip.error_source": "https://app.test/api/commandes/42",
        "http.method": "POST",
        "http.status_code": 500,
      }),
    ]);
    const erreur = etat.spans.find((s) => s.name === "exception")!;
    const appel = etat.spans.find((s) => s.name === "http.client" && s.attributes["http.status_code"] === 500)!;
    expect(erreur.traceId).toBe(appel.traceId);
    expect(erreur.parentSpanId).toBe(appel.spanId);
    expect(erreur.startTime).toEqual(appel.startTime);
    expect(noms().filter((nom) => nom === "http.client")).toHaveLength(3);
  });

  it("sur option : 4xx et abandons classés à part ; délais et coupures toujours signalés", async () => {
    const env = await demarrer({ captureErrors: { network: { clientErrors: true, aborts: true } } });
    const introuvable = window.fetch("/api/introuvable");
    const controleur = new AbortController();
    const annulee = window.fetch(new Request("https://app.test/api/annulee", { signal: controleur.signal }));
    const coupee = window.fetch("/api/coupee");
    const lente = window.fetch("/api/lente");
    env.appels[0].resolve(reponse(404));
    controleur.abort("changement de page");
    env.appels[1].reject("changement de page");
    env.appels[2].reject(new TypeError("Failed to fetch"));
    env.appels[3].reject(new DOMException("signal timed out", "TimeoutError"));
    await introuvable;
    await Promise.allSettled([annulee, coupee, lente]);

    const xhrLent = new XMLHttpRequest() as unknown as InstanceType<typeof env.Xhr>;
    xhrLent.open("GET", "/api/xhr-lent");
    xhrLent.send();
    xhrLent.terminer(0, "timeout");
    const xhrAnnule = new XMLHttpRequest() as unknown as InstanceType<typeof env.Xhr>;
    xhrAnnule.open("GET", "/api/xhr-annule");
    xhrAnnule.send();
    xhrAnnule.terminer(0, "abort");
    const xhrOk = new XMLHttpRequest() as unknown as InstanceType<typeof env.Xhr>;
    xhrOk.open("GET", "/api/xhr-ok");
    xhrOk.send();
    xhrOk.terminer(200);

    expect(exceptions().map((a) => [a["exception.type"], a["exception.message"]])).toEqual([
      ["HTTP 404", "GET app.test/api/introuvable : HTTP 404"],
      ["AbortError", "GET app.test/api/annulee : requête abandonnée"],
      ["NetworkError", "GET app.test/api/coupee : échec réseau"],
      ["TimeoutError", "GET app.test/api/lente : délai dépassé"],
      ["TimeoutError", "GET app.test/api/xhr-lent : délai dépassé"],
      ["AbortError", "GET app.test/api/xhr-annule : requête abandonnée"],
    ]);
    for (const attrs of exceptions().slice(1)) expect(attrs).not.toHaveProperty("http.status_code");
  });

  it("XHR : délai signalé par défaut, abandon volontaire non", async () => {
    await demarrer({ captureErrors: { network: true } });
    for (const [url, status, issue] of [
      ["/api/lent", 0, "timeout"],
      ["/api/annule", 0, "abort"],
      ["/api/indisponible", 503, undefined],
    ] as const) {
      const xhr = new XMLHttpRequest() as unknown as ReturnType<typeof classeXhr>["prototype"];
      xhr.open("GET", url);
      xhr.send();
      xhr.terminer(status, issue);
    }
    expect(exceptions().map((a) => a["exception.type"])).toEqual(["TimeoutError", "HTTP 503"]);
  });

  it("deux clics proches : chaque échec garde l'action de son départ, même drainé", async () => {
    const env = await demarrer({ captureErrors: { network: true } });
    expect(env.sdk.addAction("Payer")).toBe(true);
    const premier = window.fetch("/api/paiement");
    expect(env.sdk.addAction("Payer encore")).toBe(true);
    const second = window.fetch("/api/paiement");
    // Le second répond d'abord ; le premier, identique, est tu puis drainé.
    env.appels[1].resolve(reponse(502));
    env.appels[0].resolve(reponse(502));
    await Promise.all([premier, second]);
    env.sdk.flush();

    const actions = etat.spans.filter((s) => s.name === "rum.action");
    const idDe = (nom: string) => actions.find((s) => s.attributes["mip.event_name"] === nom)!.attributes["mip.action_id"];
    expect(exceptions().map((a) => [a["mip.action_id"], a["mip.error_count"]])).toEqual([
      [idDe("Payer encore"), undefined],
      [idDe("Payer"), 1],
    ]);
    expect(
      etat.spans.filter((s) => s.name === "http.client").map((s) => s.attributes["mip.action_id"]),
    ).toEqual([idDe("Payer encore"), idDe("Payer")]);
  });

  it("révocation avant la réponse : ni erreur ni span, même après un nouvel accord", async () => {
    const env = await demarrer({ captureErrors: { network: true } });
    const avant = window.fetch("/api/profil");
    env.sdk.consent(false);
    env.sdk.consent(true);
    env.appels[0].resolve(reponse(500));
    await avant;
    expect(noms().filter((nom) => nom === "exception" || nom === "http.client")).toEqual([]);
    expect(env.sdk.getErrorCollectionStats()!.network).toMatchObject({ emitted: 0, rejected: 1 });

    const apres = window.fetch("/api/compte");
    env.appels[1].resolve(reponse(500));
    await apres;
    expect(exceptions().map((a) => a["exception.message"])).toEqual(["GET app.test/api/compte : HTTP 500"]);
  });

  it("l'envoi vers l'ingestion qui échoue ne produit ni span ni erreur", async () => {
    const env = await demarrer({ captureErrors: { network: { clientErrors: true, aborts: true } } });
    const envoi = window.fetch(ENDPOINT, { method: "POST", body: "{}" });
    env.appels[0].reject(new TypeError("Failed to fetch"));
    await expect(envoi).rejects.toThrow("Failed to fetch");
    const rejeu = window.fetch("https://ingest.test/v1/replay", { method: "POST" });
    env.appels[1].resolve(reponse(503));
    await rejeu;
    expect(noms().filter((nom) => nom === "exception" || nom === "http.client")).toEqual([]);
    expect(new Headers(env.appels[0].init?.headers).get("traceparent")).toBeNull();
    expect(env.sdk.getErrorCollectionStats()!.network).toMatchObject({ enabled: true, emitted: 0, rejected: 0 });
  });

  it("session error-biased : la première erreur promeut la session, le span de l'appel passe avec elle", async () => {
    etat.mode = "error-biased";
    const env = await demarrer({ captureErrors: { network: true } });
    const ok = window.fetch("/api/ok");
    env.appels[0].resolve(reponse(200));
    await ok;
    expect(noms()).toEqual([]);
    const ko = window.fetch("/api/ko");
    env.appels[1].resolve(reponse(500));
    await ko;
    expect(noms()).toEqual(["exception", "breadcrumb", "http.client"]);
    expect(env.sdk.track("apres_promotion")).toBe(true);
  });

  it("beforeSend : peut masquer ou refuser, jamais réécrire la voie ni le lien vers l'appel", async () => {
    const env = await demarrer({
      captureErrors: { network: true, console: true },
      beforeSend(attributes, meta) {
        if (meta?.type !== "error") return attributes;
        if (attributes["mip.error_kind"] === "console") return null;
        return {
          ...attributes,
          "exception.message": "[masqué]",
          "mip.error_kind": "error",
          "mip.error_handled": true,
          "mip.trace_id": "f".repeat(32),
          "mip.parent_span_id": "e".repeat(16),
        };
      },
    });
    console.error("refusée par le hook");
    const appel = window.fetch("/api/stock");
    env.appels[0].resolve(reponse(503));
    await appel;

    const span = etat.spans.find((s) => s.name === "http.client")!;
    expect(exceptions()).toEqual([
      expect.objectContaining({
        "exception.message": "[masqué]",
        "mip.error_kind": "network",
        "mip.trace_id": span.traceId,
        "mip.parent_span_id": span.spanId,
      }),
    ]);
    expect(exceptions()[0]).not.toHaveProperty("mip.error_handled");
    expect(env.sdk.getErrorCollectionStats()).toMatchObject({
      console: { emitted: 0, rejected: 1 },
      network: { emitted: 1, rejected: 0 },
    });
  });
});

// ══════════════════════════ Plafonds et métriques de drops ════════════════════

describe("plafonds par voie et métriques de drops", () => {
  it("une console bavarde atteint son plafond sans faire taire les exceptions", async () => {
    const env = await demarrer({ captureErrors: { console: true } });
    const lettres = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < PLAFONDS_PAR_VOIE.console + 3; i++) console.error(`bruit ${lettres[i]}`);
    console.error("bruit A"); // répétition d'une empreinte admise : comptée, pas perdue
    env.erreurJs(new Error("vraie exception"));
    env.sdk.flush();

    const stats = env.sdk.getErrorCollectionStats()!;
    expect(stats.console).toEqual({ enabled: true, unsupported: [], emitted: 21, capped: 3, rejected: 0 });
    expect(stats.uncaught).toEqual({ enabled: true, unsupported: [], emitted: 1, capped: 0, rejected: 0 });
    expect(exceptions().filter((a) => a["mip.error_kind"] === "console")).toHaveLength(21);
    expect(exceptions().some((a) => a["exception.message"] === "vraie exception")).toBe(true);
  });

  it("les plafonds sont ceux que documente le guide d'intégration", () => {
    const doc = readFileSync("docs/INTEGRATION.md", "utf8");
    for (const [voie, plafond] of Object.entries(PLAFONDS_PAR_VOIE) as Array<[ErrorCategory, number]>) {
      expect(doc, voie).toMatch(new RegExp(`\\| \`${voie}\` \\|[^\\n]*\\| ${plafond} \\|`));
    }
  });
});

// ════════════════════ En base : ni corps, ni en-têtes, ni query, ni JWT ════════

describe("en base : ni corps, ni en-têtes métier, ni query, ni JWT", () => {
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqZWFuIn0.c2lnbmF0dXJlLXNlY3JldGU";

  function fakePool() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const colonnesErreur = [
      "occurrences", "action_id", "trace_id", "source_parent_span_id", "error_source", "handled", "is_fatal",
      "context", "view_id", "view_name", "user_id_hash", "account_id_hash", "env", "service",
    ];
    const query = async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns")) {
        return { rows: params[0] === "rum_error" ? colonnesErreur.map((column_name) => ({ column_name })) : [] };
      }
      return { rows: [] };
    };
    return { calls, pool: { connect: async () => ({ query, release() {} }) } };
  }

  it("chaque voie arrive avec sa source, et rien de ce qui ne doit pas y être", async () => {
    const env = await demarrer({ captureErrors: { console: true, resources: true, csp: true, network: true } });
    console.error(new Error("échec du rendu"));
    env.erreurRessource(element("IMG", { src: `https://cdn.test/avatars/${JWT}.png?sig=secret-query` }));
    env.violationCsp({
      effectiveDirective: "img-src",
      blockedURI: `https://pixel.test/p?jwt=${JWT}`,
      sourceFile: "https://app.test/page?code=secret-query",
      lineNumber: 3,
      columnNumber: 9,
      disposition: "enforce",
      sample: "secret-inline",
    });
    const longue = `/api/reinitialisation/${"segment-".repeat(12)}${JWT}?token=secret-query`;
    const appel = window.fetch(longue, {
      method: "PUT",
      body: JSON.stringify({ motDePasse: "secret-corps" }),
      headers: { Authorization: `Bearer ${JWT}`, "X-Metier": "secret-entete" },
    });
    env.appels[0].resolve(reponse(500));
    await appel;

    const rows = lignes();
    expect(rows.rejected).toBe(0);
    const parVoie = Object.fromEntries((rows.errors as Row[]).map((r) => [r.kind, r]));
    expect(parVoie.console).toMatchObject({ error_source: "browser_console", handled: true, is_fatal: null });
    expect(parVoie.resource).toMatchObject({ error_source: "browser_resource", handled: null });
    expect(parVoie.csp).toMatchObject({ error_source: "browser_csp", handled: null, source: "https://app.test/page" });
    const span = (rows.spans as Row[]).find((s) => s.tier === "front")!;
    expect(parVoie.network).toMatchObject({
      error_source: "browser_network",
      handled: null,
      trace_id: span.trace_id,
      source_parent_span_id: span.span_id,
    });
    for (const r of rows.errors as Row[]) expect(r.fingerprint).toBe(errorFingerprint(r.error_type, r.message, r.stack));

    _resetColonnesCache();
    const { calls, pool } = fakePool();
    await writeRows(pool, rows);
    const ecrit = JSON.stringify(calls.map((c) => c.params));
    expect(calls.some((c) => c.sql.startsWith("insert into rum_error"))).toBe(true);
    for (const interdit of ["secret-query", "secret-corps", "secret-entete", "secret-inline", JWT, "Bearer", "sig=", "token="]) {
      expect(ecrit, interdit).not.toContain(interdit);
    }
    // Le fil d'Ariane de l'erreur réseau est coupé avant le jeton, jamais au milieu.
    const fil = (rows.breadcrumbs as Row[]).find((b) => b.type === "error" && String(b.label).startsWith("PUT"));
    expect(fil?.label).toMatch(/…$/);
  });

  it("un libellé trop long perd son dernier mot ou segment entamé, pas la moitié d'un jeton", () => {
    expect(boundedWireLabel("court")).toBe("court");
    const libelle = `PUT app.test/api/${"a".repeat(80)} ${JWT} : HTTP 500`;
    expect(boundedWireLabel(libelle)).toBe(`PUT app.test/api/${"a".repeat(80)} …`);
    expect(boundedWireLabel(`${"b".repeat(119)} suite`)).toBe(`${"b".repeat(119)}…`);
    // Coupe au milieu du jeton : le segment entamé disparaît, le chemin qui précède reste.
    expect(boundedWireLabel(`/api/reinitialisation/${"x".repeat(60)}/${JWT}`)).toBe(
      `/api/reinitialisation/${"x".repeat(60)}/…`,
    );
    // Jeton ENTIER suivi d'autres segments : gardé tel quel, l'ingestion le masque.
    expect(boundedWireLabel(`/r/${JWT}${"/segment".repeat(10)}`)).toContain(`/r/${JWT}/segment/`);
    expect(boundedWireLabel("/a".repeat(100))).toBe(`${"/a".repeat(59)}/…`);
    expect(boundedWireLabel(`contact ${"x".repeat(100)}.jean@exemple.fr`)).toBe("contact …");
    expect(boundedWireLabel("x".repeat(300))).toBe("…");
  });
});
