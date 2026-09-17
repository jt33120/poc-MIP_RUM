// Runtime de l'agent (préchargé via `node -r @mip/agent-node/register`). Patche
// http.Server / https.Server pour émettre un span `http.server` par requête, et
// instrumente le client `pg` (node-postgres) pour émettre un span DB enfant par
// requête SQL — aucun changement de code dans l'app. Le lien parent/enfant passe
// par un contexte de requête (AsyncLocalStorage). Best-effort : jamais bloquant.
// P5.3 : les exceptions (levées par un gestionnaire de requête, non interceptées,
// journalisées avec console.error) partent avec leur stack, sans jamais changer le
// sort de l'application.
// Construit par esbuild (dist/register.js, CJS) ; la logique pure vit dans core.ts.
import { randomBytes } from "node:crypto";
import httpMod from "node:http";
import httpsMod from "node:https";
import { AsyncLocalStorage } from "node:async_hooks";
import Module from "node:module";
import {
  type AgentConfig,
  buildConfig,
  buildDbSpan,
  buildHttpServerSpan,
  buildLogPayload,
  buildLogRecord,
  buildPayload,
  describeError,
  describeThrown,
  type ExceptionInput,
  type LogLevel,
  logsEndpoint,
  normalizeRoute,
  normalizeSql,
  parseTraceparent,
  passesLevel,
  resolveLogLevel,
  SEVERITY,
  sessionFromTracestate,
  sqlOperation,
} from "./core";

const cfg: AgentConfig = buildConfig(process.env);

const hex = (n: number): string => randomBytes(n).toString("hex");
const header = (v: string | string[] | undefined): string | null =>
  (Array.isArray(v) ? v[0] : v) ?? null;

// Contexte de requête : identité du span http.server courant, pour rattacher les
// spans enfants (DB) au bon parent, dans la même trace.
interface ReqCtx {
  traceId: string;
  spanId: string;
  sessionId: string | null;
  route: string | null;
  /** Exceptions de la requête, émises avec son span http.server. */
  exceptions: ExceptionInput[];
  /** Émet le span http.server, une seule fois. */
  emettre: (fin: "reponse" | "fermeture" | "fatale") => void;
}
const als = new AsyncLocalStorage<ReqCtx>();

const buffer: Record<string, unknown>[] = [];
const FLUSH_MS = Number(process.env.MIP_RUM_FLUSH_MS ?? 3000);
const MAX_BATCH = 128;

async function flush(): Promise<void> {
  if (!buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await fetch(cfg.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload(cfg, batch)),
    });
  } catch {
    /* best-effort : un lot perdu n'impacte jamais l'app instrumentée */
  }
}

function enqueue(span: Record<string, unknown>): void {
  buffer.push(span);
  if (buffer.length >= MAX_BATCH) void flush();
}

// Prépare le contexte + programme l'émission du span http.server à la fin de la
// réponse. Renvoie le contexte à propager (ALS) pendant le traitement.
function onRequest(req: any, res: any): ReqCtx {
  const start = Date.now();
  const tp = parseTraceparent(header(req?.headers?.traceparent));
  const traceId = tp?.traceId ?? hex(16);
  const parentSpanId = tp?.spanId ?? null;
  const spanId = hex(8); // identité du span http.server (parent des spans DB)
  const sessionId = sessionFromTracestate(header(req?.headers?.tracestate));
  const route = normalizeRoute(String(req?.url ?? "/"));
  let emis = false;
  const ctx: ReqCtx = {
    traceId,
    spanId,
    sessionId,
    route,
    exceptions: [],
    emettre(fin) {
      // Sans réponse complète, seul un span porteur d'exception est émis : une
      // requête simplement abandonnée par le client n'en produisait pas.
      if (emis || (fin !== "reponse" && !ctx.exceptions.length)) return;
      emis = true;
      try {
        enqueue(
          buildHttpServerSpan({
            traceId,
            spanId,
            parentSpanId,
            method: String(req?.method ?? "GET"),
            route,
            url: null,
            // Aucun en-tête parti : il n'existe pas de statut, pas même un 500.
            status: fin === "reponse" || res?.headersSent ? Number(res?.statusCode ?? 0) : null,
            sessionId,
            startMs: start,
            durationMs: Date.now() - start,
            exceptions: ctx.exceptions,
          }),
        );
      } catch {
        /* ignore */
      }
    },
  };
  res?.on?.("finish", () => ctx.emettre("reponse"));
  res?.on?.("close", () => ctx.emettre("fermeture"));
  return ctx;
}

