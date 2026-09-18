// P5.1 — enveloppe d'erreur fiable (migration-v69), côté ingestion.
//
// Trois propriétés sont verrouillées ici. (1) Chaque occurrence porte SA
// corrélation, sa source et son caractère géré ou fatal quand l'émetteur les
// dit, et NULL sinon : une valeur devinée fabriquerait des liens et des filtres
// faux. (2) Aucune valeur hostile ou simplement étrange — le NUL d'un message
// V8, un exposant, une ligne décimale — ne peut plus faire refuser une ligne par
// PostgreSQL, ce qui annulait le lot entier. (3) Le regroupement ne bouge pas.
import { beforeEach, describe, expect, it } from "vitest";
import { buildResourceSpans, msToHr, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";
import { buildExceptionSpan, buildPayload, type Ctx, type MobileConfig } from "../../packages/rum-mobile/src/core";
// @ts-expect-error module JS partagé sans déclarations
import { drainerIngestRaw } from "../../apps/ingest/lib/ingest-differe.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";
import {
  ERROR_SOURCES,
  boundedErrorType,
  errorEnvelope,
  errorFingerprint,
  flattenOtlp,
  nativeParentSpanId,
  nativeTraceId,
  sansNul,
  // @ts-expect-error module JS partagé sans déclarations
} from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const NOW = Date.parse("2026-09-16T08:00:00.000Z");
const NUL = String.fromCharCode(0);
const REMPLACEMENT = String.fromCharCode(0xfffd);
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT = "53995c3f42cd8ad8";
const HASH = "ab".repeat(32);

type Attrs = Record<string, unknown>;
type Row = Record<string, unknown>;

const kv = (key: string, value: unknown) => ({
  key,
  value: typeof value === "string" ? { stringValue: value }
    : typeof value === "boolean" ? { boolValue: value }
      : Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value },
});

/** Payload OTLP écrit à la main : resource, scope et champs natifs maîtrisés. */
function payload(opts: {
  resource?: Attrs;
  scope?: unknown;
  spans: Array<{ name?: string; traceId?: unknown; parentSpanId?: unknown; spanId?: string; attrs?: Attrs }>;
}) {
  return {
    resourceSpans: [{
      resource: {
        attributes: Object.entries({ "mip.app_id": "envelope-app", ...opts.resource }).map(([k, v]) => kv(k, v)),
      },
      scopeSpans: [{
        ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
        spans: opts.spans.map((span, i) => ({
          name: span.name ?? "exception",
          spanId: span.spanId ?? (i + 1).toString(16).padStart(16, "0"),
          ...(span.traceId !== undefined ? { traceId: span.traceId } : {}),
          ...(span.parentSpanId !== undefined ? { parentSpanId: span.parentSpanId } : {}),
          startTimeUnixNano: String(BigInt(NOW) * 1_000_000n),
          endTimeUnixNano: String(BigInt(NOW) * 1_000_000n),
          attributes: Object.entries({
            "mip.session_id": "session-envelope",
            "mip.route": "/panier",
            "exception.type": "TypeError",
            "exception.message": "boom",
            ...span.attrs,
          }).map(([k, v]) => kv(k, v)),
        })),
      }],
    }],
  };
}

/** Une seule exception d'un émetteur inconnu : la ligne produite. */
function erreurUnique(span: Parameters<typeof payload>[0]["spans"][number], resource: Attrs = {}) {
  const rows = flattenOtlp(payload({ resource, spans: [span] }), { now: NOW });
  expect(rows.rejected).toBe(0);
  expect(rows.errors).toHaveLength(1);
  return rows.errors[0] as Row;
}

/** Vrai si une chaîne (valeur ou clé) contient encore un NUL, à toute profondeur. */
function contientNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes(NUL);
  if (Array.isArray(value)) return value.some(contientNul);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.entries(value).some(([key, child]) => key.includes(NUL) || contientNul(child));
  }
  return false;
}

// ─────────────────────────────── Émetteurs réels ───────────────────────────────

