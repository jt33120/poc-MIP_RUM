// Session replay (ROADMAP v0.3 B2). Le cœur reste léger : rrweb vit dans le
// bundle séparé dist/mip-rum-replay.js (global MIPRumReplay), lazy-loadé ici
// uniquement si replay activé + session échantillonnée + consent acquis.
// Chunks : events rrweb -> JSON -> gzip (CompressionStream) -> POST binaire
// /v1/replay (headers x-mip-session / x-mip-app / x-mip-seq).
import type { recordOptions } from "rrweb";
import { MIP_UI_ATTR } from "./breadcrumbs";
import { classerReponse, lireRetryAfter } from "./retry";
import type { MIPRumConfig } from "./types";

export const REPLAY_MAX_MS = 120_000; // stop après 2 min d'enregistrement
export const REPLAY_MAX_COMPRESSED_BYTES = 1024 * 1024; // stop après 1 Mo gzip cumulé
export const CHUNK_FLUSH_MS = 10_000; // flush périodique
export const CHUNK_MAX_RAW_BYTES = 256 * 1024; // flush anticipé (taille brute)
export const REPLAY_BUNDLE = "mip-rum-replay.js";

// ───────────────────────────── Masquage du rejeu ──────────────────────────────
//
// CE QUI ÉTAIT ENREGISTRÉ EN CLAIR. Le rejeu masquait les SAISIES
// (`maskAllInputs`) et excluait les blocs marqués `.mip-rum-block` par l'app.
// Tout le reste partait tel quel : le texte de la page — un nom sur une fiche
// client, un montant, un numéro de dossier — et les médias, dont l'URL d'une
// pièce jointe ou d'un justificatif. Un formulaire vide était protégé ; la même
// donnée, une fois AFFICHÉE par l'application, ne l'était plus.
//
// Le standard 2026 attend l'inverse par défaut : on masque, et on démasque ce
// qu'on a décidé de montrer. C'est ce que fait `"all"`.

/**
 * Éléments porteurs de CONTENU, remplacés par un cadre de même taille.
 *
 * `svg` en fait partie, et c'est le choix qui coûte : les icônes d'une
 * interface sont presque toujours des SVG en ligne, et le rejeu perd donc ses
 * pictogrammes. On l'assume — un graphique SVG porte des chiffres de client
 * aussi sûrement qu'un `canvas`, et un masquage par défaut qui laisse passer
 * une catégorie entière n'est pas un masquage par défaut. Les apps qui veulent
 * leurs icônes choisissent `"media"` ou `"inputs"` en connaissance de cause.
 *
 * `iframe` n'y figure PAS : rrweb enregistre le contenu d'une iframe de même
 * origine comme un document à part, auquel les mêmes règles de masquage
 * s'appliquent — la bloquer perdrait l'enregistrement au lieu de le protéger.
 */
export const SELECTEUR_MEDIAS = "img,video,audio,canvas,svg,picture,object,embed";

/** Classe que l'application pose pour exclure un bloc, quel que soit le niveau. */
export const CLASSE_BLOC = "mip-rum-block";

/**
 * Classe que l'application pose pour DÉMASQUER une zone, sous `"all"` et
 * `"media"` : son texte est enregistré en clair, ses médias ne sont plus
 * remplacés par un cadre. C'est le mouvement inverse du masquage par défaut —
 * « montre ce tableau, cache le reste » — et il ne se fait que sur décision
 * explicite de l'application, élément par élément.
 *
 * rrweb 2.0.1 n'a pas de sélecteur de démasquage (seulement `maskTextSelector`
 * et `blockSelector`). Le démasquage passe donc par ses deux points d'entrée
 * existants : `maskTextFn(texte, élément)`, appelé pour tout texte à masquer
 * avec son élément parent — à l'instantané comme aux mutations —, et un
 * `blockSelector` qui exclut la zone démasquée (`selecteurMediasBloques`).
 */
export const CLASSE_DEMASQUE = "mip-rum-unmask";

/**
 * Ce qui reste masqué DANS une zone démasquée : le plancher, redit pour le texte.
 *
 * `maskAllInputs` masque la VALEUR d'un champ, pas le texte d'un
 * `contenteditable` ni celui d'une liste déroulante : ce sont des nœuds de texte
 * comme les autres, qu'une zone démasquée laisserait passer en clair. Un bloc
 * `mip-rum-block` n'est jamais sérialisé — rrweb s'arrête à lui —, il figure ici
 * pour que la règle ne dépende pas de ce détail d'implémentation.
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
  /**
   * Le navigateur comprend `:is()` et un `:not()` à sélecteurs complexes
   * (Chrome 88, Firefox 84, Safari 14 : 2021 et après). Sinon les médias d'une
   * zone démasquée restent bloqués : le repli masque, il ne démasque jamais.
   */
  medias: boolean;
}

