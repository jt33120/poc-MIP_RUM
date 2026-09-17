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
  description: "API lecture seule des agrégats RUM (consommée par le front MIP et par le serveur MCP).",
  filters: {
    app: "slug d'app, ou 'all' (défaut)",
    period: "1h | 24h (défaut) | 7d",
    device: "mobile | desktop | tablet | all (défaut)",
  },
  pagination:
    "les listes (/errors, /sessions, /events, /actions) acceptent limit (1..200) & offset ; /errors, /events et /actions bornent offset à 10 000. page renvoyée dans data.page. /errors et /events fournissent un total (data.total) ; /sessions et /actions n'en fournissent aucun. /errors/{fingerprint} pagine ses occurrences par cursor (data.page.next_cursor), limit 1..100 ; /events accepte aussi cursor.",
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
  // Écriture : hors de l'énumération ci-dessus, qui décrit la lecture. Signalée
  // explicitement plutôt que passée sous silence.
  write: [
    { method: "POST", path: "/api/v1/deploys", desc: "enregistre un marqueur de déploiement (intégration CI/CD)" },
  ],
}));