function patch(mod: any): void {
  const proto = mod?.Server?.prototype;
  if (!proto || proto.__mipPatched) return;
  const origEmit = proto.emit;
  proto.emit = function (this: unknown, event: string, ...args: unknown[]) {
    if (event === "request") {
      let ctx: ReqCtx | null = null;
      try {
        ctx = onRequest(args[0], args[1]);
      } catch {
        /* ne jamais casser le serveur */
      }
      // Le traitement de la requête (et ses appels DB asynchrones) tourne dans
      // le contexte ALS -> les spans DB retrouvent leur parent http.server.
      if (ctx) {
        const courant = ctx;
        let termine = false;
        try {
          const retour = als.run(courant, () => origEmit.call(this, event, ...args));
          termine = true;
          return retour;
        } finally {
          // Pas de `catch` : l'exception d'un gestionnaire poursuit son chemin
          // intacte, sans relance qui déplacerait le message de crash de Node
          // vers ce fichier. Le moniteur la recevra avec ce contexte.
          if (!termine) requeteInterrompue(courant);
        }
      }
    }
    return origEmit.call(this, event, ...args);
  };
  proto.__mipPatched = true;
}

// --- exceptions (P5.3) ---------------------------------------------------------
// Trois voies, un même identifiant : l'exception levée par un gestionnaire de
// requête, l'exception non interceptée du processus, et `console.error(err)`. Une
// même Error vue deux fois (journalisée puis relancée) garde son
// `mip.exception_id`, et l'ingestion n'en écrit qu'une ligne.
//
// AUCUN handler `uncaughtException` ni `unhandledRejection` : en poser un
// transformerait un crash en processus survivant. `uncaughtExceptionMonitor`
// OBSERVE sans rien décider : Node termine le processus comme sans l'agent, avec
// le même code de sortie.
//
// BEST-EFFORT ASSUMÉ. Une fermeture fatale ne laisse pas le temps d'un dernier
// envoi réseau : le lot est tenté, rien ne garantit qu'il parte. Un tampon
// durable relève de P7/P8.
const identifiants = new WeakMap<object, string>();

function exceptionIdPour(valeur: unknown): string {
  if (valeur === null || (typeof valeur !== "object" && typeof valeur !== "function")) return hex(16);
  let id = identifiants.get(valeur);
  if (!id) {
    id = hex(16);
    identifiants.set(valeur, id);
  }
  return id;
}

/**
 * Requête dont le gestionnaire vient de lever. En sortant de `als.run`, le
 * contexte n'est plus actif : si personne n'intercepte l'exception, le moniteur
 * la reçoit dans la foulée, avant toute autre tâche, et la rattache à ce contexte.
 */
let interrompue: ReqCtx | null = null;

function requeteInterrompue(ctx: ReqCtx): void {
  interrompue = ctx;
  // Interceptée plus haut, l'exception ne reviendra jamais au moniteur : le
  // contexte ne doit pas survivre pour être prêté à une exception ultérieure.
  setImmediate(() => {
    if (interrompue === ctx) interrompue = null;
  }).unref();
}

function surveillerExceptions(): void {
  process.on("uncaughtExceptionMonitor", (err: unknown) => {
    try {
      // Sans handler applicatif, Node termine le processus juste après ce moniteur.
      const fatale =
        process.listenerCount("uncaughtException") === 0 && !process.hasUncaughtExceptionCaptureCallback();
      const ctx = interrompue ?? als.getStore();
      interrompue = null;
      const exception: ExceptionInput = {
        error: describeThrown(err),
        tsMs: Date.now(),
        exceptionId: exceptionIdPour(err),
        handled: false,
        fatal: fatale ? true : null,
      };
      if (ctx) ctx.exceptions.push(exception);
      else if (LOGS_ENABLED) journaliserException(fatale ? "fatal" : "error", exception);
      if (fatale) {
        // Le processus ne répondra plus : le span part maintenant ou jamais.
        ctx?.emettre("fatale");
        void flush();
        if (LOGS_ENABLED) void flushLogs();
      }
    } catch {
      /* ignore */
    }
  });
}

