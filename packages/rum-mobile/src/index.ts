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
// P7.3 — navigation, interactions et erreurs JS. Six changements, dont un est
// une RUPTURE DE COMPORTEMENT :
//   • la navigation se branche sur les callbacks publics du routeur, et un même
//     écran ne produit plus deux vues parce qu'un callback s'est répété ;
//   • `instrumentPressable` instrumente un appui à partir d'un nom DÉCLARÉ,
//     jamais du texte affiché ;
//   • une fenêtre causale rattache aux actions ce qu'elles causent réellement —
//     promesses comprises — et rien d'autre ;
//   • `ErrorUtils` déclare enfin la fatalité qu'il reçoit, et les rejets non
//     gérés sont collectés quand le runtime l'autorise, ou déclarés ABSENTS ;
//   • **`traceOrigins` ne propage plus que vers les origines déclarées.**
//     Jusqu'ici, une liste vide propageait vers TOUTES les origines sauf
//     l'endpoint : le `traceparent` et l'identifiant de session partaient donc
//     chez n'importe quel tiers appelé par l'application. Le README documente la
//     migration ;
//   • `markFirstScreenRendered()` mesure le démarrage JS — JS seulement.
//
// Ce qui n'est PAS ici : les capacités natives (`nativeCapabilities`, P7.5), les
// crashes natifs, l'ANR et la symbolication (P8.5).
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
import { FenetreCausale, type TypeAction } from "./causal";
import { SuiviNavigation, navigationDepuisRouteur } from "./navigation";
import { creerInstrumentation, type Instrumentation, type PropsPressable } from "./interactions";
import { installerRejets, rejetsDepuisTracker, type EtatCapacite, type InstallationRejets } from "./rejets";
import {
  CAPACITES_MOBILES,
  RAISON_CAPACITES_NATIVES,
  capacitesNativesActives,
  declarationCapacites,
  serialiserCapacites,
  type CapaciteMobile,
  type EtatCapaciteMobile,
} from "./capacites";
import {
  analyserTraceparent,
  composerTracestate,
  doitPropager,
  normaliserOrigine,
  resoudreTraceOrigins,
} from "./trace";
import type { EmitSpan } from "@mip/rum-core";

export type { EventContext, EventMeta, IdentityInput } from "@mip/rum-core";
export type {
  Adapters,
  ClockAdapter,
  EcranEntrant,
  EcranObserve,
  EtatCycleDeVie,
  LifecycleAdapter,
  NavigationAdapter,
  RandomAdapter,
  StorageAdapter,
  UnhandledRejectionAdapter,
} from "./adapters";
export type { EtatConsentement } from "./consent";
export type { EtatCapacite } from "./rejets";
export { CAPACITES_MOBILES, RAISON_CAPACITES_NATIVES };
export type { CapaciteMobile, EtatCapaciteMobile } from "./capacites";
export type { PropsPressable } from "./interactions";
export type { RefRouteur } from "./navigation";
export type { TrackerRejets } from "./rejets";

// Fabriques d'adaptateurs : l'application les appelle avec SES objets (la
// référence de son routeur, son module de suivi de rejets). Le SDK ne résout
// aucun module et ne suppose aucune version installée.
export { navigationDepuisRouteur } from "./navigation";
export { rejetsDepuisTracker } from "./rejets";

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
  /**
   * Origines vers lesquelles propager le contexte de trace (`traceparent`,
   * `tracestate`). **Liste FERMÉE : ce qui n'y figure pas ne reçoit rien.**
   *
   * RUPTURE DE COMPORTEMENT depuis la v0.3. Avant, une liste vide ou absente
   * propageait vers TOUTES les origines sauf l'endpoint de collecte — donc vers
   * les tiers appelés par l'application. Ces en-têtes portent l'identifiant de
   * session : les envoyer à une régie, un service de cartes ou une passerelle de
   * paiement, c'est leur donner de quoi relier leurs propres journaux à la
   * visite en cours. Le défaut est désormais « rien », et la corrélation
   * mobile → backend demande de nommer ses origines :
   * `traceOrigins: ["https://api.exemple.fr"]`.
   *
   * Chaque entrée doit être une origine absolue (`schéma://hôte[:port]`) ; une
   * entrée qui n'en est pas une est refusée, avec un avertissement unique au
   * démarrage. L'endpoint de collecte reste exclu même s'il y figure : une
   * requête d'ingestion tracée produirait un span, qui produirait une requête.
   */
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
  /**
   * Capacités NATIVES actives. `null` avant `init` (inconnu) ; tableau VIDE
   * après, ce qui est un fait connu et non une inconnue : aucun module natif
   * MIP n'est livré, donc ni crash natif, ni ANR, ni démarrage natif n'est
   * observé. `nativeCapabilitiesReason` dit pourquoi, en toutes lettres.
   */
  nativeCapabilities: CapaciteMobile[] | null;
  /** Pourquoi `nativeCapabilities` est vide. `null` avant `init`. */
  nativeCapabilitiesReason: string | null;
  /**
   * Déclaration COMPLÈTE transmise au serveur (les six capacités et leur état),
   * telle qu'elle partira au prochain envoi. `null` avant `init`.
   *
   * C'est un DÉCLARATIF CLIENT : il dit ce que le SDK croit avoir installé.
   * Aucune valeur de cet objet ne vaut un test natif passé, et aucune ne peut
   * écrire `verified_at` côté serveur.
   */
  capabilities: Record<CapaciteMobile, EtatCapaciteMobile> | null;
  /** Refus non contractuels du hook, par motif. Compteurs bornés. */
  beforeSendFaults: { exception: number; async: number };
  /** D'où vient le visiteur : `memory` quand le stockage est indisponible. */
  identityPersistence: PersistanceIdentite | null;
  /** Dernier statut HTTP non acquitté. Un STATUT, jamais un corps de réponse. */
  lastTransportStatus: number | null;
  /** Enregistrements durables illisibles, détectés puis abandonnés. */
  storageCorruptions: number | null;
  /**
   * Capacités de la couche **JavaScript** réellement installées. `null` avant
   * `init`. Distinct de `nativeCapabilities`, qui décrit ce que le NATIF
   * observe et reste inconnu tant que P7.5 n'a pas posé son modèle.
   *
   * `unavailable` n'est pas « zéro » : c'est « le runtime n'expose rien que le
   * SDK sache poser ET retirer ». Un tableau de bord qui lirait ces états doit
   * afficher « non collecté », jamais 0.
   */
  jsCapabilities: JsCapabilities | null;
}

