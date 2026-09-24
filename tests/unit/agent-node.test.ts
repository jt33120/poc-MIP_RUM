// PR1 — agent Node zéro-config. On vérifie la config par env, le templating de
// route, et surtout le ROUND-TRIP : la charge OTLP produite par l'agent est
// ingérée par flattenOtlp comme un span `back` (http.server) corrélable.
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  boundedObject,
  buildConfig,
  buildDbSpan,
  buildHttpServerSpan,
  buildLogPayload,
  buildLogRecord,
  buildPayload,
  buildTrackSpan,
  describeError,
  describeThrown,
  type ExceptionInput,
  normalizeRoute,
  normalizeSql,
  parseTraceparent,
  positiveNumber,
  sqlOperation,
  validateGlobalContext,
  validateRequestContext,
} from "../../packages/agent-node/src/core";
import { flattenOtlp, flattenOtlpLogs } from "../../packages/backend/shared/otlp.mjs";

describe("agent-node — config", () => {
  it("désactivé sans endpoint/app_id", () => {
    expect(buildConfig({}).enabled).toBe(false);
    expect(buildConfig({ MIP_RUM_ENDPOINT: "x" }).enabled).toBe(false);
  });
  it("actif + valeurs par défaut", () => {
    const c = buildConfig({ MIP_RUM_ENDPOINT: "https://i/v1/traces", MIP_RUM_APP_ID: "demo" });
    expect(c.enabled).toBe(true);
    expect(c.env).toBe("prod");
    expect(c.service).toBe("backend");
    expect(c.apiKey).toBeNull();
  });
});

describe("agent-node — normalizeRoute", () => {
  it("templatise ids numériques / uuid / hex longs", () => {
    expect(normalizeRoute("/users/42/orders/7")).toBe("/users/:id/orders/:id");
    expect(normalizeRoute("/o/9f1c8e2a4b6d0f3a9f1c8e2a4b6d0f3a")).toBe("/o/:id");
    expect(normalizeRoute("/api/search?q=x")).toBe("/api/search");
  });
});

describe("agent-node — round-trip OTLP -> flattenOtlp (span back)", () => {
  const cfg = buildConfig({
    MIP_RUM_ENDPOINT: "https://i/v1/traces",
    MIP_RUM_APP_ID: "demo",
    MIP_RUM_API_KEY: "mip_key_123",
  });
  const tp = parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")!;
  const span = buildHttpServerSpan({
    traceId: tp.traceId,
    spanId: "00aa11bb22cc33dd",
    parentSpanId: tp.spanId,
    method: "GET",
    route: "/api/search",
    url: null,
    status: 200,
    sessionId: "sess-9",
    startMs: 1_760_000_000_000,
    durationMs: 118,
  });
  const rows = flattenOtlp(buildPayload(cfg, [span]));

  it("est ingéré comme un span serveur (back) corrélé", () => {
    expect(rows.spans).toHaveLength(1);
    const s = rows.spans[0];
    expect(s.tier).toBe("back");
    expect(s.trace_id).toBe(tp.traceId); // corrélation avec le front navigateur
    expect(s.parent_span_id).toBe(tp.spanId);
    expect(s.route).toBe("/api/search");
    expect(s.status_code).toBe(200);
    expect(s.duration_ms).toBe(118);
    expect(s.session_id).toBe("sess-9");
    expect(rows.rejected).toBe(0);
    expect(rows.apiKeys[0]).toEqual({ app_id: "demo", api_key: "mip_key_123" });
  });
});

describe("agent-node — normalizeSql / sqlOperation (profondeur DB #20)", () => {
  it("remplace littéraux chaîne et nombres par ? (cardinalité + anti-PII)", () => {
    expect(normalizeSql("SELECT * FROM users WHERE email = 'a@b.co' AND id = 42")).toBe(
      "SELECT * FROM users WHERE email = ? AND id = ?",
    );
  });
  it("extrait le verbe SQL en tête", () => {
    expect(sqlOperation("  select 1")).toBe("SELECT");
    expect(sqlOperation("INSERT INTO t values (1)")).toBe("INSERT");
    expect(sqlOperation("vacuum analyze")).toBeNull();
  });
});

