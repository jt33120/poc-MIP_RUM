// LES OPÉRATIONS DE console-api, déclarées ici et nulle part ailleurs.
//
// Ce fichier grandit lot par lot (C0 → C11). La table des politiques — qui a le
// droit de quoi — n'est PAS ici : elle vit côté service (`@mip/console-api`),
// sous CODEOWNERS, avec le traitement. Le contrat ne porte que des types.
import type { LecturePlanifie } from "./planifie";
import type { Section } from "./section";
import { dictionnaire } from "./valider";
import { operation, type Aucun, type Chemin } from "./operation";

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

/**
 * Les moyens de se connecter que le service offre : l'écran de connexion et la
 * vitrine montrent ou cachent leurs boutons (SSO, démo) sans que la console
 * détienne la moindre configuration d'identité.
 */
export interface MethodesConnexion {
  readonly mot_de_passe: true;
  readonly sso: boolean;
  readonly demo: boolean;
}
export const METHODES = operation<Aucun, Aucun, never, MethodesConnexion>("auth.methods", "GET", "/v1/auth/methods");

/**
 * Le début d'une connexion SSO (OIDC, code + PKCE) : l'adresse de l'IdP où
 * envoyer le navigateur, et la TRANSACTION scellée (JWE) que la console garde en
 * cookie le temps de l'aller-retour — état, nonce et vérificateur PKCE y sont
 * chiffrés : la console ne les lit pas, le navigateur non plus.
 */
export interface DebutSso {
  readonly url: string;
  readonly transaction: string;
}
export const DEBUT_SSO = operation<Aucun, Aucun, never, DebutSso>("auth.oidcStart", "GET", "/v1/auth/oidc/authorization");

export interface RetourSso {
  readonly code: string;
  readonly state: string;
  readonly transaction: string;
}
/** La fin d'une connexion SSO : le service échange le code, vérifie l'ID token, lie le compte par (émetteur, sujet). */
export const FIN_SSO = operation<Aucun, Aucun, RetourSso, SessionOuverte>("auth.oidc", "POST", "/v1/auth/oidc-sessions");

// ─── Écrans (C2 → C5) ─────────────────────────────────────────────────────────

export interface Projet {
  readonly app_id: string;
  readonly name: string;
}

/**
 * LA COQUILLE (C2) : ce que le layout racine lit pour chaque écran de console.
 * Chaque lecture est une SECTION : en échec, la coquille s'affiche sans elle et
 * le dit (bandeau « Partiel »), jamais un 5xx pour tout l'écran. Le projet
 * COURANT n'y est pas : il se choisit côté console (cookie), parmi `projets`.
 */
export interface Coquille {
  readonly projets: Section<readonly Projet[]>;
  /** `table.colonne` des dimensions réellement présentes, triées. */
  readonly schema: Section<readonly string[]>;
  /** Le fuseau d'affichage de chaque projet du principal. */
  readonly fuseaux: Readonly<Record<string, string>>;
  /** L'entrée « Connecteurs de tickets » ; `null` pour qui n'est pas administrateur. */
  readonly tickets: Section<boolean> | null;
}
export const COQUILLE = operation<Aucun, Aucun, never, Coquille>("console.shell", "GET", "/v1/shell");

/**
 * Les paramètres d'URL d'un écran — filtres, plage, pagination, réglages
 * d'affichage —, tels que la page les reçoit : le chargeur les lit comme elle.
 * `app` n'y est pas : c'est la PORTÉE de l'opération, confrontée au périmètre par
 * le pipeline avant le chargeur, puis rendue au chargeur telle que demandée.
 */
export type ParametresEcran = Readonly<Record<string, string>>;

/** La borne des paramètres d'un écran (le sens, c'est le contrat de requête de la console qui le vérifie). */
export const PARAMETRES_ECRAN = dictionnaire({ max: 48, nom: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/, valeurMax: 2048 });

/**
 * UN ÉCRAN DE CONSOLE (C3 → C5) : son chargeur, servi tel quel. La réponse est
 * ce que rend le chargeur (`apps/console/lib/chargeurs/`), une SECTION par
 * lecture : son type appartient à la console, qui l'exécute aujourd'hui en local
 * et l'appellera demain ici — `Fil<…>` du même chargeur des deux côtés. Le
 * contrat, lui, fixe l'identité de l'opération, son chemin et son entrée.
 */
function ecran<P = Aucun>(id: string, chemin: Chemin) {
  return operation<P, ParametresEcran, never, unknown>(id, "GET", chemin);
}

/**
 * Les écrans servis, par nom de chargeur. Ils grandissent lot par lot (C3, C4, C5).
 * Une page de détail porte son identifiant dans le chemin ; il ne donne aucun
 * droit : le chargeur relit l'app de la ressource et la confronte au périmètre
 * (introuvable ailleurs, comme absente).
 */
export const ECRANS = Object.freeze({
  // C3 — interactions, sessions, Explorer.
  actions: ecran("screens.actions", "/v1/screens/actions"),
  events: ecran("screens.events", "/v1/screens/events"),
  mobile: ecran("screens.mobile", "/v1/screens/mobile"),
  sessions: ecran("screens.sessions", "/v1/screens/sessions"),
  session: ecran<{ id: string }>("screens.session", "/v1/screens/sessions/{id}"),
  explorer: ecran("screens.explorer", "/v1/screens/explorer"),
  /** Les événements rrweb d'une session, pour le lecteur (plafonnés par session). */
  rejeu: ecran<{ sessionId: string }>("replay.session", "/v1/replays/{sessionId}"),
});
export type CleEcran = keyof typeof ECRANS;

/** Toutes les opérations du contrat, dans l'ordre de la doc. */
export const OPERATIONS = Object.freeze([VERSION, JWKS, ETAT_PLATEFORME, CONNEXION, DEMO, DECONNEXION, MOI, METHODES, DEBUT_SSO, FIN_SSO, COQUILLE, ...Object.values(ECRANS)]);

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
