"use server";
// Server Action de login (B3) — bcryptjs.compare + JWT cookie httpOnly 8 h + audit.
// Message d'erreur générique et comparaison systématique (hash factice si email
// inconnu) : pas d'énumération d'utilisateurs, ni par le message ni par le timing.
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_HOURS, signJwt, type SessionUser } from "@/lib/auth";
import { q } from "@/lib/db";

const DUMMY_HASH = bcrypt.hashSync("mip-rum-dummy", 10);

interface UserRow {
  email: string;
  password_hash: string;
  role: "admin" | "viewer";
  apps: string[] | null;
  active: boolean;
  last_login_at: string | null;
}

export async function loginAction(fd: FormData): Promise<void> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const [u] = await q<UserRow>(
    `select email, password_hash, role, apps, active, last_login_at from console_user where email = $1`,
    [email],
  );
  const ok = (await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH)) && u?.active === true;
  if (!ok) redirect("/login?error=1");

  const user: SessionUser = { email: u.email, role: u.role, apps: u.apps };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signJwt(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  // Borne « depuis la dernière connexion » pour le briefing d'accueil : on mémorise
  // la connexion PRÉCÉDENTE avant de l'écraser (absente au 1er login -> pas de cookie).
  if (u.last_login_at) {
    jar.set("mip-prev-login", new Date(u.last_login_at).toISOString(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_HOURS * 3600,
    });
  }
  await q(`update console_user set last_login_at = now() where email = $1`, [u.email]);
  await q(`insert into audit_log (user_email, action, detail) values ($1, 'login', null)`, [u.email]);
  redirect("/");
}