/** Attributs du SDK web (otel.ts) et d'une erreur telle qu'errors.ts l'émet. */
const WEB_RESOURCE = {
  "service.name": "mip-rum-web",
  "service.version": "0.4.0",
  "mip.app_id": "envelope-web",
  "mip.release": "2.3.1",
  "deployment.environment.name": "production",
};

function webException(attributes: Attrs): Row {
  const span: EmitSpan = {
    name: "exception",
    traceId: TRACE,
    spanId: "00f067aa0ba902b7",
    parentSpanId: PARENT,
    startTime: msToHr(NOW),
    endTime: msToHr(NOW),
    attributes: { "mip.session_id": "session-web", "mip.route": "/panier", ...attributes },
  };
  const rows = flattenOtlp(buildResourceSpans(WEB_RESOURCE, [span]), { now: NOW });
  expect(rows.errors).toHaveLength(1);
  return rows.errors[0] as Row;
}

const WINDOW_ERROR = {
  "mip.error_kind": "error",
  "exception.type": "TypeError",
  "exception.message": "Cannot read properties of undefined (reading 'total')",
  "exception.stacktrace":
    "TypeError: Cannot read properties of undefined (reading 'total')\n    at validerPanier (https://app.exemple.fr/assets/panier-4f2a9c1d.js:1:2345)",
  "mip.error_source": "https://app.exemple.fr/assets/panier-4f2a9c1d.js",
  "mip.error_lineno": 1,
  "mip.error_colno": 2345,
};

