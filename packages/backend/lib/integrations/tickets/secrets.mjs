// Secrets d'un connecteur de tickets (P8.6) : comment ils sont désignés,
// jamais comment ils sont stockés en clair.
//
// LA RÈGLE. Un secret de fournisseur ne s'écrit pas dans une colonne de
// configuration. La base ne porte qu'une RÉFÉRENCE, sous deux formes :
//
//   env:TICKET_<NOM>      le gestionnaire de secrets du runtime (variables
//                         d'environnement Railway/Vercel). C'est la forme
//                         préférée : MIP n'a alors jamais la valeur en base,
//                         même chiffrée, et la rotation se fait hors produit.
//   enc:v1:<base64>       chiffré AES-256-GCM par une clé serveur SÉPARÉE
//                         (`TICKET_SECRET_KEY`), pour les déploiements où l'on
//                         ne peut pas ajouter une variable par intégration.
//
// La contrainte `ticket_integration_credential_v84` refuse tout le reste : un
// jeton collé dans ce champ fait échouer l'écriture. Ce n'est pas une
// convention de code, c'est le schéma qui l'impose.
//
// POURQUOI LE PRÉFIXE `TICKET_` (P1). La première forme acceptait `env:` suivi
// de N'IMPORTE QUELLE variable. Or la valeur résolue part, telle quelle, en
// jeton porteur chez le fournisseur : un administrateur — ou quiconque obtient
// une écriture sur `ticket_integration` — qui saisit `env:DATABASE_URL` ou
// `env:AUTH_SECRET` fait sortir la chaîne de connexion ou la clé de session
// vers un tiers, dans un en-tête `Authorization`. La référence ne désigne donc
// plus qu'une variable ÉCRITE POUR ÇA : `TICKET_` puis majuscules, chiffres,
// `_`, 64 caractères au plus en tout (la borne d'avant). Deux noms du préfixe
// sont réservés à la plateforme et restent refusés : `TICKET_SECRET_KEY…` (la
// clé qui déchiffre TOUTES les références `enc:` — la faire sortir, c'est les
// faire sortir toutes) et `TICKET_INTEGRATIONS` (un interrupteur, pas un
// secret).
//
// La règle est tenue à DEUX endroits du code : à l'écriture (`referenceValide`,
// appelée par la console) et à la RÉSOLUTION (`resoudre`) — c'est la seconde
// qui compte, car la contrainte SQL de v84 accepte encore l'ancienne forme :
// une ligne écrite avant P1, ou directement en base, est refusée au moment de
// servir, avec le code `variable_hors_perimetre`. Resserrer aussi la contrainte
// demande une migration (hors de ce changement ; voir le rapport de P1).
//
// POURQUOI UNE CLÉ SÉPARÉE. `AUTH_SECRET` signe les sessions de la console et
// `IDENTITY_SECRET` dérive les empreintes d'identité : réutiliser l'une d'elles
// ferait qu'une rotation de session invaliderait tous les connecteurs, et qu'une
// fuite de l'une emporterait les autres. `TICKET_SECRET_KEY` ne sert qu'ici.
//
// CE QUI NE SORT JAMAIS. Aucune fonction de ce fichier ne rend un secret à une
// réponse d'API : `decrire()` rend de quoi afficher une configuration (la forme,
// et le NOM de la variable quand c'en est une), jamais la valeur.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIXE_ENV = "env:";
const PREFIXE_ENC = "enc:v1:";
/** Préfixe obligatoire d'une variable de connecteur. */
export const PREFIXE_VARIABLE = "TICKET_";
// `(?!SECRET_KEY|INTEGRATIONS$)` : les deux noms réservés (cf. l'en-tête).
// `TICKET_` + 1 à 57 caractères = 64 au plus, la borne de la forme d'avant.
const RE_ENV = /^env:TICKET_(?!SECRET_KEY|INTEGRATIONS$)[A-Z0-9_]{1,57}$/;
/** L'ancienne forme, plus large : reconnue seulement pour dire POURQUOI elle est refusée. */
const RE_ENV_LARGE = /^env:[A-Z][A-Z0-9_]{0,63}$/;
const RE_ENC = /^enc:v1:[A-Za-z0-9+/=]{16,4096}$/;

