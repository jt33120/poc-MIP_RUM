// GET /api/replay/[sessionId] — reconstruit le replay : chunks bytea gzip
// (replay_chunk) -> gunzip -> concat -> JSON des events rrweb pour le player.
// Auth : protégée par le middleware global (B3, JWT cookie) ; périmètre d'apps vérifié
// par le chargeur.
//
// La lecture vit dans `lib/chargeurs/rejeu.ts` (C3) : périmètre, segments bornés à
// l'app de la session, plafond PAR SESSION, segments illisibles COMPTÉS (B36). Le
// même chargeur est servi par console-api (`replay.session`) ; cette route n'en fait
// que la réponse, par `lireEcran` qui aiguille. La portée est `all` : le lecteur ne
// connaît que la session, le chargeur résout son app et la confronte au périmètre.
import { NextResponse } from "next/server";
import { CODES_ERREUR, ECRANS } from "@mip/console-contract";
import { chargerRejeu } from "@/lib/chargeurs/rejeu";
import { lireEcran } from "@/lib/ecran";
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
    const l = await lireEcran(ECRANS.rejeu, chargerRejeu, { app: "all" }, { sessionId });
    if (!l.ok) {
      // Mode strict : le refus du service. Hors du périmètre, une session est introuvable, comme absente.
      if (l.refus.code === "hors_perimetre") return NextResponse.json({ error: "not found" }, { status: 404 });
      const code = l.refus.code === "session_invalide" ? "session_requise" : l.refus.code;
      return NextResponse.json({ error: l.refus.message }, { status: (CODES_ERREUR as Record<string, number>)[code] ?? 503 });
    }
    const lu = l.data;
    if (lu.etat === "introuvable") return NextResponse.json({ error: "not found" }, { status: 404 });
    const { etat: _etat, ...rejeu } = lu;
    return NextResponse.json(rejeu);
  });
}
