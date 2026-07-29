// Cœur de l'instrumentation backend (Voie A · inc. 2) — parties pures + contexte
// AsyncLocalStorage + écriture rum_span. AUCUN import de "next/server" ici : ce
// module est importé par lib/db.ts (partout) et testable unitairement. Le
// wrapper de route (withServerTrace, qui utilise `after`) vit dans server-trace.ts.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

/** app_id du dogfood — identique à l'init MIPRum de la console (layout.tsx). */
export const APP_ID = "mip-rum-console";

interface DbSpan {
  name: string;
  startMs: number;
  durationMs: number;
}
export interface TraceCtx {
  traceId: string;
  parentSpanId: string;
  sessionId: string | null;
  startMs: number;
  db: DbSpan[];
}

export const als = new AsyncLocalStorage<TraceCtx>();

const HEX32 = /^[0-9a-f]{32}$/i;
const HEX16 = /^[0-9a-f]{16}$/i;

/** Parse un en-tête W3C `traceparent` (00-<trace>-<span>-<flags>). null si invalide. */
export function parseTraceparent(h: string | null): { traceId: string; spanId: string } | null {
  if (!h) return null;
  const parts = h.trim().split("-");
  if (parts.length < 4) return null;
  const [, traceId, spanId] = parts;
  if (!HEX32.test(traceId) || !HEX16.test(spanId)) return null;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null; // tout-zéro interdit
  return { traceId, spanId };
}

/** Extrait la session MIP d'un `tracestate` (`mip=s:<id>`). */
export function sessionFromTracestate(h: string | null): string | null {
  if (!h) return null;
  for (const part of h.split(",")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== "mip") continue;
    const v = part.slice(i + 1).trim();
    if (v.startsWith("s:")) return v.slice(2) || null;
  }
  return null;
}

/** Libellé de requête pour le waterfall. SQL paramétré -> aucune donnée (params à part). */
export function sqlLabel(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function hexId(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Contexte de corrélation de la trace active, sous la forme attendue par les
 * champs `mip.*` du parser d'ingestion. Objet vide si aucune trace n'est active.
 *
 * Sert à corréler un log à sa trace SANS que l'appelant ait à transporter
 * l'identifiant à la main — c'est l'oubli de ce transport qui laissait
 * `rum_log.trace_id` vide sur la totalité des lignes en production.
 *
 * À capturer de façon SYNCHRONE : un appelant qui diffère l'envoi via `after()`
 * doit appeler cette fonction AVANT de différer, le contexte ALS n'étant pas
 * garanti à l'intérieur du callback.
 */
export function traceFields(): { trace_id?: string; session_id?: string } {
  const ctx = als.getStore();
  if (!ctx) return {};
  return {
    trace_id: ctx.traceId,
    ...(ctx.sessionId ? { session_id: ctx.sessionId } : {}),
  };
}

/** Enregistre un span DB si une trace serveur est active (no-op sinon). */
export function recordDbSpan(sql: string, startMs: number, durationMs: number): void {
  const ctx = als.getStore();
  if (ctx) ctx.db.push({ name: sqlLabel(sql), startMs, durationMs });
}

export interface SpanRow {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  tier: "back" | "detail";
  session_id: string | null;
  app_id: string;
  route: string | null;
  url: null;
  method: string | null;
  status_code: number | null;
  duration_ms: number;
  name: string;
  kind: "server" | "db";
  ts: Date;
}

export interface RouteMeta {
  route: string;
  method: string;
  status: number;
  durationMs: number;
}

/** Construit les lignes rum_span (serveur + DB enfants) — pur, donc testable. */
export function buildServerSpanRows(
  ctx: TraceCtx,
  meta: RouteMeta,
  newId: () => string = () => hexId(8),
): SpanRow[] {
  const serverSpanId = newId();
  const rows: SpanRow[] = [
    {
      span_id: serverSpanId,
      trace_id: ctx.traceId,
      parent_span_id: ctx.parentSpanId,
      tier: "back",
      session_id: ctx.sessionId,
      app_id: APP_ID,
      route: meta.route,
      url: null,
      method: meta.method,
      status_code: meta.status,
      duration_ms: meta.durationMs,
      name: `${meta.method} ${meta.route}`,
      kind: "server",
      ts: new Date(ctx.startMs),
    },
  ];
  for (const d of ctx.db) {
    rows.push({
      span_id: newId(),
      trace_id: ctx.traceId,
      parent_span_id: serverSpanId,
      tier: "detail",
      session_id: ctx.sessionId,
      app_id: APP_ID,
      route: null,
      url: null,
      method: null,
      status_code: null,
      duration_ms: d.durationMs,
      name: d.name,
      kind: "db",
      ts: new Date(d.startMs),
    });
  }
  return rows;
}

const COLS = [
  "span_id", "trace_id", "parent_span_id", "tier", "session_id", "app_id",
  "route", "url", "method", "status_code", "duration_ms", "name", "kind", "ts",
] as const;

/** Écrit les spans serveur/DB dans rum_span (import dynamique : évite le cycle db<->core). */
export async function insertServerSpans(ctx: TraceCtx, meta: RouteMeta): Promise<void> {
  const rows = buildServerSpanRows(ctx, meta);
  const { q } = await import("./db");
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    const base = i * COLS.length;
    for (const c of COLS) values.push((r as unknown as Record<string, unknown>)[c]);
    return `(${COLS.map((_, j) => `$${base + j + 1}`).join(",")})`;
  });
  await q(
    `insert into rum_span (${COLS.join(",")}) values ${tuples.join(",")} on conflict (span_id) do nothing`,
    values,
  );
}
