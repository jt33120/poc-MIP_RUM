// LES SESSIONS DE LA CONSOLE : un jeton qui ne dit QUI c'est que par un
// identifiant, et une ligne en base qui dit tout le reste.
//
// LE JETON. Un JWT compact ES256, signé par ce service avec la clé courante de
// `SESSION_SIGNING_KEYS` : `{ iss, aud, sid, iat, exp }`, et rien d'autre. Ni
// rôle, ni périmètre, ni e-mail : ce qu'un jeton porte, il le porte jusqu'à son
// expiration, même quand la base a changé d'avis. La console (Vercel) le vérifie
// avec la clé PUBLIQUE (`SESSION_PUBLIC_JWKS`, C1) pour savoir qu'il vient d'ici ;
// ce service, lui, ne s'arrête pas à la signature.
//
// LA LIGNE. `console_session` (migration-v90), jointe à `console_user` : une
// session révoquée, expirée en base, ou dont le compte est désactivé, est
// refusée — quel que soit l'âge du jeton. Le rôle et le périmètre viennent du
// COMPTE, relus : un administrateur rétrogradé l'est tout de suite. Une démo n'a
// pas de compte ; son périmètre est figé dans la ligne, son rôle est `viewer`
// par construction (la table n'a pas de colonne de rôle).
//
// LE CACHE. 30 s par identifiant de session, par réplique : c'est le délai
// maximal d'une révocation. Le régime de la console est un sondage — `AutoRefresh`
// rejoue chaque écran toutes les 5 s, chaque écran plusieurs appels — et sans
// cache chaque appel paierait un aller-retour de plus vers la base. Deux appels
// simultanés pour la même session ne font qu'UNE lecture.
//
// Une base injoignable n'est pas une session invalide : 503 `indisponible`, et
// non 401 — la console ne doit pas renvoyer un utilisateur à la connexion parce
// que Neon s'est endormi.
import type { Trousseau } from "./cles";
import { depuisBase64url, signer, versBase64url } from "./cles";
import type { Lecteur, Principal } from "./contexte";
import { ErreurContrat } from "./erreurs";

/** L'émetteur et l'audience d'un jeton de session : épinglés des deux côtés. */
export const EMETTEUR_SESSION = "mip-console-api";
export const AUDIENCE_SESSION = "mip-console";
/** Délai maximal d'une révocation : la durée de vie d'une entrée du cache. */
export const CACHE_SESSION_MS = 30_000;
/** Une session ne dure pas plus longtemps (la base le refuse aussi, migration-v90). */
export const DUREE_MAX_SESSION_S = 30 * 24 * 3600;
/** Tolérance d'horloge sur `iat` : un jeton émis « dans le futur » au-delà est refusé. */
const TOLERANCE_HORLOGE_S = 60;

const SID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PARTIE = /^[A-Za-z0-9_-]+$/;
const EN_TETE_PERMIS = new Set(["alg", "typ", "kid"]);
const REVENDICATIONS_PERMISES = new Set(["iss", "aud", "sid", "iat", "exp"]);

export interface RevendicationsSession {
  readonly sid: string;
  /** Secondes epoch. */
  readonly iat: number;
  /** Secondes epoch. */
  readonly exp: number;
}

function encoderJson(valeur: unknown): string {
  return versBase64url(new TextEncoder().encode(JSON.stringify(valeur)));
}

function lireJson(partie: string): Record<string, unknown> | null {
  try {
    const valeur: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(depuisBase64url(partie)));
    return valeur !== null && typeof valeur === "object" && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Émet le jeton d'une session DÉJÀ inscrite en base (C1 : connexion, démo).
 * Signé par la clé courante du trousseau.
 */
export async function emettreJetonSession(trousseau: Trousseau, r: RevendicationsSession): Promise<string> {
  if (!SID.test(r.sid)) throw new Error("identifiant de session mal formé");
  if (!Number.isInteger(r.iat) || !Number.isInteger(r.exp) || r.exp <= r.iat || r.exp - r.iat > DUREE_MAX_SESSION_S) {
    throw new Error("durée de session invalide");
  }
  const cle = trousseau.courante;
  const corps = `${encoderJson({ alg: "ES256", typ: "JWT", kid: cle.kid })}.${encoderJson({
    iss: EMETTEUR_SESSION,
    aud: AUDIENCE_SESSION,
    sid: r.sid,
    iat: r.iat,
    exp: r.exp,
  })}`;
  return `${corps}.${await signer(cle, corps)}`;
}

/**
 * Lit et vérifie la SIGNATURE et les revendications d'un jeton, sans la base.
 * `null` pour tout jeton qui n'est pas exactement ce que ce service émet.
 */
export async function lireJetonSession(
  jeton: string,
  clesPubliques: ReadonlyMap<string, CryptoKey>,
  maintenantS: number,
): Promise<RevendicationsSession | null> {
  const parties = jeton.split(".");
  if (parties.length !== 3 || !parties.every((p) => PARTIE.test(p))) return null;
  const [enTeteB64, charge, signature] = parties;
  const enTete = lireJson(enTeteB64);
  // Un en-tête qui en dit plus que `alg`, `typ` et `kid` (`jku`, `jwk`, `x5u`, `crit`…)
  // demande qu'on aille chercher une clé ailleurs : refusé, pas ignoré.
  if (!enTete || Object.keys(enTete).some((k) => !EN_TETE_PERMIS.has(k))) return null;
  if (enTete.alg !== "ES256" || enTete.typ !== "JWT" || typeof enTete.kid !== "string") return null;
  const cle = clesPubliques.get(enTete.kid);
  if (!cle) return null;
  let sig: Uint8Array;
  try {
    sig = depuisBase64url(signature);
  } catch {
    return null;
  }
  if (sig.byteLength !== 64) return null;
  const valide = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    cle,
    sig as BufferSource,
    new TextEncoder().encode(`${enTeteB64}.${charge}`),
  );
  if (!valide) return null;

  const r = lireJson(charge);
  if (!r || Object.keys(r).some((k) => !REVENDICATIONS_PERMISES.has(k))) return null;
  if (r.iss !== EMETTEUR_SESSION || r.aud !== AUDIENCE_SESSION) return null;
  if (typeof r.sid !== "string" || !SID.test(r.sid)) return null;
  if (!Number.isInteger(r.iat) || !Number.isInteger(r.exp)) return null;
  const iat = r.iat as number;
  const exp = r.exp as number;
  if (exp <= maintenantS || iat > maintenantS + TOLERANCE_HORLOGE_S || exp <= iat || exp - iat > DUREE_MAX_SESSION_S) return null;
  return { sid: r.sid, iat, exp };
}

