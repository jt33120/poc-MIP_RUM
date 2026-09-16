// Émetteur OTLP/HTTP JSON maison — remplace @opentelemetry/{api,core,resources,
// sdk-trace-web,exporter-trace-otlp-http} (Chantier A : ~52 Ko minifiés retirés
// du bundle cœur). Surface publique identique à l'ancienne intégration OTel :
// `initOtel(cfg) -> Tracer`, `tracer.startSpan(name, {startTime})`, `span
// .setAttributes()`, `span.end(ts)`, `forceFlush()`. Le batch, le flush au
// pagehide/visibilitychange et la file de retry durable (localStorage, via le
// décorateur RetryExporter) sont conservés à l'identique.
import {
  buildResourceSpans,
  kindPour,
  statutPour,
  type Attributes,
  type EmitSpan,
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
let discardEpoch = 0;
const activeExports = new Set<AbortController>();

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

// --- Span RACINE de la page vue ---------------------------------------------
// Une trace sans racine n'est pas une trace : chaque span de la page était un
// orphelin, et un backend OTel tiers affichait autant de branches détachées que
// de mesures. Le span `pageview` devient donc le parent de tout ce que la page
// produit ensuite — c'est la relation vraie, pas une convention : une métrique,
// une erreur ou un appel réseau ont bien lieu PENDANT cette page vue.
//
// L'identifiant est tiré à l'ouverture de la trace, avant que le span pageview
// n'existe, parce que les enfants doivent pouvoir le désigner.
let pageSpanId = hexId(8);

// Le span racine a-t-il été RÉELLEMENT créé pour la trace courante ?
//
// Ce drapeau évite un parent fantôme, et il en évite deux sortes :
//   - un span émis AVANT le pageview (une erreur au tout début du chargement) ;
//   - une page vue dont le span racine n'est jamais parti — consentement refusé,
//     ou session en mode « error-biased » où seules les erreurs passent.
// Dans les deux cas le span reste racine plutôt que de pointer vers un parent
// qui n'arrivera jamais. Un backend afficherait sinon une trace en attente d'un
// span perpétuellement manquant.
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

/**
 * Exporter HTTP OTLP/JSON : POST keepalive.
 *
 * TROIS ISSUES, pas deux (finding 2.2). Un 403 sur une clé mal saisie et un 503
 * pendant un incident ne demandent pas la même chose : le premier ne s'arrangera
 * jamais, le second s'arrangera tout seul. Les confondre faisait rejouer
 * indéfiniment une requête en tort, à chaque page, pour rien.
 */
function httpExporter(url: string): SpanExporter {
  return {
    export(spans, cb) {
      // les objets sont des EmitSpan (surensemble de ReadableSpan) : on rebâtit
      // l'enveloppe OTLP à partir du lot + des attributs de resource courants.
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
        // keepalive : la requête survit à l'unload (cap navigateur ~64 Ko) ;
        // au-delà, envoi normal (le pagehide aura déjà tenté un flush plus tôt).
        keepalive: body.length < 60_000,
      })
        .then((res) => {
          if (res.ok) return finish({ code: ExportResultCode.SUCCESS });
          const { retryable } = classerReponse(res.status);
          finish({
            code: ExportResultCode.FAILED,
            retryable,
            // L'ingestion renvoie `retry-after` sur ses 429 depuis toujours ;
            // personne ne le lisait.
            retryAfterMs: lireRetryAfter(res.headers.get("retry-after")),
          });
        })
        // Pas de réponse du tout : réseau coupé, onglet fermé, DNS. C'est le cas
        // nominal du mode hors-ligne, celui pour lequel la file existe.
        .catch(() => finish({
          code: ExportResultCode.FAILED,
          // Un refus de consentement annule l'envoi : ce lot ne doit surtout
          // pas revenir par la file offline après sa purge.
          retryable: controller?.signal.aborted ? false : true,
          discarded: controller?.signal.aborted === true,
          retryAfterMs: null,
        }));
    },
    shutdown: () => Promise.resolve(),
  };
}

/** Vide le buffer courant vers l'exporter (décorateur retry). Sérialise les envois. */
function flushBatch(): Promise<void> {
  if (!exporter || buffer.length === 0) return pending;
  const batch = buffer;
  buffer = [];
  const epoch = discardEpoch;
  const operation = pending.then(() => new Promise<void>((resolve) => {
    // Un refus de consentement survenu pendant l'attente annule ce lot avant
    // toute requête réseau. Un export déjà parti ne peut pas être rappelé.
    if (epoch !== discardEpoch) return resolve();
    exporter!.export(batch as unknown as ReadableSpan[], () => resolve());
  }));
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
    // release pour la dé-minification des stacks (association à la source map)
    ...(cfg.release ? { "mip.release": cfg.release } : {}),
    // sendBeacon/keepalive ne portent pas de headers : la clé voyage en resource
    ...(cfg.apiKey ? { "mip.api_key": cfg.apiKey } : {}),
    // ÉCHANTILLONNAGE — les deux taux, pas seulement le premier.
    //
    // Sans eux, un backend ne peut pas repondérer : il voit un échantillon et le
    // prend pour la population. Et `sampleRate` SEUL ne suffit pas, parce que
    // l'échantillonnage de ce SDK n'est pas uniforme mais biaisé-erreurs (voir
    // sampling.ts). Une session sans erreur n'apparaît qu'avec une probabilité
    // `sampleRate` ; une session AVEC erreur apparaît avec
    // `sampleRate + (1 - sampleRate) × errorSampleRate`. Les deux nombres sont
    // donc nécessaires pour reconstruire la probabilité d'inclusion, et c'est
    // elle — pas le taux — qui donne le poids. Détail dans migration-v58.
    "mip.sample_rate": String(cfg.sampleRate ?? 1),
    "mip.error_sample_rate": String((cfg.keepOnError ?? true) ? (cfg.errorSampleRate ?? 1) : 0),
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
      // Le PREMIER pageview de la trace en est la racine : il prend l'identifiant
      // réservé, et n'a pas de parent. Les suivants — le rejeu de la file de
      // retry peut en produire un second — reçoivent un identifiant neuf, sans
      // quoi deux spans porteraient la même clé et l'ingestion en jetterait un.
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
          if (ended) return; // end() idempotent
          ended = true;
          // Les spans d'appel API (http.client) ont déjà un contexte W3C : c'est
          // celui qui part dans `traceparent`, donc celui que le serveur voit.
          // On le recopie dans les champs NATIFS pour que les deux vues (attributs
          // propriétaires et OTLP standard) désignent le même span.
          const a = span.attributes as Record<string, unknown>;
          if (typeof a["mip.trace_id"] === "string") span.traceId = a["mip.trace_id"];
          if (typeof a["mip.span_id"] === "string") span.spanId = a["mip.span_id"];
          if (typeof a["mip.parent_span_id"] === "string") span.parentSpanId = a["mip.parent_span_id"];
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
