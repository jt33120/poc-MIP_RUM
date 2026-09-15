// Tracing distribué (v0.4) : instrumentation fetch + XMLHttpRequest.
// - Génère un contexte W3C par appel API (trace_id 16 o / span_id 8 o), injecte
//   `traceparent` (+ `tracestate: mip=s:<session>`) sur les requêtes same-origin
//   et les origins de cfg.trace — jamais vers l'ingestion MIP elle-même.
// - Émet un span 'http.client' (méthode, url scrubbée, statut, durée) via le
//   pipeline normal (consent gate, beforeSend, retry) ; la corrélation avec le
//   span backend 'http.server' se fait par mip.trace_id (table rum_span).
// XHR est patché car axios (G-IT) repose dessus ; fetch couvre le reste.
import { makeCap, type PageCap } from "./caps";
import { scrubUrl } from "./context";
import type { Emit } from "./errors";

export const API_CAP_PER_PAGE = 100;

export interface ApiSpanOptions {
  /** Origins supplémentaires (ex. 'https://api.exemple.fr') vers lesquels propager. */
  extraOrigins: string[];
  /** Origins à ne JAMAIS instrumenter (endpoints d'ingestion MIP : boucle interdite). */
  denyOrigins: string[];
  /** Peut être dynamique : P2 ouvre une nouvelle session quand l'identité change. */
  sessionId: string | (() => string);
  /**
   * traceId de la page vue courante (E0). Rattache l'appel API à la trace de la
   * page plutôt que d'ouvrir une trace par requête : le span serveur rejoint
   * alors la même trace que le pageview et les autres appels de la page.
   * Omis (tests unitaires) -> une trace par appel, comportement historique.
   */
  traceId?: () => string;
}

function randHex(nBytes: number): string {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  if (b.every((x) => x === 0)) b[0] = 1; // tout-zéro interdit par la spec W3C
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function traceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

/**
 * Cible instrumentable -> URL absolue, sinon null (cross-origin hors liste,
 * origin d'ingestion MIP, ou URL invalide). On ne mesure QUE ce vers quoi on
 * propage : un span front sans jumeau back possible n'apporte rien de plus que
 * l'observer resources existant.
 */
export function resolveTarget(rawUrl: string, opts: ApiSpanOptions): string | null {
  try {
    const u = new URL(rawUrl, location.href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (opts.denyOrigins.includes(u.origin)) return null;
    if (u.origin === location.origin || opts.extraOrigins.includes(u.origin)) return u.href;
    return null;
  } catch {
    return null;
  }
}

export function initApiSpans(emit: Emit, opts: ApiSpanOptions): PageCap {
  const cap = makeCap(API_CAP_PER_PAGE);
  const sessionId = () => typeof opts.sessionId === "function" ? opts.sessionId() : opts.sessionId;

  const record = (
    url: string,
    method: string,
    traceId: string,
    spanId: string,
    status: number,
    startPerf: number,
    tsMs: number,
  ) => {
    emit(
      "http.client",
      {
        "mip.trace_id": traceId,
        "mip.span_id": spanId,
        "http.url": scrubUrl(url),
        "http.method": method,
        "http.status_code": status,
        "http.duration_ms": Math.round(performance.now() - startPerf),
      },
      tsMs,
    );
  };

  // --- fetch ------------------------------------------------------------------
  if (typeof window.fetch === "function") {
    const orig = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      try {
        const rawUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const target = resolveTarget(rawUrl, opts);
        if (!target || !cap.take()) return orig.call(this, input as RequestInfo, init);

        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const traceId = opts.traceId?.() ?? randHex(16);
        const spanId = randHex(8);
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        headers.set("traceparent", traceparent(traceId, spanId));
        headers.set("tracestate", `mip=s:${sessionId()}`);
        const startPerf = performance.now();
        const ts = Date.now();
        return orig.call(this, input as RequestInfo, { ...init, headers }).then(
          (resp) => {
            record(target, method, traceId, spanId, resp.status, startPerf, ts);
            return resp;
          },
          (err) => {
            record(target, method, traceId, spanId, 0, startPerf, ts); // réseau coupé
            throw err;
          },
        );
      } catch {
        return orig.call(this, input as RequestInfo, init); // jamais casser l'app hôte
      }
    };
  }

  // --- XMLHttpRequest (axios) ---------------------------------------------------
  if (typeof XMLHttpRequest === "function") {
    type MipXhr = XMLHttpRequest & { __mip?: { method: string; url: string } };
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (
      this: MipXhr,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      this.__mip = { method: String(method).toUpperCase(), url: String(url) };
      return (origOpen as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function (this: MipXhr, body?: Document | XMLHttpRequestBodyInit | null) {
      try {
        const meta = this.__mip;
        const target = meta ? resolveTarget(meta.url, opts) : null;
        if (meta && target && cap.take()) {
          const traceId = opts.traceId?.() ?? randHex(16);
          const spanId = randHex(8);
          this.setRequestHeader("traceparent", traceparent(traceId, spanId));
          this.setRequestHeader("tracestate", `mip=s:${sessionId()}`);
          const startPerf = performance.now();
          const ts = Date.now();
          // loadend couvre load/error/abort/timeout ; status 0 = échec réseau
          this.addEventListener("loadend", () =>
            record(target, meta.method, traceId, spanId, this.status, startPerf, ts),
          );
        }
      } catch {
        /* jamais casser la requête de l'app hôte */
      }
      return origSend.call(this, body);
    };
  }

  return cap;
}
