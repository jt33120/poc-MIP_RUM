// LES OPÉRATIONS DE console-api, déclarées ici et nulle part ailleurs.
//
// Ce fichier grandit lot par lot (C0 → C11). La table des politiques — qui a le
// droit de quoi — n'est PAS ici : elle vit côté service (`@mip/console-api`),
// sous CODEOWNERS, avec le traitement. Le contrat ne porte que des types.
import type { LecturePlanifie } from "./planifie";
import { operation, type Aucun } from "./operation";

// ─── Exploitation ────────────────────────────────────────────────────────────

/**
 * LA POIGNÉE DE MAIN. Le domaine généré d'un service Railway (`*.up.railway.app`)
 * peut être réattribué si le service est recréé. Avant d'envoyer son secret
 * client, la console appelle donc cette opération SANS secret, avec un nonce, et
 * vérifie la signature ES256 contre la clé publique des sessions qu'elle détient
 * (`SESSION_PUBLIC_JWKS`) : seul le vrai service a la clé privée.
 */
export interface Version {
  readonly service: "console-api";
  /** Le commit déployé (court), ou `dev`. */
  readonly version: string;
  /** L'empreinte de la table des opérations servies : la console journalise un écart. */
  readonly contrat: string;
  readonly nonce: string;
  readonly kid: string;
  /** ES256 (r‖s, base64url) sur `messageDePoignee(…)`. */
  readonly signature: string;
}

/** 16 à 64 octets aléatoires, en base64url. */
export const NONCE_POIGNEE = /^[A-Za-z0-9_-]{22,86}$/;

/** Le message signé : un préfixe de protocole, puis chaque champ sur sa ligne. */
export function messageDePoignee(v: Pick<Version, "nonce" | "contrat" | "version" | "kid">): string {
  return ["mip-console-api/poignee/1", v.nonce, v.contrat, v.version, v.kid].join("\n");
}

export const VERSION = operation<Aucun, { nonce: string }, never, Version>("ops.version", "GET", "/v1/version");

/** Clé publique ES256 d'un jeu JWKS (RFC 7517) : jamais de `d`. */
export interface ClePublique {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
  readonly kid: string;
  readonly alg: "ES256";
  readonly use: "sig";
}

export interface JeuDeClesPubliques {
  readonly keys: readonly ClePublique[];
}

/** Les clés publiques des sessions, au format JWKS BRUT (sans enveloppe), comme l'attend tout vérificateur. */
export const JWKS = operation<Aucun, Aucun, never, JeuDeClesPubliques>("ops.jwks", "GET", "/v1/.well-known/jwks.json");

// ─── Public ──────────────────────────────────────────────────────────────────

/** Ce que la vitrine anonyme (`/presentation`) lit de la plateforme : les preuves que les travaux planifiés tournent. */
export interface EtatPlateforme {
  /** Dernier passage QUOTIDIEN abouti (purge et comptage). */
  readonly quotidien: LecturePlanifie;
  /** Dernier TICK abouti du scheduler, et la cadence qu'il publie. */
  readonly tick: LecturePlanifie;
}

export const ETAT_PLATEFORME = operation<Aucun, Aucun, never, EtatPlateforme>(
  "public.platformStatus",
  "GET",
  "/v1/public/platform-status",
);

// ─── Identité (C1) ───────────────────────────────────────────────────────────

/**
 * Une session ouverte : le jeton à poser dans le cookie de la console, et son
 * expiration. Le jeton ne porte qu'un identifiant de session (ES256) ; rôle et
 * périmètre se relisent par `MOI` à chaque rendu.
 */
export interface SessionOuverte {
  readonly jeton: string;
  /** ISO 8601. */
  readonly expire_le: string;
  /** La connexion PRÉCÉDENTE du compte (ISO 8601), pour le briefing d'accueil ; `null` à la première, et pour une démo. */
  readonly connexion_precedente: string | null;
}

/** Ce que la console sait du principal : relu en base à chaque vérification. */
export interface Moi {
  readonly email: string;
  readonly role: "admin" | "viewer";
  /** `null` = toutes les applications. */
  readonly apps: readonly string[] | null;
  readonly demo: boolean;
}

export interface Identifiants {
  readonly email: string;
  readonly mot_de_passe: string;
}

/** Connexion par mot de passe. Refus générique (`identifiants_refuses`) : ni le message ni le temps ne disent si le compte existe. */
export const CONNEXION = operation<Aucun, Aucun, Identifiants, SessionOuverte>("auth.login", "POST", "/v1/auth/sessions");
/** Session de démonstration : lecture seule, périmètre fixé par le service (`DEMO_USER_APPS`). 404 si la démo est fermée. */
export const DEMO = operation<Aucun, Aucun, never, SessionOuverte>("auth.demo", "POST", "/v1/auth/demo-sessions");
/** Déconnexion : la session est RÉVOQUÉE en base — le jeton ne vaut plus rien, même avant son expiration. */
export const DECONNEXION = operation<Aucun, Aucun, never, { readonly revoquee: boolean }>("auth.logout", "DELETE", "/v1/auth/sessions/current");
export const MOI = operation<Aucun, Aucun, never, Moi>("auth.me", "GET", "/v1/me");

/** Toutes les opérations du contrat, dans l'ordre de la doc. */
export const OPERATIONS = Object.freeze([VERSION, JWKS, ETAT_PLATEFORME, CONNEXION, DEMO, DECONNEXION, MOI]);

/**
 * La forme canonique de la table (une ligne par opération, triée) : chaque côté
 * en tire l'empreinte SHA-256 avec son propre outil (WebCrypto), et la poignée de
 * main les compare.
 */
export function lignesDuContrat(operations: readonly { id: string; methode: string; chemin: string }[]): string {
  return operations
    .map((o) => `${o.methode} ${o.chemin} ${o.id}`)
    .sort()
    .join("\n");
}
