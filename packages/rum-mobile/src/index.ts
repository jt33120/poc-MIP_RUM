// Runtime React Native du SDK mobile MIP RUM. Capte crashes (ErrorUtils), écrans,
// appels réseau (patch fetch + traceparent) et événements métier, puis émet en
// OTLP vers MIP — via le cœur pur (core.ts). Best-effort : ne casse jamais l'app.
// Globals RN typés en souple ; construit par esbuild (dist/). RN >= fetch global.
//
// P7.1 — l'enveloppe rejoint le contrat P2 du SDK web : contexte global,
// identités métier, vue, action, timing, flag et erreur déclarée, avec LES MÊMES
// signatures et LES MÊMES limites (validation partagée par `@mip/rum-core`).
//
// P7.2 — le consentement, l'identité et le transport. Trois changements dont
// chacun corrige un mensonge du lot précédent :
//   • un événement n'entre plus en file sans que le consentement l'autorise, et
//     une révocation purge AVANT tout nouvel enqueue — mémoire, disque, et le
//     lot déjà parti, dont la réponse ne réinjectera rien ;
//   • le visiteur est une installation, pas un lancement : il est persistant,
//     app-scopé, et créé seulement après consentement lorsqu'il est requis ;
//   • un lot n'est plus retiré avant l'envoi mais après ACQUITTEMENT. Ce qui
//     échoue revient, avec ses identifiants d'origine, et l'ingestion le
//     dédoublonne au lieu de compter deux fois.
//
// Ce qui n'est PAS ici et arrive en P7.3 : les adaptateurs navigation et
// Pressable, le durcissement d'ErrorUtils et du patch fetch, la mesure de
// démarrage.
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
import {
  aleaParDefaut,
  hexDepuis,
  horlogeMonotoneParDefaut,
  type Adapters,
  type ClockAdapter,
  type EtatCycleDeVie,
  type RandomAdapter,
} from "./adapters";
import { ConsentGate, PENDING_MAX_EVENTS, type EtatConsentement } from "./consent";
import {
  BATCH_MAX_EVENTS,
  EventQueue,
  octets,
  resoudreLimites,
  type EntreeFile,
  type LimitesFile,
  type MotifPerte,
} from "./queue";
import { FORMAT_VERSION, PersistentStore } from "./persist";
import {
  SessionManager,
  nouveauVisiteur,
  resoudreInactivite,
  type PersistanceIdentite,
} from "./session";
import { classerReponse, delaiProchainEssai, envoyer } from "./transport";
import type { EmitSpan } from "@mip/rum-core";

export type { EventContext, EventMeta, IdentityInput } from "@mip/rum-core";
export type {
  Adapters,
  ClockAdapter,
  EtatCycleDeVie,
  LifecycleAdapter,
  NavigationAdapter,
  RandomAdapter,
  StorageAdapter,
} from "./adapters";
export type { EtatConsentement } from "./consent";

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

/** Réglages de la file hors ligne. Les valeurs sont bornées par le SDK. */
export interface OfflineOptions {
  /**
   * File DURABLE sur le stockage fourni. **Désactivée par défaut, et son
   * activation en production exige P8.1** : sans transaction d'effacement
   * côté serveur, une reprise pourrait réécrire des données que l'utilisateur
   * vient de faire supprimer. Tant que P8.1 n'est pas livré, cette option est
   * destinée à la recette, et le SDK le rappelle une fois au démarrage.
   */
  persistent?: boolean;
  /** Défaut 500, plafond dur 1 000. */
  maxEvents?: number;
  /** Défaut 1 Mio, plafond dur 2 Mio. */
  maxBytes?: number;
  /** Défaut et plafond : 24 h. */
  ttlMs?: number;
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
   * Exige un consentement avant toute collecte. **Défaut `false`** pour ne pas
   * éteindre la télémétrie des intégrations déjà en place ; une installation
   * neuve devrait le mettre à `true`, comme le documente le README.
   */
  requireConsent?: boolean;
  /**
   * État initial, quand l'application a déjà recueilli une réponse et n'a pas à
   * rejouer son écran de consentement. Prime sur `requireConsent`.
   */
  initialConsent?: EtatConsentement;
  /**
   * Inactivité au-delà de laquelle une reprise ouvre une nouvelle session.
   * Défaut 30 min, borné à [1 min, 4 h].
   */
  sessionInactivityMs?: number;
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
   * obligatoire et autoritaire à réception, et le scrub portable passe avant
   * toute écriture durable.
   */
  beforeSend?: (
    attributes: Record<string, unknown>,
    meta?: EventMeta,
  ) => Record<string, unknown> | null;
  /** Points de contact avec la plateforme. Aucun n'est découvert à l'exécution. */
  adapters?: Adapters;
  offline?: OfflineOptions;
}

