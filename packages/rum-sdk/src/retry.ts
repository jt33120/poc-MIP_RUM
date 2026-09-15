// File de retry/offline (LIMITES §4) — best-effort documenté :
// décorateur de SpanExporter ; si l'export échoue (FAILED), les spans sont
// sérialisés (name + attributs + timestamps) dans localStorage et ré-émis au
// prochain init() avec leurs timestamps d'origine (les span_id changent — le
// `on conflict do nothing` côté ingestion reste donc sans effet ici, doublon
// possible si l'échec était un faux négatif réseau ; assumé pour un POC).
// Limite connue : un envoi sendBeacon « accepté » par le navigateur mais perdu
// ensuite n'est pas détectable — seuls les échecs remontés par l'exporter
// (réseau down, 4xx/5xx en XHR/fetch) alimentent la file.
// Types d'export locaux (ex-@opentelemetry/core + sdk-trace-web) : le SDK OTel a
// été retiré (Chantier A, allègement du bundle) — on ne garde que le contrat
// minimal réellement utilisé par le décorateur et l'émetteur maison (otel.ts).
export enum ExportResultCode {
  SUCCESS = 0,
  FAILED = 1,
}
export interface ExportResult {
  code: ExportResultCode;
  error?: Error;
  /**
   * L'échec vaut-il la peine d'être rejoué ? `false` = définitif, on jette.
   *
   * Absent vaut « oui », pour que tout exporteur tiers non averti garde le
   * comportement d'avant. Voir `classerReponse`.
   */
  retryable?: boolean;
  /** Délai demandé par le serveur (en-tête `Retry-After`), en millisecondes. */
  retryAfterMs?: number | null;
}

// ═══════════════ Ce qui mérite d'être rejoué, et quand ════════════════════════
//
// Finding 2.2 de docs/AUDIT_RUM_EXTERNE.md — bloquant.
//
// CE QUI ÉTAIT EN PLACE : `cb({ code: res.ok ? SUCCESS : FAILED })`. TOUT ce qui
// n'est pas 2xx était un échec réessayable — 400 (JSON invalide), 403 (clé
// refusée), 413 (charge trop grosse) compris. Trois scénarios très ordinaires
// devenaient des boucles :
//
//   • une clé d'API mal saisie (403) rejouait indéfiniment, à chaque page, pour
//     rien, jusqu'à saturer les 50 Ko de la file ;
//   • un incident d'ingestion (503) faisait converger TOUS les navigateurs vers
//     un rejeu simultané à la reprise — le retour de service recevait un pic
//     supérieur au trafic nominal ;
//   • l'en-tête `retry-after: 60` que l'ingestion prend soin de renvoyer sur un
//     429 n'était lu par personne.

/** Statuts qu'il est utile de retenter : le serveur dit « plus tard », pas « non ». */
const REJOUABLES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Classe une réponse HTTP. PURE, donc testable sans réseau.
 *
 * Un échec RÉSEAU (pas de réponse du tout) est rejouable : c'est le cas nominal
 * du mode hors-ligne, celui pour lequel cette file existe.
 */
export function classerReponse(status: number | null): { retryable: boolean } {
  if (status == null) return { retryable: true }; // pas de réponse : réseau
  if (status >= 200 && status < 300) return { retryable: false }; // succès
  if (REJOUABLES.has(status)) return { retryable: true };
  if (status >= 500) return { retryable: true }; // 5xx inconnu : le serveur a un souci
  return { retryable: false }; // 4xx : la requête est en tort, la rejouer ne l'améliore pas
}