describe("agent-node — round-trip DB span (tier detail/db) enfant du http.server", () => {
  const cfg = buildConfig({ MIP_RUM_ENDPOINT: "https://i/v1/traces", MIP_RUM_APP_ID: "demo" });
  const traceId = "0af7651916cd43dd8448eb211c80319c";
  const httpSpanId = "00aa11bb22cc33dd";
  const http = buildHttpServerSpan({
    traceId,
    spanId: httpSpanId,
    parentSpanId: null,
    method: "GET",
    route: "/api/x",
    url: null,
    status: 200,
    sessionId: null,
    startMs: 1_760_000_000_000,
    durationMs: 50,
  });
  const db = buildDbSpan({
    traceId,
    spanId: "dddd1111eeee2222",
    parentSpanId: httpSpanId,
    system: "postgresql",
    statement: "SELECT * FROM users WHERE id = ?",
    operation: "SELECT",
    startMs: 1_760_000_000_010,
    durationMs: 7,
  });
  const rows = flattenOtlp(buildPayload(cfg, [http, db]));

  it("produit un span detail/db corrélé au http.server parent", () => {
    expect(rows.rejected).toBe(0);
    const dbRow = rows.spans.find((s: { tier: string }) => s.tier === "detail");
    expect(dbRow).toBeTruthy();
    expect(dbRow.kind).toBe("db");
    expect(dbRow.trace_id).toBe(traceId);
    expect(dbRow.parent_span_id).toBe(httpSpanId); // enfant du http.server
    expect(dbRow.method).toBe("SELECT");
    expect(dbRow.route).toBe("postgresql");
    expect(dbRow.name).toContain("SELECT * FROM users");
    expect(dbRow.duration_ms).toBe(7);
    expect(dbRow.session_id).toBeNull(); // spans back "detail" ne portent pas de session
  });
});

// ─────────────────────────── P5.3 : exceptions ───────────────────────────────

describe("agent-node — extraction d'une Error", () => {
  it("garde type, message et STACK, y compris pour une Error d'un autre realm", () => {
    const locale = describeError(new TypeError("total indéfini"));
    expect(locale).toMatchObject({ type: "TypeError", message: "total indéfini" });
    expect(locale?.stack).toContain("TypeError: total indéfini");
    // `instanceof Error` est faux ici : c'est ce qui faisait sérialiser `{}`.
    const autreRealm = runInNewContext("new RangeError('hors limites')");
    expect(autreRealm instanceof Error).toBe(false);
    expect(describeError(autreRealm)).toMatchObject({ type: "RangeError", message: "hors limites" });
    class PaiementRefuse extends Error {
      name = "PaiementRefuse";
    }
    expect(describeError(new PaiementRefuse("carte"))?.type).toBe("PaiementRefuse");
  });

  it("accepte une valeur qui a message et stack, refuse le reste, ne lève jamais", () => {
    expect(describeError({ message: "m", stack: "Error: m\n    at f (a.js:1:1)" })).toMatchObject({ type: "Object", message: "m" });
    for (const valeur of [null, undefined, "texte", 42, { message: "sans stack" }, [1, 2]]) {
      expect(describeError(valeur)).toBeNull();
    }
    const hostile = new Error("x");
    Object.defineProperty(hostile, "name", { get() { throw new Error("piège"); } });
    Object.defineProperty(hostile, "stack", { get() { throw new Error("piège"); } });
    expect(describeError(hostile)).toEqual({ type: "Error", message: "x", stack: null });
  });

  it("borne ce qui part, largement au-dessus de ce que l'ingestion garde", () => {
    const e = new Error("m".repeat(20_000));
    e.stack = "s".repeat(40_000);
    expect(describeError(e)).toMatchObject({ message: "m".repeat(8_000), stack: "s".repeat(16_000) });
  });

  it("une valeur levée qui n'est pas une Error garde son texte, sans type ni stack inventés", () => {
    expect(describeThrown("boom")).toEqual({ type: null, message: "boom", stack: null });
    expect(describeThrown({ code: 42 })).toEqual({ type: null, message: '{"code":42}', stack: null });
    expect(describeThrown(undefined)).toEqual({ type: null, message: "undefined", stack: null });
    expect(describeThrown(10n)).toEqual({ type: null, message: "valeur illisible", stack: null });
  });
});

