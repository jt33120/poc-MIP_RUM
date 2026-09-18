// GET  /api/admin/ticket-integrations[?appId=] — connecteurs de tickets configurés.
// POST /api/admin/ticket-integrations           — { app, provider, target, credentialRef, … }
//
// Session admin uniquement (jamais démo, jamais jeton `CONSOLE_API_TOKENS` :
// ceux-ci restent en lecture seule et n'obtiennent JAMAIS un droit d'écriture
// externe), Origin de la console pour la création.
//
// LA RÉPONSE NE PORTE AUCUN SECRET. Ni à la création, ni à la lecture : elle dit
// la FORME de la référence (variable d'environnement, ou chiffré) et, pour une
// variable, son nom. `credentialRef` attendu en entrée est lui-même une
// référence — un jeton collé là est refusé en 400, et la contrainte de base le
// refuserait de toute façon.
//
// GitHub Issues est l'implémentation actuelle ; la cible reste l'outil ITSM de
// MIP (ServiceNow, sous réserve de confirmation). L'interface visuelle de cette
// configuration reste masquée tant qu'aucun fournisseur n'est branché et testé.
import { type NextRequest, NextResponse } from "next/server";
import { ErreurUpload, lireCorpsLimite } from "ingest/lib/sourcemap-upload.mjs";
import { guardAdmin } from "@/lib/api/admin";
import { SESSION_COOKIE } from "@/lib/auth";
import { workflowApps } from "@/lib/api/issue-workflow";
import {
  createTicketIntegration,
  listTicketIntegrations,
  parseIntegrationRequest,
  ticketSchemaDisponible,
} from "@/lib/queries-ticket-integrations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Une configuration tient en quelques centaines d'octets. */
const MAX_CORPS = 16 * 1024;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function GET(req: NextRequest) {
  const garde = await guardAdmin(req.headers, req.cookies.get(SESSION_COOKIE)?.value ?? null, { mutation: false });
  if (!garde.ok) return json({ error: garde.error }, garde.status);
  if (!(await ticketSchemaDisponible())) {
    return json({ error: "schéma des connecteurs de tickets non migré : migration-v84 requise" }, 503);
  }
  const apps = workflowApps(garde.user);
  if (apps?.length === 0) return json({ error: "aucune application autorisée" }, 403);
  const demandee = req.nextUrl.searchParams.get("appId")?.trim() || null;
  // Un filtre n'est pas une autorisation : il est intersecté avec le périmètre
  // signé avant toute lecture.
  if (demandee && apps && !apps.includes(demandee)) return json({ error: "application hors périmètre" }, 403);
  try {
    const toutes = await listTicketIntegrations(demandee);
    const integrations = apps ? toutes.filter((i) => apps.includes(i.app_id)) : toutes;
    return json({ integrations });
  } catch (err) {
    console.error("[api/admin/ticket-integrations]", err);
    return json({ error: "erreur interne" }, 500);
  }
}

export async function POST(req: NextRequest) {
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
  const demande = parseIntegrationRequest(corps);
  if (!demande.ok) return json({ error: demande.error }, 400);
  const apps = workflowApps(garde.user);
  if (apps?.length === 0) return json({ error: "aucune application autorisée" }, 403);
  if (apps && !apps.includes(demande.value.app)) return json({ error: "application hors périmètre" }, 403);
  try {
    const cree = await createTicketIntegration(demande.value, garde.user.email);
    if (!cree) return json({ error: `application inconnue : ${demande.value.app}` }, 404);
    return json({ integration: cree }, 201);
  } catch (err) {
    // Cible déjà configurée pour ce fournisseur : 409, pas un doublon silencieux.
    if (String((err as { code?: string })?.code) === "23505") {
      return json({ error: "cette cible est déjà configurée pour cette application" }, 409);
    }
    console.error("[api/admin/ticket-integrations]", err);
    return json({ error: "erreur interne" }, 500);
  }
}
