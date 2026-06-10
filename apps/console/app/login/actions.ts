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
}

export async function loginAction(fd: FormData): Promise<void> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const [u] = await q<UserRow>(
    `select email, password_hash, role, apps, active from console_user where email = $1`,
    [email],
  );
  const ok = (await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH)) && u?.active === true;
  if (!ok) redirect("/login?error=1");

  const user: SessionUser = { email: u.email, role: u.role, apps: u.apps };
  (await cookies()).set(SESSION_COOKIE, await signJwt(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  await q(`update console_user set last_login_at = now() where email = $1`, [u.email]);
  await q(`insert into audit_log (user_email, action, detail) values ($1, 'login', null)`, [u.email]);
  redirect("/");
}
