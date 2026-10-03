// Émetteur OTLP/HTTP JSON maison : remplace les paquets @opentelemetry/* (~52 Ko
// minifiés de moins) avec le sous-ensemble d'API OTel que le SDK utilise.
import {
  buildResourceSpans,
  kindPour,
  statutPour,
  type Attributes,
  type EmitSpan,
  type HrTime,
  msToHr,
} from "./otlp-encode";
import {
  classerReponse,
  ExportResultCode,
  lireRetryAfter,
  type ReadableSpan,
  RetryExporter,
  type SpanExporter,
} from "./retry";
import type { MIPRumConfig } from "./types";

type SpanEvent = NonNullable<EmitSpan["events"]>[number];

// Suit packages/rum-sdk/package.json (tests/unit/specs.test.ts), pour qu'un
// changement de comportement se distingue dans ce que le SDK émet.
const SDK_VERSION = "0.5.0";
const MAX_BATCH = 64; // plafond du BatchSpanProcessor OTel

/** Interface minimale d'un span (sous-ensemble de l'API OTel réellement utilisé). */
export interface Span {
  setAttributes(attrs: Record<string, unknown>): void;
  end(epochMs?: number): void;
}
export interface Tracer {
  startSpan(name: string, opts?: { startTime?: number }): Span;
}

let buffer: EmitSpan[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let exporter: SpanExporter | null = null;
let resourceAttrs: Attributes = {};
let pending: Promise<void> = Promise.resolve();
let discardEpoch = 0;
const activeExports = new Set<AbortController>();

/** Identifiant hex aléatoire (16 octets = traceId, 8 octets = spanId). */
function hexId(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  if (a.every((x) => x === 0)) a[0] = 1; // tout-zéro interdit par la spec W3C
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Un traceId par page vue (chargement et navigation SPA), partagé par ses spans :
// le span serveur, enfant du `traceparent` d'un appel API, tombe dans la même
// trace. Par page vue et non par session, pour qu'une trace reste bornée.
let pageTraceId = hexId(16);

// Span racine `pageview`, parent de tout ce que la page produit. Son identifiant
// est tiré dès l'ouverture de la trace, pour que les enfants puissent le désigner.
let pageSpanId = hexId(8);

// La racine est-elle réellement partie ? Sinon (span émis avant le pageview,
// consentement refusé, session « error-biased »), un span reste racine plutôt que
// de pointer vers un parent qui n'arrivera jamais.
let racineCreee = false;

/** traceId de la page vue courante — injecté dans `traceparent` par apispans. */
export function currentTraceId(): string {
  return pageTraceId;
}

/** spanId de la page vue courante — parent des spans de cette page. */
export function currentPageSpanId(): string {
  return pageSpanId;
}

/** Ouvre une nouvelle trace : appelé à chaque pageview (initiale et SPA). */
export function newPageTrace(): string {
  pageTraceId = hexId(16);
  pageSpanId = hexId(8);
  racineCreee = false;
  return pageTraceId;
}

// Conventions OTel : les attributs historiques (http.method, http.url…), lus par
// l'ingestion MIP, restent ; les stables s'y ajoutent pour un backend tiers. Dérivés
// à la fermeture, donc après `beforeSend`, pour hériter de ses réécritures d'URL.

/** Méthodes HTTP connues de la convention ; toute autre devient `_OTHER`. */
const METHODE_CONNUE = /^(?:GET|HEAD|POST|PUT|DELETE|CONNECT|OPTIONS|TRACE|PATCH)$/;

/** Ajoute à un span `http.client` les attributs HTTP stables, sans écraser un attribut posé. */
export function conventionsHttp(a: Record<string, unknown>): void {
  const methode = a["http.method"];
  const url = a["http.url"];
  const statut = a["http.status_code"];
  if (typeof methode === "string" && a["http.request.method"] == null) {
    const connue = METHODE_CONNUE.test(methode);
    a["http.request.method"] = connue ? methode : "_OTHER";
    if (!connue) a["http.request.method_original"] = methode;
  }
  if (typeof url === "string" && a["url.full"] == null) a["url.full"] = url;
  // Statut 0 = aucune réponse : la convention veut alors l'attribut ABSENT.
  if (typeof statut === "number" && statut > 0 && a["http.response.status_code"] == null) {
    a["http.response.status_code"] = statut;
    // Un 4xx ou un 5xx est une erreur pour un span CLIENT ; `error.type` en dit la classe.
    if (statut >= 400 && a["error.type"] == null) a["error.type"] = String(statut);
  }
}

/**
 * Événement `exception` où un backend OTel tiers lit type, message et pile, recopié
 * des attributs finaux du span (après `beforeSend`). L'ingestion MIP l'ignore : le
 * span est déjà l'exception (packages/backend/shared/otlp.mjs).
 */
export function evenementException(a: Record<string, unknown>, time: HrTime): SpanEvent | null {
  const attributes: Attributes = {};
  for (const cle of ["exception.type", "exception.message", "exception.stacktrace"]) {
    const v = a[cle];
    if (typeof v === "string" && v) attributes[cle] = v;
  }
  // La convention exige le type OU le message : sans l'un ni l'autre, pas d'événement.
  if (!attributes["exception.type"] && !attributes["exception.message"]) return null;
  return { name: "exception", time, attributes };
}

/**
 * Exporter OTLP/JSON en POST keepalive, à trois issues (finding 2.2) : succès,
 * échec rejouable (5xx, réseau) ou définitif (4xx, comme une clé erronée).
 */
function httpExporter(url: string): SpanExporter {
  return {
    export(spans, cb) {
      // Le lot porte des EmitSpan (surensemble de ReadableSpan), d'où le transtypage.
      const body = JSON.stringify(buildResourceSpans(resourceAttrs, spans as unknown as EmitSpan[]));
      const controller = typeof AbortController === "undefined" ? null : new AbortController();
      if (controller) activeExports.add(controller);
      let finished = false;
      const finish = (result: Parameters<typeof cb>[0]) => {
        if (finished) return;
        finished = true;
        if (controller) activeExports.delete(controller);
        cb(result);
      };
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        ...(controller ? { signal: controller.signal } : {}),
        // keepalive survit à l'unload mais le navigateur le plafonne à ~64 Ko ;
        // au-delà, envoi normal (le pagehide aura déjà tenté un flush).
        keepalive: body.length < 60_000,
      })
        .then((res) => {
          if (res.ok) return finish({ code: ExportResultCode.SUCCESS });
          const { retryable } = classerReponse(res.status);
          finish({
            code: ExportResultCode.FAILED,
            retryable,
            // L'ingestion accompagne ses 429 d'un `retry-after`.
            retryAfterMs: lireRetryAfter(res.headers.get("retry-after")),
          });
        })
        // Pas de réponse (réseau coupé, onglet fermé, DNS) : le cas pour lequel la file existe.
        .catch(() => finish({
          code: ExportResultCode.FAILED,
          // Annulé par un refus de consentement : ce lot ne doit pas revenir par la file.
          retryable: controller?.signal.aborted ? false : true,
          discarded: controller?.signal.aborted === true,
          retryAfterMs: null,
        }));
    },
    shutdown: () => Promise.resolve(),
  };
}

