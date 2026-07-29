// Émetteur OTLP/HTTP JSON maison — remplace @opentelemetry/{api,core,resources,
// sdk-trace-web,exporter-trace-otlp-http} (Chantier A : ~52 Ko minifiés retirés
// du bundle cœur). Surface publique identique à l'ancienne intégration OTel :
// `initOtel(cfg) -> Tracer`, `tracer.startSpan(name, {startTime})`, `span
// .setAttributes()`, `span.end(ts)`, `forceFlush()`. Le batch, le flush au
// pagehide/visibilitychange et la file de retry durable (localStorage, via le
// décorateur RetryExporter) sont conservés à l'identique.
import { buildResourceSpans, type Attributes, type EmitSpan, msToHr } from "./otlp-encode";
import {
  ExportResultCode,
  type ReadableSpan,
  RetryExporter,
  type SpanExporter,
} from "./retry";
import type { MIPRumConfig } from "./types";

const SDK_VERSION = "0.4.0";
const MAX_BATCH = 64; // même plafond que l'ancien BatchSpanProcessor

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

/** Identifiant hex aléatoire (16 octets = traceId, 8 octets = spanId). */
function hexId(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  if (a.every((x) => x === 0)) a[0] = 1; // tout-zéro interdit par la spec W3C
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Contexte de trace W3C (E0) ---------------------------------------------
// AVANT : chaque span portait un traceId ET un spanId tirés au hasard. Résultat,
// aucun span n'était rattachable à un autre : un backend OTel recevant notre
// OTLP voyait autant de traces que de spans, et la promesse « OTel-native, donc
// corrélable » était fausse dans les champs natifs (seuls les attributs
// propriétaires mip.trace_id portaient la corrélation front↔back).
//
// MAINTENANT : un traceId par PAGE VUE (chargement initial + chaque navigation
// SPA), partagé par tous les spans de cette page. Les spans d'appel API portent
// en plus leur propre spanId, celui-là même propagé dans l'en-tête `traceparent`
// — le span serveur devient donc leur enfant, dans la MÊME trace que la page.
// Rotation par page vue (et non par session) : une trace doit rester bornée.
let pageTraceId = hexId(16);

/** traceId de la page vue courante — injecté dans `traceparent` par apispans. */
export function currentTraceId(): string {
  return pageTraceId;
}

/** Ouvre une nouvelle trace : appelé à chaque pageview (initiale et SPA). */
export function newPageTrace(): string {
  pageTraceId = hexId(16);
  return pageTraceId;
}

/** Exporter HTTP OTLP/JSON : POST keepalive ; échec réseau/HTTP -> FAILED. */
function httpExporter(url: string): SpanExporter {
  return {
    export(spans, cb) {
      // les objets sont des EmitSpan (surensemble de ReadableSpan) : on rebâtit
      // l'enveloppe OTLP à partir du lot + des attributs de resource courants.
      const body = JSON.stringify(buildResourceSpans(resourceAttrs, spans as unknown as EmitSpan[]));
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        // keepalive : la requête survit à l'unload (cap navigateur ~64 Ko) ;
        // au-delà, envoi normal (le pagehide aura déjà tenté un flush plus tôt).
        keepalive: body.length < 60_000,
      })
        .then((res) => cb({ code: res.ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED }))
        .catch(() => cb({ code: ExportResultCode.FAILED }));
    },
    shutdown: () => Promise.resolve(),
  };
}

/** Vide le buffer courant vers l'exporter (décorateur retry). Sérialise les envois. */
function flushBatch(): Promise<void> {
  if (!exporter || buffer.length === 0) return Promise.resolve();
  const batch = buffer;
  buffer = [];
  const done = new Promise<void>((resolve) => {
    exporter!.export(batch as unknown as ReadableSpan[], () => resolve());
  });
  pending = pending.then(() => done).catch(() => {});
  return done;
}

export function initOtel(cfg: MIPRumConfig): Tracer {
  resourceAttrs = {
    "service.name": "mip-rum-web",
    "service.version": SDK_VERSION,
    "mip.app_id": cfg.appId,
    "mip.client_id": cfg.clientId ?? "",
    "mip.user_agent": navigator.userAgent,
    "deployment.environment.name": cfg.env ?? "dev",
    // release pour la dé-minification des stacks (association à la source map)
    ...(cfg.release ? { "mip.release": cfg.release } : {}),
    // sendBeacon/keepalive ne portent pas de headers : la clé voyage en resource
    ...(cfg.apiKey ? { "mip.api_key": cfg.apiKey } : {}),
  };
  // décorateur retry : export raté -> file localStorage, rejouée au prochain init
  exporter = new RetryExporter(httpExporter(cfg.endpoint));

  const delay = cfg.flushIntervalMs ?? 3000;
  if (flushTimer != null) clearInterval(flushTimer);
  flushTimer = setInterval(() => void flushBatch(), delay);

  // les valeurs finales (INP/CLS) sont émises au passage en hidden : on flush
  // juste après pour que la requête keepalive parte avant l'unload
  const flush = () => void flushBatch();
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  return {
    startSpan(name, opts) {
      const startMs = opts?.startTime ?? Date.now();
      const span: EmitSpan = {
        name,
        traceId: pageTraceId, // tous les spans de la page vue partagent la trace
        spanId: hexId(8),
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
          if (ended) return; // end() idempotent
          ended = true;
          // Les spans d'appel API (http.client) ont déjà un contexte W3C : c'est
          // celui qui part dans `traceparent`, donc celui que le serveur voit.
          // On le recopie dans les champs NATIFS pour que les deux vues (attributs
          // propriétaires et OTLP standard) désignent le même span.
          const a = span.attributes as Record<string, unknown>;
          if (typeof a["mip.trace_id"] === "string") span.traceId = a["mip.trace_id"];
          if (typeof a["mip.span_id"] === "string") span.spanId = a["mip.span_id"];
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
  void flushBatch();
  return pending;
}
