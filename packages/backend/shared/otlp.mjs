// Parser OTLP/HTTP JSON -> lignes SQL. JS pur, sans dépendance :
// importé tel quel par les routes d'ingestion de la console, le receveur du collector
// et le dev-server (l'edge function Deno qui l'importait aussi est retirée depuis le 23/09/2026).
// v0.3 : geo timezone->pays (attribut span mip.tz -> sessions[].geo_country).
import { tzToCountry } from "./tz-country.mjs";
// Scrub PII serveur (A2) : défense en profondeur, ne dépend pas du beforeSend client.
import { scrubProps, scrubText, scrubUrl } from "./scrub.mjs";
// Lot 2 : détection de trafic non humain (headless/monitoring/crawlers JS) ->
// sessions[].is_bot, exclu par défaut des agrégats console.
import { isBot } from "./bots.mjs";
// P5.3 : identité déterministe des exceptions dérivées d'un span ou d'un log.
import { sha256Hex } from "./sha256.mjs";
// P5.5 : clé de regroupement déclarée, hachée dans le périmètre de l'app.
import { overrideHash } from "./error-normalize.mjs";
// P6.1 : navigateur/système/appareil de la session, env/service/release bornés
// et recopiés sur chaque événement.
import { boundedDimension, boundedRelease, clientDimensions } from "./dimensions.mjs";
import { CAPABILITY_ATTRIBUTE, capabilityRows } from "./mobile-capabilities.mjs";

// Seuils Core Web Vitals — bornes [good, needs-improvement], alignés sur la
// référence web.dev (E0). SOURCE DE VÉRITÉ du rating : il est recalculé ici à
// l'ingestion, quoi qu'envoie le SDK. Miroir de rum-sdk/src/vitals.ts et
// console/lib/rating.ts — les trois doivent rester identiques.
const THRESHOLDS = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

// Les types de breadcrumb sont une petite taxonomie, pas un champ de texte.
// Accepter une valeur libre reviendrait à créer un second canal de persistance
// de PII à côté de `label`, même si le SDK officiel émet déjà cette liste.
const BREADCRUMB_TYPES = new Set(["click", "nav", "error", "custom"]);
const BREADCRUMB_LABEL_MAX = 120;
const RESOURCE_TYPES = new Set([
  "document", "stylesheet", "script", "image", "font", "xhr", "fetch", "beacon", "media", "worker", "other",
]);
const SPAN_INDEX_KINDS = new Set(["client", "server", "db", "internal"]);
const EVENT_INDEX_ROUTE_MAX = 512;
const EVENT_INDEX_VITALS = new Set(Object.keys(THRESHOLDS));
const NATIVE_SPAN_ID = /^[0-9a-f]{16}$/i;
const IDENTITY_HASH = /^[0-9a-f]{64}$/i;
const MANUAL_EVENT_TYPES = new Set(["custom", "view", "action", "timing", "feature_flag", "error"]);
const ACTION_TYPES = new Set(["click", "manual"]);
const ACTION_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const CONTEXT_MAX_BYTES = 16 * 1024;
const CONTEXT_MAX_KEYS = 64;
const CONTEXT_MAX_DEPTH = 4;
const CONTEXT_MAX_STRING = 500;
const CONTEXT_MAX_NAME = 100;
// `jsonb::text` ajoute des séparateurs avec espaces là où JSON.stringify est
// compact. Garder une marge avant la contrainte PostgreSQL de 16 KiB évite que
// la représentation acceptée ici soit ensuite rejetée par la base.
const EVENT_PROPS_MAX_BYTES = 12 * 1024;
const EVENT_PROPS_MAX_NODES = 256;
const EVENT_PROP_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const EVENT_PROP_SECRET_KEY = /pass(?:word|wd)?|pwd|secret|token|api[_-]?key|auth|bearer|email|e[_-]?mail|phone|ssn|credit|card|cvv|iban/i;
// Même allowlist négative que le SDK : sans ce miroir, un émetteur OTLP tiers
// pourrait réintroduire dans `mip.context` des noms techniques que le SDK
// officiel interdit, puis les faire persister comme données métier.
const CONTEXT_RESERVED_KEYS = new Set([
  "session_id", "trace_id", "span_id", "app_id", "client_id", "sampling",
  "sample_rate", "error_sample_rate", "route", "view_id", "action_id",
]);
const CONTEXT_DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function breadcrumbType(value) {
  return typeof value === "string" && BREADCRUMB_TYPES.has(value.toLowerCase())
    ? value.toLowerCase()
    : "custom";
}

export function breadcrumbLabel(value) {
  const clean = scrubText(value);
  return clean == null ? null : clean.slice(0, BREADCRUMB_LABEL_MAX);
}

/**
 * Libellé optionnel de la projection d'événements.
 *
 * L'index n'est pas un second stockage de texte libre : il ne retient qu'un
 * nom court, déjà scrubbed, pour distinguer les catégories homogènes. Les
 * messages, stacks, props et corps de log ne passent jamais par ici.
 */
export function isNativeSpanId(value) {
  return typeof value === "string" && NATIVE_SPAN_ID.test(value);
}

/**
 * Frontière route de la projection. Une URL absolue, un protocole-relative ou
 * une route non-string ne deviennent jamais un second canal de stockage. La
 * base applique ensuite exactement mip_router_ou_autre() (règles + plafond de
 * cardinalité), via le trigger de rum_event_index.
 */
export function eventIndexRoute(value) {
  const clean = scrubUrl(value);
  if (clean == null || !clean.startsWith("/") || clean.startsWith("//")) return null;
  return clean.slice(0, EVENT_INDEX_ROUTE_MAX);
}

function boundedName(value) {
  if (typeof value !== "string") return null;
  const clean = scrubText(value)?.trim() ?? "";
  if (clean.length > CONTEXT_MAX_NAME) return null;
  return clean || null;
}

function boundedString(value) {
  if (typeof value !== "string" || value.length > CONTEXT_MAX_STRING) return null;
  const clean = scrubText(value);
  return clean ? clean : null;
}

export function causalActionId(value) {
  return typeof value === "string" && ACTION_ID.test(value) ? value.toLowerCase() : null;
}

/**
 * Nombre gardé dans un contexte ou des props : fini, et écrit SANS exposant.
 *
 * Les bornes d'octets se mesurent ici en JSON compact, mais la contrainte
 * PostgreSQL mesure `jsonb::text`, où un numeric s'écrit en toutes lettres :
 * `1e308` y occupe 309 octets au lieu de 6. Un contexte de 120 × 1e308, loin
 * sous les 16 Kio en JSON, dépassait donc la limite en base et faisait rejeter
 * tout le lot. JavaScript n'écrit un exposant qu'au-delà de 1e21 ou en deçà de
 * 1e-6 : sans ces valeurs, un nombre garde la même longueur des deux côtés.
 */
function nombreSansExposant(value) {
  return Number.isFinite(value) && !/e/i.test(String(value));
}

