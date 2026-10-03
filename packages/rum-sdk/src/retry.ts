// File de rejeu hors ligne, best-effort (docs/LIMITES.md §4) : un export échoué
// est gardé dans localStorage et réémis au prochain init() avec ses horodatages
// et identifiants OTLP d'origine, que l'ingestion déduplique. Un sendBeacon
// accepté puis perdu reste indétectable. Types d'export minimaux, repris du SDK
// OpenTelemetry retiré du bundle.
import { accesTerminalAutorise } from "./consent";

export enum ExportResultCode {
  SUCCESS = 0,
  FAILED = 1,
}
export interface ExportResult {
  code: ExportResultCode;
  error?: Error;
  /** Annulation volontaire (retrait de consentement) : ne rien persister. */
  discarded?: boolean;
  /** `false` = échec définitif, on jette ; absent vaut « oui » (exporteurs tiers). */
  retryable?: boolean;
  /** Délai demandé par le serveur (en-tête `Retry-After`), en millisecondes. */
  retryAfterMs?: number | null;
}

// Ne rejouer que ce qui peut réussir, et pas tous à la même seconde
// (finding 2.2 de docs/AUDIT_RUM_EXTERNE.md).

/** Statuts qu'il est utile de retenter : le serveur dit « plus tard », pas « non ». */
const REJOUABLES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Classe une réponse HTTP ; sans réponse (hors ligne), l'échec est rejouable. */
export function classerReponse(status: number | null): { retryable: boolean } {
  if (status == null) return { retryable: true };
  if (status >= 200 && status < 300) return { retryable: false };
  if (REJOUABLES.has(status)) return { retryable: true };
  if (status >= 500) return { retryable: true }; // 5xx inconnu : le serveur a un souci
  return { retryable: false }; // 4xx : la requête est en tort, la rejouer ne l'améliore pas
}

/** Lit `Retry-After` (secondes ou date HTTP) en ms ; `null` si absent, illisible ou passé. */
export function lireRetryAfter(valeur: string | null, maintenant: number = Date.now()): number | null {
  if (!valeur) return null;
  const secondes = Number(valeur.trim());
  if (Number.isFinite(secondes)) return secondes > 0 ? Math.round(secondes * 1000) : null;
  const date = Date.parse(valeur);
  if (!Number.isFinite(date)) return null;
  const delta = date - maintenant;
  return delta > 0 ? delta : null;
}

/** Premier palier du retrait exponentiel. */
export const RETRY_BASE_MS = 30_000;
/** Plafond du retrait : au-delà, on n'attend pas plus longtemps. */
export const RETRY_MAX_MS = 30 * 60_000;
/** Au-delà, la file est jetée : ce lot ne passera jamais. */
export const RETRY_MAX_TENTATIVES = 6;

/**
 * Délai avant la prochaine tentative, bruité : sans bruit, tous les navigateurs
 * reviennent à la même seconde après un incident. Le bruit n'écourte jamais un
 * `Retry-After`.
 */
export function delaiProchainEssai(
  tentatives: number,
  retryAfterMs: number | null,
  alea: number = Math.random(),
): number {
  if (retryAfterMs != null && retryAfterMs > 0) return Math.round(retryAfterMs * (1 + alea * 0.5));
  const expo = Math.min(RETRY_BASE_MS * 2 ** Math.min(Math.max(tentatives, 0), 10), RETRY_MAX_MS);
  return Math.round(expo * (0.5 + alea));
}
/** Span lisible minimal consommé par serializeSpan (name + attrs + timestamps). */
export interface ReadableSpan {
  name: string;
  attributes: Record<string, unknown>;
  startTime: HrTime;
  endTime: HrTime;
  /** Identifiants OTLP natifs, conservés pour rendre un rejeu idempotent. */
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}
export interface SpanExporter {
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void;
  shutdown(): Promise<void>;
  forceFlush?(): Promise<void>;
}

export const RETRY_KEY = "mip_rum_retry";
export const RETRY_REVOKED_ACTIONS_KEY = "mip_rum_retry_revoked_actions";
export const RETRY_MAX_SPANS = 100;
export const RETRY_MAX_BYTES = 50_000; // ~50 Ko sérialisés
const RETRY_MAX_REVOKED_ACTIONS = 200;
// Non borné en mémoire : des requêtes en vol peuvent finir après plus de 200
// évictions. Le miroir localStorage reste borné, elles meurent au rechargement.
const revokedRootsMemory = new Set<string>();

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
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}): RetrySpan {
  const a: RetryAttrs = {};
  for (const [k, v] of Object.entries(span.attributes)) {
    // Identifiants métier bruts : jamais dans localStorage ; seule l'ingestion
    // les reçoit, et les remplace par un HMAC.
    if (k === "mip.identity.user_id" || k === "mip.identity.account_id") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") a[k] = v;
  }
  // otel.ts recopie ces attributs dans les champs natifs au rejeu : l'ingestion
  // retrouve la même clé (ON CONFLICT) au lieu de compter un doublon.
  if (typeof span.traceId === "string" && !("mip.trace_id" in a)) a["mip.trace_id"] = span.traceId;
  if (typeof span.spanId === "string" && !("mip.span_id" in a)) a["mip.span_id"] = span.spanId;
  if (!("mip.parent_span_id" in a)) {
    // Parent vide explicite : sinon un rejeu après la pageview hériterait du
    // parent de la page courante.
    a["mip.parent_span_id"] = typeof span.parentSpanId === "string" ? span.parentSpanId : "";
  }
  return { n: span.name, a, s: hrToMs(span.startTime), e: hrToMs(span.endTime) };
}

