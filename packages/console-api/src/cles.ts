// LES CLÉS DE SIGNATURE DES SESSIONS, et la signature de la poignée de main.
//
// ES256 (ECDSA P-256, SHA-256) par WebCrypto : aucune dépendance, et le même
// algorithme se vérifie dans le middleware Edge de la console (Ed25519 n'y est
// pas garanti). `SESSION_SIGNING_KEYS` est un jeu JWKS PRIVÉ, sur ce service
// seulement : la première clé signe, toutes vérifient — c'est la rotation (poser
// la nouvelle en seconde position, publier sa clé publique sur Vercel, la passer
// en tête, retirer l'ancienne 8 h plus tard). La console ne détient que la partie
// publique (`SESSION_PUBLIC_JWKS`) : elle vérifie, elle ne signe jamais.
//
// `scripts/ops/generer-cles-session.mjs` fabrique et fait tourner ce jeu.
import type { ClePublique, JeuDeClesPubliques } from "@mip/console-contract";

export interface CleDeSignature {
  readonly kid: string;
  readonly privee: CryptoKey;
  readonly publique: ClePublique;
}

export interface Trousseau {
  /** La clé qui signe : la première du jeu. */
  readonly courante: CleDeSignature;
  readonly toutes: readonly CleDeSignature[];
  readonly jwks: JeuDeClesPubliques;
}

const B64URL = /^[A-Za-z0-9_-]+$/;
const KID = /^[A-Za-z0-9._-]{1,64}$/;
/** Un `kid` qui dit « test » ou « dev » n'a rien à faire en production : c'est celui d'une clé qui a circulé. */
const KID_DE_TEST = /(^|[-_.])(test|tests|dev|demo|exemple|example|local|fixture)([-_.]|$)/i;

export function versBase64url(octets: Uint8Array): string {
  let binaire = "";
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function depuisBase64url(texte: string): Uint8Array {
  const b64 = texte.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (texte.length % 4)) % 4);
  const binaire = atob(b64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

/**
 * Lit et importe le jeu de clés privées. Lève avec la liste de ce qui ne va pas —
 * JAMAIS avec une valeur de clé : le message part au journal de démarrage.
 */
export async function chargerTrousseau(brut: string, { production }: { production: boolean }): Promise<Trousseau> {
  let jeu: unknown;
  try {
    jeu = JSON.parse(brut);
  } catch {
    throw new Error("SESSION_SIGNING_KEYS : JSON illisible (attendu un jeu JWKS privé {\"keys\":[…]})");
  }
  const cles = (jeu as { keys?: unknown })?.keys;
  if (!Array.isArray(cles) || cles.length < 1 || cles.length > 2) {
    throw new Error("SESSION_SIGNING_KEYS : 1 ou 2 clés attendues (la courante, puis la suivante pendant une rotation)");
  }
  const fautes: string[] = [];
  const kids = new Set<string>();
  const toutes: CleDeSignature[] = [];
  for (const [i, c] of cles.entries()) {
    const k = c as Record<string, unknown>;
    const ou = `clé ${i + 1}`;
    if (k.kty !== "EC" || k.crv !== "P-256") fautes.push(`${ou} : EC P-256 attendue (ES256)`);
    for (const champ of ["x", "y", "d"]) {
      if (typeof k[champ] !== "string" || !B64URL.test(k[champ] as string)) fautes.push(`${ou} : « ${champ} » absent ou mal encodé${champ === "d" ? " (clé PRIVÉE attendue)" : ""}`);
    }
    if (typeof k.kid !== "string" || !KID.test(k.kid)) fautes.push(`${ou} : « kid » absent ou mal formé`);
    else if (kids.has(k.kid)) fautes.push(`${ou} : « kid » en double`);
    else if (production && KID_DE_TEST.test(k.kid)) fautes.push(`${ou} : « kid » de test refusé en production (${k.kid})`);
    if (typeof k.kid === "string") kids.add(k.kid);
    if (fautes.length) continue;
    try {
      const privee = await crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x: k.x as string, y: k.y as string, d: k.d as string, ext: false },
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      );
      const publique: ClePublique = { kty: "EC", crv: "P-256", x: k.x as string, y: k.y as string, kid: k.kid as string, alg: "ES256", use: "sig" };
      // La partie publique doit s'importer aussi : une clé dont x/y ne sont pas sur la courbe est refusée ici, pas chez la console.
      await crypto.subtle.importKey("jwk", { ...publique, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
      toutes.push({ kid: publique.kid, privee, publique });
    } catch {
      fautes.push(`${ou} : clé EC P-256 invalide (import refusé)`);
    }
  }
  if (fautes.length) throw new Error(`SESSION_SIGNING_KEYS : ${fautes.join(" ; ")}`);
  return { courante: toutes[0], toutes, jwks: { keys: toutes.map((c) => c.publique) } };
}

/** Signe un message texte : ES256, signature brute r‖s (64 octets), en base64url — la forme JWS. */
export async function signer(cle: CleDeSignature, message: string): Promise<string> {
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cle.privee, new TextEncoder().encode(message));
  return versBase64url(new Uint8Array(sig));
}

/** Vérifie une signature ES256 contre une clé publique JWKS. Ce que fait la console ; ici pour les tests et l'outillage. */
export async function verifierSignature(publique: ClePublique, message: string, signature: string): Promise<boolean> {
  try {
    const cle = await crypto.subtle.importKey("jwk", { ...publique, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const sig = depuisBase64url(signature);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, cle, sig as BufferSource, new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

/** Empreinte SHA-256 d'un texte, en hexadécimal (empreinte du contrat). */
export async function empreinte(texte: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)));
  return [...h].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/**
 * Égalité en temps constant de deux secrets : comparer leurs EMPREINTES (même
 * longueur), octet par octet sans sortie anticipée. Ni la longueur ni le premier
 * octet différent ne se lisent au chronomètre.
 */
export async function egaliteConstante(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all(
    [a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))),
  );
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}
