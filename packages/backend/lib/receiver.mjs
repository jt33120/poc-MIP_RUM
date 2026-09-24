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
import { creerGeoip } from "./geoip-db.mjs";
import { creerBordDeConfiance, EDGE_PROTOCOL, ipClient, parseSourceIp } from "../shared/client-ip.mjs";
import { appliquerGeo } from "../shared/geoip.mjs";
import { corsHeaders as buildCors, originsFromRegistry, REPLAY_ALLOW_HEADERS } from "../shared/cors.mjs";
import { createLogger } from "../shared/log.mjs";
import {
  bodyTooLarge,
  lireCorpsBorne,
  MAX_BODY_BYTES,
  MAX_REPLAY_INFLATED_BYTES,
  MAX_SPANS_PER_REQUEST,
} from "../shared/limits.mjs";
import { flattenOtlp, flattenOtlpLogs } from "../shared/otlp.mjs";
import { estIndisponibilite, isTransient, withRetry } from "../shared/retry.mjs";
import { etatIdentite, secureOtlpIdentities } from "./identity-hash.mjs";
import { ErreurEcheance, sousEcheance } from "./privacy-barriere.mjs";

/** Garde-fou replay : > au plafond du SDK (1 Mo gzip par session). */
export const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

/**
 * BUDGET DE REQUÊTE (P2). En P3, la console relaie chaque beacon avec un délai
 * de 8 s ; au-delà, elle répond 503 sans savoir si le collector a écrit. Le
 * collector doit donc TOUJOURS répondre avant : ≈ 4 s au pire, puis un 503
 * explicite avec `retry-after`, qui dit au SDK « rien n'est écrit, rejoue ».
 *
 * C'EST UNE ÉCHÉANCE DURE, calculée à l'entrée de la requête (`handler`), et
 * non un simple plafond des attentes : un COMMIT arrivé à 9 s après un 503
 * rendu à 8 s écrirait le lot deux fois (les logs n'ont pas de clé naturelle).
 *
 *   - gardes (registre, clé, compteur de débit) : sous l'échéance ;
 *   - transaction : chaque étape sous l'échéance, `statement_timeout` /
 *     `transaction_timeout` = budget restant côté serveur, COMMIT jamais envoyé
 *     après l'échéance (`withAppIngestTransaction`, option `echeance`) ;
 *   - verrou d'application : 1,5 s × 2 essais (+ 120 ms de recul) ≈ 3,1 s, au
 *     lieu des 5 s × 3 (≈ 15,6 s) de la stratégie par défaut, que la console
 *     garde pour elle ;
 *   - reprises sur erreur transitoire (`withRetry`) : 2 au plus, recul plafonné
 *     à 400 ms, et AUCUNE reprise qui partirait après l'échéance ;
 *   - au-delà : 503 + `retry-after: 2`, jamais un 500 qui ferait croire à un
 *     incident, jamais une réponse PENDANT l'écriture (le COMMIT parti a
 *     `GRACE_COMMIT_MS` pour rendre son verdict : réponse avant 5 s).
 *
 * Le pool du collector a un `query_timeout` du même ordre (services/collector) :
 * une requête hors budget (source maps, /ready) ne tient pas une connexion 30 s.
 */
export const BUDGET_REQUETE = Object.freeze({
  totalMs: 4_000,
  verrou: Object.freeze({ delaiVerrouMs: 1_500, tentatives: 2 }),
  reprises: 2,
  repriseMaxMs: 400,
});

/**
 * Alias historiques → chemins canoniques, AVANT tout routage.
 *
 * POURQUOI ICI. Le SDK, l'extension et la CI des clients visent aujourd'hui les
 * routes de la console (`/api/ingest/v1/*`, `/api/sourcemaps`). Le jour où l'on
 * pointe un domaine vers le collector, ces chemins doivent y arriver tels
 * quels. La normalisation passe AVANT `estReplay` : sinon un préflight sur
 * `/api/ingest/v1/replay` n'annoncerait pas les en-têtes `x-mip-*`, et le
 * navigateur bloquerait le POST. `/api/sourcemaps` ne mène qu'à la branche
 * JETON : la lecture admin (GET, cookie) reste l'affaire de la console.
 */