/**
 * Diagnostics de collecte. Les champs que ce lot ne peut pas connaître valent
 * `null` — jamais `0` : « aucune tentative de renvoi » et « je ne sais pas
 * combien » ne sont pas la même information. Avant `init`, tout ce qui dépend
 * du runtime est donc `null`.
 */
export interface MobileDiagnostics {
  /** Signaux en attente d'envoi (mémoire + file durable restaurée). */
  queued: number;
  /** Signaux jetés : refus de consentement, faute de hook, capacité, TTL. */
  dropped: number;
  /** Renvois de lots non acquittés. Connu depuis P7.2. */
  retries: number | null;
  /** Le stockage fourni répond-il ? `false` si aucun adaptateur n'est branché. */
  storageAvailable: boolean | null;
  /** État du consentement. `null` avant `init`. */
  consent: EtatConsentement | null;
  /** Capacités natives déclarées : inconnues tant qu'aucun adaptateur ne les observe (P7.5). */
  nativeCapabilities: string[] | null;
  /** Refus non contractuels du hook, par motif. Compteurs bornés. */
  beforeSendFaults: { exception: number; async: number };
  /** D'où vient le visiteur : `memory` quand le stockage est indisponible. */
  identityPersistence: PersistanceIdentite | null;
  /** Dernier statut HTTP non acquitté. Un STATUT, jamais un corps de réponse. */
  lastTransportStatus: number | null;
  /** Enregistrements durables illisibles, détectés puis abandonnés. */
  storageCorruptions: number | null;
}

/** Délai maximal accordé au flush de `shutdown()`. */
const SHUTDOWN_TIMEOUT_MS = 2_000;

let cfg: MobileConfig | null = null;
let ctx: Ctx | null = null;
let beforeSend: InitOptions["beforeSend"];
let traceOrigins: string[] = [];
let endpointOrigin = "";
let started = false;

let gate: ConsentGate | null = null;
let queue: EventQueue | null = null;
let persist: PersistentStore | null = null;
let session: SessionManager | null = null;
let random: RandomAdapter = aleaParDefaut();
let clock: ClockAdapter = horlogeMonotoneParDefaut();
let limites: LimitesFile = resoudreLimites();
let persistant = false;
let pret: Promise<void> = Promise.resolve();
let identityPersistence: PersistanceIdentite | null = null;

/** Désinstallations à rejouer par `shutdown()`, dans l'ordre inverse de pose. */
const teardown: Array<() => void> = [];

/**
 * Contexte P2 du runtime mobile. Instance PROPRE au package : le cœur partagé
 * n'expose que la classe, jamais un singleton — deux runtimes dans le même
 * processus (WebView) ne doivent pas se mélanger leurs contextes.
 */
const store = new EventContextStore();

/** Compteurs bornés : un diagnostic ne doit jamais devenir un journal. */
const COMPTEUR_MAX = 1_000_000;
let dropped = 0;
let retries = 0;
let lastTransportStatus: number | null = null;
const hookFaults = { exception: 0, async: 0 };
let hookWarned = false;
let transportWarned = false;
let persistanceWarned = false;

function compte(n: number): number {
  return n < COMPTEUR_MAX ? n + 1 : n;
}

/** hex aléatoire issu de l'adaptateur d'aléa (jamais d'un identifiant d'appareil). */
function hex(bytes: number): string {
  return hexDepuis(random, bytes);
}
/** Horodatage UTC d'un événement. Les DURÉES, elles, passent par `clock`. */
function now(): number {
  return Date.now();
}
/** Bruit de dispersion du retrait exponentiel, tiré de la même source d'aléa. */
function alea(): number {
  return (random.bytes(1)[0] ?? 0) / 256;
}

function originOf(url: string): string | null {
  const m = /^[a-z]+:\/\/[^/]+/i.exec(url);
  return m ? m[0].toLowerCase() : null;
}

function avertirUneFois(deja: boolean, message: string): boolean {
  if (deja) return deja;
  try {
    console.warn(`[MIPRum] ${message}`);
  } catch {
    /* console indisponible */
  }
  return true;
}

