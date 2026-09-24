// Serveur HTTP d'un service : les sondes, les délais, le plafond de corps et le
// journal d'accès, pour que le point d'entrée n'ait plus qu'à brancher ses routes.
//
// LES TROIS SONDES, ET CE QUE CHACUNE VEUT DIRE :
//
//   /health   processus vivant ET base joignable (`select 1`, borné). C'est LA
//             sonde Railway : un déploiement dont la base est injoignable ne
//             doit pas remplacer celui qui marche. Publique, et muette sur la
//             panne : un statut, jamais un hôte ni un message d'erreur. Un
//             service peut y AJOUTER une description statique de lui-même
//             (`details` : nom, protocole, empreinte d'un secret — jamais le
//             secret), ce qu'un opérateur doit lire sans fouiller les variables.
//   /ready    503 dès le SIGTERM (drainage), sinon le verdict de `ready()` :
//             fraîcheur, backlog. POUR LA SUPERVISION SEULEMENT, jamais pour
//             Railway : une sonde de fraîcheur bloquerait le déploiement du
//             scheduler, dont le bail est encore tenu par l'ancienne instance.
//   /metrics  texte Prometheus.
//
//   /ready et /metrics exigent `Authorization: Bearer <METRICS_TOKEN>`. Sans
//   jeton configuré, ou avec un mauvais, ils répondent 404 — pas 401 : un 401
//   confirme à un curieux que la route existe. Le collector est public ; son
//   backlog et ses compteurs ne regardent que nous. Jamais de jeton en
//   paramètre d'URL : il finirait dans les journaux des proxys.
//
// LES DÉLAIS SERVEUR (défauts de Node entre parenthèses) :
//   - headersTimeout 10 s (60 s) : un client qui envoie ses en-têtes octet par
//     octet (slowloris) tient une connexion ; 10 s suffisent à n'importe qui.
//   - requestTimeout 30 s (300 s) : la requête ENTIÈRE, corps compris. Une source
//     map de 15 Mio à 1 Mo/s passe ; un corps qui n'arrive jamais, non.
//   - keepAliveTimeout 65 s (5 s) : PLUS LONG que l'inactivité tolérée par le
//     proxy devant nous. Si Node ferme une connexion au repos au moment où le
//     proxy la réutilise, le client reçoit un 502 sans que rien ne soit cassé.
//     Railway ne documente pas son délai ; 65 s couvre les 60 s usuels.
//   - connectionsCheckingInterval 2 s (30 s) : la fréquence à laquelle Node
//     VÉRIFIE les deux premiers délais. À 30 s, un headersTimeout de 10 s en
//     vaut en réalité jusqu'à 40.
//
// LE JOURNAL D'ACCÈS : méthode, chemin SANS la query (elle porte parfois un
// jeton ou un identifiant), statut, durée, request_id. JAMAIS d'adresse IP —
// ni `socket.remoteAddress`, ni `x-forwarded-for` : c'est une donnée
// personnelle, et le collector en voit passer des milliers. Les sondes sont
// journalisées en `debug` : une supervision qui interroge /health chaque
// minute noierait le reste.
//
// Le `request_id` vient de `X-Railway-Request-Id` (posé par le proxy Railway,
// donc corrélable avec ses journaux), sinon d'un `X-Request-Id` bien formé,
// sinon d'un UUID ; il est renvoyé en `X-Request-Id`, et TOUTE ligne de journal
// émise pendant la requête le porte (`context.mjs`).
import http from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { withContext } from "./context.mjs";
import { ping } from "./pg.mjs";
import { PROMETHEUS_CONTENT_TYPE, registerProcessMetrics } from "./metrics.mjs";
import { BodyTooLargeError, DEFAULT_MAX_BODY_BYTES, sendJson, sendTooLarge, toNodeHandler } from "./web.mjs";

export { DEFAULT_MAX_BODY_BYTES } from "./web.mjs";

export const DEFAULT_TIMEOUTS = Object.freeze({
  headersTimeout: 10_000,
  requestTimeout: 30_000,
  keepAliveTimeout: 65_000,
  connectionsCheckingInterval: 2_000,
});

const SONDES = new Set(["/health", "/ready", "/metrics"]);
const METHODES_CONNUES = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const ID_REQUETE = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Lit le corps d'une requête node:http, borné. Pour les gestionnaires
 * `(req, res, ctx)` : `await ctx.readBody()` applique le plafond du service.
 * @param {import("node:http").IncomingMessage} req
 * @param {{ maxBodyBytes?: number }} [options]
 * @returns {Promise<Buffer>}
 */
