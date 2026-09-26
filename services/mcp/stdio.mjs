// Point d'entrée LOCAL du serveur MCP : transport stdio.
//
// Pour brancher MIP RUM dans un client MCP qui lance ses serveurs en
// sous-processus (Claude Desktop, Claude Code, un IDE). Un seul utilisateur, une
// seule identité : le jeton vient de l'environnement, il n'y a pas de requête
// HTTP entrante pour le porter.
//
// RIEN NE DOIT SORTIR SUR STDOUT. Le transport stdio y écrit le JSON-RPC ; un
// console.log s'y insérerait au milieu d'une trame et casserait la session sans
// message d'erreur lisible. Les diagnostics vont donc sur stderr, toujours.
import { creerClient } from "@mip/mcp-tools/lib/client.mjs";
import { StdioServerTransport } from "@mip/mcp-tools/lib/transports.mjs";
import { creerServeur } from "@mip/mcp-tools/serveur.mjs";

const base = process.env.MIP_CONSOLE_URL;
const jeton = process.env.MIP_API_TOKEN;

// Fail-fast, comme les autres services du backend. Démarrer sans jeton
// donnerait un serveur qui s'annonce, expose tous ses outils, et répond 401 à
// chacun : le pire des deux mondes, puisque le modèle croit avoir un accès.
if (!base || !jeton) {
  process.stderr.write(
    "mcp: MIP_CONSOLE_URL et MIP_API_TOKEN sont requis.\n" +
      "  MIP_CONSOLE_URL  origine de la console, ex. https://mip-rum-console.vercel.app\n" +
      "  MIP_API_TOKEN    jeton listé dans CONSOLE_API_TOKENS (les jetons de lecture en base n'ouvrent pas l'API v1)\n",
  );
  process.exit(2);
}

const client = creerClient({ base, jeton });
const serveur = creerServeur({ clientPour: () => client });

await serveur.connect(new StdioServerTransport());
process.stderr.write(`mcp: prêt sur stdio (api ${client.racine})\n`);
