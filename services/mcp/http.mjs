// Point d'entrée DISTANT du serveur MCP : Streamable HTTP, déployé sur Railway.
//
// L'AUTHENTIFICATION EST LE SUJET DE CE FICHIER.
//
// Un serveur MCP distant est une URL publique. S'il portait son propre jeton
// d'API, quiconque trouve l'URL lirait les données RUM de TOUS les clients —
// l'authentification de l'API v1 serait contournée par un service qui, lui,
// est authentifié. Ce serveur ne détient donc AUCUN jeton : il relaie celui de
// l'appelant.
//
//   client MCP ──Authorization: Bearer <jeton>──▶ ce service ──même jeton──▶ API v1
//
// Trois conséquences, toutes voulues :
//   · le cloisonnement par app reste celui de l'API (un jeton partenaire scopé
//     à son app ne voit que la sienne, ici comme ailleurs) ;
//   · le débit est compté par l'API, par principal, comme pour n'importe quel
//     autre appelant ;
//   · il n'y a rien à voler ici. Le service ne stocke aucun secret et n'a pas
//     d'accès à la base : pas de DATABASE_URL, pas de `pg` dans l'image.
//
// SANS SESSION (`sessionIdGenerator: undefined`). Un état en mémoire ne
// survivrait ni à un redéploiement ni à une seconde instance ; le mode sans
// session rend chaque requête autonome, donc scalable et redémarrable.
import http from "node:http";
import { creerClient, origineApi } from "@mip/mcp-tools/lib/client.mjs";
import { StreamableHTTPServerTransport } from "@mip/mcp-tools/lib/transports.mjs";
import { NOM, VERSION, creerServeur } from "@mip/mcp-tools/serveur.mjs";

const PORT = Number(process.env.PORT ?? 8080);
// L'API v1 : le service `api` par le réseau privé si `MIP_API_HOST` est posé,
// sinon la console (`MIP_CONSOLE_URL`). Règles et raisons : `origineApi`.
const ORIGINE = origineApi(process.env);
const CHEMIN = process.env.MCP_PATH ?? "/mcp";
/** Taille maximale d'un corps JSON-RPC. Une requête MCP fait quelques kilo-octets. */
const MAX_CORPS = 1024 * 1024;

if ("erreur" in ORIGINE) {
  console.error(
    JSON.stringify({
      service: "mcp",
      level: "error",
      msg: `${ORIGINE.erreur} — le serveur MCP refuse de démarrer`,
    }),
  );
  process.exit(2);
}
const BASE = ORIGINE.base;

function json(res, statut, corps, entetes = {}) {
  const texte = JSON.stringify(corps);
  res.writeHead(statut, { "content-type": "application/json", ...entetes });
  res.end(texte);
}

/** Erreur JSON-RPC 2.0 sans identifiant de requête (la requête n'a pas été lue). */
function refus(res, statut, message, entetes) {
  json(res, statut, { jsonrpc: "2.0", error: { code: -32001, message }, id: null }, entetes);
}

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let taille = 0;
    const morceaux = [];
    req.on("data", (c) => {
      taille += c.length;
      if (taille > MAX_CORPS) {
        reject(new Error("corps trop volumineux"));
        req.destroy();
        return;
      }
      morceaux.push(c);
    });
    req.on("end", () => {
      const texte = Buffer.concat(morceaux).toString("utf8");
      if (!texte) return resolve(undefined);
      try {
        resolve(JSON.parse(texte));
      } catch {
        reject(new Error("JSON invalide"));
      }
    });
    req.on("error", reject);
  });
}

const serveurHttp = http.createServer(async (req, res) => {
  const chemin = (req.url ?? "/").split("?")[0];

  // Sondes de l'hébergeur. Publiques et muettes : elles ne disent rien de plus
  // que « le process vit ». Le serveur MCP n'ayant pas de dépendance à chaud
  // (pas de base), vivant et prêt sont ici la même chose.
  if (chemin === "/health" || chemin === "/") {
    return json(res, 200, { status: "ok", service: "mcp", name: NOM, version: VERSION, mcp: CHEMIN });
  }

  if (chemin !== CHEMIN) {
    res.writeHead(404);
    return res.end();
  }

  // Le GET du transport sert à ouvrir un flux serveur→client. Sans session, il
  // n'y a rien à pousser : on répond 405 plutôt que de laisser un client
  // attendre indéfiniment un flux qui n'arrivera pas.
  if (req.method !== "POST") {
    return refus(res, 405, "Ce serveur MCP est sans session : seul POST est accepté sur cette route.", {
      allow: "POST",
    });
  }

  const autorisation = req.headers.authorization;
  if (!autorisation || !/^Bearer\s+\S/i.test(autorisation)) {
    return refus(
      res,
      401,
      "Jeton requis : en-tête « Authorization: Bearer <jeton> ». Ce serveur ne détient aucun jeton, il relaie celui de l'appelant.",
      { "www-authenticate": 'Bearer realm="mip-rum-mcp"' },
    );
  }
  const jeton = autorisation.replace(/^Bearer\s+/i, "").trim();

  let corps;
  try {
    corps = await lireCorps(req);
  } catch (e) {
    return refus(res, 400, `Corps de requête illisible : ${e.message}.`);
  }

  // UN serveur et UN transport par requête. C'est le prix du mode sans session,
  // et il est faible (aucune E/S au montage) ; en échange, deux appelants ne
  // peuvent pas se croiser — ni sur leur jeton, ni sur leur état.
  const serveurMcp = creerServeur({ clientPour: () => creerClient({ base: BASE, jeton }) });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Réponses JSON simples plutôt qu'un flux SSE : plus simple à traverser pour
    // les proxys, et il n'y a rien à streamer — un appel d'outil est un aller-retour.
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    serveurMcp.close().catch(() => {});
  });

  try {
    await serveurMcp.connect(transport);
    await transport.handleRequest(req, res, corps);
  } catch (e) {
    console.error(JSON.stringify({ service: "mcp", level: "error", msg: "requête en échec", err: String(e?.stack ?? e) }));
    if (!res.headersSent) refus(res, 500, "Erreur interne du serveur MCP.");
  }
});

serveurHttp.listen(PORT, () => {
  console.log(
    JSON.stringify({
      service: "mcp",
      level: "info",
      msg: "serveur MCP démarré",
      port: PORT,
      chemin: CHEMIN,
      api: `${String(BASE).replace(/\/+$/, "")}/api/v1`,
      via: ORIGINE.via,
    }),
  );
});

function arreter(signal) {
  console.log(JSON.stringify({ service: "mcp", level: "info", msg: "arrêt", signal }));
  serveurHttp.close(() => process.exit(0));
  // Filet : un client qui garde sa connexion ouverte ne doit pas retenir le
  // process indéfiniment pendant un redéploiement.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => arreter("SIGTERM"));
process.on("SIGINT", () => arreter("SIGINT"));
