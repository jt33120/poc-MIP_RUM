// LE receveur d'ingestion — un gestionnaire HTTP Node, sans framework.
//
// POURQUOI CE FICHIER. Il existait TROIS implémentations de la même chose : les
// route handlers Next (prod sur Vercel), `dev-server.mjs` (traces + logs, local
// et CI) et `replay-dev-server.mjs` (replay, local et CI). Les trois lisaient
// bien le même parser et les mêmes écritures, mais chacune refaisait le
// registre d'apps, la vérification de clé, le débit, le CORS et le découpage
// des routes — et elles avaient déjà divergé : `dev-server.mjs` acceptait une
// app sans clé sous REQUIRE_API_KEY là où la prod la rejette (durcissement
// E1-S1 posé dans createPgAuth, jamais reporté dans le dev-server).
//
// Ici il n'y en a plus qu'une, et elle ne dépend que de `node:http` et de `pg`.
// C'est ce qui permet de la déployer telle quelle ailleurs — un conteneur, une
// VM, un hébergeur souverain — sans emporter Next.js avec elle.
//
// CE QU'IL NE FAIT PAS : ni TLS, ni journal d'accès, ni métriques. C'est le rôle
// de l'hébergeur (Railway, un reverse-proxy) et le service reste ainsi portable.
import { gunzipSync } from "node:zlib";
import { createPgAuth, writeLogs, writeReplayChunk, writeRows } from "./pg-ingest.mjs";
import { deposerLot } from "./ingest-differe.mjs";
import {
  creerLimiteurUpload,
  enregistrerMaps,
  ErreurUpload,
  LIMITES_UPLOAD,
  lireCorpsLimite,
  lireRequeteUpload,
  verifierJetonUpload,
} from "./sourcemap-upload.mjs";
import { corsHeaders as buildCors, originsFromRegistry, REPLAY_ALLOW_HEADERS } from "../supabase/functions/_shared/cors.mjs";
import { createLogger } from "../supabase/functions/_shared/log.mjs";
import { bodyTooLarge, MAX_BODY_BYTES, MAX_SPANS_PER_REQUEST } from "../supabase/functions/_shared/limits.mjs";
import { flattenOtlp, flattenOtlpLogs } from "../supabase/functions/_shared/otlp.mjs";
import { withRetry } from "../supabase/functions/_shared/retry.mjs";
import { secureOtlpIdentities } from "./identity-hash.mjs";

/** Garde-fou replay : > au plafond du SDK (1 Mo gzip par session). */
export const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

/** En-tête normalisé (Node donne string | string[] | undefined). */
function entete(req, nom) {
  const v = req.headers[nom];
  return Array.isArray(v) ? v[0] : (v ?? null);
}

/**
 * Lit le corps en bornant la mémoire. Renvoie null si la limite est franchie —
 * on arrête de concaténer AU MOMENT du dépassement plutôt que d'accumuler
 * d'abord et de mesurer ensuite, ce qui laisserait passer l'attaque.
 */
async function lireCorps(req, max) {
  const morceaux = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > max) return null;
    morceaux.push(c);
  }
  return Buffer.concat(morceaux);
}

/**
 * @param {import("pg").Pool} pool
 * @param {{
 *   requireApiKey?: boolean,
 *   rateLimitPerMin?: number,
 *   log?: object,
 *   tampon?: boolean,        // expose GET /__recent (assertions E2E) — JAMAIS en production
 *   signaux?: ("traces"|"logs"|"replay"|"sourcemaps")[],
 *   aliasSante?: string[],   // chemins supplémentaires répondant comme /health
 *   nom?: string,            // nom du service, renvoyé par /health
 *   identityHashSecret?: string, // injection explicite du secret HMAC (tests/self-host)
 * }} opts
 */
