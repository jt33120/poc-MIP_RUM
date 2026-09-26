// Client HTTP vers l'API v1 de la console. C'est le SEUL point du serveur MCP
// qui sort sur le réseau.
//
// POURQUOI PASSER PAR L'API ET NON PAR POSTGRES. Le serveur MCP pourrait lire la
// base directement — c'est plus court d'un saut réseau. Il ne le fait pas, pour
// deux raisons qui pèsent plus que la latence :
//
//   1. Le CLOISONNEMENT est écrit dans l'API, pas ici. `parseApiFilters` résout le
//      périmètre du jeton (une app hors périmètre est refusée, pas rabattue),
//      `handle` applique le débit et l'enveloppe. Réimplémenter ça côté MCP, ce
//      serait une deuxième version de la règle d'accès — et deux versions
//      finissent par diverger. Le dépôt en a déjà fait les frais avec trois
//      receveurs d'ingestion.
//   2. Ce service est EXPOSÉ À UNE IA. Sans identifiants de base, une injection
//      de prompt réussie ne donne accès qu'à ce que le jeton de l'appelant
//      permet déjà de lire. Avec DATABASE_URL, elle donnerait la base entière.
//
// Le jeton n'apparaît JAMAIS dans un message d'erreur : les erreurs remontent à
// l'IA, qui peut les répéter dans sa réponse.

/** Au-delà, on rend la main : une IA qui attend est une IA qui ne dit rien. */
export const DELAI_MS = 20_000;

/** Port du service `api` sur le réseau privé, s'il n'est pas précisé. */
export const PORT_API_DEFAUT = 8080;

/**
 * OÙ EST L'API v1, et par quel chemin le serveur MCP distant la joint.
 *
 * Deux formes ; la première l'emporte :
 *
 *   · `MIP_API_HOST` (+ `MIP_API_PORT`, 8080 par défaut) : le service `api`
 *     (P4) par le RÉSEAU PRIVÉ Railway — `api.railway.internal`, la référence
 *     `RAILWAY_PRIVATE_DOMAIN` du service. En HTTP clair : Railway n'offre pas
 *     de TLS entre services, et le trafic ne quitte pas le réseau du projet.
 *     C'est pourquoi l'hôte DOIT être privé — `*.railway.internal`, un nom sans
 *     point (un service compose), ou `localhost`. Un hôte public en HTTP clair
 *     ferait voyager le jeton de l'appelant en clair sur Internet : refusé au
 *     démarrage, pas découvert en production.
 *   · `MIP_CONSOLE_URL` : l'API v1 de la console Vercel, comme avant P4. Reste
 *     le repli tant que le service `api` n'est pas déployé.
 *
 * Le chemin privé retire un saut public (Railway → Vercel → Neon devient
 * Railway → Neon) et ne dépend plus de la console pour qu'une IA lise.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ base: string, via: "reseau-prive" | "console" } | { erreur: string }}
 */
export function origineApi(env) {
  const hote = env.MIP_API_HOST?.trim();
  if (hote) {
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(hote)) {
      return { erreur: "MIP_API_HOST : nom d'hôte invalide" };
    }
    const prive = hote.endsWith(".railway.internal") || !hote.includes(".") || hote === "localhost";
    if (!prive) {
      return {
        erreur: `MIP_API_HOST : « ${hote} » n'est pas un hôte privé (*.railway.internal) — le jeton de l'appelant y partirait en clair`,
      };
    }
    const brut = env.MIP_API_PORT?.trim() || String(PORT_API_DEFAUT);
    const port = /^\d{1,5}$/.test(brut) ? Number(brut) : Number.NaN;
    if (!(port >= 1 && port <= 65535)) return { erreur: `MIP_API_PORT : port invalide (${brut})` };
    return { base: `http://${hote}:${port}`, via: "reseau-prive" };
  }
  const console_ = env.MIP_CONSOLE_URL?.trim();
  if (console_) return { base: console_, via: "console" };
  return { erreur: "ni MIP_API_HOST (service api, réseau privé) ni MIP_CONSOLE_URL (console)" };
}

/** Erreur portant un statut HTTP et un message déjà rédigé pour l'appelant. */
export class ErreurApi extends Error {
  constructor(message, statut) {
    super(message);
    this.name = "ErreurApi";
    this.statut = statut;
  }
}

/**
 * Messages d'erreur ACTIONNABLES : chacun dit quoi faire, pas seulement ce qui
 * a échoué. Une IA à qui on répond « 401 » relance la même requête ; une IA à
 * qui on dit « le jeton est refusé, ce n'est pas un problème de paramètre »
 * arrête d'essayer et le signale à l'utilisateur.
 */