/** États des capacités JS. Voir `MobileDiagnostics.jsCapabilities`. */
export interface JsCapabilities {
  /** `ErrorUtils` trouvé et enchaîné : erreurs JS non interceptées. */
  errorHandler: EtatCapacite;
  /** Rejets de promesses non gérés — adaptateur, événement standard, ou rien. */
  unhandledRejection: EtatCapacite;
  /** Un adaptateur de navigation est abonné ; sinon `screen()` reste manuel. */
  navigation: EtatCapacite;
  /** La mesure de démarrage JS a été déclarée par l'application. */
  appStart: EtatCapacite;
}

/** Délai maximal accordé au flush de `shutdown()`. */
const SHUTDOWN_TIMEOUT_MS = 2_000;

/**
 * Nom de la mesure de démarrage JS. **JS seulement** : elle court depuis
 * `init()` — c'est-à-dire depuis un moteur JS déjà démarré, un bundle déjà
 * chargé et une application déjà en train de s'exécuter — jusqu'au premier
 * écran que l'application DÉCLARE rendu. Elle ne mesure ni le démarrage du
 * processus, ni le pré-main natif, ni l'écran de lancement. Présentée comme un
 * « temps de démarrage », elle mentirait d'un facteur inconnu et toujours dans
 * le même sens : elle sous-estime.
 */
const DEMARRAGE_FROID = "js_start_to_first_screen_ms";

/**
 * Démarrage à CHAUD : depuis un retour au premier plan jusqu'au premier écran
 * déclaré ensuite. Nom distinct, parce que les deux populations n'ont ni la même
 * cause ni le même ordre de grandeur — les mélanger dans une même moyenne rend
 * les deux illisibles.
 */
const DEMARRAGE_CHAUD = "js_warm_start_to_first_screen_ms";

/**
 * Au-delà, la mesure est REFUSÉE. Un « démarrage » de plus d'une minute n'est
 * pas un démarrage : c'est un callback appelé tard, un écran monté après une
 * authentification, ou une application restée en arrière-plan. La publier
 * fabriquerait une queue de distribution qu'on finirait par lire comme un
 * incident de performance.
 *
 * Et cette borne n'est PAS un détecteur d'ANR : un compteur JS ne sait pas
 * distinguer un thread principal bloqué d'une application qui n'a rien à faire.
 * L'ANR appartient au natif, donc à P8.5.
 */
const DEMARRAGE_MAX_MS = 60_000;

/** Racines refusées mémorisées. Un diagnostic borné, jamais un journal. */
const RACINES_REFUSEES_MAX = 200;

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

/** Fenêtre causale : ce qui relie une action à ce qu'elle a réellement causé. */
let fenetre: FenetreCausale | null = null;
/** Mémoire de l'écran courant : c'est elle qui absorbe les callbacks répétés. */
let suiviNav = new SuiviNavigation();
/**
 * Racines d'action qui n'ont PAS été livrées — refusées par la gate ou par le
 * hook, évincées de la file, abandonnées par le serveur. Tout signal encore en
 * file qui les désigne perd son `mip.action_id` : c'est le mécanisme
 * `revokedRoots` du SDK web (`packages/rum-sdk/src/consent.ts`), transposé.
 */
