// LES SESSIONS OUVERTES PAR console-api, vues de la console (C1).
//
// Deux jetons coexistent pendant la bascule :
//   · HS256 — celui d'aujourd'hui, signé par la console avec `AUTH_SECRET`,
//     qui porte rôle et périmètre (`lib/auth.ts`, `verifyJwt`). Il disparaît
//     quand `AUTH_SECRET` quitte Vercel (une reconnexion forcée) ;
//   · ES256 — signé par console-api, qui ne porte QUE l'identifiant de session
//     (et `demo: true` pour une démo). La console ne détient que la clé PUBLIQUE
//     (`SESSION_PUBLIC_JWKS`) : elle vérifie, elle ne signe jamais.
//
// Vérifier la signature ici ne suffit pas à connaître l'utilisateur : rôle et
// périmètre se relisent par `GET /v1/me` (console-api les relit en base). La
// signature sert à deux choses : ne pas déranger le service pour un jeton
// forgé, et lire `demo` sans appel — le middleware refuse toute écriture à une
// démo, et ce drapeau ne change jamais.
//
// ÉCHEC FERMÉ. Sans `SESSION_PUBLIC_JWKS` lisible, aucun jeton ES256 ne vaut. Et
// une réponse de console-api qui n'est ni un principal ni un refus de session
// (service injoignable, hôte non vérifié) N'EST PAS une déconnexion : elle lève,
// l'écran d'erreur le dit — renvoyer à /login quiconque tombe sur une panne
// ferait croire à une session perdue.
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { MOI } from "@mip/console-contract";
import type { SessionUser } from "./auth";
import { backend } from "./backend";

export const EMETTEUR = "mip-console-api";
export const AUDIENCE = "mip-console";

/** L'algorithme annoncé par un jeton, sans rien vérifier : l'aiguillage entre les deux formats. */
export function algorithmeDuJeton(jeton: string): string | null {
  try {
    return decodeProtectedHeader(jeton).alg ?? null;
  } catch {
    return null;
  }
}

export interface JetonConsoleApi {
  readonly sid: string;
  /** Secondes epoch. */
  readonly exp: number;
  readonly demo: boolean;
}

type Cle = Awaited<ReturnType<typeof importJWK>>;
let jeuLu: { brut: string; cles: Map<string, Cle> } | null = null;

async function clesPubliques(brut: string | undefined): Promise<Map<string, Cle> | null> {
  if (!brut) return null;
  if (jeuLu?.brut === brut) return jeuLu.cles;
  let jeu: { keys?: JWK[] };
  try {
    jeu = JSON.parse(brut) as { keys?: JWK[] };
  } catch {
    return null;
  }
  const cles = new Map<string, Cle>();
  for (const k of jeu.keys ?? []) {
    // Une clé PRIVÉE ici serait une faute de configuration : on ne l'utilise pas.
    if (k.kty !== "EC" || k.crv !== "P-256" || typeof k.kid !== "string" || "d" in k) continue;
    cles.set(k.kid, await importJWK(k, "ES256"));
  }
  if (cles.size === 0) return null;
  jeuLu = { brut, cles };
  return cles;
}

/** La signature ES256 et les revendications d'un jeton de console-api ; `null` s'il ne vaut rien. */
export async function verifierJetonConsoleApi(jeton: string, env: Record<string, string | undefined> = process.env): Promise<JetonConsoleApi | null> {
  const cles = await clesPubliques(env.SESSION_PUBLIC_JWKS);
  if (!cles) return null;
  try {
    const { payload } = await jwtVerify(
      jeton,
      async (enTete) => {
        const cle = enTete.kid ? cles.get(enTete.kid) : undefined;
        if (!cle) throw new Error("clé inconnue");
        return cle;
      },
      { algorithms: ["ES256"], issuer: EMETTEUR, audience: AUDIENCE, typ: "JWT" },
    );
    if (typeof payload.sid !== "string" || typeof payload.exp !== "number") return null;
    return { sid: payload.sid, exp: payload.exp, demo: payload.demo === true };
  } catch {
    return null;
  }
}

/** console-api ne répond pas comme il faut : ni un principal, ni un refus de session. */
export class ConsoleApiIndisponible extends Error {
  constructor(readonly requestId: string | null) {
    super(`console-api indisponible${requestId ? ` (réf. ${requestId})` : ""}`);
    this.name = "ConsoleApiIndisponible";
  }
}

/**
 * Le principal d'un jeton ES256 : signature vérifiée ici, puis `GET /v1/me`.
 * `null` : jeton invalide, session révoquée ou expirée, compte désactivé.
 * Lève `ConsoleApiIndisponible` si le service ne peut pas répondre.
 */
export async function principalConsoleApi(
  jeton: string,
  deps: { client?: Pick<ReturnType<typeof backend>, "appeler" | "estBranche">; env?: Record<string, string | undefined>; requestId?: string } = {},
): Promise<SessionUser | null> {
  const client = deps.client ?? backend();
  if (!client.estBranche()) return null;
  const local = await verifierJetonConsoleApi(jeton, deps.env);
  if (!local) return null;
  const r = await client.appeler(MOI, {}, { jeton, requestId: deps.requestId });
  if (r.ok) {
    // Le jeton et le service doivent dire la même chose de la démo (le service l'exige aussi).
    if (r.data.demo !== local.demo) return null;
    return { email: r.data.email, role: r.data.role, apps: r.data.apps === null ? null : [...r.data.apps], demo: r.data.demo };
  }
  if (r.statut === 401) return null;
  throw new ConsoleApiIndisponible(r.requestId);
}
