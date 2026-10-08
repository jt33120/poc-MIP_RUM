// LA DEMANDE RGPD EN COURS (`/admin/privacy`), HORS DE TOUTE URL (audit du 07/10/2026).
//
// Une demande désigne une personne : le HMAC de son identité métier, ou son
// identifiant de visiteur. Les deux sont des identifiants (pseudonymes, mais
// stables) : dans une URL, ils finiraient dans l'historique du navigateur, les
// journaux d'accès de Vercel et l'en-tête Referer. Ils n'y entrent donc plus.
//
// La recherche (une action serveur, en POST) SCELLE la demande dans un cookie :
//   · chiffré et authentifié (JWE `dir` + A256GCM, clé dérivée d'AUTH_SECRET) :
//     le navigateur ne garde qu'une référence opaque ;
//   · `httpOnly`, `SameSite=Strict`, borné au chemin `/admin/privacy` (l'écran et
//     son export) et à 15 minutes — l'expiration est aussi DANS le jeton ;
//   · une demande à la fois : une nouvelle recherche remplace la précédente, un
//     effacement abouti l'oublie.
// L'écran et l'export le rouvrent côté serveur ; console-api reçoit les paramètres
// dans le CORPS d'un POST (`ECRANS_ADMIN.viePrivee`).
//
// PUR : ni cookie, ni `next/*` — `app/admin/privacy/demande.ts` pose et lit le
// cookie. Le scellement se teste seul.
import { EncryptJWT, jwtDecrypt } from "jose";

export const COOKIE_DEMANDE_RGPD = "mip_dsar";
/** Durée de vie d'une demande, en secondes : le temps d'instruire, d'exporter, d'effacer. */
export const DUREE_DEMANDE_RGPD_S = 15 * 60;
/** Le chemin du cookie : l'écran et son export, rien d'autre. */
export const CHEMIN_DEMANDE_RGPD = "/admin/privacy";

const HMAC = /^[0-9a-f]{64}$/;
const APP = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VISITEUR_MAX = 200;

export type DemandeRgpd =
  | { readonly type: "identite"; readonly app: string; readonly kind: "user" | "account"; readonly hash: string }
  | { readonly type: "visiteur"; readonly app: string; readonly visitorId: string };

/** La demande, si elle est bien formée ; `null` sinon (rien n'est scellé ni rouvert d'invalide). */
export function demandeValide(d: unknown): DemandeRgpd | null {
  if (typeof d !== "object" || d === null) return null;
  const o = d as Record<string, unknown>;
  if (typeof o.app !== "string" || !(APP.test(o.app) || o.app === "all")) return null;
  if (o.type === "identite") {
    if (o.app === "all" || (o.kind !== "user" && o.kind !== "account") || typeof o.hash !== "string" || !HMAC.test(o.hash)) return null;
    return { type: "identite", app: o.app, kind: o.kind, hash: o.hash };
  }
  if (o.type === "visiteur") {
    if (typeof o.visitorId !== "string") return null;
    const v = o.visitorId.trim();
    if (!v || v.length > VISITEUR_MAX) return null;
    return { type: "visiteur", app: o.app, visitorId: v };
  }
  return null;
}

/** La clé de scellement : 32 octets dérivés du secret de la console, propres à cet usage. */
async function cle(secret: string): Promise<Uint8Array> {
  const brut = new TextEncoder().encode(`mip-rum/demande-rgpd/1\n${secret}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", brut));
}

/** Scelle une demande : une chaîne opaque, chiffrée, qui expire d'elle-même. */
export async function scellerDemande(d: DemandeRgpd, secret: string, maintenantS = Math.floor(Date.now() / 1000)): Promise<string> {
  const valide = demandeValide(d);
  if (!valide) throw new Error("demande RGPD mal formée : rien n'est scellé");
  return new EncryptJWT({ d: valide })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(maintenantS)
    .setExpirationTime(maintenantS + DUREE_DEMANDE_RGPD_S)
    .encrypt(await cle(secret));
}

/** Rouvre une demande scellée ; `null` si elle est absente, altérée, expirée ou mal formée. */
export async function ouvrirDemande(jeton: string | null | undefined, secret: string, maintenant = new Date()): Promise<DemandeRgpd | null> {
  if (!jeton) return null;
  try {
    const { payload } = await jwtDecrypt(jeton, await cle(secret), { currentDate: maintenant, keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    return demandeValide(payload.d);
  } catch {
    return null;
  }
}

/** Les paramètres que l'URL ne porte plus : une valeur venue de l'URL sous ces noms est écartée. */
export const PARAMETRES_DE_PERSONNE = Object.freeze(["identity_hash", "user"] as const);

/**
 * Les paramètres de l'écran : ceux de l'URL SANS identifiant de personne, puis ceux
 * de la demande scellée — la seule source d'une identité ou d'un visiteur.
 */
export function parametresEcranRgpd(sp: Readonly<Record<string, string | string[] | undefined>>, d: DemandeRgpd | null): Record<string, string> {
  const sortie: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if ((PARAMETRES_DE_PERSONNE as readonly string[]).includes(k)) continue;
    if (typeof v === "string") sortie[k] = v;
  }
  if (d?.type === "identite") Object.assign(sortie, { app: d.app, kind: d.kind, identity_hash: d.hash });
  if (d?.type === "visiteur") Object.assign(sortie, { visitor_app: d.app, user: d.visitorId });
  return sortie;
}