const racinesRefusees = new Set<string>();
/** Origine monotone du démarrage JS. */
let demarrageA = 0;
/** Instant monotone du dernier retour au premier plan, pour le démarrage à chaud. */
let retourPremierPlanA: number | null = null;
let demarrageFroidEmis = false;
let capacites: JsCapabilities | null = null;
let rejets: InstallationRejets | null = null;
let originesRefusees: string[] = [];
/**
 * Contexte local de la racine en cours d'ouverture. La fenêtre causale appelle
 * `emitRoot` sans contexte — c'est sa frontière, et la lui faire traverser
 * l'obligerait à connaître le contrat P2. Cette variable la transporte sur la
 * seule pile d'appels qui les relie, et elle est vidée dans un `finally`.
 */
let contexteRacine: EventContext = {};

/** Ouvre une racine causale. Rend son identifiant, ou `null` si elle est refusée. */
function ouvrirAction(nom: string, type: TypeAction, context: EventContext = {}): string | null {
  if (!fenetre) return null;
  contexteRacine = context;
  try {
    return fenetre.ouvrir(nom, type);
  } finally {
    contexteRacine = {};
  }
}

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
let originesWarned = false;

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
    // L'ACTION CAUSALE est lue ici, et nulle part ailleurs : `envelopeCtx` est
    // le seul chemin traversé par tous les signaux, et `commonAttrs()` pose déjà
    // `mip.action_id` depuis P7.1. La fenêtre rend `null` dès que le lien n'est
    // plus prouvé — hors délai, racine refusée, session tournée, consentement
    // révoqué.
    actionId: fenetre?.courante() ?? null,
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
/** Ce span est-il la racine d'une action causale ? */
function estRacineAction(span: EmitSpan): boolean {
  return span.name === "rum.action" && span.attributes["mip.event_type"] === "action";
}

function actionIdDe(span: EmitSpan): string | null {
  const id = span.attributes["mip.action_id"];
  return typeof id === "string" && id ? id : null;
}

/**
 * Mémorise une racine non livrée, en bornant la mémoire. La plus ancienne part
 * en premier : au-delà de deux cents racines refusées, les enfants de la
 * première sont soit partis, soit tombés de la file eux aussi.
 */
function racineRefusee(id: string): void {
  if (racinesRefusees.size >= RACINES_REFUSEES_MAX) {
    const plusAncienne = racinesRefusees.values().next();
    if (!plusAncienne.done) racinesRefusees.delete(plusAncienne.value);
  }
  racinesRefusees.add(id);
}

function enqueue(span: EmitSpan | null): boolean {
  if (!span || !cfg || !gate || !queue) return false;
  const racine = estRacineAction(span);
  const actionId = actionIdDe(span);
  // UN ENFANT NE SURVIT PAS À SA RACINE. Si la racine a été refusée, le lien est
  // retiré AVANT le hook : `beforeSend` ne doit pas voir un identifiant que
  // l'ingestion ne connaîtra jamais, et l'enfant reste par ailleurs collectable.
  if (!racine && actionId && racinesRefusees.has(actionId)) {
    span = { ...span, attributes: { ...span.attributes, "mip.action_id": null } };
  }
  if (!gate.collecte) {
    if (racine && actionId) racineRefusee(actionId);
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
    if (racine && actionId) racineRefusee(actionId);
    dropped = compte(dropped);
    return false;
  }
  const complet: EmitSpan = { ...span, attributes: filtered };
  let poids: number;
  try {
    poids = octets(JSON.stringify(complet));
  } catch {
    if (racine && actionId) racineRefusee(actionId);
    dropped = compte(dropped);
    return false;
  }
  // En attente de consentement, le tampon mémoire reste au plafond P2 : aucun
  // octet ne part sur le réseau ni sur le disque, et un consentement jamais
  // donné ne doit pas coûter de mémoire à l'application hôte.
  const cap = gate.granted ? limites.maxEvents : Math.min(PENDING_MAX_EVENTS, limites.maxEvents);
  const entree: EntreeFile = { id: complet.spanId, span: complet, bytes: poids, at: now() };
  if (!queue.push(entree, now(), cap)) {
    if (racine && actionId) racineRefusee(actionId);
    return false;
  }
  // La racine est entrée en file : elle n'est plus refusée. Un identifiant
  // réutilisé — ce que la borne FIFO rend possible à très long terme — ne doit
  // pas amputer les enfants d'une action bel et bien livrée.
  if (racine && actionId) racinesRefusees.delete(actionId);
  if (gate.granted && queue.length >= BATCH_MAX_EVENTS) void flush();
  return true;
}

/**
 * Une racine a quitté la file sans être livrée (capacité, TTL, refus définitif
 * du serveur) : les signaux qu'elle a causés sont encore là et la désignent.
 * On coupe le lien plutôt que de laisser partir un `action_id` orphelin.
 */
