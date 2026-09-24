// Adaptateur node:http ↔ Request/Response Web (fetch).
//
// POURQUOI. Les routes de la console (Next) sont écrites contre l'API Web :
// `(request: Request) => Response`. Pour les déplacer sur Railway sans les
// réécrire (piste C : console-api), il faut les servir depuis un serveur
// `node:http`. C'est tout ce que fait ce module, dans les deux sens, sans
// framework : un fichier plutôt qu'Express ou Hono en dépendance.
//
// Ce que l'adaptateur garantit, et qu'une conversion naïve raterait :
//   - LE PLAFOND DE CORPS VAUT AUSSI SANS Content-Length. Une requête en
//     `Transfer-Encoding: chunked` n'annonce pas sa taille : le flux passé à
//     `Request` compte les octets et s'interrompt au premier octet de trop. Le
//     gestionnaire ne peut pas contourner la borne en lisant le corps
//     autrement : il n'a que ce flux.
//   - 413 GAGNE, quoi que le gestionnaire fasse de l'erreur : s'il l'avale et
//     répond 400, l'adaptateur répond quand même 413 — c'est la vraie cause.
//   - `request.signal` avorte quand le CLIENT part : un gestionnaire peut
//     arrêter une requête SQL que personne n'attendra.
//   - les en-têtes répétés survivent (`rawHeaders`, puis `getSetCookie()` au
//     retour) : deux `Set-Cookie` fusionnés par une virgule cassent les cookies.
//   - la contre-pression : la réponse est versée par `pipeline`, qui attend le
//     client lent au lieu d'empiler la réponse en mémoire.
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Plafond de corps par défaut : 1 Mio. Une route qui a besoin de plus le dit. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** Corps au-delà du plafond. Porte son statut HTTP. */
export class BodyTooLargeError extends Error {
  /** @param {number} limite */
  constructor(limite) {
    super(`corps de requête au-delà de ${limite} octets`);
    this.name = "BodyTooLargeError";
    this.status = 413;
    this.limit = limite;
  }
}

/** Requête mal formée côté client (cible illisible, méthode refusée par fetch). */
export class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "BadRequestError";
    this.status = 400;
  }
}

// En-têtes « de saut » (RFC 9110 §7.6.1) : ils décrivent UNE connexion, pas le
// message. Recopiés depuis la Response d'un `fetch` relayé, ils mentiraient
// sur la connexion avec NOTRE client — `transfer-encoding: chunked` recopié
// sur un corps déjà décodé le ferait décoder deux fois.
const EN_TETES_DE_SAUT = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"]);

/** Hôte montrable dans une URL ; sinon « localhost » (l'en-tête Host est fourni par le client). */
function hoteSur(hote) {
  if (typeof hote !== "string") return "localhost";
  return /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(hote) || /^\[[0-9A-Fa-f:.]{2,45}\](:\d{1,5})?$/.test(hote)
    ? hote
    : "localhost";
}

/**
 * Chemin + requête, à partir de la cible HTTP. Une cible `//autre/x` n'est PAS
 * une URL relative au protocole : c'est un chemin qui commence par deux
 * barres, et `new URL("//autre/x", base)` en ferait l'hôte « autre ».
 */
function cible(url) {
  if (typeof url === "string" && url.startsWith("/")) return url;
  try {
    // forme absolue (`GET http://hote/x HTTP/1.1`, légale en HTTP/1.1)
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    throw new BadRequestError("cible de requête illisible");
  }
}

/**
 * Construit la Request, et dit après coup si le corps a dépassé le plafond.
 * @param {import("node:http").IncomingMessage} req
 * @param {{ maxBodyBytes?: number, signal?: AbortSignal, origin?: string }} [options]
 * @returns {{ request: Request, bodyTooLarge: () => boolean, release: () => void }}
 *   `release()` : à appeler une fois la réponse écrite — le reste du corps
 *   non lu est jeté, pour que la connexion keep-alive reste utilisable.
 */
