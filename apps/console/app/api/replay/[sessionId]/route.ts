// GET /api/replay/[sessionId] — reconstruit le replay : chunks bytea gzip
// (replay_chunk) -> gunzip -> concat -> JSON des events rrweb pour le player.
// Auth : protégée par le middleware global (B3, JWT cookie) ; périmètre d'apps vérifié ici.
import { NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { q } from "@/lib/db";
import { authorizedAppsOf } from "@/lib/query-contract";
import { withServerTrace } from "@/lib/server-trace";

export const dynamic = "force-dynamic";

interface ChunkRow {
  seq: number;
  events_count: number | null;
  body: Buffer; // gzip (stocké compressé à l'ingestion)
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  // dogfood (Voie A inc.2) : cette route est appelée par le navigateur (lecteur
  // replay) avec le traceparent du SDK -> on trace le handler + ses requêtes DB.
  return withServerTrace(req, { route: "/api/replay/:sessionId", method: "GET" }, async () => {
    // Périmètre : la session doit appartenir à une app autorisée (liste vide = aucune).
    const { getUser } = await import("@/lib/auth");
    const authorized = authorizedAppsOf(await getUser());
    const owner = await q<{ app_id: string }>(`select app_id from rum_session where session_id = $1`, [sessionId]);
    const appId = owner[0]?.app_id;
    if (!appId || (authorized !== null && !authorized.includes(appId))) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Chunks bornés à l'app de la session : un lot d'une autre app qui citerait cet
    // identifiant (émis par le client) ne s'ajoute jamais au replay.
    const chunks = await q<ChunkRow>(
      `select seq, events_count, body from replay_chunk
       where session_id = $1 and app_id = $2 order by seq`,
      [sessionId, appId],
    );

    const events: unknown[] = [];
    for (const c of chunks) {
      try {
        const parsed: unknown = JSON.parse(gunzipSync(c.body).toString("utf8"));
        if (Array.isArray(parsed)) events.push(...parsed);
      } catch {
        /* chunk corrompu : ignoré, le reste du replay reste lisible */
      }
    }
    return NextResponse.json({ sessionId, chunks: chunks.length, events });
  });
}