function messagePour(statut, corps) {
  const detail = typeof corps?.error === "string" ? ` (${corps.error})` : "";
  const code = typeof corps?.code === "string" ? corps.code : null;
  switch (statut) {
    case 400:
      // Le contrat rend un `code` stable : le donner évite à l'IA de deviner
      // laquelle de ses dix hypothèses corriger.
      return `Requête refusée par l'API MIP RUM${detail}${code ? ` [code ${code}]` : ""}. C'est le paramètre ou le corps qui est en cause : le corriger, ne pas réessayer à l'identique.`;
    case 413:
      return `Corps de requête trop volumineux${detail}. Réduire le nombre de filtres ou de groupes avant de réessayer.`;
    case 503:
      if (code === "query_budget_exceeded") {
        return `La requête n'a pas tenu son budget de lecture${detail}. Réduire la période, le nombre de groupes ou ajouter un filtre, puis réessayer. IMPORTANT : aucun chiffre n'a été renvoyé — ce n'est PAS un résultat à zéro.`;
      }
      return `L'API MIP RUM est indisponible (503)${detail}. C'est une panne côté serveur, pas une erreur d'appel.`;
    case 401:
      return `Jeton refusé par l'API MIP RUM${detail}. Ce n'est pas un problème de paramètre : réessayer la même requête donnera le même résultat. Le jeton doit figurer dans CONSOLE_API_TOKENS (la même valeur sur la console et le service api) ; les jetons de lecture créés dans la console n'ouvrent pas cette API.`;
    case 403:
      return `Accès refusé à cette ressource${detail}. Le jeton est valide mais son périmètre ne couvre pas l'app demandée — utiliser mip_rum_list_apps pour connaître les apps réellement accessibles.`;
    case 404:
      return `Ressource introuvable${detail}. Vérifier l'identifiant, et élargir 'period' : l'API cherche dans la fenêtre demandée, pas dans tout l'historique.`;
    case 429:
      return `Débit dépassé côté API${detail}. Attendre quelques secondes ; enchaîner les appels immédiatement ne fera qu'allonger l'attente.`;
    default:
      if (statut >= 500)
        return `L'API MIP RUM a répondu ${statut}${detail}. C'est une panne côté serveur, pas une erreur d'appel — inutile de reformuler la requête.`;
      return `L'API MIP RUM a répondu ${statut}${detail}.`;
  }
}

/**
 * Construit le client.
 *
 * @param {object} opts
 * @param {string} opts.base    origine de la console, ex. https://mip-rum-console.vercel.app
 * @param {string} opts.jeton   jeton porteur (Bearer) — celui de l'appelant, jamais journalisé
 * @param {Function} [opts.fetchImpl] injectable pour les tests
 * @param {number} [opts.delaiMs]
 */
export function creerClient({ base, jeton, fetchImpl = fetch, delaiMs = DELAI_MS }) {
  // Base normalisée UNE fois : `https://x/` et `https://x` doivent produire la
  // même URL, sinon on obtient `//api/v1` — que certains proxys redirigent et
  // d'autres refusent.
  const racine = `${String(base).replace(/\/+$/, "")}/api/v1`;

  return {
    racine,
    /**
     * Appelle l'API et renvoie l'enveloppe `{ meta, data }` désérialisée.
     *
     * `corps` déclenche un POST. Ce n'est PAS une écriture : l'Explorer (P6.4)
     * lit par POST parce que son AST ne tient pas dans une query string, et
     * l'API l'authentifie exactement comme ses GET. Aucun outil du catalogue ne
     * poste vers une route d'écriture, et un test le verrouille.
     *
     * @param {string} chemin chemin relatif construit par construireChemin()
     * @param {object} [options]
     * @param {object|null} [options.corps] corps JSON ; présent = POST
     */
    async appeler(chemin, options = {}) {
      const url = `${racine}${chemin}`;
      const aCorps = options.corps != null;
      let reponse;
      try {
        reponse = await fetchImpl(url, {
          method: aCorps ? "POST" : "GET",
          headers: {
            authorization: `Bearer ${jeton}`,
            accept: "application/json",
            ...(aCorps ? { "content-type": "application/json" } : {}),
            // Identifie l'appelant dans les journaux de la console : un pic de
            // trafic doit pouvoir être attribué à l'IA plutôt qu'au front.
            "user-agent": "mip-rum-mcp-server",
          },
          ...(aCorps ? { body: JSON.stringify(options.corps) } : {}),
          signal: AbortSignal.timeout(delaiMs),
        });
      } catch (e) {
        // Panne réseau ou délai dépassé. On ne remonte PAS `e.message` tel quel :
        // il contient l'URL, donc l'hôte interne, dans certaines implémentations.
        const cause = e?.name === "TimeoutError" ? `délai de ${delaiMs} ms dépassé` : "réseau injoignable";
        throw new ErreurApi(
          `Impossible de joindre l'API MIP RUM (${cause}). Vérifier que l'API est en ligne ; réessayer une fois, puis abandonner.`,
          0,
        );
      }

      // Le corps peut ne pas être du JSON (page d'erreur d'un proxy, 502 HTML).
      let corps = null;
      const texte = await reponse.text();
      if (texte) {
        try {
          corps = JSON.parse(texte);
        } catch {
          corps = null;
        }
      }

      if (!reponse.ok) throw new ErreurApi(messagePour(reponse.status, corps), reponse.status);
      if (corps == null)
        throw new ErreurApi(
          "L'API a répondu 200 avec un corps illisible (JSON attendu). C'est une anomalie côté serveur.",
          reponse.status,
        );
      return corps;
    },
  };
}
