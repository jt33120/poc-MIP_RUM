// Runtime React Native du SDK mobile MIP RUM. Capte crashes (ErrorUtils), écrans,
// appels réseau (patch fetch + traceparent) et événements métier, puis émet en
// OTLP vers MIP — via le cœur pur (core.ts). Best-effort : ne casse jamais l'app.
// Globals RN typés en souple ; construit par esbuild (dist/). RN >= fetch global.
//
// P7.1 — l'enveloppe rejoint le contrat P2 du SDK web : contexte global,
// identités métier, vue, action, timing, flag et erreur déclarée, avec LES MÊMES
// signatures et LES MÊMES limites (validation partagée par `@mip/rum-core`).
// Ce qui n'est PAS ici et arrive plus tard, volontairement : le consentement, la
// file durable et le transport avec retry (P7.2) ; les adaptateurs navigation,
// Pressable et le durcissement d'ErrorUtils/fetch (P7.3).
import {
  EventContextStore,
  applyBeforeSend,
  boundedName,
  newEnvelopeId,
  validateIdentity,
  type BeforeSendFault,
  type EventContext,
  type EventMeta,
  type IdentityInput,
} from "@mip/rum-core";
import {
  MOBILE_SDK_VERSION,
  buildActionSpan,
  buildAddErrorSpan,
  buildExceptionSpan,
  buildFeatureFlagSpan,
  buildHttpSpan,
  buildPayload,
  buildScreenSpan,
  buildTimingSpan,
  buildTrackSpan,
  buildViewSpan,
  type Ctx,
  type MobileConfig,
} from "./core";
import type { EmitSpan } from "@mip/rum-core";

export type { EventContext, EventMeta, IdentityInput } from "@mip/rum-core";

// --- globals RN / JS (déclarés en souple pour éviter une dépendance react-native)
declare const global: any;

/** Troisième argument de `addError` — même forme qu'en P2 web. */
export interface AddErrorOptions {
  /**
   * Clé de regroupement opaque, sans donnée personnelle, 100 caractères au
   * plus. Transmise en `mip.error_fingerprint` ; une clé invalide est ignorée,
   * l'erreur part quand même.
   */
  fingerprint?: string;
}

export interface InitOptions {
  endpoint: string;
  appId: string;
  apiKey?: string;
  clientId?: string;
  env?: string;
  appVersion?: string;
  /** 'ios' | 'android' — sert d'indice d'appareil et compose le user-agent. */
  platform?: string;
  osVersion?: string;
  /** Origines supplémentaires où propager le traceparent (défaut : toutes sauf l'endpoint). */
  traceOrigins?: string[];
  flushIntervalMs?: number;
  /**
   * Filtre PII de dernière chance, SYNCHRONE, appliqué aux attributs de chaque
   * signal avant mise en file. Retourner `null` jette l'événement.
   *
   * Trois garde-fous, dont la raison tient en une phrase chacun :
   *  - les attributs structurels (session, vue, action, trace, échantillonnage)
   *    sont restaurés après le hook : une application ne peut pas casser la
   *    corrélation de sa propre télémétrie ;
   *  - une exception du hook jette l'événement et compte un diagnostic, sans
   *    remonter dans l'app hôte — une redbox pour une faute de notre SDK serait
   *    inacceptable ;
   *  - une Promise est une entrée INVALIDE, pas une attente : bloquer le thread
   *    UI pour un filtre PII n'est pas une option.
   *
   * Le hook n'est pas une garantie de confidentialité : le scrub serveur reste
   * obligatoire et autoritaire à réception.
   */
  beforeSend?: (
    attributes: Record<string, unknown>,
    meta?: EventMeta,
  ) => Record<string, unknown> | null;
}

/**
 * Diagnostics de collecte. Les champs que P7.1 ne peut pas connaître valent
 * `null` — jamais `0` : « aucune tentative de renvoi » et « je ne sais pas
 * combien » ne sont pas la même information.
 */