describe("agent-node — exceptions en span et en log, round-trip ingestion", () => {
  const cfg = buildConfig({ MIP_RUM_ENDPOINT: "https://i/v1/traces", MIP_RUM_APP_ID: "demo", MIP_RUM_SERVICE: "api" });
  const traceId = "0af7651916cd43dd8448eb211c80319c";
  const spanId = "00aa11bb22cc33dd";
  const exception: ExceptionInput = {
    error: { type: "TypeError", message: "total indéfini", stack: "TypeError: total indéfini\n    at payer (/srv/app.js:10:5)" },
    tsMs: Date.now() - 1_000,
    exceptionId: "0123456789abcdef0123456789abcdef",
    handled: false,
    fatal: true,
  };
  const span = buildHttpServerSpan({
    traceId, spanId, parentSpanId: null, method: "POST", route: "/api/pay", url: null,
    status: null, sessionId: null, startMs: Date.now() - 2_000, durationMs: 5, exceptions: [exception],
  });

  it("le span porte l'événement `exception`, le statut ERROR et `error.type`, sans statut HTTP inventé", () => {
    expect(span.status).toEqual({ code: 2 });
    const events = span.events as Array<{ name: string; attributes: Array<{ key: string; value: Record<string, unknown> }> }>;
    expect(events.map((e) => e.name)).toEqual(["exception"]);
    const attrs = Object.fromEntries(events[0].attributes.map((a) => [a.key, a.value]));
    expect(attrs).toEqual({
      "exception.type": { stringValue: "TypeError" },
      "exception.message": { stringValue: "total indéfini" },
      "exception.stacktrace": { stringValue: exception.error.stack },
      "mip.exception_id": { stringValue: exception.exceptionId },
      "mip.error_handled": { boolValue: false },
      "mip.error_fatal": { boolValue: true },
    });
    const keys = (span.attributes as Array<{ key: string }>).map((a) => a.key);
    expect(keys).toContain("error.type");
    expect(keys).not.toContain("http.status_code");
  });

  it("sans exception, le span reste celui d'avant P5.3", () => {
    const ordinaire = buildHttpServerSpan({
      traceId, spanId, parentSpanId: null, method: "GET", route: "/", url: null,
      status: 200, sessionId: null, startMs: Date.now(), durationMs: 1,
    });
    expect(ordinaire.status).toEqual({ code: 1 });
    expect(ordinaire).not.toHaveProperty("events");
    expect((ordinaire.attributes as Array<{ key: string }>).map((a) => a.key)).not.toContain("error.type");
  });

  it("span et log de la même Error : deux lignes dérivées, une seule identité", () => {
    const traces = flattenOtlp(buildPayload(cfg, [span]));
    const logs = flattenOtlpLogs(buildLogPayload(cfg, [buildLogRecord({
      level: "error", body: "TypeError: total indéfini", tsMs: Date.now(), traceId, spanId,
      sessionId: null, route: "/api/pay", exception,
    })]));
    expect(traces.spans).toHaveLength(1);
    expect(traces.errors).toHaveLength(1);
    expect(logs.errors).toHaveLength(1);
    expect(traces.errors[0]).toMatchObject({
      origin_signal: "span_event", error_source: "node", service: "api", env: "prod",
      trace_id: traceId, source_parent_span_id: spanId, handled: false, is_fatal: true,
      exception_id: exception.exceptionId, session_id: null, route: "/api/pay",
    });
    expect(logs.errors[0]).toMatchObject({ origin_signal: "log", error_source: "node", trace_id: traceId });
    expect(logs.errors[0].span_id).toBe(traces.errors[0].span_id);
  });

  it("un log sans exception reste un log, même en ERROR", () => {
    const logs = flattenOtlpLogs(buildLogPayload(cfg, [buildLogRecord({
      level: "error", body: "paiement refusé", tsMs: Date.now(), traceId, spanId, sessionId: null, route: null,
    })]));
    expect(logs.logs).toHaveLength(1);
    expect(logs.errors).toEqual([]);
  });
});

// ─────────────────── P7.4 : configuration, contexte, événements ───────────────

describe("agent-node — configuration bornée", () => {
  it("une variable absente ou vide garde le DÉFAUT, jamais zéro", () => {
    // `Number("")` vaut 0 : lu naïvement, une variable absente aurait supprimé
    // le timer de flush et réduit le budget d'envoi à 1 ms.
    expect(positiveNumber(undefined, 3000, 300_000)).toBe(3000);
    expect(positiveNumber("", 3000, 300_000)).toBe(3000);
    expect(positiveNumber("   ", 3000, 300_000)).toBe(3000);
    expect(positiveNumber("abc", 3000, 300_000)).toBe(3000);
    expect(positiveNumber("-5", 3000, 300_000)).toBe(3000);
    // Zéro reste valide quand il est réellement écrit (aucun timer périodique).
    expect(positiveNumber("0", 3000, 300_000)).toBe(0);
    expect(positiveNumber("9999999", 3000, 300_000)).toBe(300_000);
  });

  it("les défauts d'un agent de supervision restent modestes", () => {
    const c = buildConfig({ MIP_RUM_ENDPOINT: "https://i/v1/traces", MIP_RUM_APP_ID: "demo" });
    expect(c.flushMs).toBe(3000);
    expect(c.maxQueue).toBe(1000);
    expect(c.logs).toBe(true);
    expect(c.logLevel).toBe("warn");
    expect(c.logsEndpoint).toBe("https://i/v1/logs");
    // Très en deçà du sursis d'arrêt usuel (10 s Docker/Kubernetes).
    expect(c.shutdownTimeoutMs).toBe(2000);
  });
});