/**
 * Médias à bloquer : tous, sauf ceux d'une zone démasquée.
 *
 * `:is(zone) *` et non `zone *` : un sélecteur d'application peut être une liste
 * (`.a, .b`), et `.a, .b *` ne voudrait pas dire « dans .a ou dans .b ».
 */
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
 * Résout l'option `replayUnmask` en zones démasquées.
 *
 * Un sélecteur invalide est IGNORÉ, avec un avertissement : le transmettre tel
 * quel ferait lever `matches()` dans rrweb, qui avale l'exception et répond
 * « non bloqué » — un sélecteur mal tapé démasquerait alors TOUS les médias.
 */
export function resoudreDemasquage(
  replayUnmask: unknown,
  valide: (selecteur: string) => boolean = selecteurValide,
  avertir: (message: string) => void = (m) => console.warn(m),
): Demasquage {
  let selecteur = `.${CLASSE_DEMASQUE}`;
  const brut = typeof replayUnmask === "string" ? replayUnmask.trim() : replayUnmask;
  if (brut !== undefined && brut !== null && brut !== "") {
    if (typeof brut === "string" && valide(brut)) selecteur = `${selecteur},${brut}`;
    else avertir(`[mip-rum] replayUnmask ignoré : ${JSON.stringify(brut)} n'est pas un sélecteur CSS valide. Rien n'est démasqué par cette option.`);
  }
  return { selecteur, medias: valide(selecteurMediasBloques(selecteur)) };
}

/**
 * L'élément est-il dans une zone démasquée, hors de tout ce qui reste masqué ?
 * Toute exception vaut « non » : dans le doute, on masque.
 */
export function estDemasque(element: Element | null, selecteurDemasque: string): boolean {
  if (!element) return false;
  try {
    return element.closest(selecteurDemasque) !== null && element.closest(SELECTEUR_TOUJOURS_MASQUE) === null;
  } catch {
    return false;
  }
}

/**
 * `maskTextFn` : en clair dans une zone démasquée, sinon le masquage de rrweb À
 * L'IDENTIQUE (chaque caractère visible devient `*`, les blancs restent) — le
 * rejeu garde la forme des textes masqués, rien de plus.
 */
export function masquerTexteHors(selecteurDemasque: string): MasqueTexte {
  return (texte, element) => (estDemasque(element, selecteurDemasque) ? texte : texte.replace(/[\S]/g, "*"));
}

/**
 * Options rrweb correspondant à un niveau de masquage.
 *
 * `maskAllInputs` et `blockClass` sont dans les TROIS niveaux : une saisie n'est
 * jamais enregistrée, et un bloc que l'application a marqué comme sensible n'est
 * jamais capturé, quel que soit le réglage. Aucun niveau ne peut donc les
 * désactiver — c'est le plancher, pas une option. Le démasquage n'y touche pas
 * non plus : il ne règle ni `maskAllInputs` ni `blockClass`.
 *
 * Sans `demasquage`, le masquage est entier. `"inputs"` l'ignore : il n'y a
 * rien à démasquer là où rien n'est masqué au-delà du plancher.
 */
export function optionsMasquage(niveau: NiveauMasquage = "all", demasquage?: Demasquage): OptionsMasquage {
  const base: OptionsMasquage = { maskAllInputs: true, blockClass: CLASSE_BLOC };
  if (niveau === "inputs") return base;
  const blockSelector = demasquage?.medias ? selecteurMediasBloques(demasquage.selecteur) : SELECTEUR_MEDIAS;
  if (niveau === "media") return { ...base, blockSelector };
  // "all" : le texte aussi. `*` couvre tout élément, donc tout nœud de texte ;
  // `maskTextFn` décide ensuite, texte par texte, de ce qui reste en clair.
  const options: OptionsMasquage = { ...base, maskTextSelector: "*", blockSelector };
  if (demasquage) options.maskTextFn = masquerTexteHors(demasquage.selecteur);
  return options;
}

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
// tests/e2e/rum-flow.spec.ts, démo headless avec replay:true)
// ---------------------------------------------------------------------------