export interface MobileDiagnostics {
  /** Signaux en attente d'envoi dans le tampon mémoire. */
  queued: number;
  /** Signaux jetés avant émission (refus ou faute de `beforeSend`). */
  dropped: number;
  /** Renvois : inconnu tant que le transport avec retry n'existe pas (P7.2). */
  retries: number | null;
  /** Stockage durable : inconnu tant qu'aucun adaptateur n'est branché (P7.2). */
  storageAvailable: boolean | null;
  /** Consentement : inconnu tant que la gate n'existe pas (P7.2). */
  consent: string | null;
  /** Capacités natives déclarées : inconnues tant qu'aucun adaptateur ne les observe (P7.5). */
  nativeCapabilities: string[] | null;
  /** Refus non contractuels du hook, par motif. Compteurs bornés. */
  beforeSendFaults: { exception: number; async: number };
}

let cfg: MobileConfig | null = null;
let ctx: Ctx | null = null;
let beforeSend: InitOptions["beforeSend"];
let traceOrigins: string[] = [];
let endpointOrigin = "";
const buffer: EmitSpan[] = [];
let started = false;

/**
 * Contexte P2 du runtime mobile. Instance PROPRE au package : le cœur partagé
 * n'expose que la classe, jamais un singleton — deux runtimes dans le même
 * processus (WebView) ne doivent pas se mélanger leurs contextes.
 */
const store = new EventContextStore();

/** Compteurs bornés : un diagnostic ne doit jamais devenir un journal. */
const COMPTEUR_MAX = 1_000_000;
let dropped = 0;
const hookFaults = { exception: 0, async: 0 };
let hookWarned = false;

function compte(n: number): number {
  return n < COMPTEUR_MAX ? n + 1 : n;
}

/** hex aléatoire (RN-safe : Math.random, suffisant pour des identifiants de corrélation). */
function hex(bytes: number): string {
  let s = "";
  for (let i = 0; i < bytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return s;
}
function now(): number {
  return Date.now();
}

function originOf(url: string): string | null {
  const m = /^[a-z]+:\/\/[^/]+/i.exec(url);
  return m ? m[0].toLowerCase() : null;
}

/** Enveloppe P2 du moment : contexte figé, identités brutes, vue courante. */
function envelopeCtx(action: EventContext = {}, local: EventContext = {}): Ctx | null {
  if (!ctx) return null;
  const envelope = store.envelope(action, local);
  return {
    ...ctx,
    context: envelope.context ?? null,
    userId: envelope.userId ?? null,
    accountId: envelope.accountId ?? null,
    viewId: envelope.viewId ?? null,
    viewName: envelope.viewName ?? null,
  };
}

function metaDe(span: EmitSpan): EventMeta {
  const type = span.attributes["mip.event_type"];
  const name = span.attributes["mip.event_name"];
  return {
    type: typeof type === "string"
      ? type as EventMeta["type"]
      : span.name === "exception" ? "error" : span.name.startsWith("track.") ? "custom" : "telemetry",
    name: typeof name === "string" ? name : span.name,
  };
}

/**
 * Passage du hook applicatif puis mise en file. Retourne `false` si l'événement
 * a été jeté : les API publiques P2 renvoient cette décision, elles ne lèvent
 * jamais dans l'app hôte.
 */
function enqueue(span: EmitSpan | null): boolean {
  if (!span || !cfg) return false;
  const filtered = applyBeforeSend(beforeSend, span.attributes, metaDe(span), {
    onFault: (fault: BeforeSendFault) => {
      hookFaults[fault] = compte(hookFaults[fault]);
      if (!hookWarned) {
        hookWarned = true;
        // Une seule fois par lancement : le motif suffit à diagnostiquer, et
        // le contenu de l'exception peut porter la PII que le hook devait
        // justement retirer.
        console.warn(`[MIPRum] beforeSend ignoré (${fault}) : événement jeté`);
      }
    },
  });
  if (!filtered) {
    dropped = compte(dropped);
    return false;
  }
  buffer.push({ ...span, attributes: filtered });
  if (buffer.length >= 64) void flush();
  return true;
}

async function flush(): Promise<void> {
  if (!cfg || !buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await global.fetch(cfg.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload(cfg, batch)),
    });
  } catch {
    /* best-effort : P7.2 apporte l'acquittement et le retry */
  }
}

