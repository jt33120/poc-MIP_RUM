// GET /api/replay/[sessionId] — reconstruit le replay : chunks bytea gzip
// (replay_chunk) -> gunzip -> concat -> JSON des events rrweb pour le player.
// Auth : protégée par le middleware global (B3, JWT cookie) ; périmètre d'apps vérifié
// par le chargeur.
//
// La lecture vit dans `lib/chargeurs/rejeu.ts` (C3) : périmètre, segments bornés à
// l'app de la session, plafond PAR SESSION, segments illisibles COMPTÉS (B36). Le
// même chargeur est servi par console-api ; cette route n'en fait que la réponse.
import { NextResponse } from "next/server";
import { chargerRejeu } from "@/lib/chargeurs/rejeu";
import { withServerTrace } from "@/lib/server-trace";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  // dogfood (Voie A inc.2) : cette route est appelée par le navigateur (lecteur
  // replay) avec le traceparent du SDK -> on trace le handler + ses requêtes DB.
  return withServerTrace(req, { route: "/api/replay/:sessionId", method: "GET" }, async () => {
    const { getUser } = await import("@/lib/auth");
    const lu = await chargerRejeu(await getUser(), {}, { sessionId });
    if (lu.etat === "introuvable") return NextResponse.json({ error: "not found" }, { status: 404 });
    const { etat: _etat, ...rejeu } = lu;
    return NextResponse.json(rejeu);
  });
}