/** Enveloppe P2 du moment : contexte figé, identités brutes, vue courante. */
function envelopeCtx(action: EventContext = {}, local: EventContext = {}): Ctx | null {
  if (!ctx || !session) return null;
  // L'inactivité est évaluée ICI : c'est le seul endroit traversé par tous les
  // signaux. Une session laissée dormante 30 min ouvre une nouvelle visite au
  // premier événement qui suit, sans dépendre d'un callback de cycle de vie
  // qu'aucune plateforme ne garantit.
  session.touch();
  const envelope = store.envelope(action, local);
  return {
    ...ctx,
    sessionId: session.id,
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
 * Gate de consentement, hook applicatif, puis mise en file. Retourne `false` si
 * l'événement a été jeté : les API publiques P2 renvoient cette décision, elles
 * ne lèvent jamais dans l'app hôte.
 *
 * L'ORDRE COMPTE. Le consentement est évalué AVANT le hook : appeler du code
 * applicatif pour un événement que l'utilisateur a refusé serait une collecte
 * en soi, et un hook peut avoir des effets de bord.
 */
function enqueue(span: EmitSpan | null): boolean {
  if (!span || !cfg || !gate || !queue) return false;
  if (!gate.collecte) {
    dropped = compte(dropped);
    return false;
  }
  const filtered = applyBeforeSend(beforeSend, span.attributes, metaDe(span), {
    onFault: (fault: BeforeSendFault) => {
      hookFaults[fault] = compte(hookFaults[fault]);
      // Une seule fois par lancement : le motif suffit à diagnostiquer, et
      // le contenu de l'exception peut porter la PII que le hook devait
      // justement retirer.
      hookWarned = avertirUneFois(hookWarned, `beforeSend ignoré (${fault}) : événement jeté`);
    },
  });
  if (!filtered) {
    dropped = compte(dropped);
    return false;
  }
  const complet: EmitSpan = { ...span, attributes: filtered };
  let poids: number;
  try {
    poids = octets(JSON.stringify(complet));
  } catch {
    dropped = compte(dropped);
    return false;
  }
  // En attente de consentement, le tampon mémoire reste au plafond P2 : aucun
  // octet ne part sur le réseau ni sur le disque, et un consentement jamais
  // donné ne doit pas coûter de mémoire à l'application hôte.
  const cap = gate.granted ? limites.maxEvents : Math.min(PENDING_MAX_EVENTS, limites.maxEvents);
  const entree: EntreeFile = { id: complet.spanId, span: complet, bytes: poids, at: now() };
  if (!queue.push(entree, now(), cap)) return false;
  if (gate.granted && queue.length >= BATCH_MAX_EVENTS) void flush();
  return true;
}

// ───────────────────────────── transport ─────────────────────────────────────

let flushEnCours: Promise<void> | null = null;
let tentatives = 0;
/** Instant MONOTONE avant lequel aucune tentative n'est faite. */
let prochainEssaiA = 0;
let annulation: { abort(): void; signal: unknown } | null = null;

/**
 * Envoie tout ce qui est en file, lot par lot, en n'en retirant aucun avant
 * acquittement. Résolu même en cas d'échec : `flushNow()` promet une fin, pas
 * une livraison.
 */
async function flush(): Promise<void> {
  if (flushEnCours) return flushEnCours;
  flushEnCours = flushInterne().catch(() => undefined);
  try {
    await flushEnCours;
  } finally {
    flushEnCours = null;
  }
}

async function flushInterne(): Promise<void> {
  await pret;
  if (!cfg || !gate || !queue) return;
  // `pending` : rien ne part. `denied` : il n'y a rien à faire partir.
  if (!gate.granted) return;
  if (clock.nowMs() < prochainEssaiA) return;

  let plafondLot = BATCH_MAX_EVENTS;
  while (queue.length) {
    const lot = queue.lease(now(), plafondLot, limites.maxBytes);
    if (!lot.length) return;
    const epoqueEnvoi = gate.epoch;
    let corps: string;
    try {
      corps = JSON.stringify(buildPayload(cfg, lot.map((e) => e.span)));
    } catch {
      queue.abandonne(lot, "definitif");
      continue;
    }

    const controleur = nouvelleAnnulation();
    annulation = controleur;
    const reponse = await envoyer(
      global.fetch,
      cfg.endpoint,
      corps,
      cfg.apiKey ? { "x-mip-api-key": cfg.apiKey } : {},
      controleur?.signal,
      now(),
    );
    annulation = null;

    // Révocation pendant le vol : la file a déjà été purgée, et rien de cette
    // époque ne doit y revenir — pas même un lot que le serveur a accepté.
    if (gate.epoch !== epoqueEnvoi || !gate.granted) return;

    if (reponse.tropGros) {
      if (lot.length > 1) {
        // Le plafond HTTP est mesuré sur le corps RÉEL : on coupe le lot en
        // deux plutôt que de deviner un ratio d'encodage.
        queue.nack(lot);
        plafondLot = Math.max(1, Math.floor(lot.length / 2));
        continue;
      }
      // Un seul événement dépasse à lui seul la limite d'ingestion : il ne
      // passera jamais. Le garder bloquerait tout ce qui le suit.
      queue.abandonne(lot, "trop_gros");
      plafondLot = BATCH_MAX_EVENTS;
      continue;
    }

    const verdict = classerReponse(reponse.status);
    if (verdict.acquitte) {
      queue.ack(lot);
      tentatives = 0;
      prochainEssaiA = 0;
      plafondLot = BATCH_MAX_EVENTS;
      continue;
    }

    lastTransportStatus = reponse.status;
    if (verdict.rejouable) {
      // Le lot reste en file AVEC SES IDENTIFIANTS : au prochain essai, le
      // serveur reverra les mêmes `span_id` et appliquera ses `on conflict`
      // plutôt que de compter une seconde occurrence.
      queue.nack(lot);
      tentatives++;
      retries = compte(retries);
      prochainEssaiA = clock.nowMs() + delaiProchainEssai(tentatives, reponse.retryAfterMs, alea());
      await sauvegarderSiDurable();
      return;
    }

    // Réponse définitive : clef refusée, charge invalide, application inconnue.
    // Rejouer ne l'améliorera pas. On jette CE lot, on recule avant le suivant
    // — sinon une clef mal saisie déclencherait autant de requêtes qu'il y a de
    // lots en file — et on ne journalise que le statut.
    queue.abandonne(lot, "definitif");
    tentatives++;
    prochainEssaiA = clock.nowMs() + delaiProchainEssai(tentatives, null, alea());
    transportWarned = avertirUneFois(
      transportWarned,
      `ingestion a refusé le lot (HTTP ${reponse.status ?? "?"}) : lot abandonné`,
    );
    return;
  }
}

/** AbortController quand le moteur l'expose : une révocation annule ce qui l'est encore. */
function nouvelleAnnulation(): { abort(): void; signal: unknown } | null {
  const Ctor = (globalThis as { AbortController?: new () => { abort(): void; signal: unknown } }).AbortController;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

async function sauvegarderSiDurable(): Promise<void> {
  if (!persistant || !cfg || !gate?.granted || !queue || !persist) return;
  try {
    await persist.enregistrerFile(cfg.appId, gate.epoch, queue.entries());
  } catch {
    /* le stockage a déjà signalé son indisponibilité ; la mémoire reste maître */
  }
}

// ─────────────────── identité, visiteur et reprise de file ───────────────────

/**
 * Résout l'identité d'installation puis, si la file durable est activée, reprend
 * ce qui restait du lancement précédent.
 *
 * Asynchrone parce que le stockage l'est. Le flush attend cette promesse : aucun
 * événement ne part avec un visiteur provisoire, et les événements déjà mis en
 * file pendant la résolution reçoivent le visiteur définitif par estampillage.
 */
async function bootstrapIdentite(): Promise<void> {
  if (!cfg || !ctx || !gate || !queue || !persist) return;
  const appId = cfg.appId;
  const record = await persist.chargerIdentite(appId);
  if (record && record.epoch > gate.epoch) gate.adopte(record.epoch);

  if (!gate.granted) {
    // Consentement requis et non accordé : PAS de visiteur. Un identifiant
    // d'installation créé « au cas où » serait déjà une collecte.
    ctx.visitorId = null;
    identityPersistence = null;
    return;
  }

  let visiteur = record?.visitorId ?? null;
  let origine: PersistanceIdentite = visiteur ? "storage" : "memory";
  if (!visiteur) {
    visiteur = nouveauVisiteur(random);
    const ecrit = await persist.enregistrerIdentite({
      v: FORMAT_VERSION,
      appId,
      epoch: gate.epoch,
      visitorId: visiteur,
      createdAt: now(),
    });
    // Stockage indisponible (absent, plein, chiffré avant déverrouillage) :
    // identifiant mémoire, et le diagnostic le dit au lieu de le taire.
    origine = ecrit ? "storage" : "memory";
  }
  ctx.visitorId = visiteur;
  identityPersistence = origine;
  queue.estampille("mip.visitor_id", visiteur);

  if (persistant) {
    const reprises = await persist.chargerFile(appId, gate.epoch, now(), limites.ttlMs);
    queue.restore(reprises, now());
  }
}

// --- capture crashes (ErrorUtils : handler global RN) ------------------------
function installCrashHandler(): void {
  const EU = global.ErrorUtils;
  if (!EU?.getGlobalHandler || !EU?.setGlobalHandler) return;
  const prev = EU.getGlobalHandler();
  const notre = (err: any, isFatal: boolean) => {
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
  };
  EU.setGlobalHandler(notre);
  teardown.push(() => {
    try {
      // On ne retire QUE notre handler. Si l'application en a posé un après le
      // nôtre, le remplacer par `prev` effacerait le sien.
      if (EU.getGlobalHandler?.() === notre) EU.setGlobalHandler(prev);
    } catch {
      /* ignore */
    }
  });
}

// --- patch réseau (fetch) : span http.client + propagation traceparent -------
function installFetchPatch(): void {
  const orig = global.fetch;
  if (typeof orig !== "function" || orig.__mipPatched) return;
  const patched = async (input: any, init: any = {}) => {
    // Désinstallé alors qu'un tiers avait patché par-dessus : on ne peut pas se
    // retirer de la chaîne, on devient un simple passe-plat.
    if ((patched as any).__mipInerte) return orig(input, init);
    const url = typeof input === "string" ? input : input?.url ?? "";
    const origin = originOf(url);
    const sameOrTraced =
      origin && origin !== endpointOrigin && (traceOrigins.length === 0 || traceOrigins.includes(origin));
    const traceId = hex(16);
    const spanId = hex(8);
    if (sameOrTraced && ctx && session) {
      const headers = new global.Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
      headers.set("traceparent", `00-${traceId}-${spanId}-01`);
      headers.set("tracestate", `mip=s:${session.id}`);
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
  teardown.push(() => {
    if (global.fetch === patched) global.fetch = orig;
    else (patched as any).__mipInerte = true;
  });
}

// --- cycle de vie : session, sauvegarde et flush au passage en arrière-plan ---
function installAppState(adapters: Adapters): void {
  const traiter = (etat: EtatCycleDeVie) => {
    session?.cycleDeVie(etat);
    if (etat === "active") {
      void flush();
      return;
    }
    // Passage en arrière-plan : on sauvegarde AVANT de tenter l'envoi. L'OS peut
    // suspendre l'application à tout moment ; une requête interrompue est
    // rattrapable, une file jamais écrite ne l'est pas.
    void (async () => {
      await sauvegarderSiDurable();
      await flush();
    })();
  };

  if (adapters.lifecycle) {
    try {
      const desabonner = adapters.lifecycle.subscribe(traiter);
      if (typeof desabonner === "function") teardown.push(() => { try { desabonner(); } catch { /* ignore */ } });
    } catch {
      /* un adaptateur défaillant ne casse pas l'initialisation */
    }
    return;
  }
  try {
    // Repli historique, laissé tel quel : le durcissement de cette découverte
    // (peer dependency explicite, versions testées) appartient à P7.3.
    const rn = (global.require ?? (() => null))("react-native");
    const abonnement = rn?.AppState?.addEventListener?.("change", (state: string) =>
      traiter(state as EtatCycleDeVie),
    );
    if (abonnement?.remove) teardown.push(() => { try { abonnement.remove(); } catch { /* ignore */ } });
  } catch {
    /* AppState indisponible : la rotation par inactivité prend le relais */
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

  const adapters = opts.adapters ?? {};
  random = adapters.random ?? aleaParDefaut();
  clock = adapters.monotonicClock ?? horlogeMonotoneParDefaut();
  limites = resoudreLimites(opts.offline);
  persistant = opts.offline?.persistent === true;
  gate = new ConsentGate(opts.requireConsent === true, opts.initialConsent, 1);
  // Le motif n'est pas exposé : `getDiagnostics()` annonce un nombre de pertes,
  // pas une taxonomie. Le garder dans la signature documente ce que la file
  // sait, sans promettre au produit une ventilation qu'il faudrait ensuite
  // maintenir stable entre deux versions du SDK.
  queue = new EventQueue(limites, (_motif: MotifPerte, nombre: number) => {
    for (let i = 0; i < nombre; i++) dropped = compte(dropped);
  });
  persist = new PersistentStore(adapters.storage, () => {
    /* le diagnostic porte déjà l'information ; pas de journal par échec */
  });
  session = new SessionManager(random, clock, resoudreInactivite(opts.sessionInactivityMs));

  ctx = {
    // Le visiteur est résolu par `bootstrapIdentite` : persistant si le
    // stockage répond, mémoire sinon, ABSENT tant que le consentement manque.
    sessionId: session.id,
    visitorId: null,
    route: null,
    tz: null,
    deviceType: platform,
  };
  traceOrigins = (opts.traceOrigins ?? []).map((o) => o.replace(/\/+$/, "").toLowerCase());
  endpointOrigin = originOf(opts.endpoint) ?? "";

  if (persistant) {
    persistanceWarned = avertirUneFois(
      persistanceWarned,
      "file durable activée : son usage en production exige P8.1 (effacement transactionnel), sans quoi une reprise peut réécrire des données supprimées",
    );
  }

  installCrashHandler();
  installFetchPatch();
  installAppState(adapters);

  pret = bootstrapIdentite().catch(() => undefined);

  const timer = setInterval(() => void flush(), opts.flushIntervalMs ?? 3000);
  if (timer?.unref) timer.unref();
  teardown.push(() => clearInterval(timer));
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

/**
 * Consentement RGPD. `true` débloque la collecte, `false` la révoque.
 *
 * La révocation PURGE SYNCHRONEMENT, avant que le moindre nouvel événement
 * puisse entrer : mémoire vidée, requête en vol annulée quand le moteur le
 * permet, époque incrémentée pour que la réponse d'un lot déjà parti ne
 * réinjecte rien, puis effacement du disque. Une requête DÉJÀ REÇUE par le
 * serveur n'est pas effaçable depuis le client : c'est la voie DSAR, côté
 * serveur, qui répond à cette demande-là.
 */
export function consent(granted: boolean): void {
  if (!gate || !queue) return;
  if (granted) {
    gate.set(true);
    // Le visiteur n'existait pas tant que le consentement manquait : il est créé
    // maintenant, et les événements déjà en tampon en reçoivent l'estampille.
    pret = bootstrapIdentite().catch(() => undefined);
    void flush();
    return;
  }
  const revoque = gate.set(false);
  queue.purge("revocation");
  tentatives = 0;
  prochainEssaiA = 0;
  try {
    annulation?.abort();
  } catch {
    /* annulation non supportée : la vérification d'époque prend le relais */
  }
  annulation = null;
  if (ctx) ctx.visitorId = null;
  identityPersistence = null;
  if (!revoque || !cfg || !persist) return;
  const appId = cfg.appId;
  const epoch = gate.epoch;
  // L'époque révoquée est écrite sur le disque : une file laissée par un
  // lancement précédent, ou par une écriture qu'on n'arrive pas à effacer, sera
  // reconnue périmée au prochain démarrage.
  pret = (async () => {
    await persist!.effacerFile(appId);
    await persist!.enregistrerIdentite({
      v: FORMAT_VERSION, appId, epoch, visitorId: null, createdAt: now(),
    });
  })().catch(() => undefined);
}

/**
 * Flush borné, sauvegarde, puis retrait des hooks et timers POSÉS PAR MIP.
 *
 * Chaque désinstallation vérifie que ce qu'elle retire est encore le nôtre : un
 * patch installé après nous est respecté, et notre propre couche devient un
 * passe-plat plutôt que de casser la sienne. Après `shutdown()`, un `init()`
 * repart d'un état neuf sans dupliquer le moindre écouteur.
 */
export async function shutdown(): Promise<void> {
  if (!started) return;
  // Les hooks d'abord : rien de nouveau ne doit entrer pendant l'arrêt.
  for (const defaire of teardown.splice(0).reverse()) {
    try {
      defaire();
    } catch {
      /* une désinstallation qui échoue n'empêche pas les suivantes */
    }
  }
  let minuteur: any = null;
  try {
    await Promise.race([
      flush(),
      new Promise<void>((resoudre) => {
        minuteur = setTimeout(resoudre, SHUTDOWN_TIMEOUT_MS);
        if (minuteur?.unref) minuteur.unref();
      }),
    ]);
  } catch {
    /* best-effort : `shutdown` promet de rendre la main, pas de livrer */
  } finally {
    if (minuteur) clearTimeout(minuteur);
  }
  await sauvegarderSiDurable();

  cfg = null;
  ctx = null;
  gate = null;
  queue = null;
  persist = null;
  session = null;
  beforeSend = undefined;
  traceOrigins = [];
  endpointOrigin = "";
  persistant = false;
  identityPersistence = null;
  tentatives = 0;
  prochainEssaiA = 0;
  annulation = null;
  pret = Promise.resolve();
  started = false;
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
 * secret HMAC app-scopé. Aucun secret de hachage n'est embarqué ici, et aucune
 * identité brute n'atteint le stockage durable.
 *
 * Un changement d'identité tourne la session, comme en P2 : les événements de
 * l'utilisateur précédent ne doivent jamais être réattribués au suivant. Ceux
 * qui sont déjà en file gardent le snapshot pris à leur émission, y compris
 * lorsqu'ils partent après plusieurs renvois.
 */
export function setUser(user: string | IdentityInput | null): boolean {
  if (validateIdentity(user) === undefined) return false;
  // `setUser` renvoie « a changé » : ne tourner la session que dans ce cas, pour
  // qu'un re-rendu qui repose la même identité ne fabrique pas une session.
  if (store.setUser(user)) session?.rotate();
  return true;
}

export function clearUser(): void {
  setUser(null);
}

export function setAccount(account: string | IdentityInput | null): boolean {
  if (validateIdentity(account) === undefined) return false;
  if (store.setAccount(account)) session?.rotate();
  return true;
}

export function clearAccount(): void {
  setAccount(null);
}

// ──────────────────────── Vue, action, timing, flag ──────────────────────────

/**
 * Démarre une vue nommée stable, sans modifier la route déclarée par `screen`.
 *
 * L'instant de départ est pris sur l'horloge MONOTONE : c'est lui qui sert de
 * référence aux timings, et une horloge murale qui recule entre l'ouverture de
 * la vue et le timing produirait sinon une durée négative.
 */
export function startView(name: string, context: EventContext = {}): boolean {
  if (!ctx) return false;
  const view = store.startView(name, ctx.route ?? "", context, clock.nowMs());
  if (!view) return false;
  const snapshot = envelopeCtx();
  if (!snapshot) return false;
  return enqueue(buildViewSpan(snapshot, { id: view.id, name: view.name, context: snapshot.context }, now(), hex(8)));
}

/**
 * Émet une action déclarée par l'application. P7.2 n'ouvre AUCUNE fenêtre
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

/**
 * Émet un timing relatif au début de la vue courante. Sans vue : refusé.
 *
 * Sans argument, l'instant est lu sur l'horloge monotone. Avec un horodatage
 * mural explicite (compatibilité), il est converti en ANCIENNETÉ puis reporté
 * sur l'horloge monotone, et borné à l'instant présent : un horodatage venu
 * d'une horloge qui a reculé ne peut produire ni durée négative, ni durée
 * supérieure au temps réellement écoulé depuis l'ouverture de la vue.
 */
export function addTiming(name: string, timestamp?: number): boolean {
  const safeName = boundedName(name);
  if (!safeName) return false;
  const maintenant = clock.nowMs();
  let instant = maintenant;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    const anciennete = Math.max(0, now() - timestamp);
    instant = Math.min(maintenant, maintenant - anciennete);
  }
  const duration = store.timing(safeName, instant);
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

/** État de la collecte. `null` = information que le runtime ne connaît pas encore. */
export function getDiagnostics(): MobileDiagnostics {
  return {
    queued: queue?.length ?? 0,
    dropped,
    retries: started ? retries : null,
    storageAvailable: persist ? persist.storageAvailable : null,
    consent: gate ? gate.state : null,
    nativeCapabilities: null,
    beforeSendFaults: { ...hookFaults },
    identityPersistence,
    lastTransportStatus,
    storageCorruptions: persist ? persist.corruptionsDetectees : null,
  };
}

export default {
  init,
  screen,
  track,
  flushNow,
  consent,
  shutdown,
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
