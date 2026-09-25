// POST /api/v1/deploys — enregistre un marqueur de déploiement (Voie A · inc. 3).
// Point d'intégration CI/CD : la pipeline signale un déploiement, croisé ensuite
// aux métriques RUM pour détecter « la régression a commencé après le déploiement
// X ». Le middleware laisse passer /api/v1 (auth dans le handler).
//
// C11 — DEUX JETONS, UNE FENÊTRE.
//   · Le jeton de CI `deploys:write` (migration-v92), créé dans /admin/sourcemaps
//     pour UNE application : le chemin du collector, qui sert la même route
//     (`/v1/deploys`). Le relais d'ingestion la lui transmet quand il est allumé ;
//     sinon la console l'écrit elle-même, par le même code et avec les mêmes
//     refus (`@mip/backend/lib/deploiements.mjs`, contrat de parité).
//   · Un jeton d'API de CONSOLE_API_TOKENS : l'ancien chemin, accepté jusqu'à
//     `FIN_JETONS_HISTORIQUES` et annoncé comme tel (`Deprecation`, `Sunset`,
//     RFC 8594). Le collector ne le lit pas.
// Une session n'a rien à faire ici — y compris la démo, distribuée à quiconque
// ouvre /demo : un marqueur fabriqué décale la lecture des régressions.
import { NextResponse } from "next/server";
import {
  CORPS_DEPLOIEMENT_MAX,
  FIN_JETONS_HISTORIQUES,
  lireDeploiement,
  PRIVILEGE_DEPLOIEMENT,
  REFUS_DEPLOIEMENT,
} from "@mip/backend/lib/deploiements.mjs";
import { lireJetonUpload, verifierJetonUpload } from "@mip/backend/lib/sourcemap-upload.mjs";
import { lireCorpsBorne } from "@mip/backend/shared/limits.mjs";
import { authenticateApi } from "@/lib/api/auth";
import { SESSION_COOKIE } from "@/lib/auth";
import { pool } from "@/lib/db";
import { relayer } from "@/lib/ingest-relay";
import { recordDeploy } from "@/lib/queries-deploys";
import { authorizedAppsOf } from "@/lib/query-contract";

export const dynamic = "force-dynamic";

const refus = (status: number, error: string, entetes: Record<string, string> = {}) =>
  NextResponse.json({ error }, { status, headers: entetes });

/** L'annonce de la fin de l'ancien chemin (RFC 8594), sur chacune de ses réponses. */
const HISTORIQUE = {
  deprecation: "true",
  sunset: new Date(FIN_JETONS_HISTORIQUES).toUTCString(),
  link: '</docs/integration/sourcemaps-ci.md>; rel="deprecation"',
};

/** Le cookie de session, lu dans l'en-tête de la requête (une session est refusée ici). */
function cookieDeSession(entete: string | null): string | null {
  for (const morceau of (entete ?? "").split(";")) {
    const i = morceau.indexOf("=");
    if (i > 0 && morceau.slice(0, i).trim() === SESSION_COOKIE) return decodeURIComponent(morceau.slice(i + 1).trim());
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const authorization = req.headers.get("authorization");
  // Lu une fois, borné : il sert au relais ET au chemin local.
  const corps = await lireCorpsBorne(req.body as AsyncIterable<Uint8Array> | null, CORPS_DEPLOIEMENT_MAX);

  // ── Le jeton de CI `deploys:write` : le chemin du collector ──
  if (lireJetonUpload(authorization)) {
    if (!corps) return refus(413, REFUS_DEPLOIEMENT.tropGros);
    const relayee = await relayer("deploys", req, corps, {});
    if (relayee) return relayee;
    // Dans l'ordre du collector : le jeton, puis le corps.
    const jeton = await verifierJetonUpload(pool, authorization, PRIVILEGE_DEPLOIEMENT);
    if (!jeton) return refus(401, REFUS_DEPLOIEMENT.jetonInvalide);
    const lu = lireCorpsJson(corps);
    if ("erreur" in lu) return refus(400, lu.erreur);
    if (lu.appId !== jeton.app_id) return refus(403, REFUS_DEPLOIEMENT.horsPerimetre(lu.appId));
    await recordDeploy(lu.appId, lu.version, lu.env, "ci", lu.ts ?? undefined);
    return NextResponse.json({ ok: true, app_id: lu.appId, version: lu.version, env: lu.env }, { status: 201 });
  }

  // ── L'ancien chemin : un jeton de CONSOLE_API_TOKENS, jusqu'à la fin annoncée ──
  const principal = await authenticateApi(authorization, cookieDeSession(req.headers.get("cookie")));
  if (!principal) return refus(401, REFUS_DEPLOIEMENT.sansJeton);
  if (principal.kind === "session") {
    return refus(403, "réservé à un jeton d'intégration (Authorization: Bearer <jeton de CI deploys:write>)");
  }
  if (Date.now() > Date.parse(FIN_JETONS_HISTORIQUES)) {
    return refus(401, "les jetons d'API ne posent plus de marqueur : jeton de CI « deploys:write » requis", HISTORIQUE);
  }
  if (!corps) return refus(413, REFUS_DEPLOIEMENT.tropGros, HISTORIQUE);
  const lu = lireCorpsJson(corps);
  if ("erreur" in lu) return refus(400, lu.erreur, HISTORIQUE);
  // scope : le principal doit avoir accès à cette app (null = toutes, [] = aucune)
  const authorized = authorizedAppsOf(principal);
  if (authorized !== null && !authorized.includes(lu.appId)) return refus(403, REFUS_DEPLOIEMENT.horsPerimetre(lu.appId), HISTORIQUE);
  await recordDeploy(lu.appId, lu.version, lu.env, "ci", lu.ts ?? undefined);
  return NextResponse.json({ ok: true, app_id: lu.appId, version: lu.version, env: lu.env }, { status: 201, headers: HISTORIQUE });
}

function lireCorpsJson(corps: Uint8Array) {
  let brut: unknown;
  try {
    brut = JSON.parse(new TextDecoder().decode(corps));
  } catch {
    return { erreur: "corps JSON invalide" };
  }
  const lu = lireDeploiement(brut);
  return lu.erreur !== undefined ? { erreur: lu.erreur } : lu.deploiement;
}