describe("helpers d'enveloppe", () => {
  it("ERROR_SOURCES est la taxonomie fermée de migration-v69, dans son ordre, et figée", () => {
    expect(ERROR_SOURCES).toEqual([
      "browser_js", "browser_console", "browser_resource", "browser_csp", "browser_network",
      "node", "python", "react_native_js", "native", "otel",
    ]);
    expect(Object.isFrozen(ERROR_SOURCES)).toBe(true);
  });

  it("sansNul remplace chaque NUL d'une chaîne et laisse le reste intact", () => {
    expect(sansNul(`a${NUL}b${NUL}`)).toBe(`a${REMPLACEMENT}b${REMPLACEMENT}`);
    const objet = { a: NUL };
    expect(sansNul(objet)).toBe(objet);
    for (const value of [42, true, null, undefined]) expect(sansNul(value)).toBe(value);
  });

  it("nativeTraceId : 32 hex non nuls, en minuscules ; ni tout-zéro ni 64 bits complété", () => {
    expect(nativeTraceId(TRACE)).toBe(TRACE);
    expect(nativeTraceId(TRACE.toUpperCase())).toBe(TRACE);
    expect(nativeTraceId("0".repeat(32))).toBeNull();
    // rum-mobile : `spanId.padStart(32, "0")` quand aucun appel réseau n'a de trace
    expect(nativeTraceId(`${"0".repeat(16)}a1b2c3d4e5f60718`)).toBeNull();
    expect(nativeTraceId(`${"0".repeat(15)}1a1b2c3d4e5f60718`)).toBe(`${"0".repeat(15)}1a1b2c3d4e5f60718`);
    for (const hostile of [TRACE.slice(1), `${TRACE}0`, "z".repeat(32), `${TRACE}\n`, 42, null, undefined]) {
      expect(nativeTraceId(hostile)).toBeNull();
    }
  });

  it("nativeParentSpanId : 16 hex non nuls, en minuscules", () => {
    expect(nativeParentSpanId(PARENT)).toBe(PARENT);
    expect(nativeParentSpanId(PARENT.toUpperCase())).toBe(PARENT);
    for (const hostile of ["0".repeat(16), PARENT.slice(1), `${PARENT}0`, "g".repeat(16), "", 7, null]) {
      expect(nativeParentSpanId(hostile)).toBeNull();
    }
  });

  it("boundedErrorType scrubbe, coupe à 200 et rend null sur un vide ou un non-texte", () => {
    expect(boundedErrorType("  TypeError ")).toBe("TypeError");
    expect(boundedErrorType("Erreur pour jean@client.fr")).toBe("Erreur pour [email]");
    expect(boundedErrorType("E".repeat(300))).toBe("E".repeat(200));
    for (const vide of ["", "   ", 42, null, undefined]) expect(boundedErrorType(vide)).toBeNull();
  });

  it("errorEnvelope : source navigateur par catégorie EXPLICITE, jamais par un nom hérité", () => {
    const web = (kind: unknown) => errorEnvelope({
      attrs: kind === undefined ? {} : { "mip.error_kind": kind },
      resource: {},
      scopeName: "@mip/rum-sdk",
    }).error_source;
    expect(web("console")).toBe("browser_console");
    expect(web("resource")).toBe("browser_resource");
    expect(web("csp")).toBe("browser_csp");
    expect(web("network")).toBe("browser_network");
    for (const autre of ["error", "unhandledrejection", "Console", "constructor", "__proto__", 42, undefined]) {
      expect(web(autre)).toBe("browser_js");
    }
  });

  it("errorEnvelope : géré et fatal seulement quand ils sont dits ou certains", () => {
    const rn = { "service.name": "mip-rum-mobile" };
    expect(errorEnvelope({ attrs: { "mip.error_handled": true, "mip.error_kind": "crash" }, resource: rn }).handled).toBe(true);
    expect(errorEnvelope({ attrs: {}, resource: {}, eventType: "error" }).handled).toBe(true);
    expect(errorEnvelope({ attrs: { "mip.error_kind": "crash" }, resource: rn }).handled).toBe(false);
    // Le même mot venu d'un émetteur inconnu ne prouve rien.
    expect(errorEnvelope({ attrs: { "mip.error_kind": "error" }, resource: {} }).handled).toBeNull();
    expect(errorEnvelope({ attrs: { "mip.error_kind": "console" }, resource: rn }).handled).toBeNull();
    expect(errorEnvelope({ attrs: { "mip.error_handled": "false" }, resource: {} }).handled).toBeNull();
    expect(errorEnvelope({ attrs: { "mip.error_fatal": false }, resource: {} }).is_fatal).toBe(false);
    for (const nonBooleen of ["true", 1, null]) {
      expect(errorEnvelope({ attrs: { "mip.error_fatal": nonBooleen, "mip.error_kind": "crash" }, resource: rn }).is_fatal).toBeNull();
    }
  });

  it("errorEnvelope : env déclaré (clé semconv récente puis ancienne), service seulement hors SDK MIP", () => {
    expect(errorEnvelope({ attrs: {}, resource: { "deployment.environment": "staging" } }).env).toBe("staging");
    expect(errorEnvelope({
      attrs: {}, resource: { "deployment.environment.name": "prod", "deployment.environment": "staging" },
    }).env).toBe("prod");
    expect(errorEnvelope({ attrs: {}, resource: { "service.name": "checkout-api" } }))
      .toMatchObject({ service: "checkout-api", error_source: null, handled: null });
    expect(errorEnvelope({ attrs: {}, resource: { "service.name": "mip-rum-web" } }).service).toBeNull();
    expect(errorEnvelope({ attrs: {}, resource: { "service.name": "mip-rum-mobile" } }).service).toBeNull();
    expect(errorEnvelope({ attrs: {}, resource: { "service.name": "checkout-api" }, scopeName: "@mip/rum-sdk" }).service)
      .toBeNull();
  });
});

