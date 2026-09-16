// Parser OTLP/HTTP JSON -> lignes SQL. JS pur, sans dépendance :
// importé tel quel par le dev-server Node (local) et l'edge function Deno (prod).
// v0.3 : geo timezone->pays (attribut span mip.tz -> sessions[].geo_country).
import { tzToCountry } from "./tz-country.mjs";
// Scrub PII serveur (A2) : défense en profondeur, ne dépend pas du beforeSend client.
import { scrubProps, scrubText, scrubUrl } from "./scrub.mjs";
// Lot 2 : détection de trafic non humain (headless/monitoring/crawlers JS) ->
// sessions[].is_bot, exclu par défaut des agrégats console.
import { isBot } from "./bots.mjs";

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

function boundedContextValue(value, depth, budget) {
  if (value == null) return null;
  if (typeof value === "string") return value.length <= CONTEXT_MAX_STRING ? (scrubText(value) ?? "") : undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (depth >= CONTEXT_MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => boundedContextValue(item, depth + 1, budget)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (budget.keys >= CONTEXT_MAX_KEYS) break;
    const key = (scrubText(rawKey) ?? "").trim();
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

/** device_type déduit du user-agent — repli quand le SDK n'a pas mis
 *  mip.device_type sur la span (parité avec le helper SQL mip_device_from_ua). */
export function deviceFromUa(ua) {
  if (!ua) return null;
  return /mobile|tablet|iphone|ipad|android|silk|kindle/i.test(ua) ? "mobile" : "desktop";
}

/** Déstructure un AnyValue OTLP ({stringValue|intValue|doubleValue|boolValue}). */
export function anyValue(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
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
  let rejected = 0;

  /**
   * Ligne rum_span commune front/back ; null si trace_id/span_id absents.
   *
   * `parentNatif` est le champ OTLP `span.parentSpanId`, que les capteurs de ce
   * dépôt renseignent depuis qu'ils émettent des spans standard. Il PRIME sur
   * l'attribut propriétaire `mip.parent_span_id`, qui reste lu en repli : un SDK
   * déjà posé chez un client continue d'alimenter le waterfall sans être
   * redéployé. L'ordre compte — le champ natif est celui qu'un collecteur tiers
   * lirait, donc celui qui fait foi.
   */
  const spanRow = (tier, a, appId, ts, parentNatif = null) => {
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
    const release = res["mip.release"] ?? null; // version de l'app (dé-minification)
    for (const ss of Array.isArray(rs.scopeSpans) ? rs.scopeSpans : []) {
      for (const span of Array.isArray(ss?.spans) ? ss.spans : []) {
        // garde-fou : au-delà du plafond, on compte sans traiter (mémoire/CPU bornés)
        if (++seen > maxSpans) {
          rejected++;
          continue;
        }
        // durcissement A5 : un span sans nom (string) ne peut être routé -> rejet
        if (!span || typeof span.name !== "string") {
          rejected++;
          continue;
        }
        const a = attrsToObj(span.attributes);

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

        // span backend (middleware serveur) : pas de session requise, pas
        // d'upsert rum_session (le front est seul maître de la session)
        if (span.name === "http.server") {
          const row = spanRow("back", a, appId, nanosToDate(span.startTimeUnixNano, now), span.parentSpanId);
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
            route:
              normalizeRouteTemplate(a["http.route"]) ??
              normalizeRouteTemplate(routeFromOtelName(span.name)) ??
              (a["url.path"] ?? null),
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
          device_type: a["mip.device_type"] ?? deviceFromUa(res["mip.user_agent"]),
          geo_country: null,
          // Lot 2 : classifié à la 1re vue de la session (UA + éventuel signal
          // webdriver du SDK). Flag, pas drop : la donnée reste, mais exclue par
          // défaut des agrégats console.
          is_bot: isBot(res["mip.user_agent"], res["mip.webdriver"] ?? a["mip.webdriver"]),
          // Ext-A : mode de collecte — 'sdk' (script posé par le dev, défaut) ou
          // 'extension' (SDK injecté par l'extension navigateur). Figé à la 1re vue.
          collection_source: a["mip.collection_source"] === "extension" ? "extension" : "sdk",
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
        if (s.geo_country == null && a["mip.tz"]) s.geo_country = tzToCountry(a["mip.tz"]);
        // back-fill device_type si une span ultérieure le porte (ou repli UA), la 1re
        // span ayant pu créer la session sans l'attribut.
        if (s.device_type == null)
          s.device_type = a["mip.device_type"] ?? deviceFromUa(res["mip.user_agent"]);
        // net_type n'arrive que sur les spans de navtiming, émises après `load` :
        // la session existe déjà, créée par une span antérieure sans l'attribut.
        if (s.net_type == null && a["mip.net_type"]) s.net_type = a["mip.net_type"];
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
            ...metadata,
          });
        } else if (span.name === "exception") {
          // La session porte une erreur : c'est ce qui décide LAQUELLE des deux
          // probabilités d'inclusion s'applique à son poids (migration-v58).
          // Une session biaisée-erreurs n'apparaît QUE si elle en a une.
          s.has_error = true;
          const errorType = a["exception.type"] ?? null;
          // scrub PII AVANT troncature (un secret ne doit pas survivre coupé en deux)
          const message = (scrubText(a["exception.message"]) ?? "").slice(0, 1000);
          const stack = (scrubText(a["exception.stacktrace"]) ?? "").slice(0, 4000);
          errors.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            // Le SDK déduplique et compte (v59) : cette ligne peut représenter
            // plusieurs occurrences. Absent = 1, donc les SDK antérieurs restent
            // justes sans rien changer.
            occurrences: occurrencesDe(a["mip.error_count"]),
            kind: a["mip.error_kind"] ?? "error",
            message,
            error_type: errorType,
            stack,
            source: scrubUrl(a["mip.error_source"]),
            lineno: a["mip.error_lineno"] ?? null,
            colno: a["mip.error_colno"] ?? null,
            release,
            fingerprint: errorFingerprint(errorType, message, stack),
            ts,
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
            ...metadata,
          });
        } else if (span.name === "http.client") {
          const row = spanRow("front", a, appId, ts, span.parentSpanId);
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
            props: scrubProps(parseJsonAttr(a["mip.props"])),
            ts,
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
            props: scrubProps({
              target: a["frustration.target"] ?? null,
              count: typeof a["frustration.count"] === "number" ? a["frustration.count"] : 1,
            }),
            ts,
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
 * @param {object} payload  enveloppe OTLP/HTTP JSON (resourceLogs[]).
 * @param {{maxLogs?: number}} [opts]  garde-fou anti-charge (défaut 20 000).
 * @returns {{logs: object[], apiKeys: {app_id: string, api_key: string|null}[], rejected: number}}
 */
export function flattenOtlpLogs(payload, opts = {}) {
  const maxLogs = opts.maxLogs ?? 20_000;
  const now = opts.now ?? Date.now();
  let seen = 0;
  const logs = [];
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
      }
    }
  }
  return { logs, apiKeys, rejected };
}
