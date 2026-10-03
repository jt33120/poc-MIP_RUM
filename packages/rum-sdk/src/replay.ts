// Session replay. rrweb vit dans le bundle séparé dist/mip-rum-replay.js (global
// MIPRumReplay), chargé seulement si le rejeu est activé, la session échantillonnée
// et le consentement acquis : le cœur reste léger.
import type { recordOptions } from "rrweb";
import { MIP_UI_ATTR } from "./breadcrumbs";
import { classerReponse, lireRetryAfter } from "./retry";
import type { MIPRumConfig } from "./types";

export const REPLAY_MAX_MS = 120_000;
export const REPLAY_MAX_COMPRESSED_BYTES = 1024 * 1024; // gzip cumulé
export const CHUNK_FLUSH_MS = 10_000;
export const CHUNK_MAX_RAW_BYTES = 256 * 1024; // taille JSON brute : déclenche un envoi anticipé
export const REPLAY_BUNDLE = "mip-rum-replay.js";

// Masquage : tout est masqué par défaut (`"all"`), l'application démasque ce
// qu'elle décide de montrer.

/**
 * Éléments porteurs de contenu, remplacés par un cadre de même taille. `svg` y
 * est, au prix des icônes : un graphique SVG porte des chiffres client comme un
 * `canvas`. `iframe` n'y est pas : rrweb masque une iframe de même origine avec
 * les mêmes règles, la bloquer perdrait l'enregistrement.
 */
export const SELECTEUR_MEDIAS = "img,video,audio,canvas,svg,picture,object,embed";

/** Classe que l'application pose pour exclure un bloc, quel que soit le niveau. */
export const CLASSE_BLOC = "mip-rum-block";

/**
 * Classe qui démasque une zone sous `"all"` et `"media"`. rrweb 2.0.1 n'a pas de
 * sélecteur de démasquage : on passe par `maskTextFn` et par un `blockSelector`
 * qui exclut la zone (`selecteurMediasBloques`).
 */
export const CLASSE_DEMASQUE = "mip-rum-unmask";

/**
 * Ce qui reste masqué dans une zone démasquée : `maskAllInputs` masque la valeur
 * d'un champ, pas le texte d'un `contenteditable` ni d'un `select`. `designMode`
 * est traité dans `estDemasque`.
 */
export const SELECTEUR_TOUJOURS_MASQUE =
  `.${CLASSE_BLOC},textarea,select,[contenteditable]:not([contenteditable=false])`;

/** Ce que le rejeu cache. `all` est le défaut. */
export type NiveauMasquage = "all" | "media" | "inputs";

/** Signature de `maskTextFn` dans rrweb-snapshot 2.0.1 (`MaskTextFn`). */
export type MasqueTexte = (texte: string, element: HTMLElement | null) => string;

export interface OptionsMasquage {
  maskAllInputs: true;
  blockClass: string;
  maskTextSelector?: string;
  blockSelector?: string;
  maskTextFn?: MasqueTexte;
}

/** Les zones démasquées, telles que le navigateur les a acceptées. */
export interface Demasquage {
  /** La classe réservée, plus le sélecteur `replayUnmask` de l'application s'il est valide. */
  selecteur: string;
  /** Faux sans `:is()`/`:not()` complexes (avant Chrome 88, Firefox 84, Safari 14) : les médias restent bloqués. */
  medias: boolean;
}

/** Médias à bloquer, sauf ceux d'une zone démasquée ; `:is(zone) *` car la zone peut être une liste (`.a, .b`). */
export function selecteurMediasBloques(selecteurDemasque: string): string {
  return `:is(${SELECTEUR_MEDIAS}):not(:is(${selecteurDemasque}),:is(${selecteurDemasque}) *)`;
}