// --- capture crashes (ErrorUtils : handler global RN) ------------------------
function installCrashHandler(): void {
  const EU = global.ErrorUtils;
  if (!EU?.getGlobalHandler || !EU?.setGlobalHandler) return;
  const prev = EU.getGlobalHandler();
  EU.setGlobalHandler((err: any, isFatal: boolean) => {
    try {
      const snapshot = envelopeCtx();
      if (snapshot) {
        enqueue(
          buildExceptionSpan(
            snapshot,
            { message: String(err?.message ?? err), type: err?.name ?? null, stack: err?.stack ?? null },
            now(),
            hex(8),
          ),
        );
      }
      void flush(); // l'app peut mourir : on tente l'envoi immédiat (keepalive implicite)
    } catch {
      /* ignore */
    }
    prev?.(err, isFatal); // on ne masque pas le comportement d'origine (redbox / crash)
  });
}

// --- patch réseau (fetch) : span http.client + propagation traceparent -------
function installFetchPatch(): void {
  const orig = global.fetch;
  if (typeof orig !== "function" || orig.__mipPatched) return;
  const patched = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    const origin = originOf(url);
    const sameOrTraced =
      origin && origin !== endpointOrigin && (traceOrigins.length === 0 || traceOrigins.includes(origin));
    const traceId = hex(16);
    const spanId = hex(8);
    if (sameOrTraced && ctx) {
      const headers = new global.Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
      headers.set("traceparent", `00-${traceId}-${spanId}-01`);
      headers.set("tracestate", `mip=s:${ctx.sessionId}`);
      init = { ...init, headers };
    }
    const start = now();
    // Le snapshot d'enveloppe est pris AU DÉPART de la requête : une rotation
    // d'identité pendant l'appel ne réattribue pas la requête au nouvel
    // utilisateur au moment du flush.
    const snapshot = envelopeCtx();
    try {
      const res = await orig(input, init);
      if (snapshot && origin && origin !== endpointOrigin) {
        enqueue(buildHttpSpan(snapshot, { traceId, url, method: (init.method ?? "GET").toUpperCase(), status: res.status, durationMs: now() - start }, start, spanId));
      }
      return res;
    } catch (e) {
      if (snapshot && origin && origin !== endpointOrigin) {
        enqueue(buildHttpSpan(snapshot, { traceId, url, method: (init.method ?? "GET").toUpperCase(), status: 0, durationMs: now() - start }, start, spanId));
      }
      throw e;
    }
  };
  (patched as any).__mipPatched = true;
  global.fetch = patched;
}

// --- cycle de vie : nouvelle session au retour au premier plan ---------------
function installAppState(): void {
  try {
    // require optionnel : pas de dépendance dure à react-native. P7.2 remplace
    // cette découverte par un adaptateur `lifecycle` explicite.
    const rn = (global.require ?? (() => null))("react-native");
    rn?.AppState?.addEventListener?.("change", (state: string) => {
      if (state === "active" && ctx) ctx.sessionId = hex(16);
    });
  } catch {
    /* AppState indisponible : session unique par lancement */
  }
}

/** Démarre la collecte mobile. Idempotent. */
export function init(opts: InitOptions): void {
  if (started || !opts?.endpoint || !opts?.appId) return;
  started = true;
  const platform = opts.platform ?? "mobile";
  const major = MOBILE_SDK_VERSION.split(".").slice(0, 2).join(".");
  cfg = {
    endpoint: opts.endpoint,
    appId: opts.appId,
    apiKey: opts.apiKey ?? null,
    env: opts.env ?? "prod",
    clientId: opts.clientId ?? null,
    appVersion: opts.appVersion ?? null,
    userAgent: `MIP-RN/${major} (${platform}${opts.osVersion ? ` ${opts.osVersion}` : ""})`,
  };
  beforeSend = typeof opts.beforeSend === "function" ? opts.beforeSend : undefined;
  ctx = {
    sessionId: hex(16),
    // Visiteur : tirage MÉMOIRE, valable pour ce lancement. Il n'est ni persisté
    // ni dérivé d'un identifiant d'appareil — P7.2 apporte l'adaptateur de
    // stockage, le consentement et la persistance réelle.
    visitorId: newEnvelopeId(),
    route: null,
    tz: null,
    deviceType: platform,
  };
  traceOrigins = (opts.traceOrigins ?? []).map((o) => o.replace(/\/+$/, "").toLowerCase());
  endpointOrigin = originOf(opts.endpoint) ?? "";

  installCrashHandler();
  installFetchPatch();
  installAppState();

  const timer = setInterval(() => void flush(), opts.flushIntervalMs ?? 3000);
  if (timer?.unref) timer.unref();
}

