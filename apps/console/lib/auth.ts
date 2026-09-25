// Authentification console v0.3 (chantier B3) — JWT HS256 (jose) en cookie
// httpOnly + RBAC admin/viewer. Le cœur JWT est sans import next/* statique :
// le fichier est partagé entre le middleware (runtime Node) et les server
// components (next/headers et next/navigation sont importés dynamiquement).
//
// C1 — DEUX FORMATS DE SESSION pendant la bascule : le HS256 d'ici (rôle et
// périmètre dans le jeton), et l'ES256 de console-api (un identifiant de
// session ; rôle et périmètre relus par `GET /v1/me`, voir `session-console.ts`).
// `principalDeJeton` aiguille ; tout le reste de la console ne voit qu'un
// `SessionUser`, quel que soit le format.
import { SignJWT, jwtVerify } from "jose";
import { algorithmeDuJeton, principalConsoleApi } from "./session-console";

export const SESSION_COOKIE = "mip_session";
export const SESSION_HOURS = 8;

export interface SessionUser {
  email: string;
  role: "admin" | "viewer";
  apps: string[] | null; // null = toutes les apps ; [] = aucune (lib/query-contract.ts)
  /**
   * Session ouverte par /demo, sans mot de passe, pour un visiteur de la
   * vitrine. Portée dans le JWT donc infalsifiable côté client, et lue par le
   * middleware qui refuse toute requête non-GET : une session démo est en
   * LECTURE SEULE, quoi que fasse la page. Sans cette borne, n'importe quel
   * visiteur pourrait créer une règle d'alerte avec un webhook vers l'URL de
   * son choix (app/alerts/actions.ts ne porte aucune garde de rôle).
   */
  demo?: boolean;
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
  return new SignJWT({
    email: user.email,
    role: user.role,
    apps: user.apps,
    ...(user.demo ? { demo: true } : {}),
  })
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
    return { email: payload.email, role: payload.role, apps, demo: payload.demo === true };
  } catch {
    return null; // token absent/expiré/falsifié -> non connecté
  }
}

/**
 * Mémo court des principaux ES256 : un rendu appelle `getUser` depuis le layout,
 * la page et plusieurs composants, à quelques millisecondes d'écart — un seul
 * appel à `/v1/me` pour eux tous. 2 s, loin sous le délai de révocation du
 * service (30 s) ; une panne n'est jamais mémorisée.
 */
const memoPrincipaux = new Map<string, { principal: Promise<SessionUser | null>; jusqua: number }>();
const MEMO_PRINCIPAL_MS = 2_000;

/** Le principal d'un cookie de session, quel qu'en soit le format ; `null` s'il ne vaut rien. */
export async function principalDeJeton(token: string, requestId?: string): Promise<SessionUser | null> {
  if (algorithmeDuJeton(token) !== "ES256") return verifyJwt(token);
  const maintenant = Date.now();
  for (const [cle, v] of memoPrincipaux) if (v.jusqua <= maintenant) memoPrincipaux.delete(cle);
  const connu = memoPrincipaux.get(token);
  if (connu) return connu.principal;
  if (memoPrincipaux.size >= 1_000) memoPrincipaux.delete(memoPrincipaux.keys().next().value!);
  const principal = principalConsoleApi(token, { requestId });
  memoPrincipaux.set(token, { principal, jusqua: maintenant + MEMO_PRINCIPAL_MS });
  principal.catch(() => memoPrincipaux.delete(token));
  return principal;
}

/** Oublie le principal mémorisé d'un jeton : sa session vient d'être révoquée par CE processus. */
export function oublierPrincipal(token: string): void {
  memoPrincipaux.delete(token);
}

/**
 * Utilisateur courant (server components / server actions), null si non connecté.
 * Lève si console-api ne peut pas répondre (session ES256) : l'écran d'erreur le
 * dit, plutôt qu'un renvoi à /login qui ferait croire à une session perdue.
 */
export async function getUser(): Promise<SessionUser | null> {
  const entetes = await import("next/headers");
  const token = (await entetes.cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  if (algorithmeDuJeton(token) !== "ES256") return verifyJwt(token);
  // L'identifiant de la requête suit l'appel à console-api : la même « réf. » partout.
  return principalDeJeton(token, (await entetes.headers()).get("x-request-id") ?? undefined);
}

/** Garde des pages /admin : redirige /login (anonyme) ou / (viewer). */
export async function requireAdmin(): Promise<SessionUser> {
  const { redirect } = await import("next/navigation");
  const user = await getUser();
  if (!user) redirect("/login");
  if (user!.role !== "admin") redirect("/");
  return user as SessionUser;
}
