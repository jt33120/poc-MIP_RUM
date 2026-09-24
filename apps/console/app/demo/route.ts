// Accès démo : ouvre une session console SANS mot de passe, pour un visiteur de
// la vitrine publique qui clique « Voir le compte démo ».
//
// Trois bornes, parce que cette route donne un accès console à l'internet entier :
//
//  1. DÉSACTIVÉE PAR DÉFAUT. Sans DEMO_USER_APPS, la route renvoie vers /login
//     et le bouton n'est pas rendu. Rien à désactiver après un déploiement : il
//     n'y a rien d'ouvert tant que personne ne l'a ouvert, et la refermer se
//     résume à retirer la variable.
//  2. VIEWER, ET SEULEMENT LES APPS NOMMÉES. Le rôle est écrit en dur ici, pas
//     lu d'une configuration : aucune valeur de variable ne peut produire une
//     session admin, ni une session voyant « toutes les apps ».
//  3. LECTURE SEULE. Le JWT porte `demo: true` et le middleware refuse toute
//     requête non-GET sur une session démo, à l'exception de /logout et /select
//     qui n'écrivent qu'un cookie. Sans cette borne, un visiteur pourrait créer
//     une règle d'alerte avec un webhook vers l'URL de son choix.
//
// Ce que le visiteur VOIT reste décidé par DEMO_USER_APPS. Y nommer l'app d'un
// vrai client publie les données de ce client — routes, temps de chargement,
// messages d'erreur — sur une page sans mot de passe.
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { DEMO } from "@mip/console-contract";
import { SESSION_COOKIE, SESSION_HOURS, signJwt, type SessionUser } from "@/lib/auth";
import { backend } from "@/lib/backend";
import { q } from "@/lib/db";
import { demoConfig } from "@/lib/demo";
import { ipVisiteur } from "@/lib/ip-visiteur";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const demo = demoConfig();
  if (!demo) return NextResponse.redirect(new URL("/login", req.url), 302);

  // C1 — branchée sur console-api, la démo s'y ouvre : une LIGNE de session
  // (révocable), viewer au périmètre du SERVICE (`DEMO_USER_APPS` de console-api),
  // 5 par heure et par IP comptées en base, et jamais l'IP au journal. La
  // variable de Vercel ne sert plus alors qu'à montrer ou cacher le bouton.
  if (backend().estBranche()) {
    const h = await headers();
    const r = await backend().appeler(DEMO, {}, { ipVisiteur: ipVisiteur(h), requestId: h.get("x-request-id") ?? undefined });
    if (!r.ok) return NextResponse.redirect(new URL("/login", req.url), 302);
    const res = NextResponse.redirect(new URL("/", req.url), 302);
    (await cookies()).set(SESSION_COOKIE, r.data.jeton, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(r.data.expire_le),
    });
    return res;
  }

  // `role` et `demo` ne viennent PAS de la configuration : une session démo est
  // une session viewer en lecture seule, quoi qu'on mette dans l'environnement.
  const user: SessionUser = {
    email: demo.email,
    role: "viewer",
    apps: demo.apps,
    demo: true,
  };

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
    demo.email,
    JSON.stringify({ ip, apps: demo.apps }),
  ]).catch(() => {
    /* best-effort : le journal ne doit pas décider de l'accès */
  });

  return res;
}
