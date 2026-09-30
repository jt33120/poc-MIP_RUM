// LES RÈGLES DE L'INSCRIPTION EN LIBRE-SERVICE (30/09/2026), des deux côtés : la
// console les applique avant d'appeler (un refus immédiat, champ par champ), et
// console-api les applique de nouveau (il ne fait confiance à aucun appelant).
//
// Pures : ni base, ni `node:*`, ni DOM — le contrat se compile sans leurs types
// (tsconfig). Seul emprunt, `URL` (WHATWG), présent dans chacun de ses runtimes :
// la console (Node), console-api (Node), le navigateur.

/** Le mot de passe : 12 caractères au moins ; 72 octets au plus, la limite de bcrypt (au-delà, il tronque en silence). */
export const MOT_DE_PASSE_INSCRIPTION = Object.freeze({ min: 12, maxOctets: 72 });

/** Le champ en cause d'un refus de saisie. */
export type ChampInscription = "email" | "mot_de_passe" | "nom_site" | "url_site";

export interface InscriptionValide {
  readonly email: string;
  readonly nom: string;
  /** L'origine du site (schéma, hôte, port), celle que la collecte admettra. */
  readonly origine: string;
}

const FORME_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** La saisie, normalisée ; ou le premier champ refusé, dans l'ordre du formulaire. */
export function verifierInscription(corps: {
  email: string;
  mot_de_passe: string;
  nom_site: string;
  url_site: string;
}): { ok: true; valeur: InscriptionValide } | { ok: false; champ: ChampInscription } {
  const email = corps.email.trim().toLowerCase();
  if (email.length > 200 || !FORME_EMAIL.test(email)) return { ok: false, champ: "email" };
  if ([...corps.mot_de_passe].length < MOT_DE_PASSE_INSCRIPTION.min || octetsUtf8(corps.mot_de_passe) > MOT_DE_PASSE_INSCRIPTION.maxOctets) {
    return { ok: false, champ: "mot_de_passe" };
  }
  const nom = corps.nom_site.trim();
  if (!nom || nom.length > 200) return { ok: false, champ: "nom_site" };
  // 2048 : la borne du schéma de console-api ; au-delà, son refus n'aurait plus de champ.
  const url = corps.url_site.trim();
  const origine = url.length <= 2048 ? origineDe(url) : null;
  if (!origine) return { ok: false, champ: "url_site" };
  return { ok: true, valeur: { email, nom, origine } };
}

/** La longueur en UTF-8, celle que bcrypt compte (une demi-paire de substitution vaut U+FFFD : 3 octets). */
function octetsUtf8(texte: string): number {
  let n = 0;
  for (const c of texte) {
    const p = c.codePointAt(0)!;
    n += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Le constructeur `URL` du runtime, typé ici : le contrat se compile sans DOM ni Node. */
const UrlWhatwg = (globalThis as unknown as { URL: new (url: string) => { readonly protocol: string; readonly origin: string } }).URL;

/** « https://ma-boutique.fr/panier » → « https://ma-boutique.fr » ; `null` hors http(s). */
function origineDe(url: string): string | null {
  try {
    const u = new UrlWhatwg(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * L'identifiant du site d'un compte inscrit : le nom en minuscules sans accents,
 * suivi d'un suffixe aléatoire (4 caractères hexadécimaux). Le suffixe évite
 * qu'une inscription réserve le nom d'un client à venir, ou bute sur un site
 * existant ; il respecte le motif de `validateAppId` (lib/onboarding.ts).
 */
export function identifiantSite(nom: string, suffixe: string): string {
  const base = nom
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  return `${base || "site"}-${suffixe}`;
}
