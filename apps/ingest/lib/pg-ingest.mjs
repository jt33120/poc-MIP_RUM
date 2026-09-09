// Cœur d'ingestion sur Postgres NU (pg) — source UNIQUE partagée par le
// dev-server Node (local/CI) et les routes Next.js de la console (prod).
//
// Pourquoi ce module existe. L'ingestion de prod tournait en edge functions
// Supabase (Deno + supabase-js). Le projet Supabase ayant disparu, l'ingestion
// est repartie sur Vercel, où tourne déjà la console — donc sur `pg`, comme le
// dev-server. Plutôt que de laisser deux implémentations diverger (le défaut
// exact que _shared/otlp.mjs et _shared/cors.mjs avaient été créés pour fermer),
// la logique d'écriture et d'auth vit ici, et les deux chemins l'appellent.
//
// Aucune dépendance à Deno ni à supabase-js : `pg` et rien d'autre.
import { createHash } from "node:crypto";

// ───────────────────────────── Écriture ─────────────────────────────

/** Insert multi-lignes (une requête par table), paramétré. */
export function batchInsert(client, table, cols, rows, conflictClause) {
  if (!rows.length) return Promise.resolve();
  const params = [];
  const tuples = rows
    .map(
      (row) =>
        `(${cols
          .map((c) => {
            params.push(row[c]);
            return `$${params.length}`;
          })
          .join(",")})`,
    )
    .join(",");
  return client.query(
    `insert into ${table} (${cols.join(",")}) values ${tuples} ${conflictClause}`,
    params,
  );
}

// Colonnes RÉELLEMENT présentes sur rum_session, relues périodiquement.
//
// POURQUOI CE GARDE-FOU EXISTE. Sur ce projet le déploiement est automatique et
// la migration est MANUELLE : entre le déploiement d'un code qui écrit une
// nouvelle colonne et le `psql` qui la crée, il existe une fenêtre où l'INSERT
// référence une colonne absente. Postgres rejette alors la requête ENTIÈRE, donc
// la transaction, donc le lot : ce n'est pas le champ nouveau qui se perd, c'est
// TOUTE la télémétrie, jusqu'à ce qu'un humain lance la migration. Un écart de
// quelques minutes vaut un trou de quelques minutes ; un oubli d'un jour vaut un
// trou d'un jour, sans erreur visible côté client (le SDK poste en beacon).
//
// Le TTL est ce qui rend la reprise automatique : sans lui, une instance
// serverless chaude garderait indéfiniment la liste d'avant la migration et
// n'écrirait jamais les nouvelles colonnes, même une fois celles-ci créées.
const TTL_COLONNES_MS = 60_000;
/** Un cache PAR TABLE : `rum_session` et `rum_longtask` ont chacune gagné des
 *  colonnes à des dates différentes, et un cache partagé les confondrait. */
const colonnesCache = new Map();

async function colonnesDe(client, table) {
  const vu = colonnesCache.get(table);
  if (vu && Date.now() - vu.at < TTL_COLONNES_MS) return vu.set;
  const { rows } = await client.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [table],
  );
  const set = new Set(rows.map((r) => r.column_name));
  colonnesCache.set(table, { at: Date.now(), set });
  return set;
}

const colonnesSession = (client) => colonnesDe(client, "rum_session");

/** Réinitialise le cache de colonnes (tests). */
export function _resetColonnesCache() {
  colonnesCache.clear();
}

/** Colonnes d'attribution LoAF, ajoutées par migration-v55. */
const OPTIONNELLES_LONGTASK = [
  "source",
  "blocking_ms",
  "render_ms",
  "script_url",
  "script_function",
  "script_ms",
  "invoker",
];

/**
 * Colonnes de l'INSERT rum_longtask, réduites à ce que la base porte.
 *
 * Même garde-fou que pour rum_session, pour la même raison : une colonne
 * référencée mais absente fait rejeter par Postgres la requête ENTIÈRE, donc la
 * transaction, donc TOUT le lot — ce n'est pas l'attribution qui se perd, c'est
 * la télémétrie complète, en silence (le SDK poste en beacon). Le déploiement
 * applique bien les migrations en pre-deploy, mais ce chemin sert aussi aux
 * installations qui ne passent pas par lui.
 */