// Page quittée (`pagehide`) et pas encore restaurée du bfcache (`pageshow`). Safari
// peut décharger une page sans `visibilitychange` : `pagehide` est alors le seul signal.
let pageQuittee = false;

/** Page masquée ou quittée : le navigateur peut la détruire avant toute réponse. */
function envoiSansAttente(): boolean {
  return pageQuittee || (typeof document !== "undefined" && document.visibilityState === "hidden");
}

/**
 * Vide le buffer vers l'exporter. Page visible : envois sérialisés, pour qu'un
 * enfant ne dépasse jamais sa racine. Page masquée ou quittée : envoi immédiat,
 * car web-vitals y finalise LCP, CLS et INP un flush à la fois et la réponse
 * attendue n'arriverait pas ; un lot en échec retombe dans la file, un lot jamais
 * parti est perdu.
 */
function flushBatch(): Promise<void> {
  if (!exporter || buffer.length === 0) return pending;
  const batch = buffer;
  buffer = [];
  const epoch = discardEpoch;
  const envoyer = () => new Promise<void>((resolve) => {
    // Un refus de consentement pendant l'attente annule ce lot ; un export déjà
    // parti ne peut pas être rappelé.
    if (epoch !== discardEpoch) return resolve();
    exporter!.export(batch as unknown as ReadableSpan[], () => resolve());
  });
  if (envoiSansAttente()) {
    // L'exécuteur d'une promesse est synchrone : le fetch keepalive est lancé
    // avant que l'écouteur `visibilitychange` ou `pagehide` ne rende la main.
    const direct = envoyer();
    pending = Promise.all([pending, direct]).then(() => {}, () => {});
    return pending;
  }
  const operation = pending.then(envoyer);
  pending = operation.catch(() => {});
  return pending;
}