export function createWebRequest(req, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES, signal, origin } = {}) {
  const annonce = req.headers["content-length"];
  if (annonce !== undefined && Number(annonce) > maxBodyBytes) throw new BodyTooLargeError(maxBodyBytes);

  const url = `${origin ?? `http://${hoteSur(req.headers.host)}`}${cible(req.url)}`;

  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const nom = req.rawHeaders[i];
    if (nom.startsWith(":")) continue; // pseudo-en-têtes HTTP/2
    try {
      headers.append(nom, req.rawHeaders[i + 1]);
    } catch {
      /* valeur refusée par fetch (octet nul…) : l'en-tête est ignoré, pas la requête */
    }
  }

  let depasse = false;
  // Corps dont plus personne ne veut (flux annulé, ou réponse déjà partie) :
  // on le lit pour le JETER, sans rien mettre en file. Deux raisons : une
  // requête en pause bloque la connexion keep-alive (la requête suivante ne
  // peut pas être lue), et `enqueue` sur un flux annulé LÈVE — dans un
  // écouteur d'événement, donc en exception non capturée.
  let abandonne = false;
  let body = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    let recus = 0;
    body = new ReadableStream({
      start(controleur) {
        req.on("data", (morceau) => {
          if (depasse) return;
          // On compte AUSSI ce qu'on jette : jeter n'autorise pas à lire sans fin.
          recus += morceau.length;
          if (recus > maxBodyBytes) {
            depasse = true;
            req.pause();
            if (!abandonne) controleur.error(new BodyTooLargeError(maxBodyBytes));
            return;
          }
          if (abandonne) return;
          // Copie : le Buffer peut être une vue sur un tampon partagé de Node.
          controleur.enqueue(new Uint8Array(morceau));
          if (controleur.desiredSize <= 0) req.pause();
        });
        req.on("end", () => {
          if (!depasse && !abandonne) controleur.close();
        });
        req.on("error", (err) => {
          if (!depasse && !abandonne) controleur.error(err);
        });
      },
      pull() {
        if (!depasse && !abandonne) req.resume();
      },
      cancel() {
        abandonne = true;
        if (!depasse) req.resume();
      },
    });
  }

  /** Après la réponse : jeter ce qui reste du corps, borné par le plafond. */
  function release() {
    if (body && !req.complete && !depasse && !abandonne) {
      abandonne = true;
      req.resume();
    }
  }

  let request;
  try {
    request = new Request(url, {
      method: req.method,
      headers,
      body,
      signal,
      // Obligatoire pour un corps en flux sous Node : on ne l'enverra jamais
      // en duplex complet, mais fetch veut que ce soit dit.
      duplex: "half",
    });
  } catch (err) {
    // CONNECT, TRACE, TRACK : fetch refuse de les représenter.
    throw new BadRequestError(`requête non représentable : ${err?.message ?? err}`);
  }
  return { request, bodyTooLarge: () => depasse, release };
}

/**
 * Écrit une Response sur un ServerResponse, en respectant la contre-pression.
 * @param {import("node:http").ServerResponse} res
 * @param {Response} response
 * @param {{ method?: string }} [options]  `HEAD` : en-têtes seuls
 */
export async function writeWebResponse(res, response, { method } = {}) {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;
  for (const [nom, valeur] of response.headers) {
    if (nom === "set-cookie" || EN_TETES_DE_SAUT.has(nom)) continue;
    res.setHeader(nom, valeur);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", cookies);

  if (!response.body || method === "HEAD") {
    await response.body?.cancel().catch(() => {});
    res.end();
    return;
  }
  // `pipeline` annule le flux source si le client part, et détruit la réponse
  // si le flux échoue : ni fuite de lecteur, ni réponse tronquée présentée
  // comme complète.
  await pipeline(Readable.fromWeb(response.body), res).catch(() => {
    /* client parti, ou flux du gestionnaire en échec : la connexion est déjà détruite */
  });
}

/**
 * Réponse JSON minimale. `Connection: close` quand on refuse un corps qu'on
 * n'a pas lu : garder la connexion obligerait à lire (et jeter) ce qu'il reste.
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} objet
 * @param {Record<string, string>} [enTetes]
 */
export function sendJson(res, status, objet, enTetes = {}) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const corps = JSON.stringify(objet);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(corps),
    "cache-control": "no-store",
    ...enTetes,
  });
  res.end(corps);
}

/** 413 : on répond, on ferme, et on laisse filer la fin du corps sans la garder. */
export function sendTooLarge(req, res, limite) {
  sendJson(res, 413, { error: "payload_too_large", limit: limite }, { connection: "close" });
  req.resume();
}

/**
 * Transforme un gestionnaire Web en gestionnaire node:http.
 *
 * @param {(request: Request, ctx: any) => Response | Promise<Response>} gestionnaire
 * @param {{ maxBodyBytes?: number | ((req: import("node:http").IncomingMessage) => number),
 *           log?: import("./log.mjs").Logger, origin?: string }} [options]
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, ctx?: any) => Promise<void>}
 */
export function toNodeHandler(gestionnaire, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES, log, origin } = {}) {
  return async function adaptateur(req, res, ctx = {}) {
    const limite = typeof maxBodyBytes === "function" ? maxBodyBytes(req) : maxBodyBytes;

    // Le client parti AVANT la fin de la réponse : `request.signal` avorte.
    const avorteur = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) avorteur.abort(new Error("client parti avant la réponse"));
    });

    let construite;
    try {
      construite = createWebRequest(req, { maxBodyBytes: limite, signal: avorteur.signal, origin });
    } catch (err) {
      if (err instanceof BodyTooLargeError) return sendTooLarge(req, res, limite);
      return sendJson(res, 400, { error: "bad_request" }, { connection: "close" });
    }

    try {
      let response;
      try {
        response = await gestionnaire(construite.request, ctx);
      } catch (err) {
        if (construite.bodyTooLarge()) return sendTooLarge(req, res, limite);
        log?.error("gestionnaire en échec", { err, method: req.method });
        return sendJson(res, 500, { error: "internal_error" });
      }
      if (construite.bodyTooLarge()) {
        await response?.body?.cancel().catch(() => {});
        return sendTooLarge(req, res, limite);
      }
      if (!(response instanceof Response)) {
        log?.error("le gestionnaire doit rendre une Response", { recu: typeof response });
        return sendJson(res, 500, { error: "internal_error" });
      }
      await writeWebResponse(res, response, { method: req.method });
    } finally {
      // Quelle que soit l'issue : le corps que personne n'a lu est jeté.
      construite.release();
    }
  };
}
