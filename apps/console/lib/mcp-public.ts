// Ce qu'un client MCP doit savoir pour se brancher : l'adresse, et les extraits
// de configuration à copier tels quels.
//
// POURQUOI CES EXTRAITS SONT DU CODE ET NON DU TEXTE DANS UNE PAGE. Un bloc de
// configuration est copié-collé sans être relu : une virgule en trop, un champ
// mal nommé, et l'utilisateur obtient une erreur de parsing qu'il attribuera au
// produit. Les construire ici les rend testables — un test vérifie que chaque
// extrait est du JSON valide et porte les champs que le client attend.
//
// LE PIÈGE DU CHAMP `type`. Une entrée qui porte `url` SANS `type` est lue comme
// un serveur stdio et échoue de façon incompréhensible. `"type": "http"` est
// donc obligatoire, pas décoratif.
// Réf. https://code.claude.com/docs/en/mcp
//
// Module PUR : aucune E/S, aucune horloge.

/**
 * Origine publique du serveur MCP (Railway, projet `mip-rum-backend`, service
 * `mcp`, région europe-west4).
 *
 * Écrit ici et nulle part ailleurs. Si le domaine Railway change, c'est la
 * SEULE ligne à toucher — et la page interroge `/health` à chaque rendu, donc
 * une adresse périmée s'affiche comme injoignable au lieu d'être servie comme
 * si elle marchait.
 */
export const MCP_ORIGINE = "https://mcp-production-201c.up.railway.app";

/** L'adresse à donner à un client MCP. Le chemin `/mcp` n'est pas optionnel. */
export const MCP_ENDPOINT = `${MCP_ORIGINE}/mcp`;

/** Origine de la console, dont le serveur MCP consomme l'API v1. */
export const CONSOLE_ORIGINE = "https://mip-rum-console.vercel.app";

/** Nom sous lequel le serveur apparaît chez le client. */
export const MCP_NOM = "mip-rum";

/**
 * Configuration d'un client MCP **distant** (Claude Code, Claude Desktop, un
 * IDE) : transport HTTP, jeton porté par l'en-tête.
 */
export function configDistante(endpoint = MCP_ENDPOINT): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_NOM]: {
          type: "http",
          url: endpoint,
          headers: { Authorization: "Bearer VOTRE_JETON" },
        },
      },
    },
    null,
    2,
  );
}

/** La même chose en une commande, pour qui préfère la ligne de commande. */
export function commandeCli(endpoint = MCP_ENDPOINT): string {
  // Coupée en trois lignes courtes plutôt qu'en deux longues : le bloc de code
  // est étroit sur la page, et une ligne qui déborde se copie mal à la souris.
  return [
    `claude mcp add --transport http \\`,
    `  ${MCP_NOM} ${endpoint} \\`,
    `  --header "Authorization: Bearer VOTRE_JETON"`,
  ].join("\n");
}

/**
 * Configuration **locale** (transport stdio) : le serveur tourne en
 * sous-processus depuis une copie du dépôt, et le jeton vient de
 * l'environnement — il n'y a pas de requête HTTP entrante pour le porter.
 */
export function configLocale(console_ = CONSOLE_ORIGINE): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_NOM]: {
          command: "node",
          args: ["/chemin/vers/poc-MIP_RUM/services/mcp/stdio.mjs"],
          env: { MIP_CONSOLE_URL: console_, MIP_API_TOKEN: "VOTRE_JETON" },
        },
      },
    },
    null,
    2,
  );
}

/**
 * Deux appels pour vérifier soi-même, dans cet ordre : le second DOIT échouer.
 * Un utilisateur qui ne teste que le cas passant ne saura pas si son serveur
 * est ouvert à tous.
 */
export function curlVerification(origine = MCP_ORIGINE): string {
  return [
    `# 1. le service répond`,
    `curl -s ${origine}/health`,
    ``,
    `# 2. la liste des outils (jeton exigé)`,
    `curl -s -X POST ${origine}/mcp \\`,
    `  -H "Authorization: Bearer VOTRE_JETON" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Accept: application/json, text/event-stream" \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    ``,
    `# 3. SANS jeton : doit répondre 401`,
    `curl -s -o /dev/null -w '%{http_code}\\n' -X POST ${origine}/mcp \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  ].join("\n");
}