/** Ajoute à la file en respectant les caps (nombre puis octets) — purge les plus anciens. */
export function appendRetry(
  queue: RetrySpan[],
  spans: RetrySpan[],
  capCount: number = RETRY_MAX_SPANS,
  capBytes: number = RETRY_MAX_BYTES,
  revokedRoots: Set<string> = new Set(),
): RetrySpan[] {
  const incomingRoots = new Set(
    spans
      .filter((span) => span.n === "rum.action" && span.a["mip.event_type"] === "action")
      .map((span) => span.a["mip.action_id"])
      .filter((id): id is string => typeof id === "string"),
  );
  for (const id of incomingRoots) revokedRoots.delete(id);
  const safeIncoming = spans.map((span) => {
    const id = span.a["mip.action_id"];
    if (span.n === "rum.action" || typeof id !== "string" || !revokedRoots.has(id)) return span;
    const attrs = { ...span.a };
    delete attrs["mip.action_id"];
    return { ...span, a: attrs };
  });
  let merged = queue.concat(safeIncoming);
  const rootsBefore = new Set(
    merged
      .filter((span) => span.n === "rum.action" && span.a["mip.event_type"] === "action")
      .map((span) => span.a["mip.action_id"])
      .filter((id): id is string => typeof id === "string"),
  );
  if (merged.length > capCount) merged = merged.slice(merged.length - capCount);
  while (merged.length > 0 && JSON.stringify(merged).length > capBytes) merged.shift();
  const rootsAfter = new Set(
    merged
      .filter((span) => span.n === "rum.action" && span.a["mip.event_type"] === "action")
      .map((span) => span.a["mip.action_id"])
      .filter((id): id is string => typeof id === "string"),
  );
  const evictedRoots = new Set([...rootsBefore].filter((id) => !rootsAfter.has(id)));
  for (const id of evictedRoots) revokedRoots.add(id);
  if (evictedRoots.size) {
    merged = merged.map((span) => {
      const id = span.a["mip.action_id"];
      if (typeof id !== "string" || !evictedRoots.has(id) || span.n === "rum.action") return span;
      const attrs = { ...span.a };
      delete attrs["mip.action_id"];
      return { ...span, a: attrs };
    });
  }
  return merged;
}

/** Ce que la file garde entre deux pages. Un tableau nu (format v1) se lit encore, comme une file échue. */
export interface FileRejeu {
  spans: RetrySpan[];
  /** Epoch ms avant lequel on ne rejoue pas. */
  notBefore: number;
  /** Tentatives déjà faites sur ce contenu — pilote le retrait exponentiel. */
  tentatives: number;
}

const FILE_VIDE: FileRejeu = { spans: [], notBefore: 0, tentatives: 0 };

// Sous consentement (finding 1.11) : un lot en vol peut échouer juste après un
// refus, donc lire et écrire la file exigent `accesTerminalAutorise`. L'effacer
// reste toujours permis (`purgeRetryQueue`).
function loadRevokedRoots(): Set<string> {
  if (!accesTerminalAutorise()) return revokedRootsMemory;
  try {
    const raw = JSON.parse(localStorage.getItem(RETRY_REVOKED_ACTIONS_KEY) || "[]");
    if (Array.isArray(raw)) {
      for (const id of raw.slice(-RETRY_MAX_REVOKED_ACTIONS)) {
        if (typeof id === "string") revokedRootsMemory.add(id);
      }
    }
  } catch {
    /* stockage indisponible : la mémoire de page reste autoritaire */
  }
  return revokedRootsMemory;
}

function saveRevokedRoots(roots: Set<string>): void {
  for (const id of roots) revokedRootsMemory.add(id);
  if (!accesTerminalAutorise()) return;
  try {
    localStorage.setItem(
      RETRY_REVOKED_ACTIONS_KEY,
      JSON.stringify([...revokedRootsMemory].slice(-RETRY_MAX_REVOKED_ACTIONS)),
    );
  } catch {
    /* quota / mode privé : best-effort */
  }
}

function clearRetryFile(): void {
  try {
    localStorage.removeItem(RETRY_KEY);
  } catch {
    /* ignore */
  }
}

export function loadRetryQueue(): FileRejeu {
  if (!accesTerminalAutorise()) return { ...FILE_VIDE };
  try {
    const raw = JSON.parse(localStorage.getItem(RETRY_KEY) || "null");
    if (Array.isArray(raw)) return { spans: raw as RetrySpan[], notBefore: 0, tentatives: 0 };
    if (raw && Array.isArray(raw.spans)) {
      return {
        spans: raw.spans as RetrySpan[],
        notBefore: Number(raw.notBefore) || 0,
        tentatives: Number(raw.tentatives) || 0,
      };
    }
    return { ...FILE_VIDE };
  } catch {
    return { ...FILE_VIDE };
  }
}

