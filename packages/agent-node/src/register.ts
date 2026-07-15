// Runtime de l'agent (préchargé via `node -r @mip/agent-node/register`). Patche
// http.Server / https.Server pour émettre un span `http.server` par requête —
// aucun changement de code dans l'app instrumentée. Best-effort : jamais bloquant.
// Construit par esbuild (dist/register.js, CJS) ; la logique pure vit dans core.ts.
import { randomBytes } from "node:crypto";
import httpMod from "node:http";
import httpsMod from "node:https";
import {
  type AgentConfig,
  buildConfig,
  buildHttpServerSpan,
  buildPayload,
  normalizeRoute,
  parseTraceparent,
  sessionFromTracestate,
} from "./core";

const cfg: AgentConfig = buildConfig(process.env);

const hex = (n: number): string => randomBytes(n).toString("hex");
const header = (v: string | string[] | undefined): string | null =>
  (Array.isArray(v) ? v[0] : v) ?? null;

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

function onRequest(req: any, res: any): void {
  const start = Date.now();
  const tp = parseTraceparent(header(req.headers?.traceparent));
  const traceId = tp?.traceId ?? hex(16);
  const parentSpanId = tp?.spanId ?? null;
  const sessionId = sessionFromTracestate(header(req.headers?.tracestate));
  res.on("finish", () => {
    try {
      enqueue(
        buildHttpServerSpan({
          traceId,
          spanId: hex(8),
          parentSpanId,
          method: String(req.method ?? "GET"),
          route: normalizeRoute(String(req.url ?? "/")),
          url: null,
          status: Number(res.statusCode ?? 0),
          sessionId,
          startMs: start,
          durationMs: Date.now() - start,
        }),
      );
    } catch {
      /* ignore */
    }
  });
}

function patch(mod: any): void {
  const proto = mod?.Server?.prototype;
  if (!proto || proto.__mipPatched) return;
  const origEmit = proto.emit;
  proto.emit = function (this: unknown, event: string, ...args: unknown[]) {
    if (event === "request") {
      try {
        onRequest(args[0], args[1]);
      } catch {
        /* ne jamais casser le serveur */
      }
    }
    return origEmit.call(this, event, ...args);
  };
  proto.__mipPatched = true;
}

if (!cfg.enabled) {
  if (process.env.MIP_RUM_DEBUG) {
    console.warn("[mip-agent] désactivé : définir MIP_RUM_ENDPOINT et MIP_RUM_APP_ID");
  }
} else {
  patch(httpMod);
  patch(httpsMod);
  const timer = setInterval(() => void flush(), FLUSH_MS);
  if (typeof timer.unref === "function") timer.unref(); // ne retient pas le process
  process.on("beforeExit", () => void flush());
  process.on("SIGTERM", () => void flush());
  console.log(`[mip-agent] actif -> ${cfg.endpoint} (app ${cfg.appId}, env ${cfg.env})`);
}