export function readBody(req, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  return new Promise((resoudre, rejeter) => {
    const annonce = req.headers["content-length"];
    if (annonce !== undefined && Number(annonce) > maxBodyBytes) {
      rejeter(new BodyTooLargeError(maxBodyBytes));
      return;
    }
    const morceaux = [];
    let total = 0;
    const nettoyer = () => {
      req.off("data", surDonnees);
      req.off("end", surFin);
      req.off("error", surErreur);
    };
    function surDonnees(morceau) {
      total += morceau.length;
      if (total > maxBodyBytes) {
        nettoyer();
        req.pause();
        rejeter(new BodyTooLargeError(maxBodyBytes));
        return;
      }
      morceaux.push(morceau);
    }
    function surFin() {
      nettoyer();
      resoudre(Buffer.concat(morceaux, total));
    }
    function surErreur(err) {
      nettoyer();
      rejeter(err);
    }
    req.on("data", surDonnees);
    req.on("end", surFin);
    req.on("error", surErreur);
  });
}

/** Chemin seul, sans query ni fragment ; tronqué pour le journal. */
function cheminSeul(url) {
  const brut = String(url ?? "/");
  const fin = brut.search(/[?#]/);
  return fin === -1 ? brut : brut.slice(0, fin);
}

function idRequete(req) {
  for (const nom of ["x-railway-request-id", "x-request-id"]) {
    const v = req.headers[nom];
    if (typeof v === "string" && ID_REQUETE.test(v)) return v;
  }
  return randomUUID();
}

/** Promesse bornée : rejette après `ms`, sans laisser de rejet orphelin. */
function avecDelai(promesse, ms, message) {
  const p = Promise.resolve(promesse);
  p.catch(() => {});
  let minuterie;
  const delai = new Promise((_, rejeter) => {
    minuterie = setTimeout(() => rejeter(new Error(message)), ms);
  });
  return Promise.race([p, delai]).finally(() => clearTimeout(minuterie));
}

/**
 * @typedef {object} ServiceOptions
 * @property {string} name                      nom du service (journal, métriques)
 * @property {import("./log.mjs").Logger} log
 * @property {number} [port]                    défaut 8080 ; 0 = port libre (tests)
 * @property {string} [host]                    défaut : toutes les interfaces, IPv6 comprise
 *   (le réseau privé Railway est en IPv6)
 * @property {(req, res, ctx) => unknown} [handler]   routes du service, style node:http
 * @property {(request: Request, ctx) => Response | Promise<Response>} [fetch]
 *   routes du service, style Web (adaptées par web.mjs) — l'un OU l'autre ;
 *   ni l'un ni l'autre : un service sans route (scheduler), sondes seules
 * @property {{ query: Function }} [pool]       /health vérifie la base par `ping`
 * @property {() => unknown} [health]           remplace le `ping` du pool
 * @property {() => Record<string, unknown>} [details]  champs ajoutés au corps de
 *   /health (200 comme 503) ; `status` reste celui du kit. Rien de secret, rien
 *   qui dépende de la panne : la sonde est publique.
 * @property {() => ({ ok: boolean } & Record<string, unknown>) | Promise<any>} [ready]
 * @property {ReturnType<import("./metrics.mjs").createMetrics>} [metrics]
 * @property {string} [metricsToken]            sans lui, /ready et /metrics = 404
 * @property {number | ((req) => number)} [maxBodyBytes]  défaut 1 Mio ; une fonction
 *   donne une borne par route (les source maps en veulent plus)
 * @property {Partial<typeof DEFAULT_TIMEOUTS>} [timeouts]
 * @property {number} [healthTimeoutMs]         défaut 2 s
 * @property {ReturnType<import("./lifecycle.mjs").installLifecycle>} [lifecycle]
 *   si fourni : /ready suit le drainage, et la fermeture du serveur est
 *   enregistrée en phase de drainage
 */

/**
 * Démarre le serveur HTTP d'un service.
 * @param {ServiceOptions} options
 * @returns {{ server: import("node:http").Server, listening: Promise<{ port: number }>,
 *             close: (o?: { signal?: AbortSignal }) => Promise<void> }}
 */
export function startService(options) {
  const {
    name,
    log,
    port = 8080,
    host,
    handler,
    fetch: gestionnaireWeb,
    pool,
    health,
    details,
    ready,
    metrics,
    metricsToken,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    healthTimeoutMs = 2_000,
    lifecycle,
  } = options ?? {};
  if (!name) throw new TypeError("startService : name obligatoire");
  if (!log) throw new TypeError("startService : log obligatoire");
  if (handler && gestionnaireWeb) throw new TypeError("startService : handler OU fetch, pas les deux");

  const delais = { ...DEFAULT_TIMEOUTS, ...(options.timeouts ?? {}) };
  if (delais.headersTimeout > delais.requestTimeout) {
    throw new RangeError("startService : headersTimeout doit rester ≤ requestTimeout");
  }

  const limiteDe = (req) => (typeof maxBodyBytes === "function" ? maxBodyBytes(req) : maxBodyBytes);
  const routes = gestionnaireWeb ? toNodeHandler(gestionnaireWeb, { maxBodyBytes: limiteDe, log }) : handler;

  // --- Jeton de supervision ------------------------------------------------------
  // Comparaison à temps constant, sur des empreintes de même longueur : ni la
  // durée ni la longueur ne renseignent sur le jeton.
  const empreinte = (s) => createHash("sha256").update(String(s)).digest();
  const jetonAttendu = metricsToken ? empreinte(metricsToken) : null;
  function jetonValide(req) {
    if (!jetonAttendu) return false;
    const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? "");
    return Boolean(m) && timingSafeEqual(empreinte(m[1]), jetonAttendu);
  }

  // --- /health ----------------------------------------------------------------------
  const verifierSante = health ?? (pool ? () => ping(pool, { timeoutMs: healthTimeoutMs }) : () => {});
  let santeEnCours = null;
  let dernierEtatSain = true;
  /** Une vérification à la fois : cent sondes simultanées font UN `select 1`. */
  function sante() {
    santeEnCours ??= avecDelai(
      Promise.resolve().then(verifierSante),
      healthTimeoutMs + 500,
      `santé : pas de verdict en ${healthTimeoutMs + 500} ms`,
    ).then(
      () => {
        if (!dernierEtatSain) log.info("santé rétablie");
        dernierEtatSain = true;
        return true;
      },
      (err) => {
        // Journalisé au CHANGEMENT d'état seulement : une base coupée une heure
        // ne doit pas écrire une ligne par sonde.
        if (dernierEtatSain) log.warn("santé dégradée : base injoignable", { err });
        dernierEtatSain = false;
        return false;
      },
    ).finally(() => {
      santeEnCours = null;
    });
    return santeEnCours;
  }

  /** Réponses en cours : au drainage, on leur pose `Connection: close`. */
  const enVol = new Set();

  // --- Métriques HTTP -------------------------------------------------------------
  let requetes = null;
  let duree = null;
  if (metrics) {
    registerProcessMetrics(metrics);
    requetes = metrics.counter("http_requests_total", "Requêtes servies (sondes exclues).", { labels: ["method", "code"] });
    duree = metrics.counter("http_request_duration_seconds_total", "Temps passé à servir les requêtes (sondes exclues).");
    metrics.gauge("http_requests_in_flight", "Requêtes en cours.", { collect: () => enVol.size });
  }

  // --- Sondes -----------------------------------------------------------------------
  async function servirSonde(chemin, req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "method_not_allowed" }, { allow: "GET, HEAD" });
    }
    if (chemin === "/health") {
      const ok = await sante();
      let extra = {};
      try {
        extra = details?.() ?? {};
      } catch (err) {
        // Une description qui lève ne doit pas rendre malade une sonde saine.
        log.warn("détails de /health en échec", { err });
      }
      return sendJson(res, ok ? 200 : 503, { ...extra, status: ok ? "ok" : "unavailable" });
    }
    if (!jetonValide(req)) return sendJson(res, 404, { error: "not_found" });
    if (chemin === "/ready") {
      if (lifecycle?.draining) return sendJson(res, 503, { status: "draining" });
      if (!ready) return sendJson(res, 200, { status: "ready" });
      try {
        const verdict = (await avecDelai(ready(), 5_000, "ready : pas de verdict en 5 s")) ?? {};
        const ok = verdict.ok !== false;
        return sendJson(res, ok ? 200 : 503, { ...verdict, status: ok ? "ready" : "not_ready" });
      } catch (err) {
        log.warn("ready en échec", { err });
        return sendJson(res, 503, { status: "not_ready" });
      }
    }
    // /metrics
    if (!metrics) return sendJson(res, 404, { error: "not_found" });
    const texte = await metrics.render();
    res.writeHead(200, { "content-type": PROMETHEUS_CONTENT_TYPE, "cache-control": "no-store" });
    res.end(texte);
  }

  // --- Requêtes ---------------------------------------------------------------------
  function traiter(req, res) {
    const debut = performance.now();
    const requestId = idRequete(req);
    const chemin = cheminSeul(req.url);
    const sonde = SONDES.has(chemin);
    res.setHeader("x-request-id", requestId);
    if (lifecycle?.draining) res.setHeader("connection", "close");
    enVol.add(res);

    res.on("close", () => {
      enVol.delete(res);
      const ms = Math.round((performance.now() - debut) * 10) / 10;
      const champs = { method: req.method, path: chemin.slice(0, 256), status: res.statusCode, ms, request_id: requestId };
      if (!res.writableFinished) champs.interrompue = true; // client parti avant la fin
      if (sonde) log.debug("requête", champs);
      else if (res.statusCode >= 500) log.warn("requête", champs);
      else log.info("requête", champs);
      if (!sonde && requetes) {
        const methode = METHODES_CONNUES.has(req.method) ? req.method : "OTHER";
        requetes.inc({ method: methode, code: String(res.statusCode) });
        duree.inc(ms / 1000);
      }
    });

    return withContext({ request_id: requestId }, async () => {
      try {
        if (sonde) return await servirSonde(chemin, req, res);
        if (!routes) return sendJson(res, 404, { error: "not_found" });
        const limite = limiteDe(req);
        const annonce = req.headers["content-length"];
        if (annonce !== undefined && Number(annonce) > limite) return sendTooLarge(req, res, limite);
        const ctx = {
          requestId,
          log,
          // Une route peut ABAISSER la borne, pas la relever : le contrôle sur
          // Content-Length ci-dessus a déjà appliqué celle du service. Pour une
          // route qui a besoin de plus, `maxBodyBytes` du service est une fonction.
          readBody: (o) => readBody(req, { maxBodyBytes: Math.min(o?.maxBodyBytes ?? limite, limite) }),
        };
        await routes(req, res, ctx);
      } catch (err) {
        if (err instanceof BodyTooLargeError) return sendTooLarge(req, res, err.limit);
        log.error("requête en échec", { err, method: req.method, path: chemin.slice(0, 256) });
        // Au client : un identifiant à citer, jamais la pile.
        sendJson(res, 500, { error: "internal_error", request_id: requestId });
      }
    });
  }

  const serveur = http.createServer(
    {
      headersTimeout: delais.headersTimeout,
      requestTimeout: delais.requestTimeout,
      connectionsCheckingInterval: delais.connectionsCheckingInterval,
    },
    traiter,
  );
  // Propriété et non option : l'option du constructeur n'existe pas sur toutes
  // les versions de Node que nous faisons tourner (images en 22, CI en 26).
  serveur.keepAliveTimeout = delais.keepAliveTimeout;

  const listening = new Promise((resoudre, rejeter) => {
    serveur.once("error", rejeter);
    serveur.listen(port, host, () => {
      serveur.off("error", rejeter);
      const adresse = serveur.address();
      const portReel = typeof adresse === "object" && adresse ? adresse.port : Number(port);
      log.info("à l'écoute", { service: name, port: portReel, ...delais });
      resoudre({ port: portReel });
    });
  });
  listening.catch((err) => log.error("écoute impossible", { service: name, port, err }));

  let fermeture = null;
  /**
   * Cesse d'accepter, laisse finir les requêtes en vol. `signal` avorté (délai
   * de drainage atteint) : on coupe ce qui reste.
   */
  function close({ signal } = {}) {
    // Après l'écoute, pas avant : un SIGTERM reçu pendant `listen` fermerait un
    // serveur pas encore ouvert… qui s'ouvrirait juste après, et tiendrait le
    // processus en vie jusqu'à la sortie forcée.
    fermeture ??= listening.then(
      () => fermerServeur(signal),
      () => undefined, // jamais ouvert : rien à fermer
    );
    return fermeture;
  }

  function fermerServeur(signal) {
    return new Promise((resoudre) => {
      for (const res of enVol) if (!res.headersSent) res.setHeader("connection", "close");
      serveur.close(() => resoudre());
      // Une connexion keep-alive qui finit sa réponse redevient inactive : on la
      // ferme au fil de l'eau, sans attendre les 65 s de keepAliveTimeout.
      serveur.closeIdleConnections();
      const balai = setInterval(() => serveur.closeIdleConnections(), 100);
      balai.unref();
      serveur.once("close", () => clearInterval(balai));
      if (signal?.aborted) serveur.closeAllConnections();
      else signal?.addEventListener("abort", () => serveur.closeAllConnections(), { once: true });
    });
  }

  lifecycle?.onDrain(`http:${name}`, ({ signal }) => close({ signal }));

  return { server: serveur, listening, close };
}