describe("flattenOtlp — une ligne d'exception par émetteur", () => {
  it("SDK web, window error : trace et parent natifs, source JS, non gérée", () => {
    expect(webException(WINDOW_ERROR)).toMatchObject({
      trace_id: TRACE,
      source_parent_span_id: PARENT,
      error_source: "browser_js",
      handled: false,
      is_fatal: null,
      env: "production",
      service: null,
      kind: "error",
      lineno: 1,
      colno: 2345,
      release: "2.3.1",
    });
  });

  it("SDK web, unhandledrejection : même source, non gérée, kind conservé", () => {
    expect(webException({
      "mip.error_kind": "unhandledrejection",
      "exception.type": "UnhandledRejection",
      "exception.message": "délai dépassé",
      "exception.stacktrace": "",
    })).toMatchObject({ kind: "unhandledrejection", error_source: "browser_js", handled: false, trace_id: TRACE });
  });

  it("SDK web, addError manuel : gérée, snapshot P2 porté par la ligne elle-même", () => {
    const row = webException({
      "mip.event_type": "error",
      "mip.event_name": "PaymentError",
      "exception.type": "PaymentError",
      "exception.message": "carte refusée",
      "mip.context": JSON.stringify({ panier: "p-42", montant: 12.5 }),
      "mip.view_id": "view-panier",
      "mip.view_name": "Panier",
      "mip.user_id_hash": HASH.toUpperCase(),
    });
    expect(row).toMatchObject({
      event_type: "error",
      handled: true,
      kind: "error",
      error_source: "browser_js",
      context: { panier: "p-42", montant: 12.5 },
      view_id: "view-panier",
      view_name: "Panier",
      user_id_hash: HASH,
    });
  });

  it("SDK web, catégorie et booléens explicites d'un SDK plus récent : pris tels quels", () => {
    expect(webException({
      "mip.error_kind": "console",
      "mip.error_handled": true,
      "mip.error_fatal": false,
      "exception.message": "console.error",
    })).toMatchObject({ kind: "console", error_source: "browser_console", handled: true, is_fatal: false });
  });

  it("rum-mobile, crash : trace synthétique écartée, source RN, service non inventé", () => {
    const cfg: MobileConfig = {
      endpoint: "https://i.test/v1/traces", appId: "envelope-rn", apiKey: null, env: "prod",
      clientId: null, appVersion: "1.2.3", userAgent: "MIP-RN/0.1 (ios 17)",
    };
    const ctx: Ctx = { sessionId: "session-rn", route: "Accueil", userHash: null, tz: "Europe/Paris", deviceType: "ios" };
    const rows = flattenOtlp(buildPayload(cfg, [
      buildExceptionSpan(ctx, { message: "undefined is not an object", type: "TypeError", stack: "at App" }, NOW, "bb22cc33dd44ee55"),
    ]), { now: NOW });
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0]).toMatchObject({
      kind: "crash",
      trace_id: null,
      source_parent_span_id: null,
      error_source: "react_native_js",
      handled: false,
      is_fatal: null,
      env: "prod",
      service: null,
    });
  });

  it("émetteur inconnu : source et géré inconnus, service déclaré conservé", () => {
    expect(erreurUnique(
      { traceId: TRACE, attrs: { "mip.error_kind": "error" } },
      { "service.name": "checkout-api", "deployment.environment": "staging" },
    )).toMatchObject({
      trace_id: TRACE,
      error_source: null,
      handled: null,
      is_fatal: null,
      env: "staging",
      service: "checkout-api",
      kind: "error",
    });
  });
});

