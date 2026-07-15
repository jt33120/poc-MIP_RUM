// Wrapper de route API (Voie A · inc. 2) — utilise `after` de next/server, donc
// isolé du cœur pur (server-trace-core.ts, importé partout via lib/db.ts).
import { after } from "next/server";
import {
  als,
  insertServerSpans,
  parseTraceparent,
  sessionFromTracestate,
  type TraceCtx,
} from "./server-trace-core";

/**
 * Enveloppe un handler de route API : lit le traceparent injecté par le SDK
 * navigateur (fetch same-origin), chronomètre le handler + ses requêtes DB
 * (contexte ALS), puis écrit les spans serveur/DB dans rum_span (après la
 * réponse, best-effort). Sans traceparent : simple passe-plat, aucun surcoût.
 */
export async function withServerTrace<T extends Response>(
  req: Request,
  meta: { route: string; method?: string },
  handler: () => Promise<T>,
): Promise<T> {
  const tp = parseTraceparent(req.headers.get("traceparent"));
  if (!tp) return handler();
  const ctx: TraceCtx = {
    traceId: tp.traceId,
    parentSpanId: tp.spanId,
    sessionId: sessionFromTracestate(req.headers.get("tracestate")),
    startMs: Date.now(),
    db: [],
  };
  const res = await als.run(ctx, handler);
  const durationMs = Date.now() - ctx.startMs;
  const method = meta.method ?? req.method;
  after(() =>
    insertServerSpans(ctx, { route: meta.route, method, status: res.status, durationMs }).catch(() => {
      /* dogfood best-effort : une trace perdue n'impacte pas la réponse */
    }),
  );
  return res;
}