/** Rend irrécupérables les spans matérialisés mais pas encore exportés. */
export function discardPendingSpans(): void {
  buffer = [];
  discardEpoch++;
  for (const controller of activeExports) controller.abort();
  activeExports.clear();
}

export function initOtel(cfg: MIPRumConfig): Tracer {
  resourceAttrs = {
    "service.name": "mip-rum-web",
    "service.version": SDK_VERSION,
    "mip.app_id": cfg.appId,
    "mip.client_id": cfg.clientId ?? "",
    "mip.user_agent": navigator.userAgent,
    "deployment.environment.name": cfg.env ?? "dev",
    // release : associe les piles à leur source map (dé-minification)
    ...(cfg.release ? { "mip.release": cfg.release } : {}),
    // sendBeacon/keepalive ne portent pas de headers : la clé voyage en resource
    ...(cfg.apiKey ? { "mip.api_key": cfg.apiKey } : {}),
    // Les deux taux, pour repondérer : l'échantillonnage est biaisé-erreurs, une
    // session avec erreur est incluse avec la probabilité
    // sampleRate + (1 − sampleRate) × errorSampleRate (sampling.ts, migration-v58).
    "mip.sample_rate": String(cfg.sampleRate ?? 1),
    "mip.error_sample_rate": String((cfg.keepOnError ?? true) ? (cfg.errorSampleRate ?? 1) : 0),
  };
  // décorateur retry : export raté -> file localStorage, rejouée au prochain init
  exporter = new RetryExporter(httpExporter(cfg.endpoint));

  const delay = cfg.flushIntervalMs ?? 3000;
  if (flushTimer != null) clearInterval(flushTimer);
  flushTimer = setInterval(() => void flushBatch(), delay);

  // INP et CLS finaux sont émis au passage en hidden : flush aussitôt, pour que
  // la requête keepalive parte avant l'unload
  const flush = () => void flushBatch();
  addEventListener("pagehide", () => {
    pageQuittee = true;
    flush();
  });
  // Restaurée du bfcache : les réponses arriveront, les lots se sérialisent de nouveau.
  addEventListener("pageshow", () => {
    pageQuittee = false;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  return {
    startSpan(name, opts) {
      const startMs = opts?.startTime ?? Date.now();
      // Le premier pageview de la trace en est la racine (identifiant réservé, sans
      // parent). Un second, possible au rejeu de la file, prend un identifiant neuf :
      // l'ingestion jetterait un doublon de clé.
      const estRacine = name === "pageview" && !racineCreee;
      if (estRacine) racineCreee = true;
      const span: EmitSpan = {
        name,
        traceId: pageTraceId, // tous les spans de la page vue partagent la trace
        spanId: estRacine ? pageSpanId : hexId(8),
        ...(!estRacine && racineCreee ? { parentSpanId: pageSpanId } : {}),
        kind: kindPour(name),
        startTime: msToHr(startMs),
        endTime: msToHr(startMs),
        attributes: {},
      };
      let ended = false;
      return {
        setAttributes(attrs) {
          Object.assign(span.attributes, attrs);
        },
        end(epochMs) {
          if (ended) return;
          ended = true;
          // Un span http.client porte déjà le contexte W3C parti dans `traceparent` :
          // recopié dans les champs natifs, il désigne le span que le serveur voit.
          const a = span.attributes as Record<string, unknown>;
          if (typeof a["mip.trace_id"] === "string") span.traceId = a["mip.trace_id"];
          if (typeof a["mip.span_id"] === "string") span.spanId = a["mip.span_id"];
          if (typeof a["mip.parent_span_id"] === "string") span.parentSpanId = a["mip.parent_span_id"];
          if (span.name === "http.client") conventionsHttp(a);
          if (span.name === "exception") {
            const ev = evenementException(a, span.startTime);
            if (ev) span.events = [ev];
          }
          // L'issue ne se connaît qu'à la fermeture : le code HTTP d'un appel
          // arrive avec la réponse, pas à l'ouverture du span.
          const statut = statutPour(span.name, span.attributes);
          if (statut) span.status = statut;
          span.endTime = msToHr(epochMs ?? Date.now());
          buffer.push(span);
          if (buffer.length >= MAX_BATCH) void flushBatch();
        },
      };
    },
  };
}

/** Force l'export des spans en attente (tests + avant unload). */
export function forceFlush(): Promise<void> {
  return flushBatch();
}