describe("flattenOtlp — une valeur hostile ne coûte que son champ", () => {
  it("trace et parent malformés ou nuls deviennent NULL, la casse est normalisée", () => {
    expect(erreurUnique({ traceId: "0".repeat(32), parentSpanId: "0".repeat(16) }))
      .toMatchObject({ trace_id: null, source_parent_span_id: null });
    expect(erreurUnique({ traceId: "z".repeat(32), parentSpanId: "abc" }))
      .toMatchObject({ trace_id: null, source_parent_span_id: null });
    expect(erreurUnique({ traceId: { hostile: true }, parentSpanId: 42 }))
      .toMatchObject({ trace_id: null, source_parent_span_id: null });
    expect(erreurUnique({ traceId: TRACE.toUpperCase(), parentSpanId: PARENT.toUpperCase() }))
      .toMatchObject({ trace_id: TRACE, source_parent_span_id: PARENT });
  });

  it("scope hostile : pas de runtime deviné, pas d'exception", () => {
    for (const scope of ["@mip/rum-sdk", { name: { toString: "@mip/rum-sdk" } }, null, 42]) {
      const rows = flattenOtlp(payload({ scope, spans: [{}] }), { now: NOW });
      expect(rows.errors[0]).toMatchObject({ error_source: null, handled: null });
    }
  });

  it("env et service : scrubbés, refusés si contrôle ou trop longs", () => {
    expect(erreurUnique({}, { "deployment.environment.name": "prod jean@client.fr", "service.name": "api jean@client.fr" }))
      .toMatchObject({ env: "prod [email]", service: "api [email]" });
    expect(erreurUnique({}, {
      "deployment.environment.name": `pr${String.fromCharCode(27)}od`,
      "service.name": "s".repeat(121),
    })).toMatchObject({ env: null, service: null });
    expect(erreurUnique({}, { "deployment.environment.name": 3 })).toMatchObject({ env: null });
  });

  it("kind : un mot court est gardé à l'octet près, tout texte libre redevient « error »", () => {
    expect(erreurUnique({ attrs: { "mip.error_kind": "Chunk_Load.v2" } }).kind).toBe("Chunk_Load.v2");
    for (const hostile of ["error; drop table rum_error", "a".repeat(41), "1error", "", 42, true]) {
      expect(erreurUnique({ attrs: { "mip.error_kind": hostile } }).kind).toBe("error");
    }
  });

  it("lineno/colno : entier int4 positif ou chaîne décimale, sinon NULL", () => {
    const position = (value: unknown) => erreurUnique({ attrs: { "mip.error_lineno": value, "mip.error_colno": value } });
    expect(position(42)).toMatchObject({ lineno: 42, colno: 42 });
    expect(position("42")).toMatchObject({ lineno: 42, colno: 42 });
    expect(position(2_147_483_647)).toMatchObject({ lineno: 2_147_483_647 });
    for (const hostile of ["12.5", 12.5, "1e21", 1e21, true, -1, "-1", 2_147_483_648, " 42", ""]) {
      expect(position(hostile)).toMatchObject({ lineno: null, colno: null });
    }
    // Sans attribut, rien n'est inventé.
    expect(erreurUnique({})).toMatchObject({ lineno: null, colno: null });
  });

  it("error_type : borné à 200 caractères, NULL s'il n'est pas un texte", () => {
    expect((erreurUnique({ attrs: { "exception.type": "E".repeat(5_000) } }).error_type as string)).toHaveLength(200);
    expect(erreurUnique({ attrs: { "exception.type": 404 } }).error_type).toBeNull();
  });
});

describe("flattenOtlp — NUL : remplacé partout, lot jamais perdu", () => {
  it("message V8, type, stack, route et contexte échappé ne portent plus de NUL", () => {
    let messageV8 = "";
    try {
      JSON.parse(`${NUL}{}`);
    } catch (error) {
      messageV8 = (error as Error).message;
    }
    // Précondition : V8 recopie bien l'entrée fautive, NUL compris.
    expect(messageV8).toContain(NUL);

    const rows = flattenOtlp(payload({
      spans: [{
        traceId: TRACE,
        attrs: {
          "exception.message": messageV8,
          "exception.type": `Syntax${NUL}Error`,
          "exception.stacktrace": `SyntaxError\n    at lire (https://app.test/a.js:1:2)${NUL}`,
          "mip.route": `/panier${NUL}`,
          // JSON.stringify échappe le NUL : l'attribut n'en contient pas, mais
          // JSON.parse le fait renaître dans la valeur ET dans la clé.
          "mip.context": JSON.stringify({ note: `a${NUL}b`, [`cl${NUL}e`]: "v" }),
        },
      }],
    }), { now: NOW });
    expect(rows.rejected).toBe(0);
    const [row] = rows.errors as Row[];
    expect(contientNul(rows)).toBe(false);
    expect(row.error_type).toBe(`Syntax${REMPLACEMENT}Error`);
    expect(row.message).toContain(REMPLACEMENT);
    expect(row.route).toBe(`/panier${REMPLACEMENT}`);
    expect(row.context).toEqual({ note: `a${REMPLACEMENT}b`, [`cl${REMPLACEMENT}e`]: "v" });
    expect(row.fingerprint).toBe(errorFingerprint(row.error_type, row.message, row.stack));
    expect(contientNul(rows.eventIndex)).toBe(false);
  });

  it("un span dont le nom contient un NUL est rejeté, sans session ni ligne", () => {
    const rows = flattenOtlp(payload({
      spans: [{ name: `track.checkout${NUL}` }, { name: `exception${NUL}` }],
    }), { now: NOW });
    expect(rows.rejected).toBe(2);
    expect(rows.sessions).toEqual([]);
    expect(rows.events).toEqual([]);
    expect(rows.errors).toEqual([]);
  });

  it("props : une valeur échappée ne ressuscite pas le NUL", () => {
    const rows = flattenOtlp(payload({
      spans: [{ name: "track.checkout", attrs: { "mip.props": JSON.stringify({ note: `a${NUL}b` }) } }],
    }), { now: NOW });
    expect(rows.events[0].props).toEqual({ note: `a${REMPLACEMENT}b` });
  });
});

