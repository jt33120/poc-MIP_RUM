// GET  /api/admin/sourcemap-tokens[?appId=] — jetons de CI d'upload de source maps.
// POST /api/admin/sourcemap-tokens          — { appId, name, expiresInDays? } → secret rendu UNE fois.
//
// Session admin uniquement (jamais démo, jamais jeton), Origin de la console pour
// la création. La réponse de liste ne porte que identifiant, nom, app, dates de
// création, d'expiration, de dernière utilisation et de révocation : ni secret,
// ni hash. Chaque création est tracée dans audit_log.
import { type NextRequest, NextResponse } from "next/server";
import { ErreurUpload, lireCorpsLimite } from "ingest/lib/sourcemap-upload.mjs";
import { guardAdmin } from "@/lib/api/admin";
import { SESSION_COOKIE } from "@/lib/auth";
import { schemaSourcemapAbsent } from "@/lib/queries-sourcemap";
import { createSourcemapToken, listSourcemapTokens, parseTokenRequest } from "@/lib/queries-sourcemap-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Un corps de création tient en quelques centaines d'octets. */
const MAX_CORPS = 16 * 1024;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

function echec(err: unknown) {
  if (schemaSourcemapAbsent(err)) return json({ error: "schéma source maps non migré : migration-v71 requise" }, 503);
  console.error("[api/admin/sourcemap-tokens]", err);
  return json({ error: "erreur interne" }, 500);
}

export async function GET(req: NextRequest) {
  const garde = await guardAdmin(req.headers, req.cookies.get(SESSION_COOKIE)?.value ?? null, { mutation: false });
  if (!garde.ok) return json({ error: garde.error }, garde.status);
  const appId = req.nextUrl.searchParams.get("appId")?.trim() || null;
  try {
    return json({ tokens: await listSourcemapTokens(appId) });
  } catch (err) {
    return echec(err);
  }
}

export async function POST(req: NextRequest) {
  const garde = await guardAdmin(req.headers, req.cookies.get(SESSION_COOKIE)?.value ?? null, { mutation: true });
  if (!garde.ok) return json({ error: garde.error }, garde.status);
  if (!req.body) return json({ error: "JSON invalide" }, 400);
  let corps: unknown;
  try {
    // Le ReadableStream web de Node est itérable de façon asynchrone.
    const flux = req.body as unknown as AsyncIterable<Uint8Array>;
    corps = JSON.parse((await lireCorpsLimite(flux, { max: MAX_CORPS })).toString("utf8"));
  } catch (err) {
    if (err instanceof ErreurUpload) return json({ error: err.message }, err.statut);
    return json({ error: "JSON invalide" }, 400);
  }
  const demande = parseTokenRequest(corps);
  if (!demande.ok) return json({ error: demande.error }, 400);
  try {
    const cree = await createSourcemapToken(demande, garde.user.email);
    if (!cree) return json({ error: `application inconnue : ${demande.appId}` }, 404);
    return json(cree, 201);
  } catch (err) {
    return echec(err);
  }
}