// --- pont de journalisation (signal LOGS) ------------------------------------
// Capture console.* et l'exporte en OTLP vers /v1/logs, en injectant le contexte
// de la requête courante. C'est là tout l'intérêt de le faire dans l'agent : le
// trace_id, le span_id, la session et la route sont déjà dans l'ALS, donc chaque
// log part corrélé à sa trace SANS que l'application change une ligne.
//
// Choix de conception :
//   • plancher `warn` par défaut (MIP_RUM_LOG_LEVEL) — un agent de supervision
//     ne doit pas doubler par défaut le volume de journaux de l'application ;
//   • console.* d'origine TOUJOURS appelée en premier : si le pont casse, les
//     logs de l'app sortent quand même ;
//   • garde de ré-entrance : nos propres écritures ne se ré-alimentent pas ;
//   • désactivable d'un cran : MIP_RUM_LOGS=false.
const LOGS_ENABLED = (process.env.MIP_RUM_LOGS ?? "true") !== "false";
const LOG_FLOOR = resolveLogLevel(process.env.MIP_RUM_LOG_LEVEL);
const LOG_ENDPOINT = logsEndpoint(cfg.endpoint, process.env.MIP_RUM_LOGS_ENDPOINT);
const MAX_LOG_BATCH = 128;
const logBuffer: Record<string, unknown>[] = [];
let inBridge = false; // garde de ré-entrance

async function flushLogs(): Promise<void> {
  if (!logBuffer.length) return;
  const batch = logBuffer.splice(0, logBuffer.length);
  try {
    await fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildLogPayload(cfg, batch)),
    });
  } catch {
    /* best-effort : un lot de logs perdu n'impacte jamais l'app instrumentée */
  }
}

/** Arguments console -> une ligne de texte (les objets sont sérialisés). */
function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      // La stack ne va pas dans le corps : elle voyage en `exception.stacktrace`.
      const erreur = describeError(a);
      if (erreur) return erreur.type ? `${erreur.type}: ${erreur.message}` : erreur.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

/**
 * Exception structurée d'un `console.error(…, err)` : la première Error passée.
 * Du texte seul reste un log — « texte » n'est pas une exception —, et un
 * avertissement n'entre pas dans le suivi d'erreurs.
 */
function exceptionJournalisee(level: LogLevel, args: unknown[], tsMs: number): ExceptionInput | null {
  if (SEVERITY[level] < SEVERITY.error) return null;
  for (const arg of args) {
    const error = describeError(arg);
    // `handled` reste inconnu : journaliser une Error ne dit pas si elle est relancée.
    if (error) return { error, tsMs, exceptionId: exceptionIdPour(arg), handled: null, fatal: null };
  }
  return null;
}

/** Log d'une exception non interceptée survenue hors de toute requête. */
function journaliserException(level: LogLevel, exception: ExceptionInput): void {
  if (!passesLevel(level, LOG_FLOOR)) return;
  const { type, message } = exception.error;
  logBuffer.push(
    buildLogRecord({
      level,
      body: type ? `${type}: ${message}` : message,
      tsMs: exception.tsMs,
      traceId: null,
      spanId: null,
      sessionId: null,
      route: null,
      exception,
    }),
  );
}

function captureLog(level: LogLevel, args: unknown[]): void {
  if (inBridge || !passesLevel(level, LOG_FLOOR)) return;
  inBridge = true;
  try {
    const ctx = als.getStore();
    const body = formatArgs(args);
    if (!body) return;
    const tsMs = Date.now();
    logBuffer.push(
      buildLogRecord({
        level,
        body,
        tsMs,
        traceId: ctx?.traceId ?? null,
        spanId: ctx?.spanId ?? null,
        sessionId: ctx?.sessionId ?? null,
        route: ctx?.route ?? null,
        exception: exceptionJournalisee(level, args, tsMs),
      }),
    );
    if (logBuffer.length >= MAX_LOG_BATCH) void flushLogs();
  } catch {
    /* ignore */
  } finally {
    inBridge = false;
  }
}