export function normaliserChemin(url) {
  const chemin = String(url ?? "/").split("?")[0];
  if (chemin === "/api/sourcemaps") return "/v1/sourcemaps";
  if (chemin.startsWith("/api/ingest/v1/")) return chemin.slice("/api/ingest".length);
  return chemin;
}

/**
 * Plafond de corps du receveur pour un chemin (déjà normalisé ou non). Exporté
 * pour que le service donne au kit une borne EXTÉRIEURE cohérente.
 */
export function plafondCorps(url) {
  const chemin = normaliserChemin(url);
  if (chemin === "/v1/sourcemaps") return LIMITES_UPLOAD.corpsDirect;
  if (chemin.startsWith("/v1/replay")) return MAX_REPLAY_BYTES;
  return MAX_BODY_BYTES;
}

// « Base indisponible » (`estIndisponibilite`) et lecture bornée du corps
// (`lireCorpsBorne`) vivent dans `shared/` : la console les emploie aussi, pour
// que les deux ports rendent le même statut (contrat de parité, P2).

/** En-tête normalisé (Node donne string | string[] | undefined). */
function entete(req, nom) {
  const v = req.headers[nom];
  return Array.isArray(v) ? v[0] : (v ?? null);
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
 *   identityFingerprint?: string, // empreinte déclarée (IDENTITY_HASH_FINGERPRINT) ; écart = identité retirée, /ready refusé
 *   edgeSecrets?: readonly string[], // EDGE_PROXY_SECRET (1 ou 2 valeurs) : bord de confiance du relais
 *   budget?: Partial<typeof BUDGET_REQUETE>,
 *   env?: Record<string, string|undefined>, // injectable pour les tests
 * }} opts
 */
