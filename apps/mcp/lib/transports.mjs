// Les transports MCP, ré-exportés depuis le noyau.
//
// POURQUOI CETTE INDIRECTION. Les points d'entrée (services/mcp/*.mjs)
// pourraient importer `@modelcontextprotocol/sdk` directement. Ils ne le font
// pas, pour deux raisons concrètes :
//
//   · UNE SEULE VERSION. Le SDK serait alors déclaré dans deux manifestes, qui
//     dériveraient — un serveur et son transport compilés contre deux versions
//     du protocole échouent à la négociation, pas à l'installation.
//   · UNE SEULE ARBORESCENCE. L'image Docker n'installe les dépendances qu'une
//     fois, dans le noyau ; les services n'ont pas de node_modules à eux.
//
// Rien n'est enveloppé ici : ce sont les classes du SDK, telles quelles.
export { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
export { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