function patchConsole(): void {
  const c = console as unknown as Record<string, unknown> & { __mipLogPatched?: boolean };
  if (c.__mipLogPatched) return;
  const map: Array<[string, LogLevel]> = [
    ["debug", "debug"],
    ["log", "info"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ];
  for (const [method, level] of map) {
    const orig = c[method];
    if (typeof orig !== "function") continue;
    c[method] = function (this: unknown, ...args: unknown[]) {
      const out = (orig as (...a: unknown[]) => unknown).apply(this, args);
      captureLog(level, args); // après l'écriture réelle : jamais bloquant
      return out;
    };
  }
  c.__mipLogPatched = true;
}

// --- instrumentation pg (node-postgres) --------------------------------------
function emitDbSpan(ctx: ReqCtx, sql: string, startMs: number, durationMs: number): void {
  try {
    enqueue(
      buildDbSpan({
        traceId: ctx.traceId,
        spanId: hex(8),
        parentSpanId: ctx.spanId,
        system: "postgresql",
        statement: normalizeSql(sql),
        operation: sqlOperation(sql),
        startMs,
        durationMs,
      }),
    );
  } catch {
    /* ignore */
  }
}

// Patch Client.prototype.query (couvre aussi Pool.query, qui délègue à un Client).
// Supporte les deux formes : Promise (pg >= 7) et callback. Hors requête tracée
// (pas de contexte ALS) ou SQL non-string -> passe-plat.
function patchPg(pg: any): void {
  const proto = pg?.Client?.prototype;
  if (!proto || proto.__mipQueryPatched) return;
  const origQuery = proto.query;
  if (typeof origQuery !== "function") return;
  proto.query = function (this: unknown, ...args: any[]) {
    const ctx = als.getStore();
    const config = args[0];
    const sql = typeof config === "string" ? config : config?.text;
    if (!ctx || typeof sql !== "string") return origQuery.apply(this, args);
    const start = Date.now();
    const done = () => emitDbSpan(ctx, sql, start, Date.now() - start);
    const last = args[args.length - 1];
    if (typeof last === "function") {
      const origCb = last;
      args[args.length - 1] = function (this: unknown, ...a: unknown[]) {
        done();
        return origCb.apply(this, a);
      };
      return origQuery.apply(this, args);
    }
    const ret = origQuery.apply(this, args);
    if (ret && typeof ret.then === "function") {
      return ret.then(
        (r: unknown) => {
          done();
          return r;
        },
        (e: unknown) => {
          done();
          throw e;
        },
      );
    }
    done();
    return ret;
  };
  proto.__mipQueryPatched = true;
}

// Hook require : patche `pg` au chargement, sans en dépendre (agent zéro-dépendance).
function hookRequire(): void {
  const M = Module as any;
  const orig = M._load;
  if (typeof orig !== "function" || M.__mipHooked) return;
  M._load = function (...a: any[]) {
    const loaded = orig.apply(this, a);
    if (a[0] === "pg") {
      try {
        patchPg(loaded);
      } catch {
        /* ignore */
      }
    }
    return loaded;
  };
  M.__mipHooked = true;
}

if (!cfg.enabled) {
  if (process.env.MIP_RUM_DEBUG) {
    console.warn("[mip-agent] désactivé : définir MIP_RUM_ENDPOINT et MIP_RUM_APP_ID");
  }
} else {
  patch(httpMod);
  patch(httpsMod);
  hookRequire();
  surveillerExceptions();
  const timer = setInterval(() => {
    void flush();
    if (LOGS_ENABLED) void flushLogs();
  }, FLUSH_MS);
  if (typeof timer.unref === "function") timer.unref(); // ne retient pas le process
  const flushAll = () => {
    void flush();
    if (LOGS_ENABLED) void flushLogs();
  };
  process.on("beforeExit", flushAll);
  process.on("SIGTERM", flushAll);
  // La bannière est écrite AVANT le patch console : elle ne se capture pas
  // elle-même, et l'exploitant voit tout de suite si le pont logs est actif.
  console.log(
    `[mip-agent] actif -> ${cfg.endpoint} (app ${cfg.appId}, env ${cfg.env})` +
      (LOGS_ENABLED ? ` · logs >= ${LOG_FLOOR} -> ${LOG_ENDPOINT}` : " · logs désactivés"),
  );
  if (LOGS_ENABLED) patchConsole();
}
