"use server";
// Server Action de login (B3) — bcryptjs.compare + JWT cookie httpOnly 8 h + audit.
// Message d'erreur générique et comparaison systématique (hash factice si email
// inconnu) : pas d'énumération d'utilisateurs, ni par le message ni par le timing.
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { CONNEXION } from "@mip/console-contract";
import { SESSION_COOKIE, SESSION_HOURS, signJwt, type SessionUser } from "@/lib/auth";
import { backend } from "@/lib/backend";
import { ipVisiteur } from "@/lib/ip-visiteur";
import { q } from "@/lib/db";
import { forwardLog } from "@/lib/log-forward";

const DUMMY_HASH = bcrypt.hashSync("mip-rum-dummy", 10);

// Anti-brute-force : on ne compte QUE les ÉCHECS par (IP + email) sur une fenêtre
// glissante. Un utilisateur (ou l'E2E) qui se connecte correctement n'est jamais
// throttlé ; seul le bourrage de mots de passe l'est. Best-effort par isolat
// (serverless) — première barrière ; un store partagé (Redis/PG) serait requis
// pour une garantie stricte multi-instance.
const LOGIN_MAX_FAILS = 8;
const LOGIN_WINDOW_MS = 10 * 60_000;
const loginFails = new Map<string, number[]>();

function recentFails(key: string, now: number): number[] {
  const hits = (loginFails.get(key) ?? []).filter((t) => t > now - LOGIN_WINDOW_MS);
  loginFails.set(key, hits);
  return hits;
}

/** IP client depuis les en-têtes proxy (Vercel/CDN). */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

const COOKIE = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" } as const;

/**
 * C1 — LA CONNEXION PAR console-api, quand la console y est branchée. Le service
 * vérifie le mot de passe, compte les échecs EN BASE (toutes répliques), ouvre
 * une LIGNE de session et rend un jeton ES256 qui ne porte que son identifiant.
 * La console ne fait que poser le cookie. Sans branchement, le chemin
 * d'aujourd'hui, plus bas, reste le seul.
 */
async function connexionParConsoleApi(email: string, password: string): Promise<never> {
  const h = await headers();
  const r = await backend().appeler(
    CONNEXION,
    { corps: { email, mot_de_passe: password } },
    { ipVisiteur: ipVisiteur(h), requestId: h.get("x-request-id") ?? undefined },
  );
  if (!r.ok) {
    // Identifiants refusés, trop de tentatives, entrée invalide : le même message
    // générique qu'aujourd'hui — il ne dit ni si le compte existe, ni s'il est bloqué.
    if (r.code === "identifiants_refuses" || r.code === "debit_depasse" || r.code === "entree_invalide") redirect("/login?error=1");
    after(() => forwardLog("error", "connexion impossible : console-api indisponible", { code: r.code, request_id: r.requestId ?? undefined }));
    redirect("/login?error=indisponible");
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, r.data.jeton, { ...COOKIE, expires: new Date(r.data.expire_le) });
  if (r.data.connexion_precedente) jar.set("mip-prev-login", r.data.connexion_precedente, { ...COOKIE, maxAge: SESSION_HOURS * 3600 });
  after(() => forwardLog("info", "connexion console (console-api)", { request_id: r.requestId }));
  redirect("/");
}

async function auditFail(email: string, action: string, detail: string | null): Promise<void> {
  try {
    await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [
      email.slice(0, 200),
      action,
      detail,
    ]);
  } catch {
    /* best-effort : la journalisation ne doit pas bloquer le login */
  }
}

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
  if (backend().estBranche()) await connexionParConsoleApi(email, password);

  // 1) trop d'ÉCHECS récents pour cette IP+email -> blocage AVANT le bcrypt (coûteux),
  // réponse générique (pas d'énumération). Les connexions réussies ne comptent pas.
  const ip = await clientIp();
  const key = `login:${ip}:${email}`;
  if (recentFails(key, Date.now()).length >= LOGIN_MAX_FAILS) {
    after(() => auditFail(email, "login_blocked", JSON.stringify({ ip })));
    redirect("/login?error=1");
  }

  const [u] = await q<UserRow>(
    `select email, password_hash, role, apps, active, last_login_at from console_user where email = $1`,
    [email],
  );
  const ok = (await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH)) && u?.active === true;
  if (!ok) {
    recentFails(key, Date.now()).push(Date.now()); // enregistre l'échec
    after(() => auditFail(email, "login_failed", null));
    redirect("/login?error=1");
  }
  loginFails.delete(key); // succès : on repart de zéro pour cette clé

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
  // Dogfooding : trace la connexion dans la page /logs (après la réponse, best-effort).
  after(() => forwardLog("info", `connexion console (${u.role})`, { user: u.email }));
  redirect("/");
}
