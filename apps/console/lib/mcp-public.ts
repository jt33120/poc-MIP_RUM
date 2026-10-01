// L'adresse publique du serveur MCP, et les extraits à copier LIÉS À CETTE ADRESSE.
//
// UNE SEULE SOURCE (01/10/2026). Ce module construisait sa propre commande
// `claude mcp add` (sur trois lignes), sa configuration JSON et sa configuration
// stdio, quand `lib/api-docs.ts` construisait les mêmes (la commande sur une ligne)
// pour la page « API et MCP » : deux versions d'un même extrait finissent par dire
// deux choses. Les constructeurs vivent dans `lib/api-docs.ts` ; ici, des alias qui
// les appellent sur l'adresse réelle, et que tests/unit/mcp-public.test.ts éprouve
// (JSON valide, `"type": "http"`, chemin `/mcp`, appel SANS jeton qui doit échouer).
//
// LE PIÈGE DU CHAMP `type`. Une entrée qui porte `url` SANS `type` est lue comme
// un serveur stdio et échoue de façon incompréhensible. `"type": "http"` est
// donc obligatoire, pas décoratif.
// Réf. https://code.claude.com/docs/en/mcp
//
// Module PUR : aucune E/S, aucune horloge (`api-docs.ts` ne tire que la spec
// OpenAPI, pure elle aussi).
import {
  NOM_SERVEUR_MCP,
  adresseMcp,
  appelsDeVerification,
  commandeClaudeCode,
  configurationJson,
  configurationStdio,
} from "./api-docs";

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
export const MCP_ENDPOINT = adresseMcp(MCP_ORIGINE);

/** Origine de la console de production, dont le serveur MCP consomme l'API v1. */
export const CONSOLE_ORIGINE = "https://mip-rum-console.vercel.app";

/** Nom sous lequel le serveur apparaît chez le client (`NOM_SERVEUR_MCP`). */
export const MCP_NOM = NOM_SERVEUR_MCP;

/** La configuration d'un client MCP distant (transport HTTP), sur l'adresse réelle. */
export const configDistante = (endpoint: string = MCP_ENDPOINT) => configurationJson(endpoint);

/** La configuration locale (stdio), vers la console de production. */
export const configLocale = (console_: string = CONSOLE_ORIGINE) => configurationStdio(console_);

/** Les trois appels de vérification, sur le serveur réel. */
export const curlVerification = (origine: string = MCP_ORIGINE) => appelsDeVerification(origine);

/**
 * `commandeClaudeCode` coupée pour un bloc étroit : la MÊME commande (mêmes mots,
 * même ordre), une barre de continuation avant le nom et avant l'en-tête. La page
 * donne la version sur une ligne.
 */
export function commandeCli(endpoint: string = MCP_ENDPOINT): string {
  return commandeClaudeCode(endpoint)
    .replace(` ${NOM_SERVEUR_MCP} `, ` \\\n  ${NOM_SERVEUR_MCP} `)
    .replace(" --header ", " \\\n  --header ");
}