/** Le navigateur fait foi : un sélecteur qu'il refuse n'est pas valide. Hors navigateur, rien ne l'est. */
export function selecteurValide(selecteur: string): boolean {
  try {
    document.createElement("div").matches(selecteur);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sélecteur accepté par le navigateur mais sans effet : un pseudo-élément ne
 * désigne aucune zone, et un `/*` ouvert avale la suite du sélecteur de médias
 * une fois composé. Les chaînes entre guillemets sont écartées d'abord.
 */
export function selecteurInoperant(selecteur: string): boolean {
  return /\/\*|::|:(?:before|after|first-line|first-letter)(?![\w-])/i.test(
    selecteur.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""'),
  );
}

/**
 * Résout `replayUnmask` en zones démasquées. Un sélecteur invalide ou inopérant
 * est ignoré avec un avertissement : rrweb avale l'exception de `matches()` et
 * répond « non bloqué », ce qui démasquerait tous les médias.
 */
export function resoudreDemasquage(
  replayUnmask: unknown,
  valide: (selecteur: string) => boolean = selecteurValide,
  avertir: (message: string) => void = (m) => console.warn(m),
): Demasquage {
  let selecteur = `.${CLASSE_DEMASQUE}`;
  const brut = typeof replayUnmask === "string" ? replayUnmask.trim() : replayUnmask;
  if (brut !== undefined && brut !== null && brut !== "") {
    if (typeof brut === "string" && valide(brut) && !selecteurInoperant(brut)) selecteur = `${selecteur},${brut}`;
    else avertir(`[mip-rum] replayUnmask ignoré : ${JSON.stringify(brut)} n'est pas un sélecteur CSS utilisable (invalide, pseudo-élément ou commentaire). Rien n'est démasqué par cette option.`);
  }
  return { selecteur, medias: valide(selecteurMediasBloques(selecteur)) };
}

/**
 * L'élément est-il dans une zone démasquée, hors de ce qui reste masqué ? Toute
 * exception vaut « non ». Sous `designMode = "on"`, tout le document est une saisie.
 */
export function estDemasque(element: Element | null, selecteurDemasque: string): boolean {
  if (!element) return false;
  try {
    return (
      element.ownerDocument?.designMode !== "on" &&
      element.closest(selecteurDemasque) !== null &&
      element.closest(SELECTEUR_TOUJOURS_MASQUE) === null
    );
  } catch {
    return false;
  }
}

/** `maskTextFn` : en clair dans une zone démasquée, sinon le masquage de rrweb à l'identique. */
export function masquerTexteHors(selecteurDemasque: string): MasqueTexte {
  return (texte, element) => (estDemasque(element, selecteurDemasque) ? texte : texte.replace(/[\S]/g, "*"));
}

/**
 * Options rrweb d'un niveau de masquage. `maskAllInputs` et `blockClass` valent
 * pour les trois niveaux, démasquage compris : c'est le plancher, pas une option.
 */
export function optionsMasquage(niveau: NiveauMasquage = "all", demasquage?: Demasquage): OptionsMasquage {
  const base: OptionsMasquage = { maskAllInputs: true, blockClass: CLASSE_BLOC };
  if (niveau === "inputs") return base;
  const blockSelector = demasquage?.medias ? selecteurMediasBloques(demasquage.selecteur) : SELECTEUR_MEDIAS;
  if (niveau === "media") return { ...base, blockSelector };
  // `*` couvre tout nœud de texte ; `maskTextFn` décide ce qui reste en clair.
  const options: OptionsMasquage = { ...base, maskTextSelector: "*", blockSelector };
  if (demasquage) options.maskTextFn = masquerTexteHors(demasquage.selecteur);
  return options;
}

/** Échantillonnage replay : true = toutes les sessions, number = taux 0..1. */
export function isReplaySampled(
  replay: boolean | number | undefined,
  rnd: number = Math.random(),
): boolean {
  if (!replay) return false;
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

// Contrôleur DOM : couvert par tests/e2e/rum-flow.spec.ts, pas par les tests unitaires.

// Capturé au chargement : document.currentScript est nul quand init() s'exécute.
const mainScriptSrc =
  typeof document !== "undefined"
    ? ((document.currentScript as HTMLScriptElement | null)?.src ?? null)
    : null;

// Type seul, effacé au build : tsc vérifie `optionsMasquage` contre la version de
// rrweb embarquée sans faire entrer rrweb dans le cœur.
type RecordFn = (options: recordOptions<unknown>) => (() => void) | undefined;

/** Lazy-load du bundle rrweb (IIFE MIPRumReplay) depuis l'origine du script principal. */
function loadReplayBundle(url: string): Promise<RecordFn> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { MIPRumReplay?: { record?: RecordFn } };
    if (w.MIPRumReplay?.record) return resolve(w.MIPRumReplay.record);
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    // Son échec de chargement n'est pas une erreur de ressource de l'application.
    s.setAttribute(MIP_UI_ATTR, "");
    s.onload = () => {
      const record = w.MIPRumReplay?.record;
      if (record) resolve(record);
      else reject(new Error("MIPRumReplay global missing"));
    };
    s.onerror = () => reject(new Error(`replay bundle load failed: ${url}`));
    document.head.appendChild(s);
  });
}

