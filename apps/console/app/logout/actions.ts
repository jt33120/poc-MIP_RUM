"use server";
// Déconnexion (B3) : audit + clear cookie + retour /login.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getUser } from "@/lib/auth";
import { q } from "@/lib/db";

export async function logoutAction(): Promise<void> {
  const user = await getUser();
  if (user) {
    await q(`insert into audit_log (user_email, action, detail) values ($1, 'logout', null)`, [
      user.email,
    ]);
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