export function creerReceveur(pool, opts = {}) {
  const log = opts.log ?? createLogger("ingest");
  const rateLimitPerMin = opts.rateLimitPerMin ?? Number(process.env.RATE_LIMIT_PER_MIN ?? 600);
  const requireApiKey = opts.requireApiKey ?? process.env.REQUIRE_API_KEY === "true";
  const signaux = new Set(opts.signaux ?? ["traces", "logs", "replay", "sourcemaps"]);
  const aliasSante = opts.aliasSante ?? [];
  const nom = opts.nom ?? "ingest";
  const identityHashSecret = opts.identityHashSecret ?? process.env.IDENTITY_HASH_SECRET;
  // Ingestion DIFFÉRÉE (migration-v63) : le lot est débarqué dans une table
  // UNLOGGED et écrit plus tard par un travailleur. ÉTEINTE par défaut — la
  // table est vidée par PostgreSQL après un arrêt brutal, donc ce compromis se
  // choisit explicitement. Le gain mesuré est dans docs/BUILD_LOG.md.
  const differe = opts.differe ?? process.env.INGEST_DEFERRED === "true";

  const auth = createPgAuth(pool, { requireApiKey, rateLimitPerMin, log });
  const limiteurSourcemaps = creerLimiteurUpload();

  // Tampon des derniers payloads : uniquement pour les assertions de bout en
  // bout. Il retient de la donnée en clair, donc il reste éteint par défaut.
  const recents = [];
  const TAILLE_TAMPON = 50;

  async function cors(origin, extra) {
    let origines = [];
    try {
      origines = originsFromRegistry((await auth.getAppRegistry()).values());
    } catch {
      // Registre indisponible : socle statique plutôt que refus total — même
      // esprit fail-open que checkApiKey.
    }
    return buildCors(origin, origines, extra);
  }

  const repondre = (res, statut, corps, entetes) => {
    res.writeHead(statut, { "content-type": "application/json", ...entetes });
    res.end(JSON.stringify(corps));
  };

  /** Clé d'API (403) puis débit (429), une fois par app du lot. */
  async function gardes(apiKeys, entetes) {
    for (const { app_id, api_key } of apiKeys) {
      const raison = await auth.checkApiKey(app_id, api_key);
      if (raison) {
        log.warn("rejected: api key", { app_id, reason: raison });
        return { statut: 403, corps: { error: raison }, entetes };
      }
    }
    for (const appId of new Set(apiKeys.map((k) => k.app_id))) {
      if (await auth.rateLimitedDurable(appId)) {
        log.warn("rate limited", { app_id: appId, limit: rateLimitPerMin });
        return {
          statut: 429,
          corps: { error: `rate limit exceeded for app: ${appId}` },
          entetes: { ...entetes, "retry-after": "60" },
        };
      }
    }
    return null;
  }

  async function traiterOtlp(req, res, entetes, estLogs) {
    if (bodyTooLarge(entete(req, "content-length"))) {
      log.warn("payload too large", { content_length: entete(req, "content-length"), max: MAX_BODY_BYTES });
      return repondre(res, 413, { error: "payload too large" }, entetes);
    }
    const brut = await lireCorps(req, MAX_BODY_BYTES);
    if (brut === null) {
      log.warn("payload too large", { max: MAX_BODY_BYTES });
      return repondre(res, 413, { error: "payload too large" }, entetes);
    }

    let payload;
    try {
      payload = JSON.parse(brut.toString("utf8"));
    } catch {
      log.warn("bad request", { reason: "invalid json body" });
      return repondre(res, 400, { error: "invalid json body" }, entetes);
    }
    const secured = secureOtlpIdentities(
      payload,
      identityHashSecret,
    );
    payload = secured.payload;
    if (opts.tampon) {
      recents.push(payload);
      if (recents.length > TAILLE_TAMPON) recents.shift();
    }

    if (estLogs) {
      const parsed = flattenOtlpLogs(payload, { maxLogs: MAX_SPANS_PER_REQUEST });
      const refus = await gardes(parsed.apiKeys, entetes);
      if (refus) return repondre(res, refus.statut, refus.corps, refus.entetes);
      await withRetry(() => writeLogs(pool, parsed.logs), {
        onRetry: (e, n) => log.warn("db retry (logs)", { attempt: n, code: e?.code }),
      });
      log.info("ingested logs", { logs: parsed.logs.length, rejected: parsed.rejected });
      return repondre(res, 200, { partialSuccess: {} }, entetes);
    }

    const rows = flattenOtlp(payload, { maxSpans: MAX_SPANS_PER_REQUEST });
    const refus = await gardes(rows.apiKeys, entetes);
    if (refus) return repondre(res, refus.statut, refus.corps, refus.entetes);

    // Géo sans jamais stocker d'IP : mip.tz d'abord (posé par flattenOtlp),
    // repli sur l'en-tête pays du CDN quand il y en a un devant.
    const pays = entete(req, "x-vercel-ip-country") ?? entete(req, "cf-ipcountry");
    if (pays) for (const s of rows.sessions) s.geo_country = s.geo_country ?? pays;

    if (differe) {
      // Le contrôle de clé et le rate-limit sont DÉJÀ passés au-dessus : on ne
      // débarque que ce qui a le droit d'entrer. Une file derrière une porte
      // ouverte serait un amplificateur, pas un découplage.
      const appId = rows.apiKeys[0]?.app_id ?? rows.sessions[0]?.app_id ?? "inconnu";
      await withRetry(() => deposerLot(pool, appId, rows), {
        onRetry: (e, n) => log.warn("db retry (differe)", { attempt: n, code: e?.code }),
      });
    } else {
      await withRetry(() => writeRows(pool, rows), {
        onRetry: (e, n) => log.warn("db retry", { attempt: n, code: e?.code }),
      });
    }
    log.info("ingested", {
      sessions: rows.sessions.length,
      pageviews: rows.pageviews.length,
      metrics: rows.metrics.length,
      errors: rows.errors.length,
      resources: rows.resources.length,
      longtasks: rows.longtasks.length,
      breadcrumbs: rows.breadcrumbs.length,
      events: rows.events.length,
      spans: rows.spans.length,
      rejected: rows.rejected,
    });
    return repondre(res, 200, { partialSuccess: {} }, entetes);
  }

  async function traiterReplay(req, res, entetes) {
    const sessionId = entete(req, "x-mip-session");
    const appId = entete(req, "x-mip-app");
    const seq = Number(entete(req, "x-mip-seq"));
    if (!sessionId || !appId || !Number.isInteger(seq) || seq < 0) {
      return repondre(res, 400, { error: "missing x-mip-session/x-mip-app/x-mip-seq" }, entetes);
    }

    // Parité d'auth avec les traces : un endpoint durci et l'autre ouvert
    // serait exactement le trou que la garde commune ferme.
    const refus = await gardes([{ app_id: appId, api_key: entete(req, "x-mip-key") }], entetes);
    if (refus) return repondre(res, refus.statut, refus.corps, refus.entetes);

    const body = await lireCorps(req, MAX_REPLAY_BYTES);
    if (body === null || !body.length) {
      return repondre(res, 413, { error: "invalid payload size" }, entetes);
    }

    let eventsCount;
    try {
      // gunzip de contrôle : compte les events ET rejette un corps mal formé,
      // qu'on ne veut pas stocker (il serait illisible au rejeu).
      const events = JSON.parse(gunzipSync(body).toString("utf8"));
      eventsCount = Array.isArray(events) ? events.length : 0;
    } catch {
      return repondre(res, 400, { error: "body must be gzipped JSON" }, entetes);
    }

    await withRetry(() => writeReplayChunk(pool, { sessionId, appId, seq, body, eventsCount }), {
      onRetry: (e, n) => log.warn("db retry (replay)", { attempt: n, code: e?.code }),
    });
    log.info("ingested replay", { app_id: appId, seq, events: eventsCount, gzip: body.length });
    return repondre(res, 200, { ok: true, seq, events: eventsCount }, entetes);
  }

  /**
   * POST /v1/sourcemaps — port direct des source maps de CI (P5.4).
   *
   * Jeton dédié SEUL : le cookie admin reste l'affaire de la console, et un
   * jeton de lecture n'a pas le format d'un jeton d'upload. L'authentification
   * précède toute lecture du corps — sans jeton valide, on ne bufferise pas
   * 20 Mio pour les jeter —, puis débit, taille annoncée, lecture bornée en
   * octets et en durée, validation de TOUTES les maps et écriture atomique.
   */
  async function traiterSourcemaps(req, res, entetes) {
    let prise = null;
    try {
      const jeton = await verifierJetonUpload(pool, entete(req, "authorization"));
      if (!jeton) {
        return repondre(res, 401, { error: "jeton d'upload de source maps invalide, expiré ou révoqué" }, entetes);
      }
      prise = limiteurSourcemaps.prendre(`jeton:${jeton.id}`);
      if (prise.refus) {
        return repondre(res, 429, { error: prise.refus.message }, { ...entetes, "retry-after": String(prise.refus.retryAfter) });
      }
      if (bodyTooLarge(entete(req, "content-length"), LIMITES_UPLOAD.corpsDirect)) {
        return repondre(res, 413, { error: `corps trop volumineux (limite ${LIMITES_UPLOAD.corpsDirect / 1048576} Mio)` }, entetes);
      }
      const demande = lireRequeteUpload(await lireCorpsLimite(req, { max: LIMITES_UPLOAD.corpsDirect }));
      if (demande.appId !== jeton.app_id) {
        return repondre(res, 403, { error: "ce jeton n'autorise pas l'upload de source maps pour cette application" }, entetes);
      }
      if (demande.remplacer) {
        return repondre(res, 403, { error: "remplacer une source map existante est réservé à un admin, depuis la console" }, entetes);
      }
      const { statut, corps } = await enregistrerMaps(pool, {
        ...demande,
        par: `jeton:${jeton.id}`,
        jetonId: jeton.id,
      });
      log.info("sourcemaps upload", {
        app_id: demande.appId,
        release: demande.release,
        status: statut,
        maps: demande.maps.length,
        token_id: jeton.id,
      });
      return repondre(res, statut, corps, entetes);
    } catch (err) {
      if (err instanceof ErreurUpload) return repondre(res, err.statut, { error: err.message }, entetes);
      throw err;
    } finally {
      if (prise && !prise.refus) prise.liberer();
    }
  }

  /** Le gestionnaire à passer à http.createServer. */
  async function handler(req, res) {
    const origin = entete(req, "origin") ?? "";
    const chemin = (req.url ?? "/").split("?")[0];
    const estReplay = chemin.startsWith("/v1/replay");
    // Le préflight replay doit annoncer les en-têtes x-mip-* sinon le navigateur
    // bloque le POST cross-origin des clients à clé.
    const entetes = await cors(origin, estReplay ? { allowHeaders: REPLAY_ALLOW_HEADERS } : undefined);

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, entetes);
        return res.end();
      }
      if (req.method === "GET" && (chemin === "/health" || aliasSante.includes(chemin))) {
        return repondre(res, 200, {
          status: "ok",
          service: nom,
          identity_hash: { configured: typeof identityHashSecret === "string" && identityHashSecret.length > 0 },
        }, entetes);
      }
      // Readiness : la base répond. Distincte de /health à dessein — un
      // orchestrateur doit pouvoir cesser de router du trafic sans tuer le
      // process, et redémarrer un service dont seule la base est absente
      // n'arrange rien.
      if (req.method === "GET" && chemin === "/ready") {
        try {
          await pool.query("select 1");
          return repondre(res, 200, { status: "ready" }, entetes);
        } catch (err) {
          log.error("readiness check failed", { err: String(err) });
          return repondre(res, 503, { status: "unready" }, entetes);
        }
      }
      if (opts.tampon && req.method === "GET" && chemin === "/__recent") {
        return repondre(res, 200, recents, entetes);
      }
      if (req.method === "GET" && chemin === "/v1/traces") {
        return repondre(res, 200, { status: "ok", service: "v1-traces" }, entetes);
      }

      if (req.method === "POST" && estReplay && signaux.has("replay")) {
        return await traiterReplay(req, res, entetes);
      }
      if (req.method === "POST" && chemin.startsWith("/v1/traces") && signaux.has("traces")) {
        return await traiterOtlp(req, res, entetes, false);
      }
      if (req.method === "POST" && chemin.startsWith("/v1/logs") && signaux.has("logs")) {
        return await traiterOtlp(req, res, entetes, true);
      }
      if (req.method === "POST" && chemin === "/v1/sourcemaps" && signaux.has("sourcemaps")) {
        return await traiterSourcemaps(req, res, entetes);
      }

      res.writeHead(404, entetes);
      return res.end();
    } catch (err) {
      // Ici on n'est plus dans un cas client : un corps illisible a déjà été
      // traité en 400 plus haut. Tout ce qui remonte est un incident serveur,
      // et le client PEUT rejouer — sa file de retry le fera.
      log.error("internal error", { err: String(err?.stack ?? err) });
      if (!res.headersSent) return repondre(res, 500, { error: "internal error" }, entetes);
      return res.end();
    }
  }

  return { handler, auth, recents };
}
