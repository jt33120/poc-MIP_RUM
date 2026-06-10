// File de retry/offline (LIMITES §4) — best-effort documenté :
// décorateur de SpanExporter ; si l'export échoue (FAILED), les spans sont
// sérialisés (name + attributs + timestamps) dans localStorage et ré-émis au
// prochain init() avec leurs timestamps d'origine (les span_id changent — le
// `on conflict do nothing` côté ingestion reste donc sans effet ici, doublon
// possible si l'échec était un faux négatif réseau ; assumé pour un POC).
// Limite connue : un envoi sendBeacon « accepté » par le navigateur mais perdu
// ensuite n'est pas détectable — seuls les échecs remontés par l'exporter
// (réseau down, 4xx/5xx en XHR/fetch) alimentent la file.
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-web";

// ré-export pour les tests unitaires (résolution depuis la racine du workspace)
export { ExportResultCode };

export const RETRY_KEY = "mip_rum_retry";
export const RETRY_MAX_SPANS = 100;
export const RETRY_MAX_BYTES = 50_000; // ~50 Ko sérialisés

export type RetryAttrs = Record<string, string | number | boolean>;

/** Span essentiel sérialisé : n=name, a=attributes, s/e=start/end (epoch ms). */
export interface RetrySpan {
  n: string;
  a: RetryAttrs;
  s: number;
  e: number;
}

type HrTime = [number, number];

function hrToMs(t: HrTime): number {
  return Math.round(t[0] * 1e3 + t[1] / 1e6);
}

/** Ne garde que name + attributs primitifs + timestamps (payload minimal). */
export function serializeSpan(span: {
  name: string;
  attributes: Record<string, unknown>;
  startTime: HrTime;
  endTime: HrTime;
}): RetrySpan {
  const a: RetryAttrs = {};
  for (const [k, v] of Object.entries(span.attributes)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") a[k] = v;
  }
  return { n: span.name, a, s: hrToMs(span.startTime), e: hrToMs(span.endTime) };
}

/** Ajoute à la file en respectant les caps (nombre puis octets) — purge les plus anciens. */
export function appendRetry(
  queue: RetrySpan[],
  spans: RetrySpan[],
  capCount: number = RETRY_MAX_SPANS,
  capBytes: number = RETRY_MAX_BYTES,
): RetrySpan[] {
  let merged = queue.concat(spans);
  if (merged.length > capCount) merged = merged.slice(merged.length - capCount);
  while (merged.length > 0 && JSON.stringify(merged).length > capBytes) merged.shift();
  return merged;
}

export function loadRetryQueue(): RetrySpan[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RETRY_KEY) || "[]");
    return Array.isArray(raw) ? (raw as RetrySpan[]) : [];
  } catch {
    return [];
  }
}

export function saveRetryQueue(queue: RetrySpan[]): void {
  try {
    localStorage.setItem(RETRY_KEY, JSON.stringify(queue));
  } catch {
    /* quota / mode privé : on abandonne, best-effort */
  }
}

export function purgeRetryQueue(): void {
  try {
    localStorage.removeItem(RETRY_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Rejoue la file (purge d'abord : si le rejeu échoue à son tour, le décorateur
 * ré-alimentera la file). Retourne le nombre de spans rejoués.
 */
export function replayRetryQueue(
  emitRaw: (name: string, attrs: RetryAttrs, startMs: number, endMs: number) => void,
): number {
  const queue = loadRetryQueue();
  if (queue.length === 0) return 0;
  purgeRetryQueue();
  for (const s of queue) emitRaw(s.n, s.a, s.s, s.e);
  return queue.length;
}

/** Décorateur : persiste les spans dans localStorage quand l'export inner échoue. */
export class RetryExporter implements SpanExporter {
  constructor(private inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.inner.export(spans, (result) => {
      if (result.code === ExportResultCode.FAILED) {
        try {
          saveRetryQueue(appendRetry(loadRetryQueue(), spans.map(serializeSpan)));
        } catch {
          /* best-effort */
        }
      }
      resultCallback(result);
    });
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
