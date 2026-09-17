// DELETE /api/admin/sourcemap-tokens/{id} — révoque un jeton de CI (P5.4).
//
// Session admin et Origin de la console. Révocation idempotente : la ligne est
// conservée (trace), l'audit n'est écrit qu'au passage effectif à « révoqué ».
// Un upload déjà authentifié est revérifié dans sa transaction : il échoue s'il
// n'a pas encore écrit.
import { type NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/api/admin";
import { SESSION_COOKIE } from "@/lib/auth";
import { schemaSourcemapAbsent } from "@/lib/queries-sourcemap";
import { revokeSourcemapToken } from "@/lib/queries-sourcemap-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const garde = await guardAdmin(req.headers, req.cookies.get(SESSION_COOKIE)?.value ?? null, { mutation: true });
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const { id } = await params;
  try {
    const token = await revokeSourcemapToken(id, garde.user.email);
    if (!token) return NextResponse.json({ error: "jeton introuvable" }, { status: 404 });
    return NextResponse.json({ token });
  } catch (err) {
    if (schemaSourcemapAbsent(err)) {
      return NextResponse.json({ error: "schéma source maps non migré : migration-v71 requise" }, { status: 503 });
    }
    console.error("[api/admin/sourcemap-tokens]", err);
    return NextResponse.json({ error: "erreur interne" }, { status: 500 });
  }
}