export function saveRetryQueue(file: FileRejeu): boolean {
  if (!accesTerminalAutorise()) return false;
  try {
    localStorage.setItem(RETRY_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

function revokeRootsFrom(spans: RetrySpan[], roots: Set<string>): void {
  for (const span of spans) {
    const id = span.n === "rum.action" ? span.a["mip.action_id"] : null;
    if (typeof id === "string") roots.add(id);
  }
}

export function purgeRetryQueue(): void {
  clearRetryFile();
  revokedRootsMemory.clear();
  try { localStorage.removeItem(RETRY_REVOKED_ACTIONS_KEY); } catch { /* ignore */ }
}

/**
 * Rejoue la file si elle est due ; rend le nombre de spans rejoués. Purge avant
 * de réémettre : un nouvel échec la réalimente avec une échéance plus lointaine
 * au lieu de la doubler.
 */
export function replayRetryQueue(
  emitRaw: (name: string, attrs: RetryAttrs, startMs: number, endMs: number) => void,
  maintenant: number = Date.now(),
): number {
  const file = loadRetryQueue();
  if (file.spans.length === 0) return 0;
  // Pas encore due : surtout ne pas purger.
  if (file.notBefore > maintenant) return 0;
  // Les tombstones survivent : un enfant lent d'une racine évincée peut encore arriver.
  clearRetryFile();
  for (const s of file.spans) emitRaw(s.n, s.a, s.s, s.e);
  return file.spans.length;
}

/**
 * Décorateur d'export qui met en file les échecs rejouables, avec une échéance
 * bruitée. Un échec définitif est jeté et signalé une fois : rejouer une clé
 * refusée ne la fera pas accepter.
 */
export class RetryExporter implements SpanExporter {
  private abandonSignale = false;

  constructor(
    private inner: SpanExporter,
    private horloge: () => number = Date.now,
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const revokedRoots = loadRevokedRoots();
    // Une racine réémise lève sa révocation ; tout enfant d'une racine abandonnée
    // ou évincée est délié avant l'export.
    for (const span of spans) {
      if (span.name === "rum.action" && span.attributes["mip.event_type"] === "action") {
        const id = span.attributes["mip.action_id"];
        if (typeof id === "string") revokedRoots.delete(id);
      }
    }
    const outbound = spans.map((span) => {
      const id = span.attributes["mip.action_id"];
      if (span.name === "rum.action" || typeof id !== "string" || !revokedRoots.has(id)) return span;
      const attributes = { ...span.attributes };
      delete attributes["mip.action_id"];
      return { ...span, attributes };
    });
    saveRevokedRoots(revokedRoots);

    this.inner.export(outbound, (result) => {
      if (result.code === ExportResultCode.FAILED && result.discarded) {
        // Lot détruit à la demande de l'utilisateur : ni rejeu ni tombstone.
      } else if (result.code === ExportResultCode.FAILED && result.retryable !== false) {
        try {
          const file = loadRetryQueue();
          const tentatives = file.tentatives + 1;
          const serialized = outbound.map(serializeSpan);
          if (tentatives > RETRY_MAX_TENTATIVES) {
            // Ce lot ne passera pas : le garder évincerait des spans plus récents.
            clearRetryFile();
            revokeRootsFrom(serialized, revokedRoots);
            saveRevokedRoots(revokedRoots);
            this.signalerAbandon("file rejouée sans succès, abandonnée");
          } else {
            const maintenant = this.horloge();
            const queued = appendRetry(file.spans, serialized, RETRY_MAX_SPANS, RETRY_MAX_BYTES, revokedRoots);
            const saved = saveRetryQueue({
              spans: queued,
              notBefore:
                maintenant + delaiProchainEssai(tentatives, result.retryAfterMs ?? null),
              tentatives,
            });
            if (!saved) revokeRootsFrom(serialized, revokedRoots);
            // Tant que la racine n'est pas réémise, les lots suivants partent
            // déliés : la télémétrie continue, sans orphelins.
            revokeRootsFrom(serialized, revokedRoots);
            saveRevokedRoots(revokedRoots);
          }
        } catch {
          /* best-effort */
        }
      } else if (result.code === ExportResultCode.FAILED) {
        revokeRootsFrom(outbound.map(serializeSpan), revokedRoots);
        saveRevokedRoots(revokedRoots);
        this.signalerAbandon("réponse définitive de l'ingestion, lot abandonné");
      }
      resultCallback(result);
    });
  }

  /** Une seule fois par page : un avertissement répété est un bruit de plus. */
  private signalerAbandon(raison: string): void {
    if (this.abandonSignale) return;
    this.abandonSignale = true;
    try {
      console.warn(`[mip-rum] ${raison}`);
    } catch {
      /* console indisponible */
    }
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
