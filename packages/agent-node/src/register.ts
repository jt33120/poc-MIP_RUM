// Runtime de l'agent (préchargé via `node -r @mip/agent-node/register`). Patche
// http.Server / https.Server pour émettre un span `http.server` par requête, et
// instrumente le client `pg` (node-postgres) pour émettre un span DB enfant par
// requête SQL — aucun changement de code dans l'app. Le lien parent/enfant passe
// par un contexte de requête (AsyncLocalStorage). Best-effort : jamais bloquant.
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
  type LogLevel,
  logsEndpoint,
  normalizeRoute,
  normalizeSql,
  parseTraceparent,
  passesLevel,
  resolveLogLevel,
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
  res?.on?.("finish", () => {
    try {
      enqueue(
        buildHttpServerSpan({
          traceId,
          spanId,
          parentSpanId,
          method: String(req?.method ?? "GET"),
          route,
          url: null,
          status: Number(res?.statusCode ?? 0),
          sessionId,
          startMs: start,
          durationMs: Date.now() - start,
        }),
      );
    } catch {
      /* ignore */
    }
  });
  return { traceId, spanId, sessionId, route };
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
      if (ctx) return als.run(ctx, () => origEmit.call(this, event, ...args));
    }
    return origEmit.call(this, event, ...args);
  };
  proto.__mipPatched = true;
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
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function captureLog(level: LogLevel, args: unknown[]): void {
  if (inBridge || !passesLevel(level, LOG_FLOOR)) return;
  inBridge = true;
  try {
    const ctx = als.getStore();
    const body = formatArgs(args);
    if (!body) return;
    logBuffer.push(
      buildLogRecord({
        level,
        body,
        tsMs: Date.now(),
        traceId: ctx?.traceId ?? null,
        spanId: ctx?.spanId ?? null,
        sessionId: ctx?.sessionId ?? null,
        route: ctx?.route ?? null,
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
