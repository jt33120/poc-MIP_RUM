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

/** Premier frame de la stack (ligne `at …` ou style `fn@url`), sans line:col. */
function firstStackFrame(stack) {
  const lines = String(stack ?? "").split("\n");
  for (const line of lines) {
    const l = line.trim();
    if (/^at\s/.test(l) || /\S@\S/.test(l)) return l.replace(/:\d+:\d+/g, "");
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
 *            resources: object[], longtasks: object[], breadcrumbs: object[], events: object[],
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
  const spans = [];
  const apiKeys = [];
  // SVI (migration-v51) : appels, étapes et tronçons voix. Collections séparées
  // des spans RUM — un appel n'est pas un span, cf. l'en-tête de la migration.
  const sviCalls = [];
  const sviSteps = [];
  const sviLegs = [];
  let rejected = 0;

  /** Ligne rum_span commune front/back ; null si trace_id/span_id absents. */
  const spanRow = (tier, a, appId, ts) => {
    const traceId = a["mip.trace_id"];
    const spanId = a["mip.span_id"];
    const durationMs = a["http.duration_ms"];
    if (!traceId || !spanId || typeof durationMs !== "number") return null;
    return {
      span_id: spanId,
      trace_id: traceId,
      parent_span_id: a["mip.parent_span_id"] ?? null,
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
          const row = spanRow("back", a, appId, nanosToDate(span.startTimeUnixNano, now));
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

        const s = sessions.get(sessionId) ?? {
          session_id: sessionId,
          app_id: appId,
          client_id: res["mip.client_id"] || null,
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
            ts,
          });
        } else if (span.name === "exception") {
          const errorType = a["exception.type"] ?? null;
          // scrub PII AVANT troncature (un secret ne doit pas survivre coupé en deux)
          const message = (scrubText(a["exception.message"]) ?? "").slice(0, 1000);
          const stack = (scrubText(a["exception.stacktrace"]) ?? "").slice(0, 4000);
          errors.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
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
            ts,
          });
        } else if (span.name === "breadcrumb") {
          breadcrumbs.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            type: a["breadcrumb.type"] ?? "custom",
            label: a["breadcrumb.label"] ?? null,
            seq: a["breadcrumb.seq"] ?? null,
            ts,
          });
        } else if (span.name === "http.client") {
          const row = spanRow("front", a, appId, ts);
          if (row) spans.push(row);
          else rejected++;
        } else if (span.name.startsWith("track.")) {
          events.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            name: span.name.slice("track.".length),
            props: scrubProps(parseJsonAttr(a["mip.props"])),
            ts,
          });
        } else if (span.name === "frustration") {
          // Signaux de frustration (P1) : rage/dead clicks. Stockés dans rum_event
          // sous le nom réservé 'frustration.<kind>' (hérite RLS/purge/erase/métering
          // de rum_event ; target scrubbé comme tout texte libre).
          const kind = a["frustration.kind"];
          if (kind !== "rage" && kind !== "dead") {
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
          });
        }
        // autres spans (futures instrumentations) : ignorés silencieusement
      }
    }
  }
  return {
    sessions: [...sessions.values()],
    pageviews,
    metrics,
    errors,
    resources,
    longtasks,
    breadcrumbs,
    events,
    spans,
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