/**
 * Déclare l'écran courant (route) et émet une vue historique `pageview`.
 *
 * Comportement INCHANGÉ depuis le POC : `screen` est le signal de navigation
 * mobile, l'équivalent d'un changement d'URL côté web. Il n'ouvre pas de vue P2
 * nommée — `startView` le fait, comme sur le web où la navigation et
 * `MIPRum.startView()` restent deux signaux distincts. Émettre les deux depuis
 * `screen` doublerait le nombre d'événements des intégrations déjà en place.
 */
export function screen(name: string): void {
  if (!ctx) return;
  ctx.route = name;
  const snapshot = envelopeCtx();
  if (snapshot) enqueue(buildScreenSpan(snapshot, now(), hex(8)));
}

/** Événement métier : track("checkout", { amount: 42 }). Retour historique : void. */
export function track(name: string, props: Record<string, unknown> = {}, context: EventContext = {}): void {
  const safeName = boundedName(name);
  if (!safeName) return;
  const snapshot = envelopeCtx({}, { ...props, ...context });
  if (!snapshot) return;
  enqueue(buildTrackSpan(snapshot, safeName, props, now(), hex(8), snapshot.context));
}

/** Force l'envoi des spans en attente. Résolu même si l'envoi échoue (best-effort). */
export function flushNow(): Promise<void> {
  return flush();
}

// ─────────────────────────── Contexte global (P2) ────────────────────────────

/** Remplace le contexte global appliqué aux événements futurs. */
export function setGlobalContext(context: EventContext): void {
  store.setGlobal(context);
}

export function setGlobalContextProperty(key: string, value: unknown): boolean {
  if (typeof key !== "string") return false;
  store.setGlobalProperty(key, value);
  // La validation est celle du cœur partagé : une clef réservée, trop longue ou
  // une valeur non sérialisable est simplement absente du contexte résultant.
  return Object.prototype.hasOwnProperty.call(store.getGlobal(), key.trim());
}

export function removeGlobalContextProperty(key: string): void {
  store.removeGlobalProperty(key);
}

export function clearGlobalContext(): void {
  store.setGlobal({});
}

export function getGlobalContext(): Readonly<EventContext> {
  return store.getGlobal();
}

// ─────────────────────── Identités métier (HMAC serveur) ─────────────────────

/**
 * Définit ou efface l'identité utilisateur métier. L'identifiant BRUT reste en
 * mémoire et n'est transporté que vers l'endpoint MIP, qui seul détient le
 * secret HMAC app-scopé. Aucun secret de hachage n'est embarqué ici.
 *
 * Un changement d'identité tourne la session, comme en P2 : les événements de
 * l'utilisateur précédent ne doivent jamais être réattribués au suivant.
 */
export function setUser(user: string | IdentityInput | null): boolean {
  if (validateIdentity(user) === undefined) return false;
  // `setUser` renvoie « a changé » : ne tourner la session que dans ce cas, pour
  // qu'un re-rendu qui repose la même identité ne fabrique pas une session.
  if (store.setUser(user) && ctx) ctx.sessionId = hex(16);
  return true;
}

export function clearUser(): void {
  setUser(null);
}

export function setAccount(account: string | IdentityInput | null): boolean {
  if (validateIdentity(account) === undefined) return false;
  if (store.setAccount(account) && ctx) ctx.sessionId = hex(16);
  return true;
}