/**
 * Lit `Retry-After`, en secondes ou en date HTTP. Rend `null` si absent ou
 * illisible, et JAMAIS une valeur négative.
 */
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
 * Délai avant la prochaine tentative, avec BRUIT.
 *
 * Le bruit n'est pas un ornement : sans lui, tous les navigateurs qui ont échoué
 * pendant un incident reviennent à la même seconde, et le retour de service
 * reçoit un pic supérieur au trafic nominal. C'est l'incident qui se reproduit
 * tout seul.
 *
 * Quand le serveur a dit `Retry-After`, le bruit ne fait que DISPERSER le
 * retour : il ne raccourcit jamais l'attente demandée.
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
}
export interface SpanExporter {
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void;
  shutdown(): Promise<void>;
  forceFlush?(): Promise<void>;
}

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
    // Les identifiants métier bruts ne doivent jamais atteindre localStorage.
    // Ils sont transportés une seule fois vers le port d'ingestion, qui les
    // remplace par un HMAC avant toute file/persistance serveur.
    if (k === "mip.identity.user_id" || k === "mip.identity.account_id") continue;
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

/**
 * Ce que la file garde entre deux chargements de page.
 *
 * La version 1 stockait un tableau nu. On la lit encore — un navigateur peut
 * porter une file écrite par le SDK d'avant — et on la traite comme échue,
 * c'est-à-dire rejouable tout de suite : c'était son comportement.
 */
export interface FileRejeu {
  spans: RetrySpan[];
  /** Epoch ms avant lequel on ne rejoue pas. */
  notBefore: number;
  /** Tentatives déjà faites sur ce contenu — pilote le retrait exponentiel. */
  tentatives: number;
}

const FILE_VIDE: FileRejeu = { spans: [], notBefore: 0, tentatives: 0 };

export function loadRetryQueue(): FileRejeu {
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

export function saveRetryQueue(file: FileRejeu): void {
  try {
    localStorage.setItem(RETRY_KEY, JSON.stringify(file));
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
 * Rejoue la file si son échéance est passée. Rend le nombre de spans rejoués —
 * zéro si la file est vide OU si elle n'est pas encore due.
 *
 * On purge AVANT de réémettre : si le rejeu échoue à son tour, le décorateur
 * réalimentera la file, avec une tentative de plus donc une échéance plus
 * lointaine. Ne pas purger produirait un doublement à chaque tour.
 */
export function replayRetryQueue(
  emitRaw: (name: string, attrs: RetryAttrs, startMs: number, endMs: number) => void,
  maintenant: number = Date.now(),
): number {
  const file = loadRetryQueue();
  if (file.spans.length === 0) return 0;
  // PAS ENCORE DUE. On se tait, et surtout on ne purge pas : la file doit
  // survivre à ce chargement de page pour être rejouée au bon moment.
  if (file.notBefore > maintenant) return 0;
  purgeRetryQueue();
  for (const s of file.spans) emitRaw(s.n, s.a, s.s, s.e);
  return file.spans.length;
}

/**
 * Décorateur : persiste les spans quand l'export échoue ET que l'échec vaut la
 * peine d'être rejoué.
 *
 * TROIS SORTIES, LÀ OÙ IL N'Y EN AVAIT QU'UNE. Succès : rien. Échec définitif
 * (4xx hors 429) : on JETTE, en le journalisant une fois — rejouer une clé
 * refusée ne la fera pas accepter. Échec rejouable : on met en file avec une
 * échéance, dispersée par du bruit.
 */
export class RetryExporter implements SpanExporter {
  private abandonSignale = false;

  constructor(
    private inner: SpanExporter,
    private horloge: () => number = Date.now,
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.inner.export(spans, (result) => {
      if (result.code === ExportResultCode.FAILED && result.retryable !== false) {
        try {
          const file = loadRetryQueue();
          const tentatives = file.tentatives + 1;
          if (tentatives > RETRY_MAX_TENTATIVES) {
            // Six échecs successifs : ce lot ne passera pas. Le garder
            // remplirait la file au détriment de spans plus récents, qui eux
            // ont une chance.
            purgeRetryQueue();
            this.signalerAbandon("file rejouée sans succès, abandonnée");
          } else {
            const maintenant = this.horloge();
            saveRetryQueue({
              spans: appendRetry(file.spans, spans.map(serializeSpan)),
              notBefore:
                maintenant + delaiProchainEssai(tentatives, result.retryAfterMs ?? null),
              tentatives,
            });
          }
        } catch {
          /* best-effort */
        }
      } else if (result.code === ExportResultCode.FAILED) {
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