export function colonnesLongtask(dispo) {
  return [
    "span_id",
    "session_id",
    "app_id",
    "route",
    "duration_ms",
    ...OPTIONNELLES_LONGTASK.filter((c) => dispo.has(c)),
    "ts",
  ];
}

/** Colonnes optionnelles de rum_session, dans l'ordre où elles s'insèrent. */
const OPTIONNELLES = ["collection_source", "release", "net_type", "visitor_id"];

/**
 * Liste de colonnes de l'INSERT, réduite à ce que la base porte réellement.
 * PURE, donc testable : c'est ici qu'une erreur se paie par le rejet de tout
 * le lot, pas seulement par la perte d'un champ.
 */
export function colonnesInsert(dispo) {
  return [
    "session_id", "app_id", "client_id", "user_hash", "user_agent", "device_type",
    "geo_country", "is_bot",
    ...OPTIONNELLES.filter((c) => dispo.has(c)),
    "started_at", "last_seen_at", "page_count",
  ];
}

/**
 * Clause `on conflict`. Assemblée en LISTE et non en chaîne à trous : une clause
 * optionnelle interpolée laisse une virgule orpheline quand elle est vide, et une
 * colonne assignée deux fois fait rejeter tout l'INSERT par Postgres
 * (« multiple assignments to same column »). Les deux ont été commis ici.
 *
 * `collection_source` en est délibérément absent : la source est figée à la
 * première vue de la session (cf. flattenOtlp).
 */
export function clauseConflitSession(dispo) {
  const set = [
    "last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at)",
    "user_agent  = coalesce(rum_session.user_agent, excluded.user_agent)",
    "geo_country = coalesce(rum_session.geo_country, excluded.geo_country)",
    "device_type = coalesce(rum_session.device_type, excluded.device_type)",
    // v53 : posés au premier lot qui les porte, jamais écrasés ensuite. net_type
    // arrive après l'événement load, donc dans un lot POSTÉRIEUR à celui qui a
    // créé la session : sans coalesce, la colonne resterait vide.
    // `visitor_id` rejoint la liste pour la même raison, plus une : la file de
    // retry peut rejouer un lot d'un SDK antérieur, sans identifiant. Le
    // coalesce garantit qu'un identifiant déjà connu n'est jamais effacé par un
    // lot qui n'en porte pas.
    ...["release", "net_type", "visitor_id"]
      .filter((c) => dispo.has(c))
      .map((c) => `${c} = coalesce(rum_session.${c}, excluded.${c})`),
  ];
  return `on conflict (session_id) do update set ${set.join(", ")}`;
}

/**
 * Écrit un lot OTLP aplati (sortie de flattenOtlp) dans une TRANSACTION unique.
 * Idempotent au rejeu : `on conflict do nothing` partout, `greatest` sur les
 * horodatages de session — c'est ce qui autorise le retry côté appelant.
 */
