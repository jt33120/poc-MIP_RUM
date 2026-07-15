// Cœur PUR du SDK mobile (React Native) — aucun global RN, aucun import natif.
// Réutilise la STRATÉGIE du SDK web : émettre exactement les mêmes noms de spans
// OTLP (`exception`, `pageview`, `http.client`, `track.*`) avec les attributs
// mip.* attendus par l'ingestion. Résultat : le mobile alimente les MÊMES tables
// (rum_error / rum_pageview / rum_span / rum_event, device_type = mobile) sans
// aucun changement côté serveur. Isolé du runtime (index.ts) -> testé par
// round-trip contre flattenOtlp.

export interface MobileConfig {
  endpoint: string;
  appId: string;
  apiKey: string | null;
  env: string;
  clientId: string | null;
  /** version applicative (mip.release) — dé-minification / suivi de version. */
  appVersion: string | null;
  /** user-agent synthétique mobile (mip.user_agent), ex. "MIP-RN/0.1 (ios 17)". */
  userAgent: string;
}

/** Contexte commun injecté sur chaque span (comme realEmit côté web). */
export interface Ctx {
  sessionId: string;
  route: string | null;
  userHash: string | null;
  tz: string | null;
  /** 'mobile' | 'ios' | 'android' — classe la session côté console. */
  deviceType: string;
}

// --- encodage OTLP (aligné sur anyValue() de l'ingestion) --------------------
type Attr = string | number | boolean | null | undefined;
function anyValue(v: string | number | boolean): Record<string, unknown> {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
}
export function encodeAttrs(o: Record<string, Attr>): Array<{ key: string; value: Record<string, unknown> }> {
  const out: Array<{ key: string; value: Record<string, unknown> }> = [];
  for (const [key, v] of Object.entries(o)) {
    if (v == null) continue;
    out.push({ key, value: anyValue(v) });
  }
  return out;
}
export function nanos(ms: number): string {
  return `${Math.round(ms)}000000`;
}

/** Attributs mip.* communs à tout span mobile. */
function common(ctx: Ctx): Record<string, Attr> {
  return {
    "mip.session_id": ctx.sessionId,
    "mip.route": ctx.route,
    "mip.user_hash": ctx.userHash,
    "mip.tz": ctx.tz,
    "mip.device_type": ctx.deviceType,
    "mip.collection_source": "sdk",
  };
}

function span(name: string, ctx: Ctx, extra: Record<string, Attr>, tsMs: number, spanId: string, traceId?: string) {
  return {
    traceId: traceId ?? spanId.padStart(32, "0"),
    spanId,
    name,
    startTimeUnixNano: nanos(tsMs),
    endTimeUnixNano: nanos(tsMs),
    attributes: encodeAttrs({ ...common(ctx), ...extra }),
  };
}

/** Crash / erreur JS -> span `exception` (table rum_error). */
export function buildExceptionSpan(
  ctx: Ctx,
  e: { message: string; type?: string | null; stack?: string | null },
  tsMs: number,
  spanId: string,
): Record<string, unknown> {
  return span("exception", ctx, {
    "exception.message": e.message,
    "exception.type": e.type ?? null,
    "exception.stacktrace": e.stack ?? null,
    "mip.error_kind": "crash",
  }, tsMs, spanId);
}

/** Changement d'écran -> span `pageview` (table rum_pageview). route = écran. */
export function buildScreenSpan(ctx: Ctx, tsMs: number, spanId: string): Record<string, unknown> {
  return span("pageview", ctx, {
    "mip.url": ctx.route,
    "mip.nav_type": "screen",
  }, tsMs, spanId);
}

/** Appel réseau -> span `http.client` (table rum_span, tier front). */
export function buildHttpSpan(
  ctx: Ctx,
  h: { traceId: string; url: string; method: string; status: number; durationMs: number },
  tsMs: number,
  spanId: string,
): Record<string, unknown> {
  return span("http.client", ctx, {
    "mip.trace_id": h.traceId,
    "mip.span_id": spanId,
    "http.url": h.url,
    "http.method": h.method,
    "http.status_code": h.status,
    "http.duration_ms": h.durationMs,
  }, tsMs, spanId, h.traceId);
}

/** Événement métier -> span `track.<name>` (table rum_event). */
export function buildTrackSpan(
  ctx: Ctx,
  name: string,
  props: Record<string, unknown>,
  tsMs: number,
  spanId: string,
): Record<string, unknown> {
  return span(`track.${name}`, ctx, { "mip.props": JSON.stringify(props) }, tsMs, spanId);
}

/** Enveloppe OTLP/HTTP JSON pour un lot de spans mobiles. */
export function buildPayload(cfg: MobileConfig, spans: Record<string, unknown>[]): unknown {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: encodeAttrs({
            "service.name": "mip-rum-mobile",
            "service.version": "0.1.0",
            "mip.app_id": cfg.appId,
            "mip.client_id": cfg.clientId ?? "",
            "mip.user_agent": cfg.userAgent,
            "deployment.environment.name": cfg.env,
            "mip.release": cfg.appVersion,
            "mip.api_key": cfg.apiKey,
          }),
        },
        scopeSpans: [{ scope: { name: "@mip/rum-mobile", version: "0.1.0" }, spans }],
      },
    ],
  };
}