export function creerReceveur(pool, opts = {}) {
  const log = opts.log ?? createLogger("ingest");
  const env = opts.env ?? process.env;
  const rateLimitPerMin = opts.rateLimitPerMin ?? Number(env.RATE_LIMIT_PER_MIN ?? 600);
  const requireApiKey = opts.requireApiKey ?? env.REQUIRE_API_KEY === "true";
  const signaux = new Set(opts.signaux ?? ["traces", "logs", "replay", "sourcemaps"]);
  const aliasSante = opts.aliasSante ?? [];
  const nom = opts.nom ?? "ingest";

  // LE TAMPON /__recent NE DÉMARRE PAS EN PRODUCTION. Il retient les derniers
  // payloads EN CLAIR (URL visitées, attributs, messages d'erreur, identifiants
  // de session) et les rend à quiconque fait un GET, sans authentification. C'est un outil
  // d'assertion E2E ; un `tampon: true` recopié dans un point d'entrée déployé
  // serait une fuite. Refus au démarrage — pas un avertissement qu'on lit trop
  // tard — dès que l'environnement ressemble à un déploiement.
  if (opts.tampon && (env.NODE_ENV === "production" || env.RAILWAY_ENVIRONMENT)) {
    throw new Error(
      "receveur : le tampon /__recent est interdit en production (NODE_ENV=production ou RAILWAY_ENVIRONMENT défini)",
    );
  }

  // Identité : le secret n'est utilisé QUE si son empreinte concorde (ou si
  // aucune n'est déclarée — serveurs de développement, tests). Discordante :
  // `identite.secret` vaut null, et `secureOtlpIdentities` RETIRE l'identité.
  const identite = etatIdentite(
    opts.identityHashSecret ?? env.IDENTITY_HASH_SECRET,
    opts.identityFingerprint ?? null,
  );
  const identityHashSecret = identite.secret ?? undefined;
  if (identite.etat === "discordante") {
    log.error("empreinte du secret d'identité DISCORDANTE — identité retirée, readiness refusée", {
      id_fp: identite.id_fp,
      attendue: identite.attendue,
      remede: "reposer le secret d'origine, ou déclarer la nouvelle empreinte en connaissance de cause (rupture de user_id_hash)",
    });
  }

  const bord = creerBordDeConfiance(opts.edgeSecrets);
  const budget = { ...BUDGET_REQUETE, ...(opts.budget ?? {}) };
  let dernierAvisBord = 0;
  // Ingestion DIFFÉRÉE (migration-v63) : le lot est débarqué dans une table
  // UNLOGGED et écrit plus tard par un travailleur. ÉTEINTE par défaut — la
  // table est vidée par PostgreSQL après un arrêt brutal, donc ce compromis se
  // choisit explicitement. Le gain mesuré est dans docs/BUILD_LOG.md.
  const differe = opts.differe ?? env.INGEST_DEFERRED === "true";

  const auth = createPgAuth(pool, { requireApiKey, rateLimitPerMin, log });
  const limiteurSourcemaps = creerLimiteurUpload();

  // GeoIP OPTIONNEL (P8.7). Deux déclarations, toutes deux inertes par défaut :
  // `GEOIP_IP_SOURCE` dit d'où lire l'adresse du client (rien, sans elle), et la
  // base DB-IP est cherchée dans `packages/backend/data`. Sans l'une ou l'autre, le
  // pays continue d'être estimé d'après le fuseau, exactement comme avant.
  //
  // LE CHARGEMENT NE BLOQUE PAS : `creerGeoip` rend tout de suite un résolveur
  // qui répond `null` tant que la base n'est pas indexée. Les lots reçus pendant
  // ce temps gardent leur pays de fuseau — jamais une attente, jamais un rejet.
  const sourceIp = opts.sourceIp ?? parseSourceIp(env.GEOIP_IP_SOURCE);
  if (sourceIp.mode === "invalide") {
    log.warn("GEOIP_IP_SOURCE ignoré", { valeur: sourceIp.brut, attendu: "none|socket|railway|xff:<n>" });
  }
  const geoip = opts.geoip ?? (sourceIp.mode === "none" || sourceIp.mode === "invalide"
    ? null
    : creerGeoip({ log }));

  // Tampon des derniers payloads : uniquement pour les assertions de bout en
  // bout. Il retient de la donnée en clair, donc il reste éteint par défaut.
  const recents = [];
  const TAILLE_TAMPON = 50;

  async function cors(origin, extra, echeance) {
    let origines = [];
    try {
      // Sous l'échéance : un registre qui ne se charge pas ne doit pas retenir
      // la réponse au-delà du budget (le 503 qui suit part avec le socle).
      origines = originsFromRegistry((await sousEcheance(auth.getAppRegistry(), echeance)).values());
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

  /**
   * Écriture sous budget : verrou resserré, reprises bornées par l'échéance de
   * la requête. Ce qui dépasse remonte au `catch` du gestionnaire, qui en fait
   * un 503 + retry-after.
   */
  function sousBudget(echeance, ecrire, etiquette) {
    return withRetry(() => ecrire({ verrou: { ...budget.verrou, echeance } }), {
      retries: budget.reprises,
      baseMs: 100,
      maxMs: budget.repriseMaxMs,
      shouldRetry: (e) => isTransient(e) && Date.now() + budget.repriseMaxMs < echeance,
      onRetry: (e, n) => log.warn(`db retry (${etiquette})`, { attempt: n, code: e?.code }),
    });
  }

  /**
   * Lit le bord de confiance UNE fois, à l'entrée de la requête, pour TOUTES
   * les routes : les en-têtes `x-mip-edge-*` sont retirés avant que quoi que ce
   * soit d'autre ne lise la requête — aucune branche (logs, replay, source
   * maps, et celles qui viendront) ne peut relire un en-tête de bord non
   * vérifié, ni le secret lui-même.
   */
  function lireBord(req) {
    const lu = bord.lire(req);
    if (lu.mode === "refuse" || lu.forges > 0) {
      // Une ligne par minute au plus : un client qui forge à chaque beacon ne
      // doit pas noyer le journal, et l'opérateur doit quand même le voir —
      // c'est aussi le symptôme d'un secret de relais désaccordé.
      const t = Date.now();
      if (t - dernierAvisBord > 60_000) {
        dernierAvisBord = t;
        log.warn("en-têtes de bord non authentifiés retirés", { mode: lu.mode, entetes: lu.forges });
      }
    }
    return lu;
  }

  /**
   * Provenance géographique d'une requête OTLP, selon le bord de confiance.
   * Relayée : le pays du relais, SANS GeoIP (aucune adresse n'a traversé).
   * Directe : le GeoIP sur l'adresse déclarée, aucun en-tête pays de CDN.
   * Signature fausse : rien (ni GeoIP sur l'adresse d'un relais, ni pays).
   */
  function geoDe(req, lu) {
    if (lu.mode === "relaye") return { geoip: null, cdn: lu.pays };
    if (lu.mode === "refuse") return { geoip: null, cdn: null };
    return { geoip: geoip ? geoip.resoudre(ipClient(req, sourceIp)) : null, cdn: null };
  }

  /**
   * Ce que `/health` dit du receveur, au-delà du statut : jamais un secret,
   * jamais une adresse, jamais un message d'erreur.
   */
  function infosSante() {
    return {
      service: nom,
      edge_protocol: EDGE_PROTOCOL,
      edge_trust: bord.actif,
      identity: identite.etat,
      id_fp: identite.id_fp,
      identity_hash: { configured: identityHashSecret != null },
      // Un opérateur doit pouvoir lire, sans fouiller les variables, si ce
      // déploiement acquitte AVANT d'avoir écrit (table UNLOGGED, migration-v63).
      ingest_deferred: differe,
      // P8.7 : un exploitant doit pouvoir lire, sans fouiller les variables,
      // si le pays est résolu localement et avec QUELLE livraison. `etat`
      // vaut `eteint` par défaut, et c'est un état normal, pas une panne.
      geoip: {
        source_ip: sourceIp.mode,
        etat: geoip?.etat() ?? "eteint",
        version: geoip?.version() ?? null,
        raison: geoip?.raison() ?? null,
      },
    };
  }

  /**
   * Readiness : le registre d'apps a été chargé au moins une fois (sinon la
   * vérification de clé est en fail-open), et l'identité n'est pas discordante.
   */
  async function pret() {
    await auth.getAppRegistry();
    const registre = auth.registryLoaded();
    const identiteOk = identite.etat !== "discordante";
    return { ok: registre && identiteOk, registry_loaded: registre, identity: identite.etat };
  }

  /**
   * Clé d'API (403) puis débit (429), une fois par app du lot — SOUS
   * L'ÉCHÉANCE : registre et compteur sont des requêtes SQL. Échéance perdue :
   * 503 ; la requête abandonnée finit seule, bornée par le `query_timeout` du
   * pool, et n'écrit rien d'autre qu'un coup de compteur de débit.
   */
  function gardes(apiKeys, entetes, echeance) {
    // Échéance déjà passée (corps arrivé lentement) : on ne lance rien.
    if (!(echeance > Date.now())) return Promise.reject(new ErreurEcheance());
    return sousEcheance(gardesSansBorne(apiKeys, entetes), echeance);
  }

  async function gardesSansBorne(apiKeys, entetes) {
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

  async function traiterOtlp(req, res, entetes, estLogs, echeance, lu) {
    if (bodyTooLarge(entete(req, "content-length"))) {
      log.warn("payload too large", { content_length: entete(req, "content-length"), max: MAX_BODY_BYTES });
      return repondre(res, 413, { error: "payload too large" }, entetes);
    }
    const brut = await lireCorpsBorne(req, MAX_BODY_BYTES);
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
      const refus = await gardes(parsed.apiKeys, entetes, echeance);
      if (refus) return repondre(res, refus.statut, refus.corps, refus.entetes);
      const ecrit = await sousBudget(echeance, (o) => writeLogs(pool, parsed.logs, parsed.errors, o), "logs");
      log.info("ingested logs", {
        logs: parsed.logs.length,
        // Exceptions RÉELLEMENT insérées (RETURNING), pas la taille du lot.
        exceptions: ecrit.erreurs.inserees,
        rejected: parsed.rejected,
      });
      return repondre(res, 200, { partialSuccess: {} }, entetes);
    }

    const rows = flattenOtlp(payload, { maxSpans: MAX_SPANS_PER_REQUEST });
    const refus = await gardes(rows.apiKeys, entetes, echeance);
    if (refus) return repondre(res, refus.statut, refus.corps, refus.entetes);

    // Géo SANS JAMAIS STOCKER D'IP. L'adresse ne vit que le temps de cet appel :
    // elle n'est pas écrite, pas journalisée, pas mise en cache, pas attachée à
    // une clef d'erreur. Seuls sortent d'ici un code pays et sa provenance.
    //
    // Ordre : GeoIP local (trafic DIRECT seulement, si une base est chargée et
    // une façade déclarée), sinon le fuseau déjà posé par flattenOtlp, sinon le
    // pays d'un relais AUTHENTIFIÉ (bord de confiance, `geoDe`).
    appliquerGeo(rows.sessions, geoDe(req, lu));

    // Erreurs RÉELLEMENT insérées (RETURNING) ; inconnues tant qu'un lot différé
    // n'est pas drainé.
    let erreursInserees = null;
    if (differe) {
      // Le contrôle de clé et le rate-limit sont DÉJÀ passés au-dessus : on ne
      // débarque que ce qui a le droit d'entrer. Une file derrière une porte
      // ouverte serait un amplificateur, pas un découplage.
      const appId = rows.apiKeys[0]?.app_id ?? rows.sessions[0]?.app_id ?? "inconnu";
      await sousBudget(echeance, (o) => deposerLot(pool, appId, rows, o), "differe");
    } else {
      const ecrit = await sousBudget(echeance, (o) => writeRows(pool, rows, o), "traces");
      erreursInserees = ecrit.erreurs.inserees;
    }
    log.info("ingested", {
      sessions: rows.sessions.length,
      pageviews: rows.pageviews.length,
      metrics: rows.metrics.length,
      errors: rows.errors.length,
      errors_inserted: erreursInserees,
      resources: rows.resources.length,
      longtasks: rows.longtasks.length,
      breadcrumbs: rows.breadcrumbs.length,
      events: rows.events.length,
      spans: rows.spans.length,
      rejected: rows.rejected,
    });
    return repondre(res, 200, { partialSuccess: {} }, entetes);
  }

  async function traiterReplay(req, res, entetes, echeance) {
    const sessionId = entete(req, "x-mip-session");
    const appId = entete(req, "x-mip-app");
    const seq = Number(entete(req, "x-mip-seq"));
    if (!sessionId || !appId || !Number.isInteger(seq) || seq < 0) {
      return repondre(res, 400, { error: "missing x-mip-session/x-mip-app/x-mip-seq" }, entetes);
    }

    // Parité d'auth avec les traces : un endpoint durci et l'autre ouvert
    // serait exactement le trou que la garde commune ferme.
    const refus = await gardes([{ app_id: appId, api_key: entete(req, "x-mip-key") }], entetes, echeance);
    if (refus) return repondre(res, refus.statut, refus.corps, refus.entetes);

    const body = await lireCorpsBorne(req, MAX_REPLAY_BYTES);
    if (body === null || !body.length) {
      return repondre(res, 413, { error: "invalid payload size" }, entetes);
    }

    let eventsCount;
    try {
      // gunzip de contrôle : compte les events ET rejette un corps mal formé,
      // qu'on ne veut pas stocker (il serait illisible au rejeu).
      //
      // BORNE DE SORTIE OBLIGATOIRE. Le plafond d'entrée (2 Mio) ne dit rien de la
      // taille décompressée : un gzip de 2 Mio peut rendre ~2 Gio, décompressés
      // SYNCHRONEMENT ici. Sur un service à deux répliques, cela bloque la boucle
      // d'événements ou tue la réplique sur la mémoire — et les clés d'API sont
      // publiques par construction (elles sont dans le snippet), donc
      // l'authentification n'est pas une barrière. `maxOutputLength` fait lever un
      // RangeError, traité comme un corps invalide.
      const events = JSON.parse(gunzipSync(body, { maxOutputLength: MAX_REPLAY_INFLATED_BYTES }).toString("utf8"));
      eventsCount = Array.isArray(events) ? events.length : 0;
    } catch {
      return repondre(res, 400, { error: "body must be gzipped JSON" }, entetes);
    }

    const issue = await sousBudget(
      echeance,
      (o) => writeReplayChunk(pool, { sessionId, appId, seq, body, eventsCount }, o),
      "replay",
    );
    // Le corps n'est persisté dans AUCUN de ces deux refus : un chunk refusé ne
    // doit pas rester lisible « en attendant ».
    if (issue?.etat === "refus_barriere") {
      log.warn("replay refused (erased session)", { app_id: appId, seq });
      return repondre(res, 410, { error: "session erased" }, entetes);
    }
    if (issue?.etat === "attente_session") {
      log.info("replay deferred (session anchor missing)", { app_id: appId, seq });
      return repondre(res, 425, { error: "session anchor not received yet", retry: true },
        { ...entetes, "retry-after": String(issue.retryAfterS) });
    }
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
    // L'échéance part de l'ENTRÉE de la requête : tout ce qui suit (CORS,
    // lecture du corps, gardes, écriture) la consomme.
    const echeance = Date.now() + budget.totalMs;
    const lu = lireBord(req);
    const origin = entete(req, "origin") ?? "";
    const chemin = normaliserChemin(req.url);
    const estReplay = chemin.startsWith("/v1/replay");
    // Le préflight replay doit annoncer les en-têtes x-mip-* sinon le navigateur
    // bloque le POST cross-origin des clients à clé.
    const entetes = await cors(origin, estReplay ? { allowHeaders: REPLAY_ALLOW_HEADERS } : undefined, echeance);

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, entetes);
        return res.end();
      }
      if (req.method === "GET" && (chemin === "/health" || aliasSante.includes(chemin))) {
        // Sous le service `collector`, le kit intercepte /health et /ready
        // AVANT ce gestionnaire et y reprend `infosSante()` et `pret()` ; ces
        // deux branches servent les serveurs de développement.
        return repondre(res, 200, { status: "ok", ...infosSante() }, entetes);
      }
      // Readiness : la base répond ET le registre est chargé. Distincte de
      // /health à dessein — un orchestrateur doit pouvoir cesser de router du
      // trafic sans tuer le process, et redémarrer un service dont seule la
      // base est absente n'arrange rien.
      if (req.method === "GET" && chemin === "/ready") {
        try {
          await pool.query("select 1");
          const verdict = await pret();
          return repondre(res, verdict.ok ? 200 : 503, { ...verdict, status: verdict.ok ? "ready" : "unready" }, entetes);
        } catch (err) {
          log.error("readiness check failed", { err: String(err) });
          return repondre(res, 503, { status: "unready" }, entetes);
        }
      }
      if (opts.tampon && req.method === "GET" && chemin === "/__recent") {
        return repondre(res, 200, recents, entetes);
      }
      // Parité avec les routes Vercel : un GET de diagnostic répond 200 sur
      // les deux signaux OTLP (un outil de vérification d'intégration s'en sert).
      if (req.method === "GET" && chemin === "/v1/traces") {
        return repondre(res, 200, { status: "ok", service: "v1-traces" }, entetes);
      }
      if (req.method === "GET" && chemin === "/v1/logs") {
        return repondre(res, 200, { status: "ok", service: "v1-logs" }, entetes);
      }

      if (req.method === "POST" && estReplay && signaux.has("replay")) {
        return await traiterReplay(req, res, entetes, echeance);
      }
      if (req.method === "POST" && chemin.startsWith("/v1/traces") && signaux.has("traces")) {
        return await traiterOtlp(req, res, entetes, false, echeance, lu);
      }
      if (req.method === "POST" && chemin.startsWith("/v1/logs") && signaux.has("logs")) {
        return await traiterOtlp(req, res, entetes, true, echeance, lu);
      }
      if (req.method === "POST" && chemin === "/v1/sourcemaps" && signaux.has("sourcemaps")) {
        return await traiterSourcemaps(req, res, entetes);
      }

      res.writeHead(404, entetes);
      return res.end();
    } catch (err) {
      // Deux refus IDENTIFIÉS avant le 500 générique (P8.1).
      //
      // Portée d'application : la demande revendique un identifiant stocké chez
      // un autre locataire. La rejouer donnerait le même résultat — 409, et le
      // SDK la jette au lieu de la faire tourner dans sa file.
      if (err?.name === "ErreurPorteeApp" && !res.headersSent) {
        log.warn("rejected: app scope", { reason: String(err.message) });
        return repondre(res, 409, { error: String(err.message) }, entetes);
      }
      // Attente de verrou épuisée : rien n'a été écrit, et rejouer a toutes les
      // chances de réussir. 503 + Retry-After, pas un 500 qui ferait croire à un
      // incident.
      if (err?.name === "ErreurVerrouIngestion" && !res.headersSent) {
        log.warn("busy: app ingest lock", { apps: err.apps });
        return repondre(res, 503, { error: "ingestion busy, retry", retry: true },
          { ...entetes, "retry-after": "2" });
      }
      // Échéance de la requête atteinte (gardes, connexion, transaction) : la
      // transaction a été annulée — connexion détruite ou coupée par le serveur.
      if (err instanceof ErreurEcheance && !res.headersSent) {
        if (err.issue === "inconnue") {
          // Le seul cas où « rien n'est écrit » n'est pas garanti : un COMMIT
          // parti avant l'échéance, sans verdict après la grâce. Rare, et à VOIR
          // — d'où l'erreur au journal et un corps qui le dit.
          log.error("deadline: commit outcome unknown, replay may duplicate", { reason: String(err.message) });
          return repondre(res, 503, { error: "ingestion outcome unknown, retry", retry: true },
            { ...entetes, "retry-after": "2" });
        }
        log.warn("busy: request deadline reached", { budget_ms: budget.totalMs });
        return repondre(res, 503, { error: "ingestion deadline exceeded, retry", retry: true },
          { ...entetes, "retry-after": "2" });
      }
      // Base indisponible au-delà du budget (reprises épuisées ou échéance
      // atteinte) : rien n'a été écrit — la transaction a été annulée —, et
      // rejouer plus tard réussira. 503 + Retry-After, comme le verrou.
      if (estIndisponibilite(err) && !res.headersSent) {
        log.warn("busy: database unavailable within budget", { code: err?.code ?? null });
        return repondre(res, 503, { error: "ingestion unavailable, retry", retry: true },
          { ...entetes, "retry-after": "2" });
      }
      // Ici on n'est plus dans un cas client : un corps illisible a déjà été
      // traité en 400 plus haut. Tout ce qui remonte est un incident serveur,
      // et le client PEUT rejouer — sa file de retry le fera.
      log.error("internal error", { err: String(err?.stack ?? err) });
      if (!res.headersSent) return repondre(res, 500, { error: "internal error" }, entetes);
      return res.end();
    }
  }

  return { handler, auth, recents, infosSante, pret, identite };
}