// src du script principal, capturé au chargement du bundle (document.currentScript
// est nul une fois le script exécuté — init() arrive trop tard)
const mainScriptSrc =
  typeof document !== "undefined"
    ? ((document.currentScript as HTMLScriptElement | null)?.src ?? null)
    : null;

// Typé sur les options de `record()` de rrweb (type seul, effacé au build : rrweb
// n'entre pas dans le cœur). tsc vérifie ainsi que `optionsMasquage` — dont
// `maskTextFn` — parle la langue de la version de rrweb réellement embarquée.
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

// `Uint8Array<ArrayBuffer>` et non `Uint8Array` tout court : depuis TypeScript 5.7
// le type est générique sur son tampon, et `BodyInit` n'accepte qu'un tampon non
// partagé. La précision dit la vérité plutôt qu'elle ne la force — `arrayBuffer()`
// rend toujours un ArrayBuffer ordinaire — et elle rend ce corps de requête
// assignable sans assertion.
async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Tentatives d'un chunk refusé « plus tard », la première comprise. */
export const REPLAY_TENTATIVES = 4;
const REPLAY_ATTENTE_MAX_MS = 10_000;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Envoie un chunk et le REPREND tant que le collector dit « plus tard ».
 *
 * Sous la barrière RGPD, un chunk arrivé avant l'ancre de sa session (le premier
 * lot de traces, envoyé toutes les 3 s) reçoit 425 + `retry-after: 5`. Ignorer la
 * réponse perdait le chunk 0 — l'instantané complet de la page, sans lequel le
 * rejeu est illisible (relevé en production le 30/09/2026). Même classement que
 * la file des traces (`classerReponse`) : 425, 429, 5xx et panne réseau se
 * reprennent, un 4xx (clé refusée, session effacée) jamais. Borné en tentatives
 * et en attente : la chaîne `posting` qui garde l'ordre des seq ne reste jamais
 * bloquée longtemps.
 */
export async function posterAvecReprise(
  envoyer: () => Promise<Response>,
  attendre: (ms: number) => Promise<void> = dormir,
): Promise<boolean> {
  for (let tentative = 1; ; tentative++) {
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

/** Vide le chunk courant avant une rotation d'identité/session. */
export function flushReplayBoundary(): void {
  boundaryFlush?.();
}

/**
 * Démarre l'enregistrement replay (appelé par init() une fois la session
 * échantillonnée ET le consent acquis). Masquage : `optionsMasquage` (saisies,
 * texte et médias par défaut ; zones `mip-rum-unmask` / `replayUnmask` en
 * clair). Caps : 2 min ou 1 Mo gzip cumulé.
 */
export function startReplay(cfg: MIPRumConfig, sessionId: string | (() => string)): void {
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
    boundaryFlush = null;
    buffer.stopped = true;
  };

  const flush = () => {
    const chunk = buffer.take();
    if (!chunk) return;
    // Capture la session AVANT d'enfiler la compression asynchrone. Une
    // rotation suivante ne peut donc pas rattacher l'ancien chunk au nouvel ID.
    const chunkSessionId = typeof sessionId === "function" ? sessionId() : sessionId;
    posting = posting.then(async () => {
      try {
        const bytes = await gzip(JSON.stringify(chunk.events));
        const envoye = await posterAvecReprise(() => fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-mip-session": chunkSessionId,
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
        }));
        // Seul un chunk accepté compte dans le plafond : un refus n'a rien stocké.
        if (envoye && buffer.addCompressed(bytes.length)) stop(); // cap 1 Mo gzip cumulé
      } catch {
        /* best effort : compression impossible, chunk perdu, le suivant repart */
      }
    });
  };
  boundaryFlush = flush;

  loadReplayBundle(resolveReplayScriptUrl(mainScriptSrc))
    .then((record) => {
      if (buffer.stopped) return;
      stopRecording = record({
        emit: (event: unknown) => {
          if (buffer.add(event)) flush(); // ≥ 256 Ko brut -> flush anticipé
        },
        // Masqué PAR DÉFAUT, y compris le texte et les médias : démasquer est
        // une décision que l'application prend, zone par zone, pas un réglage
        // qu'elle oublie.
        ...optionsMasquage(cfg.replayMask, resoudreDemasquage(cfg.replayUnmask)),
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
      boundaryFlush = null;
    });
}
