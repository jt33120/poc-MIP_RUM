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
  buildPayload,
  normalizeRoute,
  normalizeSql,
  parseTraceparent,
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
  res?.on?.("finish", () => {
    try {
      enqueue(
        buildHttpServerSpan({
          traceId,
          spanId,
          parentSpanId,
          method: String(req?.method ?? "GET"),
          route: normalizeRoute(String(req?.url ?? "/")),
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
  return { traceId, spanId, sessionId };
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
  const timer = setInterval(() => void flush(), FLUSH_MS);
  if (typeof timer.unref === "function") timer.unref(); // ne retient pas le process
  process.on("beforeExit", () => void flush());
  process.on("SIGTERM", () => void flush());
  console.log(`[mip-agent] actif -> ${cfg.endpoint} (app ${cfg.appId}, env ${cfg.env})`);
}