export function clearAccount(): void {
  setAccount(null);
}

// ──────────────────────── Vue, action, timing, flag ──────────────────────────

/** Démarre une vue nommée stable, sans modifier la route déclarée par `screen`. */
export function startView(name: string, context: EventContext = {}): boolean {
  if (!ctx) return false;
  const view = store.startView(name, ctx.route ?? "", context);
  if (!view) return false;
  const snapshot = envelopeCtx();
  if (!snapshot) return false;
  return enqueue(buildViewSpan(snapshot, { id: view.id, name: view.name, context: snapshot.context }, now(), hex(8)));
}

/**
 * Émet une action déclarée par l'application. P7.1 n'ouvre AUCUNE fenêtre
 * causale : rattacher les signaux suivants à cette action demande d'observer le
 * geste ET sa réponse, ce que seul l'adaptateur d'interactions P7.3 peut faire.
 */
export function addAction(name: string, context: EventContext = {}): boolean {
  const safeName = boundedName(name);
  if (!safeName) return false;
  const snapshot = envelopeCtx(context);
  if (!snapshot) return false;
  return enqueue(
    buildActionSpan(snapshot, { id: newEnvelopeId(), name: safeName, context: snapshot.context }, now(), hex(8)),
  );
}

/** Émet un timing relatif au début de la vue courante. Sans vue : refusé. */
export function addTiming(name: string, timestamp: number = Date.now()): boolean {
  const safeName = boundedName(name);
  if (!safeName) return false;
  const duration = store.timing(safeName, timestamp);
  if (duration == null) return false;
  const snapshot = envelopeCtx();
  if (!snapshot) return false;
  return enqueue(buildTimingSpan(snapshot, safeName, duration, now(), hex(8)));
}

/** Émet une évaluation bornée puis la rattache au contexte futur de la vue. */
export function addFeatureFlagEvaluation(name: string, value: string | number | boolean | null): boolean {
  const safeName = boundedName(name);
  if (!safeName || !store.addFlag(safeName, value)) return false;
  const snapshot = envelopeCtx();
  if (!snapshot) return false;
  return enqueue(buildFeatureFlagSpan(snapshot, safeName, value, now(), hex(8)));
}

/** Signale explicitement une erreur : même enveloppe que la voie `exception`. */
export function addError(
  error: Error | string,
  context: EventContext = {},
  options: AddErrorOptions = {},
): boolean {
  // Aucune API publique ne doit lever dans l'app hôte : une entrée non conforme
  // produit un message vide, pas une exception au milieu d'un rendu.
  const message = (typeof error === "string" ? error : error?.message) ?? "";
  const errorName = boundedName(typeof error === "string" ? "Error" : error?.name) ?? "Error";
  const safeMessage = message.length <= 500 ? message : message.slice(0, 500);
  const safeStack = typeof error === "string" || !error?.stack ? null : error.stack.slice(0, 4000);
  const snapshot = envelopeCtx({}, context);
  if (!snapshot) return false;
  return enqueue(
    buildAddErrorSpan(
      snapshot,
      {
        message: safeMessage,
        type: errorName,
        stack: safeStack,
        context: snapshot.context,
        fingerprint: boundedName(options?.fingerprint),
      },
      now(),
      hex(8),
    ),
  );
}

/** État de la collecte. `null` = information que ce lot ne peut pas connaître. */
export function getDiagnostics(): MobileDiagnostics {
  return {
    queued: buffer.length,
    dropped,
    retries: null,
    storageAvailable: null,
    consent: null,
    nativeCapabilities: null,
    beforeSendFaults: { ...hookFaults },
  };
}

export default {
  init,
  screen,
  track,
  flushNow,
  setGlobalContext,
  setGlobalContextProperty,
  removeGlobalContextProperty,
  clearGlobalContext,
  getGlobalContext,
  setUser,
  clearUser,
  setAccount,
  clearAccount,
  startView,
  addAction,
  addTiming,
  addFeatureFlagEvaluation,
  addError,
  getDiagnostics,
};
