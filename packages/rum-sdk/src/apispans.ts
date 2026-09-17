// Tracing distribué (v0.4) : instrumentation fetch + XMLHttpRequest.
// - Génère un contexte W3C par appel API (trace_id 16 o / span_id 8 o), injecte
//   `traceparent` (+ `tracestate: mip=s:<session>`) sur les requêtes same-origin
//   et les origins de cfg.trace — jamais vers l'ingestion MIP elle-même.
// - Émet un span 'http.client' (méthode, url scrubbée, statut, durée) via le
//   pipeline normal (consent gate, beforeSend, retry) ; la corrélation avec le
//   span backend 'http.server' se fait par mip.trace_id (table rum_span).
// XHR est patché car axios (G-IT) repose dessus ; fetch couvre le reste.
// P5.2 : ces mêmes wrappers signalent, sur option, les appels en échec comme
// erreurs `network` — jamais un appel non instrumenté, donc ni l'ingestion MIP ni
// une origine hors liste.
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
 * L'appel est-il une erreur à signaler ? PURE. `null` = non.
 *
 * Un abandon volontaire (AbortController, requête annulée par l'application)
 * n'est pas un incident : classé à part, il n'est signalé que sur demande. Un
 * délai dépassé en est un. Un 4xx dit souvent « pas trouvé » ou « pas autorisé »
 * au sens métier : sur demande aussi. Un statut 0 SANS échec — réponse opaque
 * `no-cors` — n'est pas un échec.
 *
 * Le statut entre dans le TYPE (« HTTP 503 ») et pas seulement dans le message :
 * l'empreinte serveur remplace les chiffres d'un message, et 500 et 404
 * tomberaient sinon dans le même groupe.
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
  /** Peut être dynamique : P2 ouvre une nouvelle session quand l'identité change. */
  sessionId: string | (() => string);
  /**
   * traceId de la page vue courante (E0). Rattache l'appel API à la trace de la
   * page plutôt que d'ouvrir une trace par requête : le span serveur rejoint
   * alors la même trace que le pageview et les autres appels de la page.
   * Omis (tests unitaires) -> une trace par appel, comportement historique.
   */
  traceId?: () => string;
  /** Snapshot causal pris au DÉPART de l'appel, jamais à sa réponse. */
  action?: () => Record<string, string | number | boolean>;
  /**
   * Erreurs réseau (`captureErrors.network`) ; absent = aucune. `report` reçoit
   * les attributs de l'exception et l'horodatage de DÉPART de l'appel, celui de
   * son span : l'attribution causale reste celle du départ.
   */
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
          "http.duration_ms": Math.round(performance.now() - startPerf),
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
        if (!target || !cap.take()) return orig.call(this, input as RequestInfo, init);

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
            // Rejet : délai (AbortSignal.timeout), abandon volontaire — le motif
            // passé à abort() peut être n'importe quelle valeur, d'où le signal —
            // ou réseau coupé.
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
        if (meta && target && cap.take()) {
          const traceId = opts.traceId?.() ?? randHex(16);
          const spanId = randHex(8);
          this.setRequestHeader("traceparent", traceparent(traceId, spanId));
          this.setRequestHeader("tracestate", `mip=s:${sessionId()}`);
          const startPerf = performance.now();
          const ts = Date.now();
          const actionAttrs = opts.action?.() ?? {};
          // error/timeout/abort précèdent toujours loadend : ils disent POURQUOI
          // le statut vaut 0, que loadend seul ne dit pas.
          let issue: IssueReseau | null = null;
          if (opts.errors) {
            this.addEventListener("error", () => { issue = "network"; }, { once: true });
            this.addEventListener("timeout", () => { issue = "timeout"; }, { once: true });
            this.addEventListener("abort", () => { issue = "abort"; }, { once: true });
          }
          // loadend couvre load/error/abort/timeout ; status 0 = échec réseau
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
