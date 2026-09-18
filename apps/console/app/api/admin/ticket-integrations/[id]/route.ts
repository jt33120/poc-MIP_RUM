// PATCH /api/admin/ticket-integrations/{id} — { enabled?, configVersion?, state?, verified? }
//
// Session admin, même origine. Le périmètre est REVÉRIFIÉ après résolution de la
// ressource (cf. `patchTicketIntegration`) : un identifiant entier ne dit pas à
// quelle application il appartient, et deviner un entier ne doit pas permettre
// d'activer le connecteur d'un autre client.
//
// `state` n'accepte que `active` : sortir de `degraded` est une décision
// d'exploitation après correction du jeton. Y entrer est une constatation du
// dispatcher, pas une commande d'API.
//
// `verified` marque la recette RÉELLE jouée. Tant qu'elle est absente, la console
// ne propose pas de créer de ticket avec cette intégration : un bouton qui ne
// marche pas est pire que pas de bouton.
import { type NextRequest, NextResponse } from "next/server";
import { ErreurUpload, lireCorpsLimite } from "ingest/lib/sourcemap-upload.mjs";
import { guardAdmin } from "@/lib/api/admin";
import { workflowApps } from "@/lib/api/issue-workflow";
import { SESSION_COOKIE } from "@/lib/auth";
import {
  parseIntegrationPatch,
  patchTicketIntegration,
  ticketSchemaDisponible,
} from "@/lib/queries-ticket-integrations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CORPS = 8 * 1024;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function PATCH(req: NextRequest, route: { params: Promise<{ id: string }> }) {
  const garde = await guardAdmin(req.headers, req.cookies.get(SESSION_COOKIE)?.value ?? null, { mutation: true });
  if (!garde.ok) return json({ error: garde.error }, garde.status);
  if (!(await ticketSchemaDisponible())) {
    return json({ error: "schéma des connecteurs de tickets non migré : migration-v84 requise" }, 503);
  }
  if (!req.body) return json({ error: "JSON invalide" }, 400);
  let corps: unknown;
  try {
    const flux = req.body as unknown as AsyncIterable<Uint8Array>;
    corps = JSON.parse((await lireCorpsLimite(flux, { max: MAX_CORPS })).toString("utf8"));
  } catch (err) {
    if (err instanceof ErreurUpload) return json({ error: err.message }, err.statut);
    return json({ error: "JSON invalide" }, 400);
  }
  const patch = parseIntegrationPatch(corps);
  if (!patch.ok) return json({ error: patch.error }, 400);
  const apps = workflowApps(garde.user);
  if (apps?.length === 0) return json({ error: "aucune application autorisée" }, 403);
  const { id } = await route.params;
  try {
    const maj = await patchTicketIntegration(id, patch.value, garde.user.email, apps);
    if (!maj) return json({ error: "intégration introuvable" }, 404);
    return json({ integration: maj });
  } catch (err) {
    console.error("[api/admin/ticket-integrations/:id]", err);
    return json({ error: "erreur interne" }, 500);
  }
}
