// GET /api/v1 — descripteur de l'API (version + endpoints), pour l'auto-découverte
// par l'équipe Angular MIP et par le serveur MCP. Authentifié comme le reste (évite
// d'exposer la carte des routes à un anonyme). La spec machine est sur
// /api/v1/openapi (publique).
//
// CETTE LISTE A MENTI. Elle annonçait /api/v1/ai, /api/v1/ai/costs et
// /api/v1/ai/credits — trois routes qui n'existent pas dans app/api/v1/ — et
// omettait /docs et /deploys, qui existent. Un client qui suivait la découverte
// se prenait donc trois 404 et ignorait deux capacités réelles. Sans conséquence
// tant qu'un humain lisait la réponse ; avec le serveur MCP, c'est un modèle qui
// la lit, et un modèle croit ce qu'on lui dit.
//
// La liste est désormais DÉRIVÉE de la spec OpenAPI, elle-même construite à
// partir des schémas réels (lib/api/openapi.ts). Ajouter une route sans la
// déclarer là ne la fera pas apparaître ici — mais plus rien ne peut y
// apparaître sans exister. Un test verrouille la correspondance entre cette
// liste et les fichiers de app/api/v1/.
import { handle } from "@/lib/api/handle";
import { endpointsDeclares } from "@/lib/api/openapi";
import { preflight } from "@/lib/api/respond";
import { OUTILS } from "../../../../mcp/lib/catalogue.mjs";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async () => ({
  version: "1",
  description:
    "API des agrégats RUM (consommée par le front MIP et par le serveur MCP) : lecture, plus les écritures listées dans `write`.",
  filters: {
    app: "slug d'app, ou 'all' (défaut : toutes les apps AUTORISÉES). Une app hors périmètre reçoit 403 forbidden_app, jamais les chiffres d'une autre.",
    period: "1h | 24h (défaut) | 7d — fenêtre glissante ; une valeur inconnue vaut 24h",
    from: "début INCLUS d'une plage personnalisée (ISO UTC explicite, …Z), avec to et sans period",
    to: "fin EXCLUE d'une plage personnalisée : 30 jours au plus, jamais dans le futur",
    device: "mobile | desktop | tablet | all (défaut)",
    dimensions: "browser, os, env, service, release, route, country : valeur exacte (1 à 500 caractères). Une dimension que la mesure ne porte pas reçoit 400 unsupported_dimension, jamais un filtre ignoré.",
    seg: "segment : 'v2:dimension:eq|neq|is_null[:valeur encodée]' séparés par ';' (format v1 encore lu) ; 10 conditions au plus",
    bots: "1 = inclure le trafic non humain (exclu par défaut)",
    internal: "1 = inclure les apps internes dans la vue « toutes apps » (exclues par défaut)",
  },
  meta:
    "chaque réponse annonce ce qui a été APPLIQUÉ : meta.scope (app demandée, apps effectives), meta.range ([from,to) UTC, preset, largeur de seau) et meta.filters (conditions, bots, apps internes).",
  pagination:
    "les listes (/errors, /sessions, /events, /actions) acceptent limit (1..200) & offset ; /errors, /events et /actions bornent offset à 10 000. page renvoyée dans data.page. /errors, /issues et /events fournissent un total (data.total) ; /sessions et /actions n'en fournissent aucun. /errors/{fingerprint} pagine ses occurrences par cursor (data.page.next_cursor), limit 1..100 ; /events accepte aussi cursor. /issues, /issues/{id} et /issues/{id}/activity paginent uniquement par cursor (data.next_cursor), limit 1..100.",
  spec: "/api/v1/openapi (OpenAPI 3.0, sans auth)",
  docs: "/api/v1/docs (Swagger UI, sans auth)",
  mcp: {
    description:
      // Compté sur le catalogue réellement enregistré : écrit en dur, ce nombre
      // annonçait encore 11 outils après l'ajout du douzième.
      `Ces mêmes endpoints sont exposés en outils MCP pour un agent IA (${OUTILS.length} outils, lecture seule). Le serveur MCP relaie le jeton de l'appelant : il n'élargit aucun droit.`,
    doc: "docs/MCP.md",
  },
  endpoints: endpointsDeclares(),
  // L'Explorer générique (P6.4) est une LECTURE en POST : son AST ne tient pas dans
  // une query string. Il n'entre donc ni dans `endpoints` — qui énumère les GET —,
  // ni dans `write` plus bas, qui décrit des écritures. Le dire ici plutôt que le
  // ranger dans la mauvaise liste : un modèle croit ce qu'on lui annonce.
  explorer: {
    schema: "GET /api/v1/explorer/schema — jeux de données, mesures, dimensions disponibles et limites",
    query:
      "POST /api/v1/explorer/query — requête analytique bornée (LECTURE, même auth que les GET, corps ≤ 32 Kio). " +
      "Le corps est un AST versionné : dataset, measure {aggregation, field}, range {preset} OU {from,to}, " +
      "filters, groupBy (2 au plus), visualization et limit. Un budget de lecture dépassé rend 503 " +
      "query_budget_exceeded — jamais un résultat à zéro.",
    views:
      "GET /api/v1/explorer/views — vues enregistrées de la SESSION (et, pour un admin, celles de ses apps). " +
      "Un jeton CONSOLE_API_TOKENS est refusé (403) : une vue est personnelle. Écritures dans `write`.",
  },
  // Écritures : hors de l'énumération ci-dessus, qui décrit la lecture. Signalées
  // explicitement plutôt que passées sous silence. Celles des issues exigent une
  // session admin de la console et refusent tout jeton d'API ; celles des vues
  // enregistrées sont PERSONNELLES — leur propriétaire suffit, viewer compris.
  write: [
    { method: "POST", path: "/api/v1/explorer/views", desc: "enregistre une analyse comme vue personnelle (session, 50 par app)" },
    { method: "PATCH", path: "/api/v1/explorer/views/{id}", desc: "renomme une vue ou remplace son AST (propriétaire, expectedRevision)" },
    { method: "DELETE", path: "/api/v1/explorer/views/{id}", desc: "supprime une vue (propriétaire seul)" },
    { method: "POST", path: "/api/v1/deploys", desc: "enregistre un marqueur de déploiement (intégration CI/CD)" },
    { method: "POST", path: "/api/v1/issues/{id}/triage", desc: "statut et assigné d'une issue (session admin, expectedRevision)" },
    { method: "POST", path: "/api/v1/issues/{id}/comments", desc: "commentaire scrubbé sur une issue (session admin, expectedRevision)" },
    { method: "POST", path: "/api/v1/issues/{id}/links", desc: "lien de ticket HTTPS sur une issue (session admin, expectedRevision)" },
  ],
}));
