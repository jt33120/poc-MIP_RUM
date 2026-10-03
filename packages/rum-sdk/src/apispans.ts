// Tracing distribué : fetch et XHR (axios repose sur XHR) injectent `traceparent`
// sur le même site et les origines de cfg.trace, jamais vers l'ingestion MIP, et
// émettent un span 'http.client' corrélé au span serveur par mip.trace_id.
// Sur option, les échecs deviennent des erreurs `network` (appels instrumentés seulement).
import { makeCap, type PageCap } from "./caps";
import { scrubUrl } from "./context";
import { urlNettoyee } from "./error-capture";
import type { Emit } from "./errors";

export const API_CAP_PER_PAGE = 100;

/** Issue d'un appel resté sans réponse HTTP. */
export type IssueReseau = "network" | "timeout" | "abort";

/** Ce que `captureErrors.network` signale en plus des échecs réseau et des 5xx. */
export interface NetworkErrorPolicy {
  clientErrors: boolean;
  aborts: boolean;
}

/**
 * L'appel est-il une erreur à signaler ? `null` = non. Abandons et 4xx (souvent
 * métier) seulement sur demande ; statut 0 sans échec = réponse opaque `no-cors`.
 * Le statut va dans le TYPE : l'empreinte serveur efface les chiffres du message.
 */
export function echecReseau(
  status: number,
  issue: IssueReseau | null,
  policy: NetworkErrorPolicy,
): { type: string; detail: string } | null {
  if (issue === "abort") return policy.aborts ? { type: "AbortError", detail: "requête abandonnée" } : null;
  if (issue === "timeout") return { type: "TimeoutError", detail: "délai dépassé" };
  if (issue === "network") return { type: "NetworkError", detail: "échec réseau" };
  if (status >= 500 || (policy.clientErrors && status >= 400)) {
    return { type: `HTTP ${status}`, detail: `HTTP ${status}` };
  }
  return null;
}

export interface ApiSpanOptions {
  /** Origins supplémentaires (ex. 'https://api.exemple.fr') vers lesquels propager. */
  extraOrigins: string[];
  /** Origins à ne JAMAIS instrumenter (endpoints d'ingestion MIP : boucle interdite). */
  denyOrigins: string[];
  /** Fonction quand la session change avec l'identité. */
  sessionId: string | (() => string);
  /** traceId de la page vue : les appels rejoignent sa trace. Omis : une trace par appel. */
  traceId?: () => string;
  /** Snapshot causal pris au DÉPART de l'appel, jamais à sa réponse. */
  action?: () => Record<string, string | number | boolean>;
  /**
   * Faux : ni en-tête ni span, pour qu'une session hors échantillon ne fasse pas
   * tracer le serveur pour rien. Absent : toujours actif.
   */
  actif?: () => boolean;
  /** Erreurs réseau (`captureErrors.network`) ; absent = aucune. `ts` = départ de l'appel. */
  errors?: NetworkErrorPolicy & {
    report: (attrs: Record<string, string | number | boolean>, ts: number) => void;
  };
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
 * URL absolue si l'appel est instrumentable, sinon null. On ne mesure que ce vers
 * quoi on propage : sans span serveur possible, l'observer resources suffit.
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
    issue: IssueReseau | null,
    startPerf: number,
    tsMs: number,
    actionAttrs: Record<string, string | number | boolean>,
  ) => {
    try {
      const echec = opts.errors ? echecReseau(status, issue, opts.errors) : null;
      const propre = echec ? urlNettoyee(url) : null;
      if (echec && propre) {
        const verbe = method.slice(0, 16);
        // AVANT le span : dans une session error-biased, c'est l'erreur qui
        // promeut la session, et le span de l'appel en échec passe avec elle.
        opts.errors!.report({
          ...actionAttrs,
          "mip.error_kind": "network",
          "exception.type": echec.type,
          // Méthode, hôte et chemin : ni query, ni identifiants, ni corps, ni en-tête.
          "exception.message": `${verbe} ${propre.cible} : ${echec.detail}`,
          "mip.error_source": propre.source,
          "http.method": verbe,
          ...(status ? { "http.status_code": status } : {}),
          // Lien vers le span de l'appel : même trace, ce span pour parent.
          "mip.trace_id": traceId,
          "mip.parent_span_id": spanId,
        }, tsMs);
      }
      emit(
        "http.client",
        {
          ...actionAttrs,
          "mip.trace_id": traceId,
          "mip.span_id": spanId,
          "http.url": scrubUrl(url),
          "http.method": method,
          "http.status_code": status,
          // Durée du span ; les attributs HTTP stables s'ajoutent après beforeSend
          // (otel.ts, `conventionsHttp`).
          "http.duration_ms": Math.round(performance.now() - startPerf),
          // `error.type` OpenTelemetry ; un abandon voulu n'en est pas un.
          ...(issue === "timeout" ? { "error.type": "TimeoutError" } : issue === "network" ? { "error.type": "NetworkError" } : {}),
        },
        tsMs,
      );
    } catch {
      /* la mesure ne change jamais la réponse rendue à l'application */
    }
  };

  // --- fetch ------------------------------------------------------------------
  if (typeof window.fetch === "function") {
    const orig = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      try {
        const rawUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const target = resolveTarget(rawUrl, opts);
        if (!target || opts.actif?.() === false || !cap.take()) return orig.call(this, input as RequestInfo, init);

        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        // Lu au départ, sous la garde : il dira si un rejet est un abandon voulu.
        const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
        const traceId = opts.traceId?.() ?? randHex(16);
        const spanId = randHex(8);
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        headers.set("traceparent", traceparent(traceId, spanId));
        headers.set("tracestate", `mip=s:${sessionId()}`);
        const startPerf = performance.now();
        const ts = Date.now();
        const actionAttrs = opts.action?.() ?? {};
        return orig.call(this, input as RequestInfo, { ...init, headers }).then(
          (resp) => {
            record(target, method, traceId, spanId, resp.status, null, startPerf, ts, actionAttrs);
            return resp;
          },
          (err) => {
            // Le motif d'abort() peut être n'importe quelle valeur : le signal tranche.
            const nom = (err as { name?: unknown } | null)?.name;
            const issue: IssueReseau =
              nom === "TimeoutError" ? "timeout" : nom === "AbortError" || signal?.aborted ? "abort" : "network";
            record(target, method, traceId, spanId, 0, issue, startPerf, ts, actionAttrs);
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
        if (meta && target && opts.actif?.() !== false && cap.take()) {
          const traceId = opts.traceId?.() ?? randHex(16);
          const spanId = randHex(8);
          this.setRequestHeader("traceparent", traceparent(traceId, spanId));
          this.setRequestHeader("tracestate", `mip=s:${sessionId()}`);
          const startPerf = performance.now();
          const ts = Date.now();
          const actionAttrs = opts.action?.() ?? {};
          // error/timeout/abort précèdent loadend et disent pourquoi le statut vaut 0 ;
          // écoutés même sans erreurs réseau, car `error.type` en dépend.
          let issue: IssueReseau | null = null;
          this.addEventListener("error", () => { issue = "network"; }, { once: true });
          this.addEventListener("timeout", () => { issue = "timeout"; }, { once: true });
          this.addEventListener("abort", () => { issue = "abort"; }, { once: true });
          this.addEventListener(
            "loadend",
            () => record(target, meta.method, traceId, spanId, this.status, issue, startPerf, ts, actionAttrs),
            { once: true },
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
