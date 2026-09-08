// Accès démo : ouvre une session console SANS mot de passe, pour un visiteur de
// la vitrine publique qui clique « Voir le compte démo ».
//
// Trois bornes, parce que cette route donne un accès console à l'internet entier :
//
//  1. DÉSACTIVÉE PAR DÉFAUT. Sans la variable d'environnement DEMO_USER_EMAIL,
//     la route renvoie vers /login. Rien à désactiver après un déploiement :
//     il n'y a rien d'ouvert tant que personne ne l'a ouvert.
//  2. VIEWER UNIQUEMENT. Un compte admin est refusé même s'il est nommé dans la
//     variable — sinon une faute de frappe publierait la gestion des clients,
//     des utilisateurs et des clés d'API.
//  3. LECTURE SEULE. Le JWT porte `demo: true` et le middleware refuse toute
//     requête non-GET sur une session démo. Sans cette borne, un visiteur
//     pourrait créer une règle d'alerte avec un webhook vers l'URL de son choix
//     (app/alerts/actions.ts ne porte aucune garde de rôle).
//
// Ce que le visiteur VOIT reste décidé par le scope `apps` du compte désigné.
// Le pointer sur un compte qui voit les apps d'un vrai client publie les données
// de ce client — perfs, URL, messages d'erreur — sur une page sans mot de passe.
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_HOURS, signJwt, type SessionUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { demoEmail } from "@/lib/demo";

export const dynamic = "force-dynamic";

interface Row {
  email: string;
  role: "admin" | "viewer";
  apps: string[] | null;
  active: boolean;
}

export async function GET(req: Request): Promise<NextResponse> {
  const email = demoEmail();
  if (!email) return NextResponse.redirect(new URL("/login", req.url), 302);

  const [u] = await q<Row>(
    `select email, role, apps, active from console_user where email = $1`,
    [email],
  );

  // Compte absent, désactivé, ou admin : on n'ouvre rien et on le dit au journal.
  if (!u || !u.active || u.role !== "viewer") {
    await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [
      email,
      "demo_refused",
      JSON.stringify({
        raison: !u ? "compte absent" : !u.active ? "compte désactivé" : "compte admin",
      }),
    ]).catch(() => {
      /* best-effort : le journal ne doit pas décider de l'accès */
    });
    return NextResponse.redirect(new URL("/login", req.url), 302);
  }

  const user: SessionUser = { email: u.email, role: "viewer", apps: u.apps, demo: true };
  const res = NextResponse.redirect(new URL("/", req.url), 302);
  (await cookies()).set(SESSION_COOKIE, await signJwt(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });

  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
  await q(`insert into audit_log (user_email, action, detail) values ($1, 'demo_session', $2)`, [
    u.email,
    JSON.stringify({ ip }),
  ]).catch(() => {
    /* best-effort */
  });

  return res;
}
