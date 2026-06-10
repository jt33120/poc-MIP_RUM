// GET /api/replay/[sessionId] — reconstruit le replay : chunks bytea gzip
// (replay_chunk) -> gunzip -> concat -> JSON des events rrweb pour le player.
// Auth : protégée par le middleware global (B3, JWT cookie) — rien à gérer ici.
import { NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ChunkRow {
  seq: number;
  events_count: number | null;
  body: Buffer; // gzip (stocké compressé à l'ingestion)
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  // scoping viewer : refuse les sessions d'apps hors périmètre
  const { getUser } = await import("@/lib/auth");
  const user = await getUser();
  if (user?.apps) {
    const owner = await q<{ app_id: string }>(
      `select app_id from rum_session where session_id = $1`,
      [sessionId],
    );
    if (!owner[0] || !user.apps.includes(owner[0].app_id)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  const chunks = await q<ChunkRow>(
    `select seq, events_count, body from replay_chunk
     where session_id = $1 order by seq`,
    [sessionId],
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
}
