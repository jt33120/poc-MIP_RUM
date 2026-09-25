// POST /api/webhooks/tickets/{integrationId} — livraison entrante d'un
// fournisseur de tickets (P8.6).
//
// C11 — le NOTIFIER sert la même livraison sur son domaine
// (`/v1/webhooks/tickets/{id}`), par le même code : les contrôles, leur ordre et
// ce que la réponse tait vivent dans
// `@mip/backend/lib/integrations/tickets/webhook-entrant.mjs`. Ici, le transport :
// les refus d'avant lecture, le corps lu BRUT et borné (la signature porte sur
// ses octets), puis le relais octet pour octet au notifier quand
// `CONSOLE_TICKET_HOOK_URL` est posée (`lib/ticket-hook-relay.ts`), le traitement
// local sinon. Pas un cookie, pas une session : l'autorité est la signature du
// fournisseur.
import { type NextRequest, NextResponse } from "next/server";
import { ErreurUpload, lireCorpsLimite } from "@mip/backend/lib/sourcemap-upload.mjs";
import {
  CORPS_LIVRAISON_MAX,
  MOTIF_INTEGRATION,
  recevoirLivraison,
  refusAvantLecture,
} from "@mip/backend/lib/integrations/tickets/webhook-entrant.mjs";
import { pool } from "@/lib/db";
import { relayerLivraison } from "@/lib/ticket-hook-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: NextRequest, route: { params: Promise<{ integrationId: string }> }): Promise<Response> {
  const refus = refusAvantLecture(req.headers);
  if (refus) return json(refus.corps, refus.statut);

  const { integrationId } = await route.params;
  if (!MOTIF_INTEGRATION.test(integrationId)) return json({ error: "introuvable" }, 404);

  let brut: Buffer;
  try {
    brut = req.body ? await lireCorpsLimite(req.body as unknown as AsyncIterable<Uint8Array>, { max: CORPS_LIVRAISON_MAX }) : Buffer.alloc(0);
  } catch (err) {
    if (err instanceof ErreurUpload && err.statut === 413) return json({ error: "corps trop volumineux" }, 413);
    return json({ error: "corps illisible" }, 400);
  }

  const relayee = await relayerLivraison(integrationId, req, brut);
  if (relayee) return relayee;

  const r = await recevoirLivraison({ pool, integrationId, entetes: req.headers, brut, env: process.env });
  return json(r.corps, r.statut);
}