describe("contexte et props : un nombre à exposant ne gonfle plus jsonb::text", () => {
  it("contexte : 1e308, 1e21 et 1e-7 écartés, les nombres ordinaires gardés", () => {
    const row = erreurUnique({
      attrs: {
        "mip.context": JSON.stringify({
          grand: 1e308, seuil: 1e21, petit: 1e-7, ok: 1.5, entier: 42, millionieme: 0.000001,
          valeurs: [1e308, 3, -1e21],
        }),
      },
    });
    expect(row.context).toEqual({ ok: 1.5, entier: 42, millionieme: 0.000001, valeurs: [3] });
  });

  it("contexte de 120 × 1e308 : vidé de ses exposants au lieu de faire refuser le lot", () => {
    const row = erreurUnique({ attrs: { "mip.context": JSON.stringify({ valeurs: Array(120).fill(1e308), plan: "pro" }) } });
    expect(row.context).toEqual({ valeurs: [], plan: "pro" });
  });

  it("props : même règle", () => {
    const rows = flattenOtlp(payload({
      spans: [{ name: "track.checkout", attrs: { "mip.props": JSON.stringify({ montant: 1e308, quantite: 2, ratio: 1e-9 }) } }],
    }), { now: NOW });
    expect(rows.events[0].props).toEqual({ quantite: 2 });
  });
});

describe("regroupement inchangé", () => {
  it("une erreur navigateur ordinaire garde l'empreinte calculée avant P5.1", () => {
    const row = webException(WINDOW_ERROR);
    // Valeur produite par flattenOtlp au commit précédent sur ce même payload.
    expect(row.fingerprint).toBe("c8ccd93c");
    expect(row.fingerprint).toBe(errorFingerprint(
      WINDOW_ERROR["exception.type"], WINDOW_ERROR["exception.message"], WINDOW_ERROR["exception.stacktrace"],
    ));
  });
});