export async function writeRows(pool, {
  sessions,
  pageviews,
  metrics,
  errors,
  resources,
  longtasks,
  breadcrumbs,
  events,
  spans,
  sviCalls,
  sviSteps,
  sviLegs,
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Colonnes optionnelles : présentes une fois la migration passée, ignorées
    // avant. Le reste du lot part normalement dans les deux cas.
    const dispo = await colonnesSession(client);
    await batchInsert(
      client,
      "rum_session",
      // `collection_source` MANQUAIT de cette liste. batchInsert construit l'INSERT
      // strictement depuis elle : toute clé absente est jetée en silence, et la
      // colonne retombait sur son DEFAULT 'sdk'. Aucune session ne pouvait donc
      // être enregistrée comme venant de l'extension sur ce chemin — le seul
      // utilisé en production — alors que le SDK envoyait bien l'attribut.
      colonnesInsert(dispo),
      sessions.map((s) => ({ ...s, started_at: s.last_seen_at, page_count: 0 })),
      clauseConflitSession(dispo),
    );
    await batchInsert(
      client,
      "rum_pageview",
      ["span_id", "session_id", "app_id", "route", "url", "referrer", "nav_type", "started_at"],
      pageviews.map((p) => ({ ...p, started_at: p.ts })),
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_metric",
      ["span_id", "session_id", "app_id", "route", "name", "value", "rating", "attribution", "ts"],
      metrics.map((m) => ({ ...m, attribution: m.attribution ? JSON.stringify(m.attribution) : null })),
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_error",
      ["span_id", "session_id", "app_id", "route", "kind", "message", "error_type", "stack", "source", "lineno", "colno", "release", "fingerprint", "ts"],
      errors,
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_resource",
      ["span_id", "session_id", "app_id", "route", "url", "type", "duration_ms", "transfer_size", "render_blocking", "ts"],
      resources,
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_longtask",
      colonnesLongtask(await colonnesDe(client, "rum_longtask")),
      longtasks,
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_breadcrumb",
      ["span_id", "session_id", "app_id", "type", "label", "seq", "ts"],
      breadcrumbs,
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_event",
      ["span_id", "session_id", "app_id", "route", "name", "props", "ts"],
      events.map((e) => ({ ...e, props: e.props ? JSON.stringify(e.props) : null })),
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_span",
      ["span_id", "trace_id", "parent_span_id", "tier", "session_id", "app_id", "route", "url", "method", "status_code", "duration_ms", "name", "kind", "ts"],
      spans ?? [],
      "on conflict (span_id) do nothing",
    );

    // SVI (migration-v51) : la fusion des lots est non triviale (ne jamais
    // régresser un champ vers NULL, retenir le début le plus tôt / la fin la
    // plus tard, ne jamais rouvrir un appel clos) — elle vit en base, appelée
    // à l'identique par tous les chemins d'ingestion.
    for (const call of sviCalls ?? []) {
      await client.query("select upsert_svi_call($1::jsonb)", [JSON.stringify(call)]);
    }
    await batchInsert(
      client,
      "svi_step",
      ["step_id", "parent_step_id", "app_id", "call_id", "seq", "kind", "node_id", "node_label",
       "menu_path", "depth", "branch", "input_class", "input_len", "input_sensitive",
       "no_match", "no_input", "reprompt_index", "asr_confidence", "rejected",
       "milestone", "flow_outcome", "started_at", "duration_ms", "exit_reason"],
      sviSteps ?? [],
      "on conflict (step_id) do nothing",
    );
    await batchInsert(
      client,
      "svi_leg",
      ["app_id", "call_id", "leg_ref", "role", "dir", "codec", "ptime_ms", "sample_rate",
       "carrier", "mos_method", "mos_avg", "mos_min", "r_factor_avg", "r_factor_min",
       "jitter_avg_ms", "jitter_max_ms", "loss_avg_pct", "loss_max_pct", "rtt_avg_ms",
       "rtt_max_ms", "packets_sent", "packets_lost", "e_model_params", "started_at", "ended_at"],
      (sviLegs ?? []).map((l) => ({ ...l,
        e_model_params: l.e_model_params ? JSON.stringify(l.e_model_params) : null })),
      "on conflict (app_id, call_id, leg_ref, dir) do nothing",
    );
    // page_count DÉRIVÉ du compte réel de pageviews (idempotent au rejeu, cf.
    // migration-v07) plutôt qu'incrémenté.
    if (sessions.length) {
      await client.query(
        `update rum_session s
           set page_count = sub.c
          from (select session_id, count(*) c from rum_pageview
                 where session_id = any($1) group by session_id) sub
         where s.session_id = sub.session_id`,
        [sessions.map((s) => s.session_id)],
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Signal LOGS OTel -> rum_log (bigserial : pas de contrainte d'idempotence). */
export async function writeLogs(pool, logs) {
  if (!logs.length) return;
  const client = await pool.connect();
  try {
    await batchInsert(
      client,
      "rum_log",
      ["app_id", "ts", "severity_num", "severity_text", "body", "source", "trace_id", "span_id", "session_id", "route", "attributes"],
      logs.map((l) => ({ ...l, attributes: l.attributes ? JSON.stringify(l.attributes) : null })),
      "",
    );
  } finally {
    client.release();
  }
}

/**
 * Chunk rrweb (corps gzip) -> replay_chunk. La ligne rum_session minimale est
 * créée d'abord : un chunk peut précéder le 1er lot OTLP, et la FK l'exige.
 */
export async function writeReplayChunk(pool, { sessionId, appId, seq, body, eventsCount }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into rum_session (session_id, app_id) values ($1, $2)
         on conflict (session_id) do nothing`,
      [sessionId, appId],
    );
    await client.query(
      `insert into replay_chunk (session_id, app_id, seq, events_count, body)
         values ($1, $2, $3, $4, $5)
         on conflict (session_id, seq) do nothing`,
      [sessionId, appId, seq, eventsCount, body],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ───────────────────────── Auth / registre / débit ─────────────────────────

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Helpers d'auth adossés à un pool `pg`. Même modèle de décision que
 * _shared/auth.mjs (qui parlait supabase-js) : cache de registre 60 s,
 * fail-open si le registre n'a JAMAIS pu être chargé (indisponibilité DB au
 * démarrage > rejeter 100 % du trafic), rate limit durable via rate_check().
 *
 * L'état (cache, compteurs) est par instance — exactement comme l'isolat Deno
 * d'avant : en serverless chaque instance a le sien, et le compteur durable en
 * base est ce qui rend la limite globale.
 */
export function createPgAuth(pool, opts = {}) {
  const requireApiKey = opts.requireApiKey ?? false;
  const rateLimitPerMin = opts.rateLimitPerMin ?? 600;
  const log = opts.log ?? {};
  const now = opts.now ?? (() => Date.now());

  let appRegistry = new Map();
  let registryLoadedAt = 0;
  let registryEverLoaded = false;

  async function getAppRegistry() {
    if (now() - registryLoadedAt < 60_000 && appRegistry.size) return appRegistry;
    try {
      const { rows } = await pool.query(
        "select app_id, api_key_hash, active, allowed_origins from app_registry",
      );
      appRegistry = new Map(rows.map((r) => [r.app_id, r]));
      registryLoadedAt = now();
      registryEverLoaded = true;
    } catch (err) {
      log.error?.("app_registry load failed", { err: String(err) });
    }
    return appRegistry;
  }

  /** null si accepté, sinon la raison du 403. */
  async function checkApiKey(appId, apiKey) {
    if (!requireApiKey) return null;
    const registry = await getAppRegistry();
    if (!registryEverLoaded) {
      log.warn?.("api key check fail-open (registry never loaded)", { app_id: appId });
      return null;
    }
    const app = registry.get(appId);
    if (!app || !app.active) return `unknown or inactive app: ${appId}`;
    // Durcissement E1-S1 : sous REQUIRE_API_KEY, une app SANS clé est rejetée.
    if (app.api_key_hash == null) return `app requires an API key: ${appId}`;
    if (!apiKey || sha256(apiKey) !== app.api_key_hash)
      return `invalid api key for app: ${appId}`;
    return null;
  }

  const rateHits = new Map();
  function rateLimited(appId) {
    const t = now();
    const hits = rateHits.get(appId) ?? [];
    while (hits.length && hits[0] <= t - 60_000) hits.shift();
    if (hits.length >= rateLimitPerMin) return true;
    hits.push(t);
    rateHits.set(appId, hits);
    return false;
  }

  /** Pré-filtre mémoire (rapide) puis compteur durable partagé ; fallback mémoire. */
  async function rateLimitedDurable(appId) {
    if (rateLimited(appId)) return true;
    try {
      const { rows } = await pool.query("select rate_check($1, $2) as ok", [
        appId,
        rateLimitPerMin,
      ]);
      return rows[0].ok === false;
    } catch (err) {
      log.warn?.("rate_check sql failed (fallback mémoire)", { err: String(err) });
      return false;
    }
  }

  return { getAppRegistry, checkApiKey, rateLimitedDurable };
}
