// POST /api/sourcemaps — upload de source maps (P0 #3). Admin requis (cookie de
// session). Body JSON : { appId, release, filename, content } ou { appId, release,
// maps: [{filename, content}] }. content = JSON de la source map v3 (string ou objet).
// La dé-minification se fait à l'affichage (lib/sourcemap.ts), pas ici.
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifyJwt } from "@/lib/auth";
import { upsertSourceMap } from "@/lib/queries-sourcemap";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024; // 15 Mo par map

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifyJwt(token) : null;
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "admin requis" }, { status: 403 });

  let body: {
    appId?: string;
    release?: string;
    filename?: string;
    content?: unknown;
    maps?: { filename?: string; content?: unknown }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const appId = String(body.appId ?? "").trim();
  const release = String(body.release ?? "").trim();
  const maps = Array.isArray(body.maps)
    ? body.maps
    : body.filename
      ? [{ filename: body.filename, content: body.content }]
      : [];
  if (!appId || !release || !maps.length)
    return NextResponse.json(
      { error: "appId, release et au moins une map (filename + content) requis" },
      { status: 400 },
    );

  let uploaded = 0;
  for (const m of maps) {
    const filename = String(m.filename ?? "").trim();
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    if (!filename || !content) continue;
    if (content.length > MAX_BYTES)
      return NextResponse.json({ error: `source map trop volumineuse (${filename})` }, { status: 413 });
    // validation légère : c'est bien une source map v3 (champ mappings string)
    try {
      const j = JSON.parse(content) as { mappings?: unknown };
      if (typeof j.mappings !== "string") throw new Error("mappings absent");
    } catch {
      return NextResponse.json({ error: `source map invalide (${filename})` }, { status: 400 });
    }
    await upsertSourceMap(appId, release, filename, content);
    uploaded++;
  }
  return NextResponse.json({ uploaded });
}