/** Le secret est introuvable ou inutilisable ; l'intégration passera en `degraded`. */
export class ErreurSecret extends Error {
  constructor(code) {
    super(code);
    this.name = "ErreurSecret";
    this.code = code;
  }
}

/** La référence est-elle d'une forme acceptée ? Pure, sans accès au runtime. */
export function referenceValide(ref) {
  return typeof ref === "string" && (RE_ENV.test(ref) || RE_ENC.test(ref));
}

/**
 * Ce qu'une API peut dire d'une référence, sans jamais la suivre.
 * @returns {{kind: "env", name: string} | {kind: "encrypted"} | {kind: "invalid"}}
 */
export function decrire(ref) {
  if (typeof ref === "string" && RE_ENV.test(ref)) return { kind: "env", name: ref.slice(PREFIXE_ENV.length) };
  if (typeof ref === "string" && RE_ENC.test(ref)) return { kind: "encrypted" };
  return { kind: "invalid" };
}

/** Clé serveur, 32 octets, en base64 ou en hexadécimal. */
function cle(env) {
  const brut = env.TICKET_SECRET_KEY;
  if (!brut) throw new ErreurSecret("cle_serveur_absente");
  const octets = /^[0-9a-fA-F]{64}$/.test(brut) ? Buffer.from(brut, "hex") : Buffer.from(brut, "base64");
  if (octets.length !== 32) throw new ErreurSecret("cle_serveur_invalide");
  return octets;
}

/**
 * Chiffre un secret pour le stocker. Le nonce est aléatoire et voyage avec le
 * message : deux chiffrements du même jeton ne se ressemblent pas, et personne
 * ne peut déduire d'une égalité de colonnes que deux applications partagent un
 * jeton.
 * @returns {string} `enc:v1:<base64(nonce|tag|chiffré)>`
 */
export function chiffrer(secret, env = process.env) {
  if (typeof secret !== "string" || secret.length === 0 || secret.length > 4096) {
    throw new ErreurSecret("secret_invalide");
  }
  const nonce = randomBytes(12);
  const chiffreur = createCipheriv("aes-256-gcm", cle(env), nonce);
  const corps = Buffer.concat([chiffreur.update(secret, "utf8"), chiffreur.final()]);
  return PREFIXE_ENC + Buffer.concat([nonce, chiffreur.getAuthTag(), corps]).toString("base64");
}

/**
 * Résout une référence en secret utilisable, au moment de l'appel — jamais plus
 * tôt, et jamais conservé ailleurs que dans la variable locale de l'appelant.
 *
 * Une variable d'environnement absente est une `ErreurSecret`, pas une chaîne
 * vide : partir avec un jeton vide donnerait un 401 du fournisseur, donc un
 * diagnostic faux (« jeton révoqué » au lieu de « jeton jamais fourni »).
 *
 * Une variable HORS DU PRÉFIXE `TICKET_` (ou réservée) n'est jamais lue, même
 * présente : `variable_hors_perimetre`. C'est la défense qui tient quand la
 * base contient une référence que la console n'accepterait plus (cf. l'en-tête).
 */
export function resoudre(ref, env = process.env) {
  if (typeof ref !== "string") throw new ErreurSecret("reference_invalide");
  if (RE_ENV.test(ref)) {
    const valeur = env[ref.slice(PREFIXE_ENV.length)];
    if (typeof valeur !== "string" || valeur.length === 0) throw new ErreurSecret("variable_absente");
    return valeur;
  }
  if (RE_ENV_LARGE.test(ref)) throw new ErreurSecret("variable_hors_perimetre");
  if (!RE_ENC.test(ref)) throw new ErreurSecret("reference_invalide");
  const brut = Buffer.from(ref.slice(PREFIXE_ENC.length), "base64");
  if (brut.length < 12 + 16 + 1) throw new ErreurSecret("chiffre_tronque");
  const dechiffreur = createDecipheriv("aes-256-gcm", cle(env), brut.subarray(0, 12));
  dechiffreur.setAuthTag(brut.subarray(12, 28));
  try {
    return Buffer.concat([dechiffreur.update(brut.subarray(28)), dechiffreur.final()]).toString("utf8");
  } catch {
    // Authentification GCM en échec : clé changée, ou chiffré altéré. Les deux
    // méritent le même refus, et surtout pas un secret partiellement déchiffré.
    throw new ErreurSecret("dechiffrement_refuse");
  }
}
