// L'adresse de collecte que la résolution d'un domaine rend à l'extension (P6b.G).
//
// L'extension injecte le SDK avec `endpoint ?? son défaut` (la console :
// `apps/extension/src/background.ts`). Rendre l'adresse du collector ici suffit
// donc à la faire passer en collecte directe, SANS toucher à son code ni à ses
// artefacts versionnés (`apps/extension/scripts/check-sync.mjs`) : une extension
// déjà installée suit au prochain cache expiré (60 s).
//
// Ordre, domaine par domaine :
//   1. `extension_scope.endpoint`, s'il est posé : un choix explicite pour CE
//      domaine gagne toujours — c'est là qu'un site dont la CSP fige
//      `connect-src` sur la console se garde en relais ;
//   2. l'adresse directe, si la collecte directe est ouverte ;
//   3. sinon `null`, la réponse d'avant : l'extension prend son défaut.
//
// La résolution est aussi RELAYÉE au collector (C11), qui ne connaît pas la
// variable de la console et rend l'`endpoint` de la base tel quel : la même
// règle s'applique donc à sa réponse, ici, avant qu'elle reparte. Écart voulu
// avec le collector — la variable posée seulement : la parité de format tient
// (même clé, même type), l'extension ne parle qu'à la console.
import { ingestEndpointDirect } from "./ingest-endpoint";

/** L'adresse à rendre pour un domaine dont la base déclare `declaree`. */
export function endpointExtension(declaree: string | null | undefined): string | null {
  if (typeof declaree === "string" && declaree.trim() !== "") return declaree;
  return ingestEndpointDirect("traces");
}

/**
 * La réponse relayée du collector, complétée selon la même règle. Rendue telle
 * quelle — statut, en-têtes, corps — sauf un 200 dont l'`endpoint` est vide
 * alors que la collecte directe est ouverte. Un corps illisible n'est pas
 * « réparé » : il repart comme il est venu.
 */
export async function completerResolutionRelayee(res: Response): Promise<Response> {
  if (res.status !== 200 || ingestEndpointDirect("traces") === null) return res;
  let corps: unknown;
  try {
    corps = await res.clone().json();
  } catch {
    return res;
  }
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) return res;
  const lu = corps as Record<string, unknown>;
  const endpoint = endpointExtension(typeof lu.endpoint === "string" ? lu.endpoint : null);
  if (endpoint === lu.endpoint) return res;
  const entetes = new Headers(res.headers);
  // Le corps change de longueur : une longueur recopiée tronquerait la réponse.
  entetes.delete("content-length");
  return new Response(JSON.stringify({ ...lu, endpoint }), { status: res.status, headers: entetes });
}
