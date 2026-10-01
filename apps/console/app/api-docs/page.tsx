// /api-docs — « API et MCP » : les deux manières de sortir la donnée du portail.
// L'API REST pour un front, un partenaire ou un script ; le serveur MCP pour un
// agent IA (il n'est qu'un client de l'API v1). Le contenu : `ApiEtMcp`.
//
// Réécrite le 30/09/2026 (« trop long sinon ») : en haut, installer le MCP et
// ouvrir Swagger ; puis les trois jetons ; le détail replié. La page ne lit pas la
// base : l'hôte de la requête donne l'adresse de l'API, la sonde du serveur MCP
// passe par le réseau, sous <Suspense> pour ne pas retenir l'affichage.
import { headers } from "next/headers";
import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ApiEtMcp } from "@/components/api-docs/ApiEtMcp";
import { EtatMcp, PastilleMcpAttente } from "@/components/api-docs/EtatMcp";
import { origineConsole } from "@/lib/api-docs";
import { MCP_ORIGINE } from "@/lib/mcp-public";

export const dynamic = "force-dynamic";

export default async function ApiDocsPage() {
  const origine = origineConsole((await headers()).get("host"));
  return (
    <>
      <PageHeader title="API et MCP" />
      <ApiEtMcp
        origine={origine}
        origineMcp={MCP_ORIGINE}
        etatMcp={
          <Suspense fallback={<PastilleMcpAttente />}>
            <EtatMcp />
          </Suspense>
        }
      />
    </>
  );
}