// `Uint8Array<ArrayBuffer>` : depuis TypeScript 5.7, `BodyInit` exige un tampon non
// partagé, et `arrayBuffer()` en rend toujours un.
async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Tentatives d'un chunk refusé « plus tard », la première comprise. */
export const REPLAY_TENTATIVES = 4;
const REPLAY_ATTENTE_MAX_MS = 10_000;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Envoie un chunk et le reprend tant que le collector répond « plus tard ». Sous
 * la barrière RGPD, un chunk arrivé avant l'ancre de sa session reçoit 425 ; or le
 * chunk 0 porte l'instantané complet, sans lequel le rejeu est illisible. Borné,
 * pour ne pas bloquer la chaîne `posting` qui garde l'ordre des seq.
 */
export async function posterAvecReprise(
  envoyer: () => Promise<Response>,
  attendre: (ms: number) => Promise<void> = dormir,
  abandonne: () => boolean = () => false,
): Promise<boolean> {
  for (let tentative = 1; ; tentative++) {
    // Un refus de consentement survenu pendant l'attente : le morceau ne part plus.
    if (abandonne()) return false;
    let res: Response | null = null;
    try {
      res = await envoyer();
    } catch {
      res = null; // panne réseau : même traitement qu'un « plus tard »
    }
    if (res?.ok) return true;
    if (!classerReponse(res ? res.status : null).retryable || tentative >= REPLAY_TENTATIVES) return false;
    const demande = res ? lireRetryAfter(res.headers.get("retry-after")) : null;
    await attendre(Math.min(demande ?? 2_000 * tentative, REPLAY_ATTENTE_MAX_MS));
  }
}

let started = false;
let boundaryFlush: (() => void) | null = null;
let arret: (() => void) | null = null;

/** Vide le chunk courant avant une rotation d'identité/session. */
export function flushReplayBoundary(): void {
  boundaryFlush?.();
}

/**
 * Démarre l'enregistrement (session échantillonnée, consentement acquis), plafonné
 * à 2 min ou 1 Mo gzip. Rend l'arrêt à appeler au refus de consentement : il jette
 * ce qui n'est pas parti. Un accord ultérieur ne relance pas : il faudrait un
 * nouvel instantané complet, que seul un chargement redonne.
 */
export function startReplay(cfg: MIPRumConfig, sessionId: string | (() => string)): () => void {
  if (started) return () => arret?.();
  if (typeof CompressionStream === "undefined") return () => {}; // navigateur trop ancien
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
    boundaryFlush = null;
    buffer.stopped = true;
  };

  let refuse = false;
  const arreter = () => {
    refuse = true;
    buffer.take(); // le morceau en cours ne partira pas
    stop();
  };
  arret = arreter;

  const flush = () => {
    if (refuse) return;
    const chunk = buffer.take();
    if (!chunk) return;
    // Session lue avant la compression asynchrone : une rotation ne rattache pas
    // ce chunk au nouvel ID.
    const chunkSessionId = typeof sessionId === "function" ? sessionId() : sessionId;
    posting = posting.then(async () => {
      if (refuse) return;
      try {
        const bytes = await gzip(JSON.stringify(chunk.events));
        const envoye = await posterAvecReprise(() => fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-mip-session": chunkSessionId,
            "x-mip-app": cfg.appId,
            "x-mip-seq": String(chunk.seq),
            // Même auth que /v1/traces ; le beacon OTLP, sans en-têtes, passe la
            // clé en attribut resource mip.api_key.
            ...(cfg.apiKey ? { "x-mip-key": cfg.apiKey } : {}),
          },
          body: bytes,
          // keepalive (limite ~64 Ko) : le dernier chunk survit au pagehide
          keepalive: bytes.length < 60_000,
        }), dormir, () => refuse);
        // Seul un chunk accepté compte dans le plafond : un refus n'a rien stocké.
        if (envoye && buffer.addCompressed(bytes.length)) stop();
      } catch {
        /* compression impossible : chunk perdu, le suivant repart */
      }
    });
  };
  boundaryFlush = flush;

  loadReplayBundle(resolveReplayScriptUrl(mainScriptSrc))
    .then((record) => {
      if (buffer.stopped) return;
      stopRecording = record({
        emit: (event: unknown) => {
          if (buffer.add(event)) flush();
        },
        ...optionsMasquage(cfg.replayMask, resoudreDemasquage(cfg.replayUnmask)),
      });
      timer = setInterval(flush, CHUNK_FLUSH_MS);
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
      boundaryFlush = null;
    });
  return arreter;
}