function boundedContextValue(value, depth, budget) {
  if (value == null) return null;
  // Un `\u0000` échappé dans le JSON redevient un vrai NUL après JSON.parse :
  // la frontière d'anyValue ne l'a donc jamais vu passer.
  if (typeof value === "string") return value.length <= CONTEXT_MAX_STRING ? sansNul(scrubText(value) ?? "") : undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return nombreSansExposant(value) ? value : undefined;
  if (depth >= CONTEXT_MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => boundedContextValue(item, depth + 1, budget)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (budget.keys >= CONTEXT_MAX_KEYS) break;
    const key = sansNul((scrubText(rawKey) ?? "").trim());
    if (key.length > CONTEXT_MAX_NAME) continue;
    if (!key || key.startsWith("mip.") || CONTEXT_RESERVED_KEYS.has(key.toLowerCase()) || CONTEXT_DANGEROUS_KEYS.has(key.toLowerCase())) continue;
    budget.keys++;
    const clean = boundedContextValue(rawValue, depth + 1, budget);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/** Seconde frontière de limites/scrub, indépendante du SDK officiel. */
export function boundedEventContext(raw) {
  const parsed = typeof raw === "string" ? parseJsonAttr(raw) : raw;
  const clean = boundedContextValue(parsed, 0, { keys: 0 });
  if (!clean || Array.isArray(clean) || typeof clean !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(clean)) {
    out[key] = value;
    if (BufferLikeByteLength(JSON.stringify(out)) > CONTEXT_MAX_BYTES) delete out[key];
  }
  return out;
}

function boundedPropsValue(value, depth, budget) {
  if (budget.nodes >= EVENT_PROPS_MAX_NODES) return undefined;
  budget.nodes++;
  if (value == null) return null;
  // Mêmes raisons que boundedContextValue : NUL ressuscité par JSON.parse,
  // exposant démultiplié par `jsonb::text`.
  if (typeof value === "string") return sansNul(scrubText(value.slice(0, CONTEXT_MAX_STRING)) ?? "");
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return nombreSansExposant(value) ? value : undefined;
  if (depth >= CONTEXT_MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, CONTEXT_MAX_KEYS)
      .map((item) => boundedPropsValue(item, depth + 1, budget))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const out = {};
  for (const rawKey in value) {
    if (!Object.prototype.hasOwnProperty.call(value, rawKey)) continue;
    if (budget.keys >= CONTEXT_MAX_KEYS) break;
    if (rawKey.length > CONTEXT_MAX_NAME) continue;
    const key = (scrubText(rawKey) ?? "").trim();
    if (!EVENT_PROP_KEY.test(key) || CONTEXT_DANGEROUS_KEYS.has(key.toLowerCase())) continue;
    budget.keys++;
    const clean = EVENT_PROP_SECRET_KEY.test(key)
      ? "[redacted]"
      : boundedPropsValue(value[rawKey], depth + 1, budget);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/** Props custom scrubbed puis bornées avant toute écriture et toute facette. */
export function boundedEventProps(raw) {
  if (typeof raw === "string" && BufferLikeByteLength(raw) > EVENT_PROPS_MAX_BYTES * 4) return {};
  const parsed = typeof raw === "string" ? parseJsonAttr(raw) : raw;
  // Le scrub et le bornage partagent la même traversée : on ne clone jamais
  // d'abord un payload hostile complet avant de lui appliquer les limites.
  const clean = boundedPropsValue(parsed, 0, { keys: 0, nodes: 0 });
  if (!clean || Array.isArray(clean) || typeof clean !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(clean)) {
    out[key] = value;
    if (BufferLikeByteLength(JSON.stringify(out)) > EVENT_PROPS_MAX_BYTES) delete out[key];
  }
  return out;
}

function BufferLikeByteLength(value) {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(value).length : value.length;
}

function eventMetadata(attributes) {
  const type = MANUAL_EVENT_TYPES.has(attributes["mip.event_type"])
    ? attributes["mip.event_type"]
    : null;
  const userHash = attributes["mip.user_id_hash"];
  const accountHash = attributes["mip.account_id_hash"];
  const context = boundedEventContext(attributes["mip.context"]);
  const viewId = boundedName(attributes["mip.view_id"]);
  const viewName = boundedName(attributes["mip.view_name"]);
  const actionId = causalActionId(attributes["mip.action_id"]);
  const featureFlagValue = boundedString(attributes["mip.feature_flag_value"]);
  const timing = attributes["mip.timing_ms"];
  return {
    ...(type ? { event_type: type } : {}),
    ...(Object.keys(context).length ? { context } : {}),
    ...(typeof userHash === "string" && IDENTITY_HASH.test(userHash) ? { user_id_hash: userHash.toLowerCase() } : {}),
    ...(typeof accountHash === "string" && IDENTITY_HASH.test(accountHash) ? { account_id_hash: accountHash.toLowerCase() } : {}),
    ...(viewId ? { view_id: viewId } : {}),
    ...(viewName ? { view_name: viewName } : {}),
    ...(actionId ? { action_id: actionId } : {}),
    ...(typeof timing === "number" && Number.isFinite(timing) && timing >= 0 ? { timing_ms: timing } : {}),
    ...(featureFlagValue !== null ? { feature_flag_value: featureFlagValue } : {}),
  };
}

/**
 * Projection minimale construite UNIQUEMENT depuis les lignes déjà
 * normalisées par flattenOtlp. Ne jamais la dériver des attributs OTLP : cela
 * réintroduirait les URL brutes, props ou identités que les collections source
 * viennent précisément de contrôler.
 */
export function buildEventIndex({ pageviews = [], metrics = [], errors = [], resources = [], longtasks = [], breadcrumbs = [], events = [], spans = [] }) {
  const index = [];
  const ajouter = (kind, row, sourceName = null) => {
    // L'ID de span OTLP est une valeur technique de 64 bits, pas un texte libre.
    // Toute autre chaîne reste éventuellement dans la source historique, mais
    // n'entre jamais dans la projection/API.
    if (!row || !isNativeSpanId(row.span_id)) return;
    const context = row.context && Object.keys(row.context).length ? row.context : null;
    // Rebornée : un lot différé déposé avant P6.1 porte encore sa release brute.
    const release = boundedRelease(row.release);
    index.push({
      app_id: row.app_id,
      session_id: row.session_id ?? null,
      ts: row.ts,
      route: eventIndexRoute(row.route),
      kind,
      source_name: sourceName,
      source_span_id: row.span_id.toLowerCase(),
      ...(row.event_type ? { event_type: row.event_type } : {}),
      ...(context ? { context } : {}),
      ...(row.user_id_hash ? { user_id_hash: row.user_id_hash } : {}),
      ...(row.account_id_hash ? { account_id_hash: row.account_id_hash } : {}),
      ...(row.view_id ? { view_id: row.view_id } : {}),
      ...(row.view_name ? { view_name: row.view_name } : {}),
      ...(row.action_id ? { action_id: row.action_id } : {}),
      ...(row.timing_ms != null ? { timing_ms: row.timing_ms } : {}),
      ...(row.feature_flag_value != null ? { feature_flag_value: row.feature_flag_value } : {}),
      // P6.1 : dimensions déclarées de la source, à l'identique (migration-v75).
      ...(row.env ? { env: row.env } : {}),
      ...(release ? { release } : {}),
      ...(row.service ? { service: row.service } : {}),
    });
  };

  for (const row of pageviews) ajouter("pageview", row);
  for (const row of metrics) {
    ajouter("vital", row, EVENT_INDEX_VITALS.has(row.name) ? row.name : null);
  }
  for (const row of errors) ajouter("error", row);
  for (const row of resources) {
    const type = typeof row.type === "string" ? row.type.toLowerCase() : "other";
    ajouter("resource", row, RESOURCE_TYPES.has(type) ? type : "other");
  }
  for (const row of longtasks) ajouter("longtask", row, row.source === "loaf" ? "loaf" : "longtask");
  for (const row of breadcrumbs) ajouter("breadcrumb", row, BREADCRUMB_TYPES.has(row.type) ? row.type : null);
  for (const row of events) {
    ajouter("event", row,
      row.name === "frustration.rage" || row.name === "frustration.dead" || row.name === "frustration.error"
        ? row.name
        : "track");
  }
  for (const row of spans) ajouter("span", row, SPAN_INDEX_KINDS.has(row.kind) ? row.kind : null);
  return index;
}

/** Rating CWV selon seuils 2026 ; null si métrique inconnue. */
export function rating2026(name, value) {
  const t = THRESHOLDS[name];
  if (!t || typeof value !== "number") return null;
  return value <= t[0] ? "good" : value <= t[1] ? "needs-improvement" : "poor";
}

/**
 * Remplace U+0000 par U+FFFD dans une chaîne ; toute autre valeur est rendue
 * telle quelle.
 *
 * PostgreSQL refuse ce caractère dans un text (22021) comme dans un jsonb
 * (22P05), et le refus d'UNE valeur annule la transaction, donc tout le lot. Il
 * arrive sans aucune malveillance : le message d'erreur de `JSON.parse` en V8
 * recopie l'entrée fautive, NUL compris. Remplacer plutôt que rejeter garde
 * l'erreur visible, et le caractère de remplacement dit qu'un octet a été
 * altéré.
 */
export function sansNul(value) {
  return typeof value === "string" ? value.replaceAll("\u0000", "\uFFFD") : value;
}

/** Déstructure un AnyValue OTLP ({stringValue|intValue|doubleValue|boolValue}). */
export function anyValue(v) {
  if (v == null) return null;
  // Frontière unique pour TOUTES les chaînes d'attribut (message, stack, route,
  // release, noms de vue…) : aucun lecteur en aval n'a à y repenser.
  if ("stringValue" in v) return sansNul(v.stringValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("intValue" in v) return Number(v.intValue); // arrive en string ou number selon l'émetteur
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v)
    return (Array.isArray(v.arrayValue?.values) ? v.arrayValue.values : []).map(anyValue);
  return null;
}

/** KeyValue[] OTLP -> objet JS plat. Tolère un payload malformé (A5 : durcissement). */
export function attrsToObj(attrs) {
  const out = {};
  for (const kv of Array.isArray(attrs) ? attrs : []) {
    if (kv && typeof kv.key === "string") out[kv.key] = anyValue(kv.value);
  }
  return out;
}

// Fenêtre anti-dérive d'horloge : 5 min dans le futur, 7 j dans le passé.
const SKEW_FUTURE_MS = 5 * 60 * 1000;
const SKEW_PAST_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * nanos OTLP -> Date, avec GARDE ANTI-DÉRIVE D'HORLOGE (clock skew). Les
 * timestamps viennent du NAVIGATEUR (horloge cliente, parfois fausse de plusieurs
 * heures/années). Un ts dans le futur est toujours erroné ; un ts très ancien
 * aussi (la file retry ne rejoue qu'au plus quelques heures/jours). Hors de la
 * fenêtre [now-7j, now+5min], on retombe sur l'heure de RÉCEPTION serveur
 * (`nowMs` ≈ maintenant) — sinon la mesure atterrit dans le mauvais bucket
 * temporel et fausse les séries. `nowMs` injectable pour les tests.
 */
export function nanosToDate(nanos, nowMs = Date.now()) {
  if (!nanos) return new Date(nowMs);
  let ms;
  try {
    ms = Number(BigInt(nanos) / 1000000n);
  } catch {
    return new Date(nowMs); // nanos non numérique (payload hostile) : ts = maintenant
  }
  if (ms > nowMs + SKEW_FUTURE_MS) return new Date(nowMs); // horloge cliente en avance
  if (ms < nowMs - SKEW_PAST_MS) return new Date(nowMs); // horloge fausse / retry trop ancien
  return new Date(ms);
}

/**
 * Taux d'échantillonnage principal, dans ]0, 1]. Rend 1 sur toute valeur
 * absente, illisible, nulle ou hors bornes.
 *
 * ZÉRO EST REFUSÉ ICI, ET C'EST DÉLIBÉRÉ. Le poids vaut `1 / taux` : un 0
 * accepté donnerait un poids infini, et une seule ligne corrompue suffirait à
 * faire exploser tous les volumes de l'application. Un taux réellement nul n'a
 * de toute façon pas de sens sur une session qu'on est en train d'ingérer — il
 * n'aurait produit aucune donnée. 1 signifie « pas d'échantillonnage », donc
 * « ne repondère rien » : le repli qui ne peut pas mentir dans les grandes
 * largeurs.
 */
export function tauxPrincipal(v) {
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 1;
}

/**
 * Taux biaisé-erreurs, dans [0, 1] — ZÉRO COMPRIS, contrairement au précédent.
 *
 * `keepOnError: false` est une configuration parfaitement valide, et le SDK émet
 * alors 0. Le confondre avec « absent » et retomber sur 1 ferait croire que
 * toute session en erreur est certaine d'être collectée : les sessions en erreur
 * seraient sous-pondérées et le taux d'erreur affiché trop bas. Zéro ne divise
 * rien ici — il n'intervient qu'en facteur, `sr + (1 - sr) × esr`.
 */
export function tauxErreurs(v) {
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1;
}

/**
 * Occurrences représentées par une ligne d'erreur (`mip.error_count`).
 *
 * BORNÉ À 10 000, et pas par superstition : ce nombre vient du navigateur, donc
 * d'une valeur qu'un tiers peut fabriquer. Non borné, un seul beacon suffirait à
 * faire afficher des milliards d'occurrences et à écraser tous les autres
 * groupes du classement. 1 sur toute valeur absente, illisible ou < 1.
 */
export function occurrencesDe(v) {
  const n = typeof v === "number" ? v : Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 1 ? Math.min(Math.floor(n), 10_000) : 1;
}

/** Attributs string JSON (webvital.attribution, mip.props) -> objet pour le jsonb. */
function parseJsonAttr(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Hash FNV-1a 32 bits -> hex sur 8 caractères. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const RE_URL = /https?:\/\/[^\s"')]+/gi;
const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Message normalisé : urls, uuids puis chiffres remplacés par '#' (l'ordre compte). */
function normalizeMessage(message) {
  return String(message ?? "")
    .replace(RE_URL, "#")
    .replace(RE_UUID, "#")
    .replace(/\d+/g, "#")
    .trim();
}

// ─────────────── Normalisation d'une frame de pile, pour le regroupement ──────
//
// CE QUI SE PASSAIT. La frame ne perdait que `:ligne:colonne`. L'URL du bundle y
// restait entière — avec son EMPREINTE DE CONTENU. Or toute application moderne
// (Next.js, Vite, webpack, Angular CLI) sert des fichiers à nom haché :
//
//   déploiement N    …/chunks/main-4f2a9c1d.js   -> empreinte d218b59b
//   déploiement N+1  …/chunks/main-7b3e88ff.js   -> empreinte ec52be20
//
// Le même bug changeait donc de groupe à CHAQUE mise en production. `first_seen`
// repartait à zéro, le statut de triage (error_status, clé app_id+fingerprint) ne
// suivait pas, une erreur marquée « résolue » revenait en groupe neuf plutôt
// qu'en régression, et la détection de régression ne se déclenchait jamais.
// Pendant ce temps la vitrine promettait « groupées par empreinte pour qu'un même
// bug ne compte qu'une fois ».
//
// CE QU'ON RETIRE, ET CE QU'ON GARDE. On retire l'origine (une même application
// est servie depuis des domaines différents en préproduction, en préversion et en
// production), la query string, et les empreintes de contenu — dans le nom de
// fichier comme dans les segments de chemin. On GARDE le nom de fonction et le
// chemin logique : c'est ce qui distingue deux bugs.
//
// PRUDENCE ASSUMÉE. Trop normaliser est pire que pas assez : deux bugs distincts
// fondus dans un même groupe, c'est un bug qu'on ne voit plus du tout, alors
// qu'un groupe qui se scinde reste visible. Un segment n'est donc remplacé que
// s'il est ENTIÈREMENT hexadécimal sur 8 caractères ou plus — jamais sur une
// heuristique d'entropie. Reste connu : un identifiant de build non hexadécimal
// (`/_next/static/<buildId>/`, en base 62) échappe encore à la règle.

/** `-4f2a9c1d` ou `.a1b2c3d4` juste avant l'extension : une empreinte de contenu. */
const RE_HASH_FICHIER = /([._-])[0-9a-f]{8,}(?=\.[a-z0-9]+$)/i;
/** Un segment de chemin entièrement hexadécimal : un identifiant de build. */
const RE_SEGMENT_HEX = /^[0-9a-f]{8,}$/i;

/** Chemin d'un module, débarrassé de ce qui change à chaque déploiement. */
export function normalizeModulePath(url) {
  let chemin = String(url ?? "");
  // Origine et protocole : `https://app.fr/a/b.js` -> `/a/b.js`. Le repli couvre
  // les URL relatives et les schémas non http (extension, blob, eval).
  chemin = chemin.replace(/^[a-z-]+:\/\/[^/]+/i, "");
  chemin = chemin.split("?")[0].split("#")[0];
  const segments = chemin.split("/").map((seg, i, tous) => {
    if (RE_SEGMENT_HEX.test(seg)) return "#";
    // Le dernier segment est le nom de fichier : son empreinte y est infixée.
    if (i === tous.length - 1) return seg.replace(RE_HASH_FICHIER, "$1#");
    return seg;
  });
  return segments.join("/");
}

/** Premier frame de la stack (ligne `at …` ou style `fn@url`), normalisé. */
export function firstStackFrame(stack) {
  const lines = String(stack ?? "").split("\n");
  for (const line of lines) {
    const l = line.trim();
    if (!/^at\s/.test(l) && !/\S@\S/.test(l)) continue;
    // `:ligne:colonne` d'abord — sinon il serait pris pour une partie de l'URL.
    const sansPosition = l.replace(/:\d+:\d+/g, "");
    // Puis chaque URL de la frame passe par la normalisation de chemin.
    return sansPosition.replace(/(?:[a-z-]+:\/\/[^\s"')]+|\/[^\s"')]+)/gi, (u) =>
      normalizeModulePath(u),
    );
  }
  return "";
}

/**
 * Fingerprint de regroupement d'erreurs (ROADMAP v0.2 §Contrat) :
 * fnv1a(error_type + message normalisé + 1er frame de stack sans line:col).
 * Stable pour une même famille (ids numériques / uuids / urls / line:col variables).
 */
export function errorFingerprint(errorType, message, stack) {
  return fnv1a(
    [errorType ?? "", normalizeMessage(message), firstStackFrame(stack)].join("|"),
  );
}

// ─────────────── Enveloppe d'erreur fiable (P5.1, migration-v69) ───────────────
//
// Chaque occurrence porte sa corrélation, sa source et son caractère géré ou
// fatal. RÈGLE COMMUNE : ce que l'émetteur n'a pas dit reste NULL. Une source,
// une trace ou une fatalité devinée fabriquerait des liens et des filtres
// faux, là où NULL affiche honnêtement « Inconnu ». Chaque valeur est aussi
// bornée ici par la contrainte `rum_error_envelope_v69` : une valeur que la base
// refuserait annulerait le lot entier, pas seulement le champ.

/** Taxonomie fermée de rum_error.error_source, dans l'ordre de migration-v69. */
export const ERROR_SOURCES = Object.freeze([
  "browser_js", "browser_console", "browser_resource", "browser_csp", "browser_network",
  "node", "python", "react_native_js", "native", "otel",
]);

const NATIVE_TRACE_ID = /^[0-9a-f]{32}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const ERROR_TYPE_MAX = 200;
const ERROR_KIND = /^[a-z][a-z0-9_.-]{0,39}$/i;
/** `lineno`/`colno` sont des `int` PostgreSQL. */
const INT4_MAX = 2_147_483_647;
/** Catégories navigateur EXPLICITES ; toute autre valeur reste du JS. Une Map,
 *  pas un objet : `constructor` ne doit pas devenir une source. */
const BROWSER_ERROR_SOURCES = new Map([
  ["console", "browser_console"],
  ["resource", "browser_resource"],
  ["csp", "browser_csp"],
  ["network", "browser_network"],
]);
/** Listeners globaux des SDK (window error, unhandledrejection, ErrorUtils RN). */
const UNHANDLED_ERROR_KINDS = new Set(["error", "unhandledrejection", "crash"]);

/**
 * Trace OTLP native (32 hex), en minuscules, ou null.
 *
 * Deux formes bien formées sont refusées. Le tout-zéro est invalide selon W3C.
 * Seize zéros en tête trahissent un identifiant de 64 bits complété : c'est ce
 * que fabrique rum-mobile (`spanId.padStart(32, "0")`) quand aucun appel réseau
 * ne lui donne de trace. Le garder ferait afficher un lien vers une trace qui
 * n'a jamais existé. Le tout-zéro commençant lui aussi par seize zéros, un seul
 * test couvre les deux.
 */
export function nativeTraceId(value) {
  if (typeof value !== "string" || !NATIVE_TRACE_ID.test(value)) return null;
  const id = value.toLowerCase();
  return id.startsWith("0000000000000000") ? null : id;
}

/** Span parent OTLP natif (16 hex non nuls), en minuscules, ou null. */
export function nativeParentSpanId(value) {
  if (!isNativeSpanId(value) || value === "0000000000000000") return null;
  return value.toLowerCase();
}

/**
 * `exception.type` borné, ou null.
 *
 * Texte libre de l'émetteur : non borné, un seul span écrivait des mégaoctets
 * dans une colonne affichée partout. Coupé APRÈS le scrub (un secret ne doit pas
 * survivre coupé en deux). Un type réaliste (`TypeError`, `ValueError`) traverse
 * inchangé, donc son empreinte de regroupement aussi.
 */
export function boundedErrorType(value) {
  if (typeof value !== "string") return null;
  return (scrubText(value) ?? "").trim().slice(0, ERROR_TYPE_MAX) || null;
}

/**
 * `kind` historique : la valeur explicite, octet pour octet, si c'est un mot
 * court ; sinon "error". Un texte libre ici serait un second message, non scrubbé.
 */
function errorKind(value) {
  return typeof value === "string" && ERROR_KIND.test(value) ? value : "error";
}

/**
 * Ligne ou colonne dans la source : entier de [0, 2^31 - 1], chaîne décimale
 * acceptée, sinon null. « 12.5 », « 1e21 » ou `true` faisaient refuser l'INSERT
 * par la colonne `int` — et avec lui tout le lot.
 */
function positionSource(value) {
  const n = typeof value === "number" ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value)
      : Number.NaN;
  return Number.isInteger(n) && n >= 0 && n <= INT4_MAX ? n : null;
}

/**
 * Runtime d'un SDK client MIP (navigateur ou React Native), ou null.
 *
 * Reconnu sur les seuls marqueurs posés par nos SDK : le `service.name` constant
 * (mip-rum-web, mip-rum-mobile) ou le scope de l'émetteur web.
 */
function runtimeClientMip(resource, scopeName) {
  const serviceName = resource["service.name"];
  if (serviceName === "mip-rum-mobile") return "react_native";
  return scopeName === "@mip/rum-sdk" || serviceName === "mip-rum-web" ? "browser" : null;
}

// ──────────── Dimensions déclarées d'un signal (P5.1, P6.1 migration-v75) ────────────
//
// Posées sur la resource OTLP, donc communes à tous les signaux d'un scope, et
// recopiées sur CHAQUE ligne : une release qui change au cours d'une session
// (mise en production pendant la visite) ne réécrit jamais les événements passés.

/** Environnement déclaré, pas vérifié : le SDK web vaut « dev » par défaut. */
function envDeclare(resource) {
  return boundedDimension(resource["deployment.environment.name"] ?? resource["deployment.environment"]);
}

/**
 * Service déclaré par un émetteur, ou null pour un SDK client MIP : son nom
 * constant (mip-rum-web, mip-rum-mobile) n'est pas le service du client.
 */
function serviceDeclare(resource, scopeName) {
  return runtimeClientMip(resource, scopeName) ? null : boundedDimension(resource["service.name"]);
}

/**
 * Release d'un signal backend : `mip.release`, sinon `service.version`, que les
 * backends OpenTelemetry emploient pour leur version. Pour un SDK client MIP, ce
 * même attribut est la version du SDK, jamais celle de l'application. Les
 * signaux de session, eux, ne lisent que `mip.release` : un ancien SDK web sans
 * marqueur ferait sinon passer sa propre version pour celle de l'app.
 */
function releaseServeur(resource, scopeName) {
  return boundedRelease(resource["mip.release"]) ??
    (runtimeClientMip(resource, scopeName) ? null : boundedRelease(resource["service.version"]));
}

/**
 * Source, caractère géré/fatal et dimensions déclarées d'une exception.
 *
 * Une exception d'un span dédié `exception` ne voit que le runtime des SDK
 * client MIP : tout autre émetteur reste inconnu, parce qu'un ancien SDK web sans
 * marqueur y ressemble. Les exceptions DÉRIVÉES d'un span ou d'un log (P5.3)
 * complètent la source par `backendErrorSource`.
 */
export function errorEnvelope({ attrs = {}, resource = {}, scopeName = null, eventType = null }) {
  const runtime = runtimeClientMip(resource, scopeName);
  const kind = attrs["mip.error_kind"];

  let handled = null;
  if (typeof attrs["mip.error_handled"] === "boolean") handled = attrs["mip.error_handled"];
  // addError() : l'application a capturé l'erreur elle-même.
  else if (eventType === "error") handled = true;
  // Listener global d'un SDK connu : personne ne l'a interceptée. Le même mot
  // venu d'un émetteur inconnu ne prouve rien.
  else if (runtime && UNHANDLED_ERROR_KINDS.has(kind)) handled = false;

  return {
    error_source: runtime === "browser"
      ? (BROWSER_ERROR_SOURCES.get(kind) ?? "browser_js")
      : runtime === "react_native" ? "react_native_js" : null,
    handled,
    // Jamais déduit : un crash n'est pas forcément fatal, ni l'inverse.
    is_fatal: typeof attrs["mip.error_fatal"] === "boolean" ? attrs["mip.error_fatal"] : null,
    env: envDeclare(resource),
    // error_source dit déjà d'où vient l'erreur d'un SDK MIP.
    service: serviceDeclare(resource, scopeName),
  };
}

/**
 * Champs d'une exception, normalisés À L'IDENTIQUE pour toutes les sources :
 * navigateur, React Native, span dédié, événement de span ou log. Type borné
 * AVANT l'empreinte (un type réaliste garde son empreinte, un type hostile ne
 * gonfle plus la ligne), message et stack scrubbés AVANT troncature (un secret
 * ne doit pas survivre coupé en deux).
 *
 * P5.5 : la clé déclarée (`mip.error_fingerprint`) ne voyage que sous forme
 * d'empreinte app-scopée, y compris dans un lot différé ; une clé ignorée laisse
 * son diagnostic. Champs absents quand l'émetteur n'en déclare pas : la forme
 * d'une erreur sans clé ne change pas.
 */
function exceptionNormalisee(appId, attrs) {
  const errorType = boundedErrorType(attrs["exception.type"]);
  const message = (scrubText(attrs["exception.message"]) ?? "").slice(0, 1000);
  const stack = (scrubText(attrs["exception.stacktrace"]) ?? "").slice(0, 4000);
  const cle = overrideHash(appId, attrs["mip.error_fingerprint"]);
  return {
    ...(cle.hash ? { fingerprint_override_hash: cle.hash } : {}),
    ...(cle.diagnostic ? { grouping_diagnostic: cle.diagnostic } : {}),
    // Le SDK peut dédupliquer et compter (v59) : absent = 1.
    occurrences: occurrencesDe(attrs["mip.error_count"]),
    kind: errorKind(attrs["mip.error_kind"]),
    message,
    error_type: errorType,
    stack,
    source: scrubUrl(attrs["mip.error_source"]),
    lineno: positionSource(attrs["mip.error_lineno"]),
    colno: positionSource(attrs["mip.error_colno"]),
    fingerprint: errorFingerprint(errorType, message, stack),
  };
}

// ─────────── Exceptions backend et OpenTelemetry (P5.3, migration-v70) ────────────
//
// Une exception n'arrive pas seulement en span dédié `exception` (SDK client MIP).
// Un backend OpenTelemetry la pose en ÉVÉNEMENT `exception` sur le span de
// l'opération, ou — convention qui remplace désormais les événements de span —
// en LOG portant `exception.type/message/stacktrace`. Chacune devient une ligne
// rum_error, sans session inventée, avec trois garanties :
//
//   1. IDENTITÉ DÉTERMINISTE. Un rejeu du même lot réécrit la même clé, que
//      `on conflict (span_id) do nothing` rend inerte. Deux exceptions d'un
//      même span ne partagent JAMAIS la contrainte unique : la clé est dérivée de
//      l'app, de la trace, du span porteur, de la position de l'événement et de
//      son horodatage natif, et le span porteur reste à part dans
//      `source_parent_span_id`.
//   2. DÉDUPLICATION DÉCLARÉE, JAMAIS DEVINÉE. Un émetteur qui publie la même
//      exception en log ET en span leur donne le même `mip.exception_id` : la clé
//      ne dépend plus alors que de l'app et de cet identifiant. Sans identifiant
//      commun, deux signaux restent deux lignes — les fusionner sur la
//      ressemblance d'un message ferait disparaître des occurrences réelles.
//   3. ORIGINE CONSERVÉE (`origin_signal`). Le span porteur est déjà facturé, un
//      log ne l'est pas : une exception dérivée n'est donc jamais un événement
//      facturé de plus (meter_tenant_usage, migration-v70), mais compte bien dans
//      les occurrences d'erreur.

/** Au-delà, les événements `exception` d'un même span sont comptés rejetés. */
export const MAX_EXCEPTION_EVENTS_PER_SPAN = 16;

/** Même forme qu'un identifiant d'action : 32 hex ou UUID, jamais un texte libre. */
const EXCEPTION_ID = ACTION_ID;
const IDENTITE_EXCEPTION_V1 = "mip.exception.v1";
/** Horodatage OTLP natif : nanosecondes décimales (fixed64 sérialisé). */
const NANOS_NATIFS = /^\d{1,20}$/;
/** Scopes de nos intégrations backend (agent Node, middleware FastAPI). */
const SCOPE_AGENT_NODE = "@mip/agent-node";
const SCOPE_FASTAPI = "mip-rum-fastapi";
const RUNTIMES_PYTHON = new Set(["cpython", "pypy", "python", "ironpython", "jython"]);
/** severityNumber OTLP : ERROR commence à 17. */
const SEVERITE_ERREUR = 17;
const TEXTE_SEVERITE_ERREUR = /^(?:error|fatal|critical|crit|alert|emerg|emergency)\d?$/i;

/** `mip.exception_id` valide, en minuscules, ou null. */
function exceptionIdOf(value) {
  return typeof value === "string" && EXCEPTION_ID.test(value) ? value.toLowerCase() : null;
}

/**
 * Identité d'une exception dérivée : 128 bits de SHA-256, app-scopés.
 *
 * 32 caractères hexadécimaux, jamais 16 : la clé ne peut pas se confondre avec un
 * span OTLP natif, et la projection rum_event_index — dont l'identité publiée est
 * exclusivement un span natif — ne l'indexe pas.
 */
export function exceptionIdentity(appId, parts) {
  return sha256Hex(JSON.stringify([IDENTITE_EXCEPTION_V1, appId, ...parts])).slice(0, 32);
}

/**
 * Runtime d'un émetteur d'exception dérivée, pour `error_source`.
 *
 * D'abord les marqueurs de nos intégrations, puis les attributs de resource
 * standard (`telemetry.sdk.language`, `process.runtime.name`). Une JVM, Go ou .NET
 * n'a pas de valeur dédiée dans la taxonomie : « otel » dit qu'elle vient d'un
 * émetteur OpenTelemetry sans affirmer un runtime qu'on ne connaît pas.
 */
export function backendErrorSource(resource = {}, scopeName = null) {
  const langue = typeof resource["telemetry.sdk.language"] === "string"
    ? resource["telemetry.sdk.language"].toLowerCase()
    : "";
  const runtime = typeof resource["process.runtime.name"] === "string"
    ? resource["process.runtime.name"].toLowerCase()
    : "";
  if (scopeName === SCOPE_AGENT_NODE || langue === "nodejs" || runtime === "nodejs") return "node";
  if (scopeName === SCOPE_FASTAPI || langue === "python" || RUNTIMES_PYTHON.has(runtime)) return "python";
  if (langue === "webjs") return "browser_js";
  return "otel";
}

/** Une exception au sens OTel porte au moins `exception.type` ou `exception.message`. */
function exceptionDeclaree(attrs) {
  const nonVide = (value) => typeof value === "string" && value.trim() !== "";
  return nonVide(attrs["exception.type"]) || nonVide(attrs["exception.message"]);
}

/** Horodatage natif tel qu'émis, pour l'identité ; "" s'il est absent ou illisible. */
function tempsNatif(value) {
  const texte = typeof value === "number" || typeof value === "string" ? String(value) : "";
  return NANOS_NATIFS.test(texte) ? texte : "";
}

/**
 * Session DÉCLARÉE par l'émetteur, ou null. Elle n'est pas écrite telle quelle :
 * l'écrivain ne la rattache que si la session existe dans la même app.
 */
function sessionRevendiquee(value) {
  return typeof value === "string" && value !== "" && value.length <= 128 && !CONTROL_CHARS.test(value)
    ? value
    : null;
}

/** Route d'un span serveur OTel : template, puis nom du span, puis chemin. */
function routeServeurOtel(span, a) {
  return normalizeRouteTemplate(a["http.route"]) ??
    normalizeRouteTemplate(routeFromOtelName(span.name)) ??
    (a["url.path"] ?? null);
}

/**
 * Ligne rum_error d'une exception dérivée.
 *
 * `attrs` porte l'exception (événement de span ou log) ; `contexte` porte le
 * snapshot P2 déjà sécurisé aux ports d'ingestion (attributs du span porteur ou
 * du log). Les attributs d'un événement de span ne passent pas par la
 * sécurisation des identités : ils ne fournissent donc jamais d'identité.
 */
function exceptionDerivee({ appId, attrs, contexte, resource, scopeName, origin, identity, exceptionId, traceId, parentSpanId, session, route, ts }) {
  const enveloppe = errorEnvelope({ attrs, resource, scopeName });
  const { event_type: _type, timing_ms: _timing, feature_flag_value: _flag, ...snapshot } = eventMetadata(contexte);
  return {
    span_id: identity,
    // Jamais écrite telle quelle : voir `session_claim`.
    session_id: null,
    session_claim: sessionRevendiquee(session),
    app_id: appId,
    route,
    ...exceptionNormalisee(appId, attrs),
    release: releaseServeur(resource, scopeName),
    trace_id: traceId,
    source_parent_span_id: parentSpanId,
    ...enveloppe,
    error_source: enveloppe.error_source ?? backendErrorSource(resource, scopeName),
    origin_signal: origin,
    exception_id: exceptionId,
    ts,
    ...snapshot,
  };
}

/**
 * Exceptions portées par les événements `exception` d'un span.
 *
 * Appelée AVANT toute branche du parseur de spans : un span backend sans session
 * (http.server, serveur OTel, « detail ») ou même rejeté plus loin garde ses
 * exceptions. Un span dédié `exception` est déjà, lui-même, l'exception.
 *
 * `budget.restant` borne le nombre d'exceptions dérivées d'une requête.
 * @returns {{ rows: object[], rejected: number }}
 */
function spanEventExceptions(span, spanAttrs, { appId, resource, scopeName, now, budget }) {
  const rows = [];
  let rejected = 0;
  if (!Array.isArray(span?.events) || span.name === "exception") return { rows, rejected };
  const traceId = nativeTraceId(span.traceId);
  const parentSpanId = nativeParentSpanId(span.spanId);
  let exceptions = 0;
  span.events.forEach((event, position) => {
    if (event?.name !== "exception") return;
    if (++exceptions > MAX_EXCEPTION_EVENTS_PER_SPAN || budget.restant <= 0) {
      rejected++;
      return;
    }
    const attrs = attrsToObj(event.attributes);
    const exceptionId = exceptionIdOf(attrs["mip.exception_id"]);
    // Sans identifiant déclaré, la clé exige le span porteur : sans lui, deux
    // spans d'une même trace produiraient la même identité.
    if (!exceptionDeclaree(attrs) || (!exceptionId && !(traceId && parentSpanId))) {
      rejected++;
      return;
    }
    const identity = exceptionId
      ? exceptionIdentity(appId, ["id", exceptionId])
      : exceptionIdentity(appId, ["span_event", traceId, parentSpanId, position, tempsNatif(event.timeUnixNano)]);
    budget.restant--;
    rows.push(exceptionDerivee({
      appId,
      attrs,
      contexte: spanAttrs,
      resource,
      scopeName,
      origin: "span_event",
      identity,
      exceptionId,
      traceId,
      parentSpanId,
      session: spanAttrs["mip.session_id"] ?? sessionFromTraceState(span.traceState),
      route: spanAttrs["mip.route"] ?? (isServerKind(span.kind) ? routeServeurOtel(span, spanAttrs) : null),
      ts: nanosToDate(event.timeUnixNano ?? span.startTimeUnixNano, now),
    }));
  });
  return { rows, rejected };
}

/** Gravité ERROR ou plus, par severityNumber, sinon par severityText. */
function severiteErreur(severityNumber, severityTextValue) {
  if (typeof severityNumber === "number" && severityNumber > 0) return severityNumber >= SEVERITE_ERREUR;
  return typeof severityTextValue === "string" && TEXTE_SEVERITE_ERREUR.test(severityTextValue.trim());
}

/**
 * Exception structurée portée par un log, ou null.
 *
 * Exige une gravité ERROR ou plus ET des attributs `exception.*` : un
 * `console.error("texte")` reste un log, et une exception journalisée en INFO
 * (réessai attendu, erreur métier gérée) n'entre pas dans le suivi d'erreurs.
 *
 * Sans `mip.exception_id`, l'identité suit la position du log dans le lot et ses
 * horodatages natifs : un rejeu du même lot est inerte, deux logs distincts ne
 * fusionnent jamais. Sans aucun horodatage natif, cette identité ne distinguerait
 * plus deux lots différents : l'exception n'est alors pas dérivée (le log reste).
 */
function logRecordException(rec, attrs, { appId, resource, scopeName, severityNumber, position, now }) {
  if (!severiteErreur(severityNumber, rec?.severityText) || !exceptionDeclaree(attrs)) return null;
  const traceId = nativeTraceId(rec.traceId ?? attrs["mip.trace_id"]);
  const parentSpanId = nativeParentSpanId(rec.spanId ?? attrs["mip.span_id"]);
  const exceptionId = exceptionIdOf(attrs["mip.exception_id"]);
  const temps = tempsNatif(rec.timeUnixNano);
  const observe = tempsNatif(rec.observedTimeUnixNano);
  if (!exceptionId && !temps && !observe) return null;
  return exceptionDerivee({
    appId,
    attrs,
    contexte: attrs,
    resource,
    scopeName,
    origin: "log",
    identity: exceptionId
      ? exceptionIdentity(appId, ["id", exceptionId])
      : exceptionIdentity(appId, ["log", traceId ?? "", parentSpanId ?? "", temps, observe, position]),
    exceptionId,
    traceId,
    parentSpanId,
    session: attrs["mip.session_id"],
    route: attrs["mip.route"] ?? null,
    ts: nanosToDate(rec.timeUnixNano ?? rec.observedTimeUnixNano, now),
  });
}

// --- v0.6 : auto-instrumentation OpenTelemetry standard (backend codeless) ------
// Un client qui lance son app sous un agent OTel (opentelemetry-instrument, agent
// Java/.NET/Node…) émet des spans SERVER au format semconv, PAS notre forme mip.*.
// On les accepte aussi -> span back, corrélés par trace_id comme notre middleware.

/** Span SERVER ? OTLP/JSON encode l'enum kind en entier (2) OU en chaîne. */
function isServerKind(kind) {
  return kind === 2 || kind === "SPAN_KIND_SERVER";
}

/** Durée ms entre deux timestamps OTLP (nanos string|number) ; null si absent/invalide. */
/**
 * Nombre fini, ou null. Un attribut OTLP peut arriver en chaîne (`"1200"`) selon
 * l'émetteur ; `Number("")` vaut 0 et `Number(null)` vaut 0, deux valeurs qui
 * passeraient pour des mesures réelles. On écarte donc explicitement le vide.
 */
export function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function durationMsBetween(startNanos, endNanos) {
  if (!startNanos || !endNanos) return null;
  try {
    return Number(BigInt(endNanos) - BigInt(startNanos)) / 1e6;
  } catch {
    return null;
  }
}

/** Session MIP éventuellement propagée dans le tracestate W3C : "mip=s:<sid>". */
function sessionFromTraceState(traceState) {
  if (typeof traceState !== "string" || !traceState) return null;
  for (const part of traceState.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== "mip") continue;
    const val = part.slice(eq + 1).trim();
    if (val.startsWith("s:")) return val.slice(2) || null;
  }
  return null;
}

/** Template de route homogène avec le front : {id} -> :id. */
function normalizeRouteTemplate(route) {
  return typeof route === "string" ? route.replace(/\{([^/}]+)\}/g, ":$1") : null;
}

/** Nom de span OTel ("GET /aos/{id}" ou "/aos/{id}") -> route, sinon null. */
function routeFromOtelName(name) {
  if (typeof name !== "string") return null;
  const stripped = name.replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i, "").trim();
  return stripped.startsWith("/") ? stripped : null;
}

/**
 * Aplatit un payload OTLP/HTTP JSON en lignes SQL.
 * Rejette (compte) les resourceSpans sans mip.app_id (PLAN §7.2).
 * v0.2 : resources/longtasks/breadcrumbs/events (track.*), fingerprint d'erreur,
 * apiKeys = clé `mip.api_key` lue sur la resource, un élément par resourceSpan accepté.
 * v0.4 : spans de tracing distribué — 'http.client' (SDK web, session requise)
 * et 'http.server' (middleware backend, session optionnelle via tracestate) ->
 * table rum_span, corrélés par mip.trace_id.
 * P5.3 : les événements `exception` de n'importe quel span deviennent des lignes
 * `errors` dérivées (origin_signal = span_event), sans session inventée.
 * @param {object} payload  enveloppe OTLP/HTTP JSON.
 * @param {{maxSpans?: number}} [opts]  garde-fou anti-charge : au-delà de
 *        `maxSpans` spans dans une même requête, les suivants sont comptés
 *        `rejected` plutôt que traités (défaut 20 000).
 * @returns {{sessions: object[], pageviews: object[], metrics: object[], errors: object[],
 *            resources: object[], longtasks: object[], breadcrumbs: object[], events: object[], actions: object[],
 *            spans: object[], apiKeys: {app_id: string, api_key: string|null}[], rejected: number}}
 */
export function flattenOtlp(payload, opts = {}) {
  const maxSpans = opts.maxSpans ?? 20_000;
  // référence temps serveur pour la garde anti-dérive (injectable pour les tests)
  const now = opts.now ?? Date.now();
  let seen = 0; // total de spans rencontrés (cap anti-charge)
  const sessions = new Map();
  const pageviews = [];
  const metrics = [];
  const errors = [];
  const resources = [];
  const longtasks = [];
  const breadcrumbs = [];
  const events = [];
  const actions = [];
  const spans = [];
  const apiKeys = [];
  // SVI (migration-v51) : appels, étapes et tronçons voix. Collections séparées
  // des spans RUM — un appel n'est pas un span, cf. l'en-tête de la migration.
  const sviCalls = [];
  const sviSteps = [];
  const sviLegs = [];
  // P7.5 : capacités DÉCLARÉES par un runtime mobile, dédoublonnées dans le lot
  // par (app, runtime, release, capacité). Un lot qui redit six fois la même
  // chose ne doit pas écrire six lignes — ni six fois la même.
  const capabilities = new Map();
  let rejected = 0;
  // P5.3 : exceptions dérivées d'événements de span, bornées comme les spans.
  const budgetExceptions = { restant: maxSpans };

  /**
   * Ligne rum_span commune front/back ; null si trace_id/span_id absents.
   *
   * `parentNatif` est le champ OTLP `span.parentSpanId`, que les capteurs de ce
   * dépôt renseignent depuis qu'ils émettent des spans standard. Il PRIME sur
   * l'attribut propriétaire `mip.parent_span_id`, qui reste lu en repli : un SDK
   * déjà posé chez un client continue d'alimenter le waterfall sans être
   * redéployé. L'ordre compte — le champ natif est celui qu'un collecteur tiers
   * lirait, donc celui qui fait foi.
   *
   * `dimensions` : env, release et service déclarés par la resource (P6.1).
   */
  const spanRow = (tier, a, appId, ts, parentNatif, dimensions) => {
    const traceId = a["mip.trace_id"];
    const spanId = a["mip.span_id"];
    const durationMs = a["http.duration_ms"];
    if (!traceId || !spanId || typeof durationMs !== "number") return null;
    return {
      span_id: spanId,
      trace_id: traceId,
      parent_span_id: parentNatif || a["mip.parent_span_id"] || null,
      tier,
      session_id: a["mip.session_id"] ?? null,
      app_id: appId,
      route: a["mip.route"] ?? null,
      url: scrubUrl(a["http.url"]),
      method: a["http.method"] ?? null,
      status_code: a["http.status_code"] ?? null,
      duration_ms: durationMs,
      // libellé + nature pour le waterfall de trace (migration-v31)
      name:
        `${a["http.method"] ?? ""} ${a["mip.route"] ?? scrubUrl(a["http.url"]) ?? ""}`.trim() ||
        (tier === "front" ? "http.client" : "http.server"),
      kind: tier === "front" ? "client" : "server",
      ts,
      ...dimensions,
      ...eventMetadata(a),
    };
  };

  /**
   * Ligne SVI (svi.call / svi.step / svi.leg). `null` si l'identifiant d'appel
   * manque : sans lui, rien n'est rattachable et une ligne orpheline fausserait
   * les taux plus sûrement qu'une ligne absente.
   *
   * La SAISIE n'est jamais transportée : on ne lit que `svi.input_class` et
   * `svi.input_len`, et un nœud marqué sensible perd sa longueur ici, côté
   * serveur — l'adaptateur est censé l'avoir déjà fait, mais on ne fait pas
   * dépendre une garantie PCI de la bonne conduite d'un client.
   */
  const sviRow = (span, a, appId, nowMs) => {
    const callId = a["svi.call_id"];
    if (typeof callId !== "string" || callId === "") return null;
    const startedAt = nanosToDate(span.startTimeUnixNano, nowMs);

    if (span.name === "svi.call") {
      const status = a["svi.status"] === "closed" ? "closed" : "open";
      return {
        app_id: appId,
        call_id: callId,
        trace_id: span.traceId || callId,
        platform: a["svi.platform"] ?? "unknown",
        adapter_version: a["svi.adapter_version"] ?? "0",
        source_schema: a["svi.source_schema"] ?? null,
        provenance: typeof a["svi.provenance"] === "string"
          ? a["svi.provenance"].split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        direction: a["svi.direction"] ?? "inbound",
        entry_point: a["svi.entry_point"] ?? null,
        flow_id: a["svi.flow_id"] ?? null,
        flow_version: a["svi.flow_version"] ?? null,
        caller_hash: a["svi.caller_hash"] ?? null,
        caller_key_id: a["svi.caller_key_id"] ?? null,
        caller_country: a["svi.caller_country"] ?? null,
        started_at: startedAt,
        answered_at: a["svi.answered_at"] ?? null,
        ended_at: a["svi.ended_at"] ?? null,
        status,
        // Une issue n'a de sens que sur un appel clos : la contrainte
        // svi_call_outcome_ck refuserait la ligne, autant ne pas la fabriquer.
        outcome: status === "closed" ? (a["svi.outcome"] ?? "failed") : null,
        outcome_detail: a["svi.outcome_detail"] ?? null,
        close_reason: a["svi.close_reason"] ?? null,
        hangup_party: a["svi.hangup_party"] ?? null,
        duration_ms: numOrNull(a["svi.duration_ms"]),
        ivr_ms: numOrNull(a["svi.ivr_ms"]),
        queue_ms: numOrNull(a["svi.queue_ms"]),
        talk_ms: numOrNull(a["svi.talk_ms"]),
        setup_ms: numOrNull(a["svi.setup_ms"]),
        queue_name: a["svi.queue_name"] ?? null,
        wait_ms: numOrNull(a["svi.wait_ms"]),
        transfer_target: a["svi.transfer_target"] ?? null,
        agent_group: a["svi.agent_group"] ?? null,
        menu_path_final: a["svi.menu_path_final"] ?? null,
        menu_depth: numOrNull(a["svi.menu_depth"]),
        exit_node: a["svi.exit_node"] ?? null,
        task_name: a["svi.task_name"] ?? null,
        task_success: typeof a["svi.task_success"] === "boolean" ? a["svi.task_success"] : null,
        ai_agent: a["svi.ai_agent"] === true,
        ai_disclosed_at: a["svi.ai_disclosed_at"] ?? null,
        ai_disclosure_source: a["svi.ai_disclosure_source"] ?? null,
        is_test: a["svi.is_test"] === true,
        source_ref: a["svi.source_ref"] ?? null,
      };
    }

    if (span.name === "svi.step") {
      const seq = numOrNull(a["svi.seq"]);
      const kind = a["svi.kind"];
      if (seq == null || typeof kind !== "string") return null;
      const sensitive = a["svi.input_sensitive"] === true;
      const cls = sensitive ? "masked" : (a["svi.input_class"] ?? null);
      return {
        step_id: a["svi.step_id"] ?? `${callId}:${seq}:${kind}`,
        parent_step_id: a["svi.parent_step_id"] ?? null,
        app_id: appId,
        call_id: callId,
        seq,
        kind,
        node_id: a["svi.node_id"] ?? null,
        node_label: a["svi.node_label"] ?? null,
        menu_path: a["svi.menu_path"] ?? null,
        depth: numOrNull(a["svi.depth"]),
        branch: a["svi.branch"] ?? null,
        input_class: cls,
        // Garde serveur : un nœud sensible ne porte AUCUNE longueur, quoi
        // qu'envoie le client (len=16 puis len=3 est un oracle PAN+CVV).
        input_len: sensitive ? null : numOrNull(a["svi.input_len"]),
        input_sensitive: sensitive,
        no_match: a["svi.no_match"] === true,
        no_input: a["svi.no_input"] === true,
        reprompt_index: numOrNull(a["svi.reprompt_index"]) ?? 0,
        asr_confidence: numOrNull(a["svi.asr_confidence"]),
        rejected: typeof a["svi.rejected"] === "boolean" ? a["svi.rejected"] : null,
        milestone: a["svi.milestone"] ?? null,
        flow_outcome: a["svi.flow_outcome"] ?? null,
        started_at: startedAt,
        duration_ms: durationMsBetween(span.startTimeUnixNano, span.endTimeUnixNano),
        exit_reason: a["svi.exit_reason"] ?? null,
      };
    }

    if (span.name === "svi.leg") {
      const legRef = a["svi.leg_ref"];
      const dir = a["svi.dir"];
      const method = a["svi.mos_method"];
      // mos_method est NOT NULL en base : aucun MOS ne s'affiche sans sa
      // provenance. On rejette plutôt que d'inventer une méthode de mesure.
      if (typeof legRef !== "string" || (dir !== "rx" && dir !== "tx") || typeof method !== "string")
        return null;
      return {
        app_id: appId, call_id: callId, leg_ref: legRef, dir,
        role: a["svi.role"] ?? "ivr_edge",
        codec: a["svi.codec"] ?? null,
        ptime_ms: numOrNull(a["svi.ptime_ms"]),
        sample_rate: numOrNull(a["svi.sample_rate"]),
        carrier: a["svi.carrier"] ?? null,
        mos_method: method,
        mos_avg: numOrNull(a["svi.mos_avg"]),
        mos_min: numOrNull(a["svi.mos_min"]),
        r_factor_avg: numOrNull(a["svi.r_factor_avg"]),
        r_factor_min: numOrNull(a["svi.r_factor_min"]),
        jitter_avg_ms: numOrNull(a["svi.jitter_avg_ms"]),
        jitter_max_ms: numOrNull(a["svi.jitter_max_ms"]),
        loss_avg_pct: numOrNull(a["svi.loss_avg_pct"]),
        loss_max_pct: numOrNull(a["svi.loss_max_pct"]),
        rtt_avg_ms: numOrNull(a["svi.rtt_avg_ms"]),
        rtt_max_ms: numOrNull(a["svi.rtt_max_ms"]),
        packets_sent: numOrNull(a["svi.packets_sent"]),
        packets_lost: numOrNull(a["svi.packets_lost"]),
        e_model_params: a["svi.e_model_params"] ?? null,
        started_at: startedAt,
        ended_at: a["svi.ended_at"] ?? null,
      };
    }
    return null;
  };

  for (const rs of Array.isArray(payload?.resourceSpans) ? payload.resourceSpans : []) {
    if (!rs || typeof rs !== "object") {
      rejected++;
      continue;
    }
    const res = attrsToObj(rs.resource?.attributes);
    const appId = res["mip.app_id"];
    if (!appId) {
      rejected++;
      continue;
    }
    apiKeys.push({ app_id: appId, api_key: res["mip.api_key"] ?? null });
    // Version de l'app (dé-minification, P6.1 : bornée, jamais scrubbée) et
    // environnement : déclarés par la resource, recopiés sur chaque signal.
    const release = boundedRelease(res["mip.release"]);
    const env = envDeclare(res);
    // Navigateur, système et appareil : un user-agent par resource, lu une fois ;
    // l'indice `mip.device_type` reste propre à chaque span.
    const appareil = clientDimensions(res["mip.user_agent"]);
    for (const ss of Array.isArray(rs.scopeSpans) ? rs.scopeSpans : []) {
      // P5.1 : le scope est le seul marqueur du SDK web quand la resource ne
      // porte pas son service.name (source de l'erreur, cf. errorEnvelope).
      const scopeName = ss?.scope?.name ?? null;
      const service = serviceDeclare(res, scopeName);
      // P7.5 : le runtime de l'émetteur était déjà calculé ici, puis jeté. Il est
      // désormais retenu sur la session — c'est la POPULATION de l'écran /mobile,
      // et la déduire d'un user-agent donnerait un dénominateur deviné.
      const runtime = runtimeClientMip(res, scopeName);
      // Capacités déclarées : lues sur la resource, donc UNE fois par scope, et
      // seulement pour un runtime mobile. Un navigateur n'a ni crash natif ni ANR.
      for (const ligne of capabilityRows({ appId, runtime, release, raw: res[CAPABILITY_ATTRIBUTE] })) {
        capabilities.set(`${ligne.app_id} ${ligne.runtime} ${ligne.release ?? ""} ${ligne.capability}`, ligne);
      }
      // Dimensions déclarées d'un signal de session, puis d'un signal backend.
      const dimensions = { env, release };
      const dimensionsServeur = { env, release: releaseServeur(res, scopeName), service };
      for (const span of Array.isArray(ss?.spans) ? ss.spans : []) {
        // garde-fou : au-delà du plafond, on compte sans traiter (mémoire/CPU bornés)
        if (++seen > maxSpans) {
          rejected++;
          continue;
        }
        // durcissement A5 : un span sans nom (string) ne peut être routé -> rejet.
        // Un NUL dans le nom le rend tout aussi malformé : ce nom finit en base
        // (événement track.*, span OTel), où PostgreSQL rejetterait tout le lot.
        if (!span || typeof span.name !== "string" || span.name.includes("\u0000")) {
          rejected++;
          continue;
        }
        const a = attrsToObj(span.attributes);

        // ── P5.3 : exceptions du span, AVANT toute branche. Les branches backend
        // qui suivent (http.server, serveur OTel, « detail ») sortent toutes par
        // un `continue`, et un span sans session finit rejeté : placées après,
        // ces exceptions n'auraient jamais été lues.
        const derivees = spanEventExceptions(span, a, { appId, resource: res, scopeName, now, budget: budgetExceptions });
        for (const row of derivees.rows) errors.push(row);
        rejected += derivees.rejected;

        // ── SVI (migration-v51) — EN TÊTE DE CHAÎNE, et ce n'est pas un détail.
        // Plus bas, la branche « span interne » capture TOUT span porteur d'un
        // trace_id/span_id sans mip.session_id, puis `if (!sessionId) rejected++`
        // écarte le reste. Une branche svi.* placée après serait donc du CODE MORT :
        // aucun appel n'a de session web. On route ici, avant tout le reste.
        if (span.name.startsWith("svi.")) {
          const row = sviRow(span, a, appId, now);
          if (row) {
            if (span.name === "svi.call") sviCalls.push(row);
            else if (span.name === "svi.step") sviSteps.push(row);
            else if (span.name === "svi.leg") sviLegs.push(row);
            else rejected++; // svi.* inconnu : compté, jamais deviné
          } else rejected++;
          continue;
        }

        // Événement métier `track.<nom>` d'un émetteur SANS session — agent
        // Node, tâche planifiée (P7.4). EN TÊTE DE CHAÎNE, pour la même raison
        // que svi.* juste au-dessus : plus bas, la branche « span interne »
        // capture tout span sans `mip.session_id` et en ferait un faux span de
        // détail, puis `if (!sessionId) rejected++` écarterait le reste.
        //
        // La ligne s'écrit avec `session_id` NULL : aucune session inventée, et
        // aucune clé étrangère vers une session que ce lot n'écrit pas. Sa
        // corrélation passe par la trace de son span parent.
        //
        // Un événement QUI PORTE une session reste sur le chemin historique
        // (plus bas) : c'est lui qui crée aussi la ligne `rum_session` du lot,
        // sans laquelle l'écriture violerait `rum_event_session_id_fkey`.
        if (span.name.startsWith("track.") && a["mip.session_id"] == null) {
          const metadataEvenement = eventMetadata(a);
          if (metadataEvenement.event_type && metadataEvenement.event_type !== "custom") {
            rejected++;
            continue;
          }
          events.push({
            span_id: span.spanId,
            session_id: null,
            app_id: appId,
            route: a["mip.route"] ?? null,
            name: boundedName(a["mip.event_name"]) ?? boundedName(span.name.slice("track.".length)) ?? "track",
            props: boundedEventProps(a["mip.props"]),
            ts: nanosToDate(span.startTimeUnixNano, now),
            ...dimensionsServeur,
            ...metadataEvenement,
          });
          continue;
        }

        // span backend (middleware serveur) : pas de session requise, pas
        // d'upsert rum_session (le front est seul maître de la session)
        if (span.name === "http.server") {
          const row = spanRow("back", a, appId, nanosToDate(span.startTimeUnixNano, now), span.parentSpanId, dimensionsServeur);
          if (row) spans.push(row);
          else rejected++;
          continue;
        }

        // span SERVER d'auto-instrumentation OpenTelemetry standard (codeless,
        // toute stack via agent + Collector) : trace/span/parent au niveau du
        // span, attributs semconv http.*, session éventuelle via tracestate.
        // -> span back (1 par requête, comme notre middleware). Notre propre
        // http.server (ci-dessus) et http.client (kind interne) ne passent pas ici.
        const otelMethod = a["http.request.method"] ?? a["http.method"];
        if (
          isServerKind(span.kind) &&
          (otelMethod != null || a["http.route"] != null || a["url.path"] != null)
        ) {
          const durationMs = durationMsBetween(span.startTimeUnixNano, span.endTimeUnixNano);
          if (!span.traceId || !span.spanId || typeof durationMs !== "number") {
            rejected++;
            continue;
          }
          spans.push({
            span_id: span.spanId,
            trace_id: span.traceId,
            parent_span_id: span.parentSpanId || null,
            tier: "back",
            session_id: sessionFromTraceState(span.traceState) ?? a["mip.session_id"] ?? null,
            app_id: appId,
            route: routeServeurOtel(span, a),
            url: scrubUrl(a["url.full"] ?? a["http.url"]),
            method: otelMethod ?? null,
            status_code: a["http.response.status_code"] ?? a["http.status_code"] ?? null,
            duration_ms: durationMs,
            name:
              normalizeRouteTemplate(a["http.route"]) ??
              routeFromOtelName(span.name) ??
              span.name,
            kind: "server",
            ts: nanosToDate(span.startTimeUnixNano, now),
            ...dimensionsServeur,
          });
          continue;
        }

        // Span INTERNE d'une trace (auto-instrumentation OTel standard : requête
        // DB, sous-appel serveur). Émis côté backend -> jamais de mip.session_id
        // (le front est seul porteur de la session). On les stocke tier='detail'
        // pour reconstituer un waterfall complet « front → serveur → cause ».
        // Placé APRÈS http.server / SERVER OTel (déjà routés) et AVANT
        // l'exigence de session : les spans navigateur portent tous mip.session_id
        // et sont donc exclus ici.
        if (span.traceId && span.spanId && a["mip.session_id"] == null && !isServerKind(span.kind)) {
          const durationMs = durationMsBetween(span.startTimeUnixNano, span.endTimeUnixNano);
          if (typeof durationMs === "number") {
            const stmt = a["db.statement"] ?? a["db.query.text"];
            const label =
              (typeof stmt === "string" ? scrubText(stmt) : null) ??
              a["db.operation"] ??
              a["rpc.method"] ??
              span.name;
            const isDb = a["db.system"] != null || a["db.system.name"] != null || stmt != null;
            spans.push({
              span_id: span.spanId,
              trace_id: span.traceId,
              parent_span_id: span.parentSpanId || null,
              tier: "detail",
              session_id: sessionFromTraceState(span.traceState) ?? null,
              app_id: appId,
              route: a["db.system"] ?? a["db.system.name"] ?? a["rpc.service"] ?? null,
              url: null,
              method: a["db.operation"] ?? a["rpc.method"] ?? null,
              status_code: null,
              duration_ms: durationMs,
              name: typeof label === "string" ? label.slice(0, 200) : span.name,
              kind: isDb ? "db" : "internal",
              ts: nanosToDate(span.startTimeUnixNano, now),
              ...dimensionsServeur,
            });
          } else {
            rejected++;
          }
          continue;
        }

        const sessionId = a["mip.session_id"];
        if (!sessionId) {
          rejected++;
          continue;
        }
        const ts = nanosToDate(span.startTimeUnixNano, now);
        const route = a["mip.route"] ?? null;
        const metadata = eventMetadata(a);

        const s = sessions.get(sessionId) ?? {
          session_id: sessionId,
          app_id: appId,
          client_id: res["mip.client_id"] || null,
          // IDENTITÉ DU VISITEUR — deux champs, deux natures, jamais confondus.
          //
          // `visitor_id` est un tirage aléatoire du SDK : il identifie une
          // personne (au sens d'un navigateur qui revient), et c'est la seule
          // clé sur laquelle un export ou un effacement RGPD peut s'exécuter.
          //
          // `user_hash` est l'ANCIENNE empreinte de classe d'appareil, que les
          // SDK déjà posés chez des clients continuent d'émettre. On l'accepte
          // — refuser reviendrait à perdre leur télémétrie — mais on marque la
          // session pour que personne n'en tire un compte de personnes ni une
          // réponse à une demande d'accès. `id_kind` porte cette marque, et
          // aucune conversion n'est possible dans un sens ou dans l'autre.
          // `id_kind` n'est pas écrit ici : c'est une colonne GÉNÉRÉE en base,
          // dérivée de la présence de `visitor_id` (migration-v57). Deux
          // colonnes pour un même fait finiraient par se contredire.
          visitor_id: a["mip.visitor_id"] ?? null,
          user_hash: a["mip.user_hash"] ?? null,
          user_agent: res["mip.user_agent"] ?? null,
          // P6.1 : navigateur, système et classe d'appareil (tablette comprise),
          // l'user-agent primant sur l'indice du SDK — cf. clientDimensions.
          ...appareil(a["mip.device_type"]),
          geo_country: null,
          // P8.7 (v85) : d'OÙ vient ce pays. Un pays déduit du fuseau et un pays
          // résolu depuis l'adresse réseau ne valent pas la même chose, et rien
          // ne permettait de les distinguer une fois écrits. La colonne voyage
          // avec la valeur, toujours posée en même temps qu'elle.
          geo_source: null,
          geo_db_version: null,
          // Lot 2 : classifié à la 1re vue de la session (UA + éventuel signal
          // webdriver du SDK). Flag, pas drop : la donnée reste, mais exclue par
          // défaut des agrégats console.
          is_bot: isBot(res["mip.user_agent"], res["mip.webdriver"] ?? a["mip.webdriver"]),
          // Ext-A : mode de collecte — 'sdk' (script posé par le dev, défaut) ou
          // 'extension' (SDK injecté par l'extension navigateur). Figé à la 1re vue.
          collection_source: a["mip.collection_source"] === "extension" ? "extension" : "sdk",
          // P7.5 (v82) : `react_native`, `browser`, ou NULL quand aucun marqueur
          // de SDK MIP ne le désigne — un émetteur OTel tiers reste INCONNU, pas
          // « web ». Back-fillé plus bas si le premier span ne le portait pas.
          runtime,
          // v53 : version de l'app et qualité de lien estimée. `release` est une
          // resource attr (constante sur la requête), `net_type` une span attr,
          // posée par navtiming au chargement — d'où le back-fill plus bas.
          release,
          net_type: a["mip.net_type"] ?? null,
          // ÉCHANTILLONNAGE (migration-v58). Les deux taux, parce que celui de
          // ce SDK est biaisé-erreurs : `sample_rate` seul ne permet PAS de
          // reconstruire la probabilité d'inclusion d'une session. `has_error`
          // est posé plus bas, à la première exception rencontrée.
          //
          // Défaut 1 quand l'attribut manque — SDK antérieur ou lot rejoué : la
          // session est alors traitée comme non échantillonnée, ce qui est vrai
          // pour tout ce qui a été collecté jusqu'ici.
          sample_rate: tauxPrincipal(res["mip.sample_rate"]),
          error_sample_rate: tauxErreurs(res["mip.error_sample_rate"]),
          has_error: false,
          ...(metadata.user_id_hash ? { user_id_hash: metadata.user_id_hash } : {}),
          ...(metadata.account_id_hash ? { account_id_hash: metadata.account_id_hash } : {}),
          ...(metadata.context ? { context: metadata.context } : {}),
          last_seen_at: ts,
          page_count_inc: 0,
        };
        if (ts > s.last_seen_at) s.last_seen_at = ts;
        // geo RGPD-friendly : timezone (attrs communs SDK v0.3) -> pays, null si inconnue
        if (s.geo_country == null && a["mip.tz"]) {
          const pays = tzToCountry(a["mip.tz"]);
          if (pays) {
            s.geo_country = pays;
            // La provenance est posée DANS LE MÊME GESTE que la valeur. Les
            // séparer laisserait exister un pays sans origine, c'est-à-dire un
            // chiffre dont on ne sait plus ce qu'il mesure.
            s.geo_source = "timezone";
          }
        }
        // back-fill : la 1re span a pu créer la session sans indice d'appareil, ou
        // depuis une resource sans user-agent. Famille et version se complètent
        // d'un bloc : jamais la version d'un système sous le nom d'un autre.
        if (s.device_type == null || s.os == null || s.browser == null) {
          const lu = appareil(a["mip.device_type"]);
          if (s.device_type == null) s.device_type = lu.device_type;
          if (s.os == null) Object.assign(s, { os: lu.os, os_version: lu.os_version });
          if (s.browser == null) Object.assign(s, { browser: lu.browser, browser_version: lu.browser_version });
        }
        // net_type n'arrive que sur les spans de navtiming, émises après `load` :
        // la session existe déjà, créée par une span antérieure sans l'attribut.
        if (s.net_type == null && a["mip.net_type"]) s.net_type = a["mip.net_type"];
        // Le runtime est figé à la première valeur CONNUE : un même lot peut
        // mêler un scope reconnu et un scope qui ne l'est pas (une bibliothèque
        // OTel tierce posée dans la même application), et le second ne doit pas
        // effacer ce que le premier a établi.
        if (s.runtime == null && runtime) s.runtime = runtime;
        if (s.release == null && release) s.release = release;
        if (s.user_id_hash == null && metadata.user_id_hash) s.user_id_hash = metadata.user_id_hash;
        if (s.account_id_hash == null && metadata.account_id_hash) s.account_id_hash = metadata.account_id_hash;
        if (Object.keys(s.context ?? {}).length === 0 && Object.keys(metadata.context ?? {}).length) s.context = metadata.context;
        sessions.set(sessionId, s);

        if (span.name.startsWith("webvital.")) {
          const name = a["webvital.name"] ?? span.name.slice("webvital.".length);
          const value = a["webvital.value"];
          if (typeof value !== "number") {
            rejected++;
            continue;
          }
          metrics.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            name,
            value,
            rating: rating2026(name, value),
            attribution: parseJsonAttr(a["webvital.attribution"]),
            // `webvital.id` identifie UNE métrique pour UN chargement de page.
            // Le SDK l'émettait déjà — avec un commentaire disant qu'il sert à
            // ne pas double-compter — et l'ingestion le jetait. CLS et INP sont
            // rapportés à chaque passage de l'onglet en `hidden` : sans cette
            // clé, trois masquages faisaient trois lignes pour une page vue, et
            // comme ces deux métriques croissent, les rapports intermédiaires
            // tiraient le p75 vers le bas. Voir migration-v58.
            metric_uid: a["webvital.id"] ?? null,
            ts,
            ...dimensions,
            ...metadata,
          });
        } else if (span.name === "exception") {
          // La session porte une erreur : c'est ce qui décide LAQUELLE des deux
          // probabilités d'inclusion s'applique à son poids (migration-v58).
          // Une session biaisée-erreurs n'apparaît QUE si elle en a une.
          s.has_error = true;
          errors.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            // Occurrences, type, message, stack et empreinte : la normalisation
            // partagée avec les exceptions dérivées d'un span ou d'un log.
            ...exceptionNormalisee(appId, a),
            release,
            // P5.1 (migration-v69) : la corrélation vient des champs NATIFS du
            // span. Elle est propre à cette occurrence, jamais empruntée au
            // dernier exemplaire du groupe.
            trace_id: nativeTraceId(span.traceId),
            source_parent_span_id: nativeParentSpanId(span.parentSpanId),
            ...errorEnvelope({ attrs: a, resource: res, scopeName, eventType: metadata.event_type }),
            ts,
            // context, identités HMAC, vue et action : le snapshot P2 déjà
            // borné par eventMetadata, désormais écrit sur la ligne elle-même.
            ...metadata,
          });
        } else if (span.name === "pageview") {
          s.page_count_inc++;
          pageviews.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route: route ?? "/",
            url: scrubUrl(a["mip.url"]),
            referrer: scrubUrl(a["mip.referrer"]),
            nav_type: a["mip.nav_type"] ?? null,
            ts,
            ...dimensions,
            ...metadata,
          });
        } else if (span.name === "resource") {
          resources.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            url: scrubUrl(a["resource.url"]),
            type: a["resource.type"] ?? null,
            duration_ms: a["resource.duration_ms"] ?? null,
            transfer_size: a["resource.transfer_size"] ?? null,
            render_blocking: a["resource.render_blocking"] ?? null,
            ts,
            ...dimensions,
            ...metadata,
          });
        } else if (span.name === "longtask") {
          const durationMs = a["longtask.duration_ms"];
          if (typeof durationMs !== "number") {
            rejected++;
            continue;
          }
          longtasks.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            duration_ms: durationMs,
            source: "longtask",
            ts,
            ...dimensions,
            ...metadata,
          });
        } else if (span.name === "loaf") {
          // Long Animation Frames : le MÊME fait qu'un longtask — le fil
          // principal a bloqué — mais avec l'attribution. Même table, donc même
          // purge, même comptage de volume, même cloisonnement, même effacement
          // RGPD ; `source` dit laquelle des deux API a parlé.
          //
          // Les deux ne sont jamais actives ensemble côté SDK : ce n'est pas une
          // règle qu'on applique ici, c'est un fait dont dépend le comptage.
          const durationMs = a["loaf.duration_ms"];
          if (typeof durationMs !== "number") {
            rejected++;
            continue;
          }
          const nombreOuNull = (v) => (typeof v === "number" ? v : null);
          longtasks.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            duration_ms: durationMs,
            source: "loaf",
            blocking_ms: nombreOuNull(a["loaf.blocking_ms"]),
            render_ms: nombreOuNull(a["loaf.render_ms"]),
            // Textes libres venus du navigateur : ils passent au même nettoyage
            // que les messages d'erreur. Un nom de fonction ne devrait pas
            // porter de PII, mais « ne devrait pas » n'est pas une garantie.
            script_url: scrubUrl(a["loaf.script_url"]),
            script_function: scrubText(a["loaf.script_function"]),
            script_ms: nombreOuNull(a["loaf.script_ms"]),
            invoker: scrubText(a["loaf.invoker"]),
            ts,
            ...dimensions,
            ...metadata,
          });
        } else if (span.name === "breadcrumb") {
          const breadcrumbRoute = eventIndexRoute(route);
          breadcrumbs.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            ...(breadcrumbRoute ? { route: breadcrumbRoute } : {}),
            type: breadcrumbType(a["breadcrumb.type"]),
            // Un breadcrumb décrit une action de l'utilisateur : son libellé est
            // donc du texte libre, au même titre qu'un message d'erreur. Le SDK
            // le borne côté client, mais la frontière de confidentialité est
            // ici, avant toute persistance et pour tous les émetteurs OTLP.
            label: breadcrumbLabel(a["breadcrumb.label"]),
            seq: a["breadcrumb.seq"] ?? null,
            ts,
            // Sans colonne sur rum_breadcrumb : portées pour la projection rum_event_index.
            ...dimensions,
            ...metadata,
          });
        } else if (span.name === "http.client") {
          const row = spanRow("front", a, appId, ts, span.parentSpanId, { ...dimensions, service });
          if (row) spans.push(row);
          else rejected++;
        } else if (span.name.startsWith("track.")) {
          if (metadata.event_type && metadata.event_type !== "custom") {
            rejected++;
            continue;
          }
          events.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            name: boundedName(a["mip.event_name"]) ?? boundedName(span.name.slice("track.".length)) ?? "track",
            props: boundedEventProps(a["mip.props"]),
            ts,
            ...dimensions,
            ...metadata,
          });
        } else if (span.name.startsWith("rum.")) {
          const eventType = metadata.event_type;
          const rawEventName = boundedName(a["mip.event_name"]);
          const eventName = eventType === "action"
            ? boundedName(scrubText(rawEventName))
            : rawEventName;
          const expectedType = {
            "rum.view": "view",
            "rum.action": "action",
            "rum.timing": "timing",
            "rum.feature_flag": "feature_flag",
          }[span.name];
          if (
            !eventType || !eventName ||
            !expectedType || eventType !== expectedType ||
            (eventType === "view" && !metadata.view_id) ||
            (eventType === "timing" && metadata.timing_ms == null) ||
            (eventType === "feature_flag" && metadata.feature_flag_value == null) ||
            (eventType === "action" && !metadata.action_id)
          ) {
            rejected++;
            continue;
          }
          events.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            name: eventName,
            props: {},
            ts,
            ...dimensions,
            ...metadata,
          });
          if (eventType === "action") {
            const actionType = ACTION_TYPES.has(a["mip.action_type"])
              ? a["mip.action_type"]
              : "manual"; // SDK P2 : action manuelle sans attribut dédié
            // Une action automatique est du texte libre issu du DOM. Le nom de
            // la projection de lecture repasse donc à la frontière serveur par
            // le scrub PII, même si le SDK l'a déjà borné.
            const actionName = eventName;
            if (!actionName) {
              rejected++;
              continue;
            }
            actions.push({
              action_id: metadata.action_id,
              span_id: span.spanId,
              session_id: sessionId,
              app_id: appId,
              type: actionType,
              name: actionName,
              route: eventIndexRoute(route),
              context: metadata.context ?? {},
              ts,
              ...dimensions,
            });
          }
        } else if (span.name === "frustration") {
          // Signaux de frustration (P1) : rage/dead clicks. Stockés dans rum_event
          // sous le nom réservé 'frustration.<kind>' (hérite RLS/purge/erase/métering
          // de rum_event ; target scrubbé comme tout texte libre).
          const kind = a["frustration.kind"];
          if (kind !== "rage" && kind !== "dead" && kind !== "error") {
            rejected++;
            continue;
          }
          if (kind === "error" && !metadata.action_id) {
            rejected++;
            continue;
          }
          events.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            name: `frustration.${kind}`,
            props: boundedEventProps({
              target: a["frustration.target"] ?? null,
              count: typeof a["frustration.count"] === "number" ? a["frustration.count"] : 1,
            }),
            ts,
            ...dimensions,
            ...metadata,
          });
        }
        // autres spans (futures instrumentations) : ignorés silencieusement
      }
    }
  }
  const eventIndex = buildEventIndex({
    pageviews,
    metrics,
    errors,
    resources,
    longtasks,
    breadcrumbs,
    events,
    spans,
  });

  return {
    sessions: [...sessions.values()],
    pageviews,
    metrics,
    errors,
    resources,
    longtasks,
    breadcrumbs,
    events,
    actions,
    spans,
    eventIndex,
    apiKeys,
    sviCalls,
    sviSteps,
    sviLegs,
    capabilities: [...capabilities.values()],
    rejected,
  };
}