describe("writeRows — correspondance des colonnes rum_error", () => {
  const V68 = ["occurrences", "action_id"];
  const V69 = [
    ...V68, "trace_id", "source_parent_span_id", "error_source", "handled", "is_fatal", "context",
    "view_id", "view_name", "user_id_hash", "account_id_hash", "env", "service",
  ];

  /** `file` : lignes d'ingest_raw que le drain relira, une par sélection. */
  function fakePool(errorColumns: string[], file: Row[] = []) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns")) {
        return { rows: params[0] === "rum_error" ? errorColumns.map((column_name) => ({ column_name })) : [] };
      }
      if (sql.startsWith("select id, app_id, lot, tentatives from ingest_raw")) return { rows: file.splice(0, 1) };
      return { rows: [] };
    };
    return { calls, pool: { connect: async () => ({ query, release() {} }) } };
  }

  /** Relit les lignes de l'INSERT rum_error à partir de sa liste de colonnes. */
  function insertedErrors(calls: Array<{ sql: string; params: unknown[] }>): Row[] {
    const call = calls.find(({ sql }) => sql.startsWith("insert into rum_error"));
    if (!call) throw new Error("aucun insert rum_error");
    const columns = /^insert into rum_error \(([^)]*)\)/.exec(call.sql)![1].split(",");
    const rows: Row[] = [];
    for (let i = 0; i < call.params.length; i += columns.length) {
      rows.push(Object.fromEntries(columns.map((column, j) => [column, call.params[i + j]])));
    }
    return rows;
  }

  function lot(errors: Row[]) {
    return {
      sessions: [], pageviews: [], metrics: [], errors, resources: [], longtasks: [], breadcrumbs: [],
      events: [], spans: [], sviCalls: [], sviSteps: [], sviLegs: [],
    };
  }

  const recente = () => webException({ ...WINDOW_ERROR, "mip.context": JSON.stringify({ plan: "pro" }) });
  // Ligne d'un lot différé déposé AVANT P5.1 : relue depuis jsonb, sans aucun
  // champ d'enveloppe.
  const ancienne = (): Row => JSON.parse(JSON.stringify({
    span_id: "00000000000000e9", session_id: "session-web", app_id: "envelope-web", route: "/panier",
    occurrences: 3, kind: "error", message: "boom", error_type: "Error", stack: "", source: null,
    lineno: null, colno: null, release: null, fingerprint: "f", ts: new Date(NOW),
  }));

  beforeEach(() => _resetColonnesCache());

  it("sur v69 écrit chaque colonne, le contexte en JSON", async () => {
    const { calls, pool } = fakePool(V69);
    await writeRows(pool, lot([recente()]));
    const [nouvelle] = insertedErrors(calls);
    expect(Object.keys(nouvelle)).toEqual([
      "span_id", "session_id", "app_id", "route", "kind", "message", "error_type", "stack", "source",
      "lineno", "colno", "release", "fingerprint", ...V69, "ts",
    ]);
    expect(nouvelle).toMatchObject({
      trace_id: TRACE, source_parent_span_id: PARENT, error_source: "browser_js", handled: false,
      env: "production", context: JSON.stringify({ plan: "pro" }),
    });
  });

  it("un lot différé déposé avant P5.1 se draine sur v69 : NULL pour l'inconnu, '{}' pour le contexte", async () => {
    // Sans projection ni collection autre que ses erreurs : c'est `completer`
    // puis la correspondance de writeRows qui le rendent écrivable.
    const depose = { id: 1, app_id: "envelope-web", lot: { errors: [ancienne()] }, tentatives: 0 };
    const { calls, pool } = fakePool(V69, [depose]);
    expect(await drainerIngestRaw(pool, { log: { error() {} } })).toEqual({ drains: 1, echecs: 0 });
    const [historique] = insertedErrors(calls);
    expect(historique.context).toBe("{}");
    // pg envoie `undefined` comme NULL : l'inconnu reste inconnu.
    for (const column of V69.filter((c) => !["occurrences", "context"].includes(c))) {
      expect(historique[column] ?? null).toBeNull();
    }
    expect(historique.occurrences).toBe(3);
    expect(calls.some(({ sql, params }) => sql.startsWith("delete from ingest_raw") && params[0] === 1)).toBe(true);
  });

  it("sur v68 n'écrit aucune colonne v69 et conserve occurrences et action_id", async () => {
    const { calls, pool } = fakePool(V68);
    await writeRows(pool, lot([recente()]));
    const [ligne] = insertedErrors(calls);
    expect(Object.keys(ligne)).toEqual([
      "span_id", "session_id", "app_id", "route", "kind", "message", "error_type", "stack", "source",
      "lineno", "colno", "release", "fingerprint", "occurrences", "action_id", "ts",
    ]);
    expect(calls.map(({ sql }) => sql).at(-1)).toBe("commit");
  });
});
