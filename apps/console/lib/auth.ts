// Authentification console v0.3 (chantier B3) — JWT HS256 (jose) en cookie
// httpOnly + RBAC admin/viewer. Le cœur JWT est sans import next/* statique :
// le fichier est partagé entre le middleware (edge) et les server components
// (next/headers et next/navigation sont importés dynamiquement à l'usage).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "mip_session";
export const SESSION_HOURS = 8;

export interface SessionUser {
  email: string;
  role: "admin" | "viewer";
  apps: string[] | null; // null = toutes les apps
}

const DEV_SECRET = "dev-secret-mip-rum";
let warned = false;

/**
 * Résout le secret de signature JWT. En production AUTH_SECRET est OBLIGATOIRE
 * (fail-closed) : sans lui, le cookie de session serait signé avec le secret de dev
 * versionné dans le repo → un attaquant pourrait forger un cookie admin. Hors prod,
 * fallback toléré (avertissement unique). Pur/testable (env injectable).
 */
export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.AUTH_SECRET;
  if (s) return s;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "[mip-rum] AUTH_SECRET obligatoire en production : refus de signer une session avec le secret de dev.",
    );
  }
  if (!warned) {
    warned = true;
    console.warn(
      "[mip-rum] AUTH_SECRET absent — secret de dev utilisé (à NE PAS faire en prod)",
    );
  }
  return DEV_SECRET;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(resolveAuthSecret());
}

export async function signJwt(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role, apps: user.apps })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export async function verifyJwt(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.email !== "string") return null;
    if (payload.role !== "admin" && payload.role !== "viewer") return null;
    const apps = Array.isArray(payload.apps)
      ? (payload.apps.filter((a) => typeof a === "string") as string[])
      : null;
    return { email: payload.email, role: payload.role, apps };
  } catch {
    return null; // token absent/expiré/falsifié -> non connecté
  }
}

/** Utilisateur courant (server components / server actions), null si non connecté. */
export async function getUser(): Promise<SessionUser | null> {
  const { cookies } = await import("next/headers");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifyJwt(token) : null;
}

/** Garde des pages /admin : redirige /login (anonyme) ou / (viewer). */
export async function requireAdmin(): Promise<SessionUser> {
  const { redirect } = await import("next/navigation");
  const user = await getUser();
  if (!user) redirect("/login");
  if (user!.role !== "admin") redirect("/");
  return user as SessionUser;
}

/**
 * Scoping viewer : app effective pour une app demandée.
 * Admin ou viewer non scopé -> app demandée ; viewer scopé -> app demandée si
 * autorisée, sinon fallback sur la 1re app autorisée (jamais « toutes »).
 */
export function allowedApps(user: SessionUser | null, requestedApp: string | null): string | null {
  if (!user || user.role === "admin" || !user.apps?.length) return requestedApp;
  return requestedApp && user.apps.includes(requestedApp) ? requestedApp : user.apps[0];
}

// Affichage unique des mots de passe générés (création / reset) : stash mémoire
// court (5 min) consommé au premier rendu — jamais de secret dans l'URL ni en base
// en clair. globalThis pour survivre au hot-reload de next dev (même motif que db.ts).
const g = globalThis as unknown as { mipOnceStore?: Map<string, { value: string; exp: number }> };
const onceStore = (g.mipOnceStore ??= new Map());

export function stashSecret(value: string): string {
  for (const [k, v] of onceStore) if (v.exp < Date.now()) onceStore.delete(k);
  const token = crypto.randomUUID();
  onceStore.set(token, { value, exp: Date.now() + 5 * 60_000 });
  return token;
}

export function popSecret(token: string): string | null {
  const e = onceStore.get(token);
  onceStore.delete(token);
  return e && e.exp > Date.now() ? e.value : null;
}