/** severityNumber OTLP (1..24) -> libellé, quand severityText est absent. */
function severityText(n) {
  if (n == null) return null;
  if (n >= 21) return "FATAL";
  if (n >= 17) return "ERROR";
  if (n >= 13) return "WARN";
  if (n >= 9) return "INFO";
  if (n >= 5) return "DEBUG";
  return "TRACE";
}

/**
 * Aplatit un payload OTLP/HTTP JSON du signal LOGS (resourceLogs) en lignes rum_log
 * — miroir de flattenOtlp() pour les traces. Rejette (compte) les resourceLogs sans
 * mip.app_id. Corrélation aux spans via traceId/spanId. PII scrubbée (body + attrs).
 * P5.3 : un log ERROR ou plus portant `exception.*` produit AUSSI une ligne
 * `errors` dérivée (origin_signal = log) ; le log lui-même reste écrit.
 * @param {object} payload  enveloppe OTLP/HTTP JSON (resourceLogs[]).
 * @param {{maxLogs?: number}} [opts]  garde-fou anti-charge (défaut 20 000).
 * @returns {{logs: object[], errors: object[], apiKeys: {app_id: string, api_key: string|null}[], rejected: number}}
 */
export function flattenOtlpLogs(payload, opts = {}) {
  const maxLogs = opts.maxLogs ?? 20_000;
  const now = opts.now ?? Date.now();
  let seen = 0;
  const logs = [];
  const errors = [];
  const apiKeys = [];
  let rejected = 0;

  for (const rl of Array.isArray(payload?.resourceLogs) ? payload.resourceLogs : []) {
    if (!rl || typeof rl !== "object") {
      rejected++;
      continue;
    }
    const res = attrsToObj(rl.resource?.attributes);
    const appId = res["mip.app_id"];
    if (!appId) {
      rejected++;
      continue;
    }
    apiKeys.push({ app_id: appId, api_key: res["mip.api_key"] ?? null });
    // source par défaut au niveau resource (surchargée par log si présent)
    const resSource = res["mip.source"] ?? res["mip.collection_source"] ?? null;

    for (const sl of Array.isArray(rl.scopeLogs) ? rl.scopeLogs : []) {
      const scopeName = sl?.scope?.name ?? null;
      for (const rec of Array.isArray(sl?.logRecords) ? sl.logRecords : []) {
        if (++seen > maxLogs) {
          rejected++;
          continue;
        }
        if (!rec || typeof rec !== "object") {
          rejected++;
          continue;
        }
        const a = attrsToObj(rec.attributes);
        const bodyVal = anyValue(rec.body);
        const bodyStr = typeof bodyVal === "string" ? bodyVal : bodyVal == null ? "" : JSON.stringify(bodyVal);
        // scrub PII AVANT troncature (un secret ne doit pas survivre coupé en deux)
        const body = (scrubText(bodyStr) ?? "").slice(0, 4000);
        const sevNum =
          typeof rec.severityNumber === "number"
            ? rec.severityNumber
            : typeof rec.severityNumber === "string"
              ? Number(rec.severityNumber) || null
              : null;
        logs.push({
          app_id: appId,
          ts: nanosToDate(rec.timeUnixNano ?? rec.observedTimeUnixNano, now),
          severity_num: sevNum,
          severity_text: rec.severityText ?? severityText(sevNum),
          body,
          source: a["mip.source"] ?? resSource ?? "sdk",
          trace_id: rec.traceId ?? a["mip.trace_id"] ?? null,
          span_id: rec.spanId ?? a["mip.span_id"] ?? null,
          session_id: a["mip.session_id"] ?? null,
          route: a["mip.route"] ?? null,
          attributes: scrubProps(a),
        });
        // `seen` est la position du log dans CE lot : stable au rejeu du lot.
        const exception = logRecordException(rec, a, {
          appId, resource: res, scopeName, severityNumber: sevNum, position: seen, now,
        });
        if (exception) errors.push(exception);
      }
    }
  }
  return { logs, errors, apiKeys, rejected };
}