describe("agent-node — validation du contexte de requête", () => {
  it("un traceparent valide rattache, un traceparent hostile ne rattache RIEN", () => {
    const valide = validateRequestContext({ traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" });
    expect(valide.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(valide.parentSpanId).toBe("b7ad6b7169203331");
    for (const hostile of ["", "00-zz-zz-01", `00-${"0".repeat(32)}-b7ad6b7169203331-01`, "n'importe quoi"]) {
      const patch = validateRequestContext({ traceparent: hostile });
      expect(patch.traceId).toBeNull();
      expect(patch.parentSpanId).toBeNull();
    }
  });

  it("un parent sans trace n'est pas conservé : il rattacherait à un arbre inconnu", () => {
    expect(validateRequestContext({ parentSpanId: "b7ad6b7169203331" }).parentSpanId).toBeNull();
  });

  it("session, route et identités : validées ou nulles, jamais devinées", () => {
    const patch = validateRequestContext({
      sessionId: "sess-1234",
      route: "/users/42/orders/7?token=x",
      userId: "u-9",
      accountId: "acct-1",
      attributes: { plan: "pro", essais: 3, actif: true, inconnu: null, rejete: () => 1 },
    });
    expect(patch.sessionId).toBe("sess-1234");
    expect(patch.route).toBe("/users/:id/orders/:id");
    expect(patch.userId).toBe("u-9");
    expect(patch.accountId).toBe("acct-1");
    // `null` reste `null` : une donnée déclarée inconnue ne devient pas 0 ni "".
    expect(patch.attributes).toEqual({ plan: "pro", essais: 3, actif: true, inconnu: null });
    expect(validateRequestContext({ sessionId: "sess 1234!" }).sessionId).toBeNull();
    expect(validateRequestContext(null).attributes).toEqual({});
    expect(validateRequestContext(undefined).traceId).toBeNull();
  });

  it("un objet cyclique ou d'un type illisible ne fait jamais lever l'agent", () => {
    const cycle: Record<string, unknown> = { a: 1 };
    cycle.moi = cycle;
    // La profondeur est bornée : le cycle s'arrête, il ne déborde pas la pile.
    const borne = boundedObject(cycle, 16 * 1024) as Record<string, unknown>;
    expect(borne.a).toBe(1);
    let niveau: unknown = borne;
    let profondeur = 0;
    while (niveau && typeof niveau === "object" && "moi" in (niveau as Record<string, unknown>)) {
      niveau = (niveau as Record<string, unknown>).moi;
      profondeur++;
    }
    expect(profondeur).toBeLessThanOrEqual(4);
    expect(boundedObject("texte", 1024)).toEqual({});
    expect(boundedObject([1, 2], 1024)).toEqual({});
  });
});

describe("agent-node — contexte GLOBAL réservé au service", () => {
  it("accepte des attributs de service stables", () => {
    expect(validateGlobalContext({ region: "eu-west-3", instance: "api-7" })).toEqual({
      region: "eu-west-3",
      instance: "api-7",
    });
  });

  it("refuse EN BLOC toute clé qui varie par requête", () => {
    // Un identifiant posé ici serait attribué à toutes les requêtes suivantes,
    // y compris celles d'autres personnes.
    for (const cle of ["user_id", "userId", "account", "client_id", "session", "visitor_id", "tenant", "email", "ip"]) {
      expect(validateGlobalContext({ region: "eu", [cle]: "x" })).toBeNull();
    }
    expect(validateGlobalContext("texte")).toBeNull();
  });
});

describe("agent-node — événement métier track (round-trip ingestion)", () => {
  const cfgTrack = buildConfig({ MIP_RUM_ENDPOINT: "https://i/v1/traces", MIP_RUM_APP_ID: "demo", MIP_RUM_SERVICE: "api" });
  const trace = "0af7651916cd43dd8448eb211c80319c";

  it("sans session (émetteur backend) : événement écrit, session NULL, jamais inventée", () => {
    const span = buildTrackSpan({
      name: "commande_validee",
      props: { montant: 42.5, devise: "EUR" },
      traceId: trace,
      spanId: "aaaa1111bbbb2222",
      parentSpanId: "00aa11bb22cc33dd",
      sessionId: null,
      route: "/api/commandes",
      attributes: { canal: "batch" },
      tsMs: 1_760_000_000_000,
    });
    const rows = flattenOtlp(buildPayload(cfgTrack, [span]));
    expect(rows.rejected).toBe(0);
    // Surtout PAS un faux span de détail : c'est un événement.
    expect(rows.spans).toEqual([]);
    expect(rows.events).toHaveLength(1);
    expect(rows.events[0]).toMatchObject({
      span_id: "aaaa1111bbbb2222",
      session_id: null,
      app_id: "demo",
      name: "commande_validee",
      route: "/api/commandes",
      event_type: "custom",
      props: { montant: 42.5, devise: "EUR" },
      service: "api",
    });
    expect(rows.events[0].context).toEqual({ canal: "batch" });
  });

  // Un événement QUI PORTE une session suit le chemin historique du SDK web :
  // c'est lui qui écrit aussi la ligne `rum_session` du lot, sans laquelle
  // l'insertion violerait `rum_event_session_id_fkey`. L'agent Node n'en émet
  // donc jamais — le front reste seul maître de la session.
  it("avec session déclarée : chemin historique, session du lot écrite avec", () => {
    const span = buildTrackSpan({
      name: "commande_validee",
      props: {},
      traceId: trace,
      spanId: "cccc3333dddd4444",
      parentSpanId: null,
      sessionId: "sess-9",
      route: "/api/commandes",
      tsMs: 1_760_000_000_000,
    });
    const rows = flattenOtlp(buildPayload(cfgTrack, [span]));
    expect(rows.rejected).toBe(0);
    expect(rows.events[0]).toMatchObject({ session_id: "sess-9", name: "commande_validee" });
    // Dimensions de session (env/release), sans `service` : celles du SDK web.
    expect(rows.events[0].service).toBeUndefined();
    // La ligne de session part dans le MÊME lot : c'est ce qui rend la clé
    // étrangère de rum_event satisfaisable.
    expect(rows.sessions.map((s: { session_id: string }) => s.session_id)).toEqual(["sess-9"]);
  });

  it("l'identité métier part BRUTE : le hash app-scopé reste au port serveur", () => {
    const span = buildTrackSpan({
      name: "paiement",
      props: {},
      traceId: trace,
      spanId: "eeee5555ffff6666",
      parentSpanId: null,
      sessionId: null,
      route: null,
      userId: "u-9",
      tsMs: 1_760_000_000_000,
    });
    const cles = (span.attributes as Array<{ key: string }>).map((a) => a.key);
    expect(cles).toContain("mip.identity.user_id");
    expect(cles).not.toContain("mip.user_id_hash");
    expect(cles).not.toContain("mip.user_hash");
  });
});

describe("agent-node — une exception capturée puis traitée n'est pas une requête en échec", () => {
  const base = {
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "00aa11bb22cc33dd",
    parentSpanId: null,
    method: "POST",
    route: "/api/pay",
    url: null,
    sessionId: null,
    startMs: 1_760_000_000_000,
    durationMs: 12,
  };
  const exception = (handled: boolean | null): ExceptionInput => ({
    error: { type: "PaiementRefuse", message: "carte", stack: "PaiementRefuse: carte" },
    tsMs: 1_760_000_000_001,
    exceptionId: "0123456789abcdef0123456789abcdef",
    handled,
    fatal: null,
  });
  const lireAttrs = (span: Record<string, unknown>) =>
    Object.fromEntries(
      (span.attributes as Array<{ key: string; value: Record<string, unknown> }>).map((a) => [a.key, Object.values(a.value)[0]]),
    );

  it("handled: true -> statut réel conservé, mais l'erreur part quand même", () => {
    const span = buildHttpServerSpan({ ...base, status: 200, exceptions: [exception(true)] });
    expect(span.status).toEqual({ code: 1 });
    expect((span.events as unknown[]).length).toBe(1);
    expect(Object.keys(lireAttrs(span))).not.toContain("error.type");
  });

  it("handled: false -> échec, quel que soit le statut déjà envoyé", () => {
    const span = buildHttpServerSpan({ ...base, status: 200, exceptions: [exception(true), exception(false)] });
    expect(span.status).toEqual({ code: 2 });
    expect(lireAttrs(span)["error.type"]).toBe("PaiementRefuse");
  });

  it("le contexte du scope voyage en `mip.context` du span porteur", () => {
    const span = buildHttpServerSpan({ ...base, status: 500, attributes: { canal: "web" }, userId: "u-9" });
    const attrs = lireAttrs(span);
    expect(JSON.parse(String(attrs["mip.context"]))).toEqual({ canal: "web" });
    expect(attrs["mip.identity.user_id"]).toBe("u-9");
  });
});