function racinesDisparues(entrees: readonly EntreeFile[]): void {
  const ids = new Set<string>();
  for (const e of entrees) {
    if (!estRacineAction(e.span)) continue;
    const id = actionIdDe(e.span);
    if (id) {
      ids.add(id);
      racineRefusee(id);
    }
  }
  if (ids.size) queue?.retireAttribut("mip.action_id", ids);
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
    // La déclaration accompagne le lot, rafraîchie ici : c'est le seul endroit
    // qui connaît l'état RÉEL au moment de l'envoi. Elle voyage sur la resource,
    // donc une fois par requête et non par signal.
    const declaration = declarationCourante();
    cfg.capabilities = declaration ? serialiserCapacites(declaration) : null;
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

// --- erreurs JS non interceptées : ErrorUtils et rejets de promesses ---------

/**
 * Émet une erreur que PERSONNE n'a interceptée.
 *
 * `kind` distingue les deux mécanismes JS (`crash` pour le handler global,
 * `unhandledrejection` pour un rejet), et l'ingestion les reconnaît tous les
 * deux comme non gérés (`UNHANDLED_ERROR_KINDS`).
 *
 * `fatal` est DÉCLARÉ, jamais déduit : `ErrorUtils` reçoit l'information du
 * moteur, un rejet non géré ne termine aucune application React Native. Sans
 * cette déclaration, `rum_error.is_fatal` restait `null` — donc « inconnu » —
 * pour tous les crashes mobiles depuis l'origine du SDK.
 *
 * ET CE N'EST PAS UN CRASH NATIF. La source reste `react_native_js` : une
 * exception JS fatale arrête le bundle, affiche une redbox en développement et
 * laisse le processus natif vivant. Un crash natif — signal, exception
 * Objective-C, `SIGABRT` — n'est pas observable depuis ce runtime et appartient
 * à P8.5. Compter l'un pour l'autre produirait un taux de « sessions sans
 * crash » qui ne décrit ni l'un ni l'autre.
 */
function emettreNonInterceptee(err: unknown, kind: "crash" | "unhandledrejection", fatal: boolean): void {
  const snapshot = envelopeCtx();
  if (!snapshot) return;
  const e = err as { message?: unknown; name?: unknown; stack?: unknown } | null | undefined;
  const message = typeof e?.message === "string" && e.message ? e.message : String(err);
  const span = buildExceptionSpan(
    snapshot,
    {
      message: message.slice(0, 500),
      type: typeof e?.name === "string" ? e.name : null,
      stack: typeof e?.stack === "string" ? e.stack.slice(0, 4000) : null,
    },
    now(),
    hex(8),
  );
  enqueue({
    ...span,
    attributes: { ...span.attributes, "mip.error_kind": kind, "mip.error_fatal": fatal },
  });
}

function installCrashHandler(): EtatCapacite {
  const EU = global.ErrorUtils;
  if (!EU?.getGlobalHandler || !EU?.setGlobalHandler) return "unavailable";
  const prev = EU.getGlobalHandler();
  const notre = (err: any, isFatal: boolean) => {
    try {
      emettreNonInterceptee(err, "crash", isFatal === true);
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
  return "active";
}

/**
 * Rejets de promesses non gérés.
 *
 * Aucune découverte de module : l'adaptateur de l'application d'abord, puis les
 * mécanismes STANDARDS de l'objet global — et rien d'autre. Quand rien n'est
 * disponible, la capacité est déclarée absente ; c'est une information, pas un
 * échec, et `getDiagnostics().jsCapabilities` la publie pour qu'aucune surface
 * ne présente « aucun rejet » là où il faut lire « non collecté ».
 */
function installRejets(adapters: Adapters): EtatCapacite {
  // `globalThis` est décrit ici par la seule surface qu'on lit (`GlobalRejets`) :
  // le tsconfig du paquet n'inclut ni la lib DOM ni les types Node, et un
  // typage plus large affirmerait une API que le moteur n'expose peut-être pas.
  const cible = globalThis as unknown as Parameters<typeof installerRejets>[1];
  const installation = installerRejets(adapters.unhandledRejection, cible, (raison) => {
    try {
      // Un rejet non géré n'est PAS fatal : l'application continue de tourner.
      emettreNonInterceptee(raison, "unhandledrejection", false);
    } catch {
      /* ignore */
    }
  });
  rejets = installation;
  if (installation.etat === "active") {
    teardown.push(() => installation.desinstaller());
  }
  return installation.etat;
}

// --- patch réseau (fetch) : span http.client + propagation traceparent -------

/** Une requête passée en premier argument (`fetch(new Request(...))`). */
function estRequest(input: unknown): input is { url: string; method?: unknown; headers?: unknown } {
  return typeof input === "object" && input !== null && typeof (input as { url?: unknown }).url === "string";
}

/**
 * Lit un en-tête SANS rien allouer, dans l'ordre de précédence WHATWG : `init`
 * d'abord, la requête ensuite. Les trois formes admises par `HeadersInit` sont
 * traitées — instance `Headers`, tableau de paires, objet simple.
 *
 * Volontairement séparé de la fusion : la très grande majorité des requêtes ne
 * reçoit aucune propagation, et construire un `Headers` complet pour lire une
 * seule clef coûterait une copie par appel réseau de l'application.
 */
function lireEntete(source: unknown, nom: string): string | null {
  if (!source) return null;
  const get = (source as { get?: unknown }).get;
  if (typeof get === "function") {
    try {
      const v = (get as (n: string) => unknown).call(source, nom);
      return typeof v === "string" ? v : null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(source)) {
    for (const paire of source) {
      if (Array.isArray(paire) && String(paire[0]).toLowerCase() === nom) return String(paire[1]);
    }
    return null;
  }
  if (typeof source === "object") {
    for (const clef of Object.keys(source as Record<string, unknown>)) {
      if (clef.toLowerCase() === nom) {
        const v = (source as Record<string, unknown>)[clef];
        return typeof v === "string" ? v : null;
      }
    }
  }
  return null;
}

/** Recopie une source d'en-têtes dans un `Headers`, quelle que soit sa forme. */
function recopierEntetes(source: unknown, cible: { set(n: string, v: string): void }): void {
  if (!source) return;
  const forEach = (source as { forEach?: unknown }).forEach;
  if (typeof forEach === "function") {
    (forEach as (cb: (v: unknown, n: unknown) => void) => void).call(source, (valeur, nom) => {
      cible.set(String(nom), String(valeur));
    });
    return;
  }
  if (Array.isArray(source)) {
    for (const paire of source) {
      if (Array.isArray(paire) && paire.length >= 2) cible.set(String(paire[0]), String(paire[1]));
    }
    return;
  }
  if (typeof source === "object") {
    for (const clef of Object.keys(source as Record<string, unknown>)) {
      const valeur = (source as Record<string, unknown>)[clef];
      if (valeur != null) cible.set(clef, String(valeur));
    }
  }
}

function installFetchPatch(): void {
  const orig = global.fetch;
  if (typeof orig !== "function" || orig.__mipPatched) return;
  const patched = async (input: any, init?: any) => {
    // Désinstallé alors qu'un tiers avait patché par-dessus : on ne peut pas se
    // retirer de la chaîne, on devient un simple passe-plat.
    if ((patched as any).__mipInerte) return orig(input, init);

    const requete = estRequest(input);
    const url = requete ? input.url : typeof input === "string" ? input : String(input ?? "");
    const origine = normaliserOrigine(url);
    // LA MÉTHODE VIENT DES DEUX SOURCES. `fetch(new Request(url, {method:"POST"}))`
    // ne porte rien dans `init` : lire `init.method` seul rapportait « GET » pour
    // toutes les requêtes construites de cette façon, et l'ingestion en tirait
    // des `rum_span` faux.
    const methode = String(
      init?.method ?? (requete ? (input as { method?: unknown }).method : undefined) ?? "GET",
    ).toUpperCase();

    // Un `traceparent` DÉJÀ POSÉ et valide est préservé, et devient l'identité
    // de notre span : l'application (ou une couche tierce) a ouvert la trace,
    // l'écraser couperait sa corrélation en deux.
    const existant = analyserTraceparent(
      lireEntete(init?.headers, "traceparent") ?? (requete ? lireEntete(input.headers, "traceparent") : null),
    );
    const propager = doitPropager(origine, traceOrigins, endpointOrigin);
    const traceId = existant?.traceId ?? hex(16);
    const spanId = existant?.spanId ?? hex(8);

    let effectif = init;
    if (propager && !existant && ctx && session && typeof global.Headers === "function") {
      try {
        // FUSION, et non remplacement. Selon WHATWG, `init.headers` REMPLACE les
        // en-têtes de la requête ; repasser seulement les nôtres effacerait
        // l'Authorization, le Content-Type et tout le reste de l'appelant.
        const entetes = new global.Headers();
        if (requete) recopierEntetes((input as { headers?: unknown }).headers, entetes);
        recopierEntetes(init?.headers, entetes);
        entetes.set("traceparent", `00-${traceId}-${spanId}-01`);
        entetes.set("tracestate", composerTracestate(entetes.get?.("tracestate"), session.id));
        effectif = { ...(init ?? {}), headers: entetes };
      } catch {
        // Un `Headers` indisponible ou hostile ne doit pas faire échouer la
        // requête de l'application : on renonce à propager, pas à l'appeler.
        effectif = init;
      }
    }

    const start = now();
    // Le snapshot d'enveloppe est pris AU DÉPART de la requête : une rotation
    // d'identité pendant l'appel ne réattribue pas la requête au nouvel
    // utilisateur au moment du flush. L'action causale y est figée de la même
    // façon — ce qui a été lancé sous l'action lui reste attribué.
    const snapshot = envelopeCtx();
    // L'endpoint de collecte n'est jamais observé : un span par envoi produirait
    // un envoi par span.
    const observable = snapshot && origine && origine !== endpointOrigin;
    try {
      const res = effectif === undefined ? await orig(input) : await orig(input, effectif);
      if (observable) {
        enqueue(buildHttpSpan(snapshot!, { traceId, url, method: methode, status: res.status, durationMs: now() - start }, start, spanId));
      }
      return res;
    } catch (e) {
      if (observable) {
        enqueue(buildHttpSpan(snapshot!, { traceId, url, method: methode, status: 0, durationMs: now() - start }, start, spanId));
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

/**
 * Cycle de vie — UNIQUEMENT par adaptateur explicite.
 *
 * LE REPLI `global.require("react-native")` EST SUPPRIMÉ. Il paraissait gratuit
 * et ne l'était pas : sous Metro, `global.require` n'est pas le `require` de
 * CommonJS mais le résolveur interne du bundler, indexé par NUMÉRO de module.
 * Selon la configuration, il rendait `undefined` — donc un cycle de vie
 * silencieusement absent — ou levait. Dans les deux cas, la découverte
 * réussissait sur le poste du développeur et échouait sur un build de
 * production, sans que rien ne le signale. Ce que l'application ne branche pas
 * est ABSENT, et `getDiagnostics()` le dit.
 */
function installAppState(adapters: Adapters): void {
  const traiter = (etat: EtatCycleDeVie) => {
    session?.cycleDeVie(etat);
    if (etat === "active") {
      // Le retour au premier plan ouvre la fenêtre d'un démarrage À CHAUD. Il
      // n'émet rien par lui-même : seule l'application sait quand son écran est
      // réellement rendu, et c'est `markFirstScreenRendered()` qui le déclare.
      retourPremierPlanA = clock.nowMs();
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

  if (!adapters.lifecycle) return;
  try {
    const desabonner = adapters.lifecycle.subscribe(traiter);
    if (typeof desabonner === "function") teardown.push(() => { try { desabonner(); } catch { /* ignore */ } });
  } catch {
    /* un adaptateur défaillant ne casse pas l'initialisation */
  }
}

// --- navigation : callbacks publics du routeur, dédoublonnés ------------------

/**
 * Applique un écran : dédoublonnage, route courante, page vue, et fermeture de
 * la fenêtre causale.
 *
 * LA FERMETURE EST LE POINT IMPORTANT. Un changement d'écran met fin à
 * l'intention de l'appui qui l'a provoqué : ce qui se passe sur le nouvel écran
 * appartient au nouvel écran. Sans cela, une action « Payer » resterait
 * attribuée aux requêtes de l'écran de confirmation, et l'analyse causale
 * désignerait un bouton pour des effets qu'il n'a pas produits.
 */
function appliquerEcran(entrant: Parameters<SuiviNavigation["accepte"]>[0]): boolean {
  if (!ctx) return false;
  const retenu = suiviNav.accepte(entrant);
  if (!retenu) return false;
  ctx.route = retenu.name;
  fenetre?.fermer();
  const snapshot = envelopeCtx();
  if (!snapshot) return false;
  return enqueue(buildScreenSpan(snapshot, now(), hex(8)));
}

function installNavigation(adapters: Adapters): EtatCapacite {
  if (!adapters.navigation) return "unavailable";
  try {
    const desabonner = adapters.navigation.subscribeScreen((entrant) => {
      try {
        appliquerEcran(entrant);
      } catch {
        /* un routeur qui notifie n'importe quoi ne casse pas l'app hôte */
      }
    });
    if (typeof desabonner === "function") {
      teardown.push(() => { try { desabonner(); } catch { /* ignore */ } });
      return "active";
    }
    // Sans désabonnement, l'écouteur survivrait à `shutdown()`. On préfère
    // déclarer la capacité absente que promettre un arrêt qu'on ne tient pas.
    return "unavailable";
  } catch {
    return "unavailable";
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
    // Renseignée avant chaque envoi par `flushInterne` : à `init`, les
    // adaptateurs ne sont pas encore posés et la réponse serait fausse.
    capabilities: null,
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
  queue = new EventQueue(
    limites,
    (_motif: MotifPerte, nombre: number) => {
      for (let i = 0; i < nombre; i++) dropped = compte(dropped);
    },
    racinesDisparues,
  );
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
  const origines = resoudreTraceOrigins(opts.traceOrigins);
  traceOrigins = origines.origines;
  originesRefusees = origines.refusees;
  endpointOrigin = normaliserOrigine(opts.endpoint) ?? "";

  // Fenêtre causale : l'époque de consentement et la session en font partie —
  // une racine ouverte avant une révocation ou avant une rotation d'identité ne
  // doit plus rien attribuer.
  fenetre = new FenetreCausale({
    now: () => clock.nowMs(),
    sessionId: () => session?.id ?? "",
    epoch: () => gate?.epoch ?? 0,
    newId: () => newEnvelopeId(),
    emitRoot: (id, nom, type) => emettreActionRacine(id, nom, type),
  });
  suiviNav = new SuiviNavigation();
  racinesRefusees.clear();
  demarrageA = clock.nowMs();
  retourPremierPlanA = null;
  demarrageFroidEmis = false;

  if (originesRefusees.length) {
    // Le défaut ne propage plus rien : une entrée mal formée SILENCIEUSEMENT
    // ignorée couperait la corrélation d'un client qui croit l'avoir demandée.
    originesWarned = avertirUneFois(
      originesWarned,
      `traceOrigins : ${originesRefusees.length} entrée(s) ignorée(s), une origine absolue est attendue (https://hôte)`,
    );
  }

  if (persistant) {
    persistanceWarned = avertirUneFois(
      persistanceWarned,
      "file durable activée : son usage en production exige P8.1 (effacement transactionnel), sans quoi une reprise peut réécrire des données supprimées",
    );
  }

  const errorHandler = installCrashHandler();
  const unhandledRejection = installRejets(adapters);
  installFetchPatch();
  installAppState(adapters);
  const navigation = installNavigation(adapters);
  capacites = { errorHandler, unhandledRejection, navigation, appStart: "unavailable" };

  pret = bootstrapIdentite().catch(() => undefined);

  const timer = setInterval(() => void flush(), opts.flushIntervalMs ?? 3000);
  if (timer?.unref) timer.unref();
  teardown.push(() => clearInterval(timer));
}

/**
 * Déclare l'écran courant (route) et émet une vue historique `pageview`.
 *
 * `screen` reste le signal de navigation mobile, l'équivalent d'un changement
 * d'URL côté web, et n'ouvre pas de vue P2 nommée — `startView` le fait, comme
 * sur le web. Émettre les deux depuis `screen` doublerait le nombre
 * d'événements des intégrations déjà en place.
 *
 * CHANGEMENT P7.3 : un écran DÉJÀ COURANT ne produit plus de seconde page vue.
 * C'est la même règle que pour l'adaptateur de navigation, et pour la même
 * raison : la plupart des intégrations manuelles branchent `screen()` sur un
 * callback de routeur, qui se répète pour une seule transition. A → B → A
 * produit toujours trois pages vues : le dédoublonnage ne compare qu'à l'écran
 * courant, jamais à l'historique.
 *
 * `key` permet de distinguer deux instances du même écran empilées l'une sur
 * l'autre — une fiche produit ouverte depuis une autre fiche produit.
 */
export function screen(name: string, key?: string): void {
  appliquerEcran(typeof key === "string" ? { name, key } : name);
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
  // La fenêtre causale suit la purge : une racine de l'époque révoquée ne doit
  // rien attribuer, même si son délai n'est pas écoulé. Les racines refusées
  // mémorisées partent avec elle — la file est vide, plus aucun enfant n'attend.
  fenetre?.fermer();
  racinesRefusees.clear();
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
  fenetre = null;
  suiviNav.reinitialise();
  racinesRefusees.clear();
  capacites = null;
  rejets = null;
  originesRefusees = [];
  demarrageA = 0;
  retourPremierPlanA = null;
  demarrageFroidEmis = false;
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
  if (store.setUser(user)) rotationIdentite();
  return true;
}

/**
 * Rotation d'identité : session neuve, et fenêtre causale FERMÉE.
 *
 * Les deux vont ensemble. Laisser la fenêtre ouverte rattacherait au clic de
 * l'utilisateur précédent les signaux du suivant — la fenêtre causale vérifie
 * déjà la session, mais la fermer explicitement évite de dépendre de l'ordre
 * dans lequel la rotation et le prochain signal se produisent.
 */
function rotationIdentite(): void {
  session?.rotate();
  fenetre?.fermer();
}

export function clearUser(): void {
  setUser(null);
}

export function setAccount(account: string | IdentityInput | null): boolean {
  if (validateIdentity(account) === undefined) return false;
  if (store.setAccount(account)) rotationIdentite();
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
 * Émet la racine d'une action et rend la décision de la gate ET du hook.
 *
 * Ce booléen est tout le contrat de la fenêtre causale : c'est lui, et rien
 * d'autre, qui décide si les signaux suivants porteront l'identifiant. Une
 * racine jetée par `beforeSend` ou par un consentement refusé ne laisse donc
 * aucun enfant orphelin derrière elle.
 */
function emettreActionRacine(id: string, nom: string, type: TypeAction): boolean {
  const snapshot = envelopeCtx(contexteRacine);
  if (!snapshot) return false;
  const racine = buildActionSpan(snapshot, { id, name: nom, context: snapshot.context }, now(), hex(8));
  return enqueue({
    ...racine,
    // `manual` reste le défaut historique ; `click` décrit un geste RÉELLEMENT
    // observé sur un composant instrumenté. L'ingestion n'accepte que ces deux
    // valeurs (`ACTION_TYPES`), et inventer un « press » les ferait toutes deux
    // retomber sur `manual` côté serveur.
    attributes: { ...racine.attributes, "mip.action_type": type, "mip.action_id": id },
  });
}

/**
 * Émet une action déclarée par l'application et OUVRE la fenêtre causale.
 *
 * Tout ce qui suit dans les cinq secondes — requête réseau, erreur, événement
 * métier — portera `mip.action_id`. Au-delà, plus rien : la fenêtre ne devine
 * pas qu'un travail tardif venait de là.
 */
export function addAction(name: string, context: EventContext = {}): boolean {
  const safeName = boundedName(name);
  if (!safeName || !fenetre) return false;
  // Le contexte local de l'appel n'appartient qu'à la RACINE ; la fenêtre ne le
  // rejoue pas sur les signaux suivants, qui portent le leur.
  return ouvrirAction(safeName, "manual", context) != null;
}

/**
 * Instrumente les props d'un `Pressable`, `TouchableOpacity`, `Button` ou de
 * n'importe quel composant exposant `onPress`.
 *
 * OPT-IN : sans `mipActionName`, les props sont rendues À L'IDENTIQUE — même
 * objet, même gestionnaire, aucun rendu supplémentaire. Le nom est DÉCLARÉ et
 * jamais extrait du texte affiché : sur mobile, le libellé d'un bouton est très
 * souvent une donnée (« Payer 128,40 € », « Appeler Marie D. »).
 *
 * ```tsx
 * <Pressable {...RUM.instrumentPressable({
 *   mipActionName: "checkout.payer",
 *   accessibilityLabel: "Payer la commande",
 *   onPress: payer,
 * })}>
 * ```
 */
export const instrumentPressable: Instrumentation = creerInstrumentation({
  ouvrir: (nom: string) => ouvrirAction(nom, "click"),
  suivre: (resultat: unknown) => fenetre?.suivre(resultat),
});

/**
 * Déclare que le premier écran de l'application est rendu.
 *
 * Émet `js_start_to_first_screen_ms` au premier appel après `init()`, puis
 * `js_warm_start_to_first_screen_ms` après chaque retour au premier plan. Rend
 * `false` si la mesure n'a pas lieu d'être : SDK non démarré, consentement
 * refusé, mesure déjà prise, ou durée invraisemblable.
 *
 * CE QU'ELLE MESURE, ET RIEN DE PLUS : le temps JS écoulé entre l'appel à
 * `init()` et cet appel-ci. Pas le lancement du processus, pas le pré-main
 * natif, pas l'écran de lancement, pas le chargement du bundle avant `init`.
 * L'appeler depuis le `onLayout` du premier écran est le point de mesure
 * attendu ; l'appeler plus tard mesure autre chose.
 */
export function markFirstScreenRendered(): boolean {
  if (!started || !ctx) return false;
  const maintenant = clock.nowMs();
  let nom: string;
  let depuis: number;
  if (!demarrageFroidEmis) {
    nom = DEMARRAGE_FROID;
    depuis = demarrageA;
  } else if (retourPremierPlanA != null) {
    nom = DEMARRAGE_CHAUD;
    depuis = retourPremierPlanA;
  } else {
    // Déjà mesuré, et aucun retour au premier plan depuis : il n'y a pas de
    // troisième démarrage à décrire.
    return false;
  }
  const duree = maintenant - depuis;
  if (!Number.isFinite(duree) || duree < 0 || duree > DEMARRAGE_MAX_MS) {
    // On consomme quand même la fenêtre : sans cela, un appel tardif serait
    // refusé puis un autre, plus tard encore, publierait une durée pire.
    if (nom === DEMARRAGE_FROID) demarrageFroidEmis = true;
    else retourPremierPlanA = null;
    return false;
  }
  const snapshot = envelopeCtx();
  if (!snapshot) return false;
  const emis = enqueue(buildTimingSpan(snapshot, nom, duree, now(), hex(8)));
  if (nom === DEMARRAGE_FROID) demarrageFroidEmis = true;
  else retourPremierPlanA = null;
  if (emis && capacites) capacites.appStart = "active";
  return emis;
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

/**
 * Déclaration de capacités À CET INSTANT.
 *
 * Recalculée à chaque appel, et non mémorisée : un adaptateur de navigation
 * abonné après `init`, un stockage qui ne répond qu'au premier accès, une file
 * durable qui tombe — chacun change la réponse. Une déclaration figée décrirait
 * un état qui n'a duré qu'un instant, et elle serait fausse le reste du temps.
 */
function declarationCourante(): Record<CapaciteMobile, EtatCapaciteMobile> | null {
  if (!capacites) return null;
  return declarationCapacites({
    errorHandler: capacites.errorHandler,
    navigation: capacites.navigation,
    // La persistance n'est « active » que si elle est DEMANDÉE et que le
    // stockage répond. Activée sur un stockage muet, elle ne persiste rien :
    // la déclarer serait annoncer une reprise hors ligne qui n'aura pas lieu.
    offlinePersistence: persistant && persist?.storageAvailable === true ? "active" : "unavailable",
  });
}

/** État de la collecte. `null` = information que le runtime ne connaît pas encore. */
export function getDiagnostics(): MobileDiagnostics {
  const declaration = declarationCourante();
  return {
    queued: queue?.length ?? 0,
    dropped,
    retries: started ? retries : null,
    storageAvailable: persist ? persist.storageAvailable : null,
    consent: gate ? gate.state : null,
    nativeCapabilities: declaration ? capacitesNativesActives(declaration) : null,
    nativeCapabilitiesReason: declaration ? RAISON_CAPACITES_NATIVES : null,
    capabilities: declaration ? { ...declaration } : null,
    beforeSendFaults: { ...hookFaults },
    identityPersistence,
    lastTransportStatus,
    storageCorruptions: persist ? persist.corruptionsDetectees : null,
    jsCapabilities: capacites ? { ...capacites } : null,
  };
}

export default {
  init,
  screen,
  track,
  flushNow,
  consent,
  shutdown,
  instrumentPressable,
  markFirstScreenRendered,
  navigationDepuisRouteur,
  rejetsDepuisTracker,
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
