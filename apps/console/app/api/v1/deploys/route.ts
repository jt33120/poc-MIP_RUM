// POST /api/v1/deploys — enregistre un marqueur de déploiement (Voie A · inc. 3).
// Point d'intégration CI/CD : la pipeline signale un déploiement, croisé ensuite
// aux métriques RUM pour détecter « la régression a commencé après le déploiement
// X ». Auth machine (Bearer CONSOLE_API_TOKENS, scopé par app) ou cookie de
// session. Le middleware laisse passer /api/v1 (auth dans le handler).
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authenticateApi } from "@/lib/api/auth";
import { SESSION_COOKIE } from "@/lib/auth";
import { recordDeploy } from "@/lib/queries-deploys";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cookieToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  const principal = await authenticateApi(req.headers.get("authorization"), cookieToken);
  if (!principal) {
    return NextResponse.json(
      { error: "authentification requise (Authorization: Bearer <token> ou session)" },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "corps JSON invalide" }, { status: 400 });
  }

  const appId = typeof body.app_id === "string" ? body.app_id.trim() : "";
  if (!appId) return NextResponse.json({ error: "app_id requis" }, { status: 400 });
  // scope : le principal doit avoir accès à cette app (null = toutes)
  if (principal.apps && !principal.apps.includes(appId)) {
    return NextResponse.json({ error: `app hors périmètre: ${appId}` }, { status: 403 });
  }

  const version = typeof body.version === "string" ? body.version.slice(0, 200) : null;
  const env = typeof body.env === "string" ? body.env.slice(0, 40) : "prod";
  const source = principal.kind === "token" ? "ci" : "manual";
  let ts: Date | undefined;
  if (body.ts != null) {
    const d = new Date(body.ts as string | number);
    if (!Number.isNaN(d.getTime())) ts = d;
  }

  await recordDeploy(appId, version, env, source, ts);
  return NextResponse.json({ ok: true, app_id: appId, version, env }, { status: 201 });
}
