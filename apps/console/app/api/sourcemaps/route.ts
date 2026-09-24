// POST /api/sourcemaps — upload de source maps, port console (P5.4).
// GET  /api/sourcemaps — releases d'une app, ou fichiers et manifeste d'une release (admin).
//
// Deux authentifications, jamais mélangées : `Authorization: Bearer msu_…` (jeton
// de CI dédié, app-scopé, expirant) OU cookie de session admin avec Origin de la
// console. Un jeton CONSOLE_API_TOKENS n'a pas le format d'un jeton d'upload : il
// est refusé. Le contrat — bornes, validation de TOUTES les maps avant la première
// écriture, transaction, 409 sur contenu différent — est celui du backend direct
// (`@mip/backend/lib/sourcemap-upload.mjs`).
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
  verifierJetonUpload,
} from "@mip/backend/lib/sourcemap-upload.mjs";
import { bodyTooLarge } from "@mip/backend/shared/limits.mjs";
import { guardAdmin } from "@/lib/api/admin";
import { SESSION_COOKIE } from "@/lib/auth";
import { pool } from "@/lib/db";
import { choisirRelais } from "@/lib/ingest-relay";
import { listSourcemapReleases, releaseManifest, schemaSourcemapAbsent } from "@/lib/queries-sourcemap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// PLAFOND EXPLICITE de la fonction : 30 s. La chaîne des délais doit rester
// croissante — collector 4 s (budget dur, 503) < relais 8 s (`DELAIS.relaisMs`)
// < fonction 30 s. Au pire, une requête enchaîne drapeau (1,5 s), sonde /health
// (2 s), relais (8 s) puis, sur un repli tardif, l'écriture locale (reprises,
// verrou) : ~27 s. Sans ce plafond, le défaut du projet (10 s en Hobby, 15 s
// en Pro hors Fluid) tuerait la fonction AVANT le 503 du relais — un 504
// FUNCTION_INVOCATION_TIMEOUT muet, sans « relay timeout » au journal.
// Voir docs/operations/relais-ingestion.md.
export const maxDuration = 30;

const PORT_DIRECT =
  "corps trop volumineux pour le port console (limite 4 Mio) : utiliser POST /v1/sourcemaps du backend d'ingestion";

// Un limiteur par instance, survivant au rechargement à chaud de next dev.
const g = globalThis as unknown as { mipLimiteurSourcemaps?: ReturnType<typeof creerLimiteurUpload> };
const limiteur = (g.mipLimiteurSourcemaps ??= creerLimiteurUpload());

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers });

export async function POST(req: NextRequest) {
  let liberer: (() => void) | null = null;
  try {
    const authorization = req.headers.get("authorization");
    // Corps déjà lu par le relais (P3) ; sur un repli, le chemin local le reprend.
    let dejaLu: Buffer | null = null;

    // 0. P3 — RELAIS vers le collector, branche JETON seulement (la session
    // admin reste l'affaire de la console). Le jeton, le débit et le contrat
    // sont vérifiés par le collector : le chemin relayé ne touche pas la base.
    // Les bornes de taille restent celles de ce port (4 Mio, plafond Vercel).
    if (authorization) {
      const relais = await choisirRelais("sourcemaps");
      if (relais) {
        if (bodyTooLarge(req.headers.get("content-length"), LIMITES_UPLOAD.corpsConsole)) return json({ error: PORT_DIRECT }, 413);
        if (!req.body) return json({ error: "corps JSON requis" }, 400);
        dejaLu = await lireCorpsLimite(req.body as unknown as AsyncIterable<Uint8Array>, { max: LIMITES_UPLOAD.corpsConsole }).catch((err: unknown) => {
          throw err instanceof ErreurUpload && err.statut === 413 ? new ErreurUpload(413, PORT_DIRECT) : err;
        });
        // Pas de CORS : ce port sert la CI, de serveur à serveur.
        const relayee = await relais.envoyer(req, dejaLu, {});
        if (relayee) return relayee;
      }
    }

    // 1. Qui écrit — avant toute lecture du corps (hors repli du relais).
    let par: string;
    let jetonId: string | null = null;
    let appDuJeton: string | null = null;
    if (authorization) {
      const jeton = await verifierJetonUpload(pool, authorization);
      if (!jeton) return json({ error: "jeton d'upload de source maps invalide, expiré ou révoqué" }, 401);
      par = `jeton:${jeton.id}`;
      jetonId = jeton.id;
      appDuJeton = jeton.app_id;
    } else {
      const garde = await guardAdmin(req.headers, req.cookies.get(SESSION_COOKIE)?.value ?? null, { mutation: true });
      if (!garde.ok) return json({ error: garde.error }, garde.status);
      par = garde.user.email;
    }

    // 2. Débit et taille annoncée, puis lecture bornée en octets et en durée.
    const prise = limiteur.prendre(par);
    if ("refus" in prise) return json({ error: prise.refus.message }, 429, { "retry-after": String(prise.refus.retryAfter) });
    liberer = prise.liberer;
    let corps: Buffer;
    if (dejaLu) {
      corps = dejaLu;
    } else {
      if (bodyTooLarge(req.headers.get("content-length"), LIMITES_UPLOAD.corpsConsole)) return json({ error: PORT_DIRECT }, 413);
      if (!req.body) return json({ error: "corps JSON requis" }, 400);
      // Le ReadableStream web de Node est itérable de façon asynchrone.
      const flux = req.body as unknown as AsyncIterable<Uint8Array>;
      corps = await lireCorpsLimite(flux, { max: LIMITES_UPLOAD.corpsConsole }).catch((err: unknown) => {
        throw err instanceof ErreurUpload && err.statut === 413 ? new ErreurUpload(413, PORT_DIRECT) : err;
      });
    }

    // 3. Contrat complet, puis droits propres à l'émetteur.
    const demande = lireRequeteUpload(corps);
    if (appDuJeton !== null && demande.appId !== appDuJeton) {
      return json({ error: "ce jeton n'autorise pas l'upload de source maps pour cette application" }, 403);
    }
    if (jetonId !== null && demande.remplacer) {
      return json({ error: "remplacer une source map existante est réservé à un admin, depuis la console" }, 403);
    }
    const { statut, corps: reponse } = await enregistrerMaps(pool, { ...demande, par, jetonId });
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
