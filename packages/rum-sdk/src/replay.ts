// Session replay (ROADMAP v0.3 B2). Le cœur reste léger : rrweb vit dans le
// bundle séparé dist/mip-rum-replay.js (global MIPRumReplay), lazy-loadé ici
// uniquement si replay activé + session échantillonnée + consent acquis.
// Chunks : events rrweb -> JSON -> gzip (CompressionStream) -> POST binaire
// /v1/replay (headers x-mip-session / x-mip-app / x-mip-seq).
import type { MIPRumConfig } from "./types";

export const REPLAY_MAX_MS = 120_000; // stop après 2 min d'enregistrement
export const REPLAY_MAX_COMPRESSED_BYTES = 1024 * 1024; // stop après 1 Mo gzip cumulé
export const CHUNK_FLUSH_MS = 10_000; // flush périodique
export const CHUNK_MAX_RAW_BYTES = 256 * 1024; // flush anticipé (taille brute)
export const REPLAY_BUNDLE = "mip-rum-replay.js";

/** Échantillonnage replay : true = toutes les sessions, number = taux 0..1. */
export function isReplaySampled(
  replay: boolean | number | undefined,
  rnd: number = Math.random(),
): boolean {
  if (!replay) return false; // false / 0 / undefined
  return replay === true || rnd < replay;
}

/** Endpoint replay : surcharge explicite, sinon dérivé de l'endpoint OTLP. */
export function deriveReplayEndpoint(endpoint: string, replayEndpoint?: string): string {
  if (replayEndpoint) return replayEndpoint;
  if (endpoint.includes("/v1/traces")) return endpoint.replace("/v1/traces", "/v1/replay");
  // edge function Supabase nommée v1-traces (…/functions/v1/v1-traces)
  return endpoint.replace("v1-traces", "v1-replay");
}

/** URL du bundle replay : même origine/répertoire que le script principal. */
export function resolveReplayScriptUrl(mainScriptSrc: string | null): string {
  if (!mainScriptSrc) return `/${REPLAY_BUNDLE}`;
  return new URL(REPLAY_BUNDLE, mainScriptSrc).href;
}

export interface ReplayChunk {
  seq: number;
  events: unknown[];
}

/** Buffer d'événements rrweb : découpage en chunks + caps (logique pure, testée). */
export class ReplayBuffer {
  private events: unknown[] = [];
  private rawBytes = 0;
  private compressedBytes = 0;
  private nextSeq = 0;
  stopped = false;

  constructor(
    private maxRawBytes: number = CHUNK_MAX_RAW_BYTES,
    private maxCompressedBytes: number = REPLAY_MAX_COMPRESSED_BYTES,
  ) {}

  /** Ajoute un événement ; true = chunk plein (≥ 256 Ko brut), flush requis. */
  add(event: unknown): boolean {
    if (this.stopped) return false;
    this.events.push(event);
    this.rawBytes += JSON.stringify(event).length;
    return this.rawBytes >= this.maxRawBytes;
  }

  /** Extrait le chunk courant (seq croissant) et vide le buffer ; null si vide. */
  take(): ReplayChunk | null {
    if (!this.events.length) return null;
    const events = this.events;
    this.events = [];
    this.rawBytes = 0;
    return { seq: this.nextSeq++, events };
  }

  /** Comptabilise un chunk compressé envoyé ; true = cap 1 Mo atteint (stop). */
  addCompressed(bytes: number): boolean {
    this.compressedBytes += bytes;
    if (this.compressedBytes >= this.maxCompressedBytes) this.stopped = true;
    return this.stopped;
  }

  get pending(): number {
    return this.events.length;
  }
  get sentCompressedBytes(): number {
    return this.compressedBytes;
  }
}

// ---------------------------------------------------------------------------
// Contrôleur DOM (non couvert par les tests unitaires : validé par
// scripts/validate-replay.mjs en démo headless)
// ---------------------------------------------------------------------------

// src du script principal, capturé au chargement du bundle (document.currentScript
// est nul une fois le script exécuté — init() arrive trop tard)
const mainScriptSrc =
  typeof document !== "undefined"
    ? ((document.currentScript as HTMLScriptElement | null)?.src ?? null)
    : null;

type RecordFn = (options: Record<string, unknown>) => (() => void) | undefined;

/** Lazy-load du bundle rrweb (IIFE MIPRumReplay) depuis l'origine du script principal. */
function loadReplayBundle(url: string): Promise<RecordFn> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { MIPRumReplay?: { record?: RecordFn } };
    if (w.MIPRumReplay?.record) return resolve(w.MIPRumReplay.record);
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => {
      const record = w.MIPRumReplay?.record;
      if (record) resolve(record);
      else reject(new Error("MIPRumReplay global missing"));
    };
    s.onerror = () => reject(new Error(`replay bundle load failed: ${url}`));
    document.head.appendChild(s);
  });
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let started = false;

/**
 * Démarre l'enregistrement replay (appelé par init() une fois la session
 * échantillonnée ET le consent acquis). Masquage par défaut : maskAllInputs
 * + blockClass 'mip-rum-block'. Caps : 2 min ou 1 Mo gzip cumulé.
 */
export function startReplay(cfg: MIPRumConfig, sessionId: string): void {
  if (started) return;
  if (typeof CompressionStream === "undefined") return; // navigateur trop ancien
  started = true;

  const endpoint = deriveReplayEndpoint(cfg.endpoint, cfg.replayEndpoint);
  const buffer = new ReplayBuffer();
  let stopRecording: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let posting: Promise<void> = Promise.resolve(); // sérialise les POST (ordre des seq)

  const stop = () => {
    if (timer != null) clearInterval(timer);
    timer = undefined;
    try {
      stopRecording?.();
    } catch {
      /* déjà stoppé */
    }
    stopRecording = undefined;
    buffer.stopped = true;
  };

  const flush = () => {
    const chunk = buffer.take();
    if (!chunk) return;
    posting = posting.then(async () => {
      try {
        const bytes = await gzip(JSON.stringify(chunk.events));
        await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-mip-session": sessionId,
            "x-mip-app": cfg.appId,
            "x-mip-seq": String(chunk.seq),
            // clé d'API pour les apps qui en exigent une (l'ingestion replay
            // partage l'auth de /v1/traces). fetch porte des en-têtes, contrairement
            // au beacon OTLP qui passe la clé en attribut resource mip.api_key.
            ...(cfg.apiKey ? { "x-mip-key": cfg.apiKey } : {}),
          },
          body: bytes,
          // keepalive (limite ~64 Ko) : le dernier chunk survit au pagehide
          keepalive: bytes.length < 60_000,
        });
        if (buffer.addCompressed(bytes.length)) stop(); // cap 1 Mo gzip cumulé
      } catch {
        /* best effort : chunk perdu, le suivant repart */
      }
    });
  };

  loadReplayBundle(resolveReplayScriptUrl(mainScriptSrc))
    .then((record) => {
      if (buffer.stopped) return;
      stopRecording = record({
        emit: (event: unknown) => {
          if (buffer.add(event)) flush(); // ≥ 256 Ko brut -> flush anticipé
        },
        maskAllInputs: true, // masquage par défaut (RGPD)
        blockClass: "mip-rum-block",
      });
      timer = setInterval(flush, CHUNK_FLUSH_MS);
      // cap 2 min : flush final puis stop
      setTimeout(() => {
        flush();
        stop();
      }, REPLAY_MAX_MS);
      // dernier chunk avant fermeture/onglet caché (fetch keepalive)
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
      });
    })
    .catch(() => {
      started = false; // bundle indisponible : replay off, le RUM continue
    });
}