interface LigneSession {
  demo: boolean;
  demo_email: string | null;
  demo_apps: string[] | null;
  expires_at: Date;
  user_id: string | null;
  email: string | null;
  role: string | null;
  apps: string[] | null;
  active: boolean | null;
}

/** La ligne en base → le principal, ou `null` si elle ne vaut plus session. */
function principalDe(sid: string, l: LigneSession): Principal | null {
  if (l.demo) {
    if (!l.demo_email || !l.demo_apps?.length) return null;
    return { kind: "session", sessionId: sid, userId: null, email: l.demo_email, role: "viewer", apps: l.demo_apps, demo: true };
  }
  if (l.user_id === null || l.active !== true || !l.email) return null;
  if (l.role !== "admin" && l.role !== "viewer") return null;
  return { kind: "session", sessionId: sid, userId: l.user_id, email: l.email, role: l.role, apps: l.apps, demo: false };
}

const LECTURE_SESSION = `
  select s.demo, s.demo_email, s.demo_apps, s.expires_at,
         u.id::text as user_id, u.email, u.role, u.apps, u.active
    from console_session s
    left join console_user u on u.id = s.user_id
   where s.id = $1::uuid
     and s.revoked_at is null
     and s.expires_at > now()`;

export interface OptionsVerificateur {
  readonly trousseau: Trousseau;
  readonly db: Lecteur;
  readonly horloge?: () => number;
  readonly cacheMs?: number;
  /** Entrées au plus dans le cache (les plus anciennes sortent d'abord). */
  readonly cacheMax?: number;
}

export interface VerificateurSession {
  /** Le principal d'un jeton, ou `null` (401). Lève `indisponible` (503) si la base ne répond pas. */
  verifier(jeton: string): Promise<Principal | null>;
  /** Oublie une session du cache (sa révocation vient d'être écrite par CETTE réplique). */
  oublier(sid: string): void;
}

export async function creerVerificateurSession(o: OptionsVerificateur): Promise<VerificateurSession> {
  const horloge = o.horloge ?? (() => Date.now());
  const cacheMs = o.cacheMs ?? CACHE_SESSION_MS;
  const cacheMax = o.cacheMax ?? 10_000;
  // Les clés publiques du trousseau, importées une fois : la courante et, pendant
  // une rotation, la suivante. Un jeton signé par une clé retirée ne vérifie plus.
  const cles = new Map<string, CryptoKey>();
  for (const c of o.trousseau.toutes) {
    cles.set(c.kid, await crypto.subtle.importKey("jwk", { ...c.publique, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  }
  const cache = new Map<string, { principal: Principal | null; jusqua: number }>();
  const enVol = new Map<string, Promise<Principal | null>>();

  async function lireEnBase(sid: string): Promise<Principal | null> {
    let lignes: LigneSession[];
    try {
      ({ rows: lignes } = await o.db.query<LigneSession>(LECTURE_SESSION, [sid]));
    } catch {
      throw new ErreurContrat("indisponible", "session invérifiable pour l'instant : réessayer");
    }
    const ligne = lignes[0];
    const principal = ligne ? principalDe(sid, ligne) : null;
    // Jamais au-delà de l'expiration de la ligne : une session qui expire dans
    // 10 s n'est pas servie 30 s depuis le cache.
    const fin = ligne ? Math.min(horloge() + cacheMs, new Date(ligne.expires_at).getTime()) : horloge() + cacheMs;
    if (cache.size >= cacheMax) {
      const plusAncienne = cache.keys().next().value;
      if (plusAncienne !== undefined) cache.delete(plusAncienne);
    }
    cache.set(sid, { principal, jusqua: fin });
    return principal;
  }

  return {
    async verifier(jeton) {
      const maintenant = horloge();
      const r = await lireJetonSession(jeton, cles, Math.floor(maintenant / 1000));
      if (!r) return null;
      const connu = cache.get(r.sid);
      if (connu && connu.jusqua > maintenant) return connu.principal;
      cache.delete(r.sid);
      const deja = enVol.get(r.sid);
      if (deja) return deja;
      const lecture = lireEnBase(r.sid).finally(() => enVol.delete(r.sid));
      enVol.set(r.sid, lecture);
      return lecture;
    },
    oublier(sid) {
      cache.delete(sid);
    },
  };
}
