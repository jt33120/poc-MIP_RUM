// POST /api/sourcemaps — upload de source maps, port console (P5.4).
// GET  /api/sourcemaps — releases d'une app, ou fichiers et manifeste d'une release (admin).
//
// Deux authentifications, jamais mélangées : `Authorization: Bearer msu_…` (jeton
// de CI dédié, app-scopé, expirant) OU cookie de session admin avec Origin de la
// console. Le contrat — bornes, validation de TOUTES les maps avant la première
// écriture, transaction, 409 sur contenu différent — est celui du backend direct
// (`@mip/backend/lib/sourcemap-upload.mjs`).
//
// C12 (06/10/2026) — la branche JETON (la CI, la collecte) est RELAYÉE au
// collector, sans chemin local : il vérifie le jeton, le débit et le contrat, et
// écrit. La branche SESSION ADMIN (envoi depuis l'écran) et la lecture (GET)
// restent à la console : ce n'est pas de la collecte, et le collector ne lit pas
// les sessions.
//
// Corps limité à 4 Mio : le plafond publié de Vercel est 4,5 Mo par requête. Les
// maps plus lourdes passent par POST /v1/sourcemaps du backend d'ingestion
// (15 Mio par map), que le CLI sait viser.
import { type NextRequest, NextResponse } from "next/server";
import {
  creerLimiteurUpload,
  enregistrerMaps,
  ErreurUpload,
  LIMITES_UPLOAD,
  lireCorpsLimite,
  lireRequeteUpload,
} from "@mip/backend/lib/sourcemap-upload.mjs";
import { bodyTooLarge } from "@mip/backend/shared/limits.mjs";
import { guardAdmin } from "@/lib/api/admin";
import { SESSION_COOKIE } from "@/lib/auth";
import { pool } from "@/lib/db";
import { relayer } from "@/lib/ingest-relay";
import { listSourcemapReleases, releaseManifest, schemaSourcemapAbsent } from "@/lib/queries-sourcemap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// PLAFOND EXPLICITE de la fonction : 30 s. La chaîne des délais doit rester
// croissante — collector 4 s (budget dur, 503) < sonde /health (2 s) + relais
// 8 s (`DELAIS`) < fonction. Sans ce plafond, le défaut du projet tuerait la
// fonction AVANT le 503 du relais — un 504 FUNCTION_INVOCATION_TIMEOUT muet.
// Voir le mode d'emploi du relais d'ingestion.
export const maxDuration = 30;

const PORT_DIRECT =
  "corps trop volumineux pour le port console (limite 4 Mio) : utiliser POST /v1/sourcemaps du backend d'ingestion";

// Un limiteur par instance, survivant au rechargement à chaud de next dev.
const g = globalThis as unknown as { mipLimiteurSourcemaps?: ReturnType<typeof creerLimiteurUpload> };
const limiteur = (g.mipLimiteurSourcemaps ??= creerLimiteurUpload());

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers });

/**
 * Taille annoncée, puis lecture bornée (octets et durée). Les refus remontent
 * en `ErreurUpload` (400, 413), rendus par le `catch` de la route.
 */
async function lireCorps(req: NextRequest): Promise<Buffer> {
  if (bodyTooLarge(req.headers.get("content-length"), LIMITES_UPLOAD.corpsConsole)) throw new ErreurUpload(413, PORT_DIRECT);
  if (!req.body) throw new ErreurUpload(400, "corps JSON requis");
  // Le ReadableStream web de Node est itérable de façon asynchrone.
  return lireCorpsLimite(req.body as unknown as AsyncIterable<Uint8Array>, { max: LIMITES_UPLOAD.corpsConsole }).catch((err: unknown) => {
    throw err instanceof ErreurUpload && err.statut === 413 ? new ErreurUpload(413, PORT_DIRECT) : err;
  });
}

export async function POST(req: NextRequest) {
  let liberer: (() => void) | null = null;
  try {
    // 0. Branche JETON : relayée au collector, jamais écrite ici. Les bornes de
    // taille restent celles de ce port (4 Mio, plafond Vercel) : un corps trop
    // gros ne part pas à Railway. Pas de CORS : ce port sert la CI, de serveur à serveur.
    if (req.headers.get("authorization")) {
      return relayer("sourcemaps", req, await lireCorps(req), {});
    }

    // 1. Branche SESSION ADMIN : qui écrit, avant toute lecture du corps.
    const garde = await guardAdmin(req.headers, req.cookies.get(SESSION_COOKIE)?.value ?? null, { mutation: true });
    if (!garde.ok) return json({ error: garde.error }, garde.status);
    const par = garde.user.email;

    // 2. Débit, puis lecture bornée en octets et en durée.
    const prise = limiteur.prendre(par);
    if ("refus" in prise) return json({ error: prise.refus.message }, 429, { "retry-after": String(prise.refus.retryAfter) });
    liberer = prise.liberer;
    const corps = await lireCorps(req);

    // 3. Contrat complet, puis écriture.
    const demande = lireRequeteUpload(corps);
    const { statut, corps: reponse } = await enregistrerMaps(pool, { ...demande, par, jetonId: null });
    return json(reponse, statut);
  } catch (err) {
    if (err instanceof ErreurUpload) return json({ error: err.message }, err.statut);
    console.error("[api/sourcemaps]", err);
    return json({ error: "erreur interne" }, 500);
  } finally {
    liberer?.();
  }
}

export async function GET(req: NextRequest) {
  const garde = await guardAdmin(req.headers, req.cookies.get(SESSION_COOKIE)?.value ?? null, { mutation: false });
  if (!garde.ok) return json({ error: garde.error }, garde.status);
  const appId = req.nextUrl.searchParams.get("appId")?.trim();
  if (!appId) return json({ error: "appId requis" }, 400);
  const release = req.nextUrl.searchParams.get("release")?.trim() || null;
  try {
    if (!release) return json({ appId, releases: await listSourcemapReleases(appId) });
    const manifeste = await releaseManifest(appId, release);
    return json({ appId, release, ...manifeste });
  } catch (err) {
    if (schemaSourcemapAbsent(err)) return json({ error: "schéma source maps non migré : migration-v71 requise" }, 503);
    console.error("[api/sourcemaps]", err);
    return json({ error: "erreur interne" }, 500);
  }
}
