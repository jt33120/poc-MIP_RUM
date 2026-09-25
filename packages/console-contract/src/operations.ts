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
  // C4 — vue d'ensemble, performance, erreurs, traces, corrélation.
  overview: ecran("screens.overview", "/v1/screens/overview"),
  forecast: ecran("screens.forecast", "/v1/screens/forecast"),
  pages: ecran("screens.pages", "/v1/screens/pages"),
  ux: ecran("screens.ux", "/v1/screens/ux"),
  map: ecran("screens.map", "/v1/screens/map"),
  errors: ecran("screens.errors", "/v1/screens/errors"),
  /** Un groupe d'erreurs par son empreinte (qui n'identifie pas un groupe : le chargeur résout). */
  erreur: ecran<{ fingerprint: string }>("screens.errorGroup", "/v1/screens/errors/{fingerprint}"),
  issue: ecran<{ id: string }>("screens.issue", "/v1/screens/errors/issues/{id}"),
  tracing: ecran("screens.tracing", "/v1/screens/tracing"),
  trace: ecran<{ traceId: string }>("screens.trace", "/v1/screens/tracing/{traceId}"),
  correlation: ecran("screens.correlation", "/v1/screens/correlation"),
  // C5 — usages, satisfaction, conversions, capacités fermées (SVI, logs, IA).
  acquisition: ecran("screens.acquisition", "/v1/screens/acquisition"),
  forms: ecran("screens.forms", "/v1/screens/forms"),
  retention: ecran("screens.retention", "/v1/screens/retention"),
  paths: ecran("screens.paths", "/v1/screens/paths"),
  experience: ecran("screens.experience", "/v1/screens/experience"),
  goals: ecran("screens.goals", "/v1/screens/goals"),
  /** Capacité FERMÉE tant que `lib/capacites.ts` la liste : le chargeur ne lit rien et le dit. */
  svi: ecran("screens.svi", "/v1/screens/svi"),
  sviAppels: ecran("screens.sviCalls", "/v1/screens/svi/calls"),
  sviAppel: ecran<{ callId: string }>("screens.sviCall", "/v1/screens/svi/calls/{callId}"),
  logs: ecran("screens.logs", "/v1/screens/logs"),
  ai: ecran("screens.ai", "/v1/screens/ai"),
  // C6 — espace de travail : tableaux de bord, vues enregistrées.
  tableaux: ecran("screens.dashboards", "/v1/screens/dashboards"),
  /** Un tableau de bord et la donnée de ses cartes. Son identifiant ne donne aucun droit : le chargeur résout (propriétaire, périmètre). */
  tableau: ecran<{ id: string }>("screens.dashboard", "/v1/screens/dashboards/{id}"),
  /** L'export CSV d'un tableau : la même donnée que l'écran, projetée en lignes (10 000 au plus). */
  exportTableau: ecran<{ id: string }>("dashboards.export", "/v1/dashboards/{id}/export"),
  vues: ecran("screens.savedViews", "/v1/screens/explorer/views"),
  // C8 — alerting.
  alertes: ecran("screens.alerts", "/v1/screens/alerts"),
  /** Écran composable : sa composition voyage sous `blocs` (le cookie de la console). */
  slo: ecran("screens.slo", "/v1/screens/slo"),
});
export type CleEcran = keyof typeof ECRANS;

/**
 * LES ÉCRANS D'ADMINISTRATION (C8 → C9) : réservés à un administrateur, sans
 * portée d'application — ils listent ce que l'administrateur gère, toutes
 * applications de son périmètre confondues (le chargeur le restreint à sa liste,
 * le cas échéant). Même forme qu'un écran : les paramètres d'URL de la page, et ce
 * que rend son chargeur.
 */
function ecranAdmin<P = Aucun>(id: string, chemin: Chemin) {
  return operation<P, ParametresEcran, never, unknown>(id, "GET", chemin);
}

export const ECRANS_ADMIN = Object.freeze({
  // C8 — les sondes de disponibilité.
  sondes: ecranAdmin("screens.uptime", "/v1/screens/admin/uptime"),
});
export type CleEcranAdmin = keyof typeof ECRANS_ADMIN;

// ─── Écritures (C6 → C9) ─────────────────────────────────────────────────────

/**
 * UNE ÉCRITURE DE CONSOLE : sa commande (`apps/console/lib/commandes/`), servie
 * telle quelle. Comme pour un écran, le contrat fixe l'identité de l'opération,
 * sa méthode et son chemin ; le corps et la décision rendue appartiennent à la
 * commande, qui déclare aussi sa règle d'accès (`RegleCommande`) et son
 * validateur d'entrée — la console et le service appliquent les mêmes.
 *
 * L'application visée, quand la règle en a une, passe par `?app=` (la PORTÉE,
 * confrontée au périmètre par le pipeline avant la commande) ; un identifiant du
 * chemin ne donne aucun droit : la commande relit la ligne DANS cette
 * application (`where id = $1 and app_id = $2`), ou résout propriétaire et
 * périmètre elle-même.
 */
function commande<P = Aucun>(id: string, methode: "POST" | "PUT" | "PATCH" | "DELETE", chemin: Chemin) {
  return operation<P, Aucun, unknown, unknown>(id, methode, chemin);
}

export const COMMANDES = Object.freeze({
  // C6 — tableaux de bord. Chaque écriture d'un tableau existant CITE la révision
  // affichée (le `If-Match` de ce contrat, dans le corps) : une révision dépassée
  // est refusée, jamais appliquée par-dessus le travail d'un autre onglet.
  creerTableau: commande("dashboards.create", "POST", "/v1/dashboards"),
  clonerModele: commande<{ modele: string }>("dashboards.cloneTemplate", "POST", "/v1/dashboards/templates/{modele}/clones"),
  clonerTableau: commande<{ id: string }>("dashboards.clone", "POST", "/v1/dashboards/{id}/clones"),
  modifierTableau: commande<{ id: string }>("dashboards.update", "PATCH", "/v1/dashboards/{id}"),
  supprimerTableau: commande<{ id: string }>("dashboards.delete", "DELETE", "/v1/dashboards/{id}"),
  ajouterCarte: commande<{ id: string }>("dashboards.addWidget", "POST", "/v1/dashboards/{id}/widgets"),
  ajouterSection: commande<{ id: string }>("dashboards.addSection", "POST", "/v1/dashboards/{id}/sections"),
  enregistrerAnalyse: commande<{ id: string }>("dashboards.saveAnalysis", "POST", "/v1/dashboards/{id}/analyses"),
  configurerCarte: commande<{ id: string; index: string }>("dashboards.configureWidget", "PATCH", "/v1/dashboards/{id}/widgets/{index}"),
  retirerCarte: commande<{ id: string; index: string }>("dashboards.removeWidget", "DELETE", "/v1/dashboards/{id}/widgets/{index}"),
  deplacerCarte: commande<{ id: string; index: string }>("dashboards.moveWidget", "POST", "/v1/dashboards/{id}/widgets/{index}/moves"),
  // C6 — vues enregistrées de l'Explorer : personnelles, leur propriétaire seul les écrit.
  creerVue: commande("savedViews.create", "POST", "/v1/saved-views"),
  modifierVue: commande<{ id: string }>("savedViews.update", "PATCH", "/v1/saved-views/{id}"),
  supprimerVue: commande<{ id: string }>("savedViews.delete", "DELETE", "/v1/saved-views/{id}"),
  // C6 — objectifs de conversion : l'administrateur de l'application.
  creerObjectif: commande("goals.create", "POST", "/v1/goals"),
  activerObjectif: commande<{ id: string }>("goals.update", "PATCH", "/v1/goals/{id}"),
  supprimerObjectif: commande<{ id: string }>("goals.delete", "DELETE", "/v1/goals/{id}"),
  // C7 — le workflow des erreurs : une issue (statut, assigné, commentaire, lien,
  // demande de ticket), et le statut d'un groupe historique par son empreinte.
  // Chaque mutation d'une issue cite la révision lue ; l'application est la portée.
  trierIssue: commande<{ id: string }>("issues.triage", "POST", "/v1/issues/{id}/triage"),
  commenterIssue: commande<{ id: string }>("issues.comment", "POST", "/v1/issues/{id}/comments"),
  lierTicket: commande<{ id: string }>("issues.link", "POST", "/v1/issues/{id}/links"),
  demanderTicket: commande<{ id: string }>("issues.requestTicket", "POST", "/v1/issues/{id}/tickets"),
  trierGroupe: commande<{ fingerprint: string }>("errors.setStatus", "PUT", "/v1/errors/{fingerprint}/status"),
  // C8 — l'alerting (règles, événements, SLO, canaux) et les sondes de disponibilité.
  // Activer ou suspendre POSE l'état voulu (`PUT …/active`) : un formulaire rejoué
  // ne défait pas ce qu'il voulait faire.
  creerRegle: commande("alerts.createRule", "POST", "/v1/alert-rules"),
  modifierRegle: commande<{ id: string }>("alerts.updateRule", "PUT", "/v1/alert-rules/{id}"),
  activerRegle: commande<{ id: string }>("alerts.setRuleActive", "PUT", "/v1/alert-rules/{id}/active"),
  acquitterEvenement: commande<{ id: string }>("alerts.acknowledgeEvent", "POST", "/v1/alert-events/{id}/acknowledgement"),
  evaluerAlertes: commande("alerts.evaluate", "POST", "/v1/alert-evaluations"),
  creerSlo: commande("slo.create", "POST", "/v1/slos"),
  activerSlo: commande<{ id: string }>("slo.setActive", "PUT", "/v1/slos/{id}/active"),
  supprimerSlo: commande<{ id: string }>("slo.delete", "DELETE", "/v1/slos/{id}"),
  creerCanal: commande("channels.create", "POST", "/v1/notify-channels"),
  activerCanal: commande<{ id: string }>("channels.setActive", "PUT", "/v1/notify-channels/{id}/active"),
  supprimerCanal: commande<{ id: string }>("channels.delete", "DELETE", "/v1/notify-channels/{id}"),
  creerSonde: commande("uptime.create", "POST", "/v1/uptime-checks"),
  activerSonde: commande<{ id: string }>("uptime.setEnabled", "PUT", "/v1/uptime-checks/{id}/enabled"),
  supprimerSonde: commande<{ id: string }>("uptime.delete", "DELETE", "/v1/uptime-checks/{id}"),
  // C9 — l'administration. Les comptes, la création d'une application et ce qui
  // n'appartient à aucune (un poste de l'extension, la recette d'une capacité
  // mobile) : l'administrateur de la plateforme. Ce qui appartient à UNE
  // application (sa clé, ses origines, ses jetons, ses connecteurs, ses domaines) :
  // son administrateur, l'application en portée (`?app=`).
  creerCompte: commande("users.create", "POST", "/v1/users"),
  activerCompte: commande("users.setActive", "PUT", "/v1/user-activations"),
  reinitialiserMotDePasse: commande("users.resetPassword", "POST", "/v1/password-resets"),
  creerApplication: commande("apps.create", "POST", "/v1/apps"),
  creerSite: commande("apps.createSite", "POST", "/v1/sites"),
  renouvelerCle: commande("apps.rotateKey", "POST", "/v1/app/key-rotations"),
  activerApplication: commande("apps.setActive", "PUT", "/v1/app/active"),
  majOrigines: commande("apps.updateOrigins", "PUT", "/v1/app/origins"),
  creerJetonLecture: commande("readTokens.create", "POST", "/v1/read-tokens"),
  revoquerJetonLecture: commande<{ id: string }>("readTokens.revoke", "DELETE", "/v1/read-tokens/{id}"),
  creerJetonSourcemap: commande("sourcemapTokens.create", "POST", "/v1/sourcemap-tokens"),
  revoquerJetonSourcemap: commande<{ id: string }>("sourcemapTokens.revoke", "DELETE", "/v1/sourcemap-tokens/{id}"),
  creerIntegration: commande("ticketIntegrations.create", "POST", "/v1/ticket-integrations"),
  majIntegration: commande<{ id: string }>("ticketIntegrations.update", "PATCH", "/v1/ticket-integrations/{id}"),
  creerDomaineExtension: commande("extensionScopes.create", "POST", "/v1/extension-scopes"),
  activerDomaineExtension: commande<{ id: string }>("extensionScopes.setActive", "PUT", "/v1/extension-scopes/{id}/active"),
  oublierPoste: commande<{ installId: string }>("extensionInstalls.forget", "DELETE", "/v1/extension-installs/{installId}"),
  validerCapaciteMobile: commande("mobileCapabilities.verify", "POST", "/v1/mobile-capabilities/verifications"),
});
export type CleCommande = keyof typeof COMMANDES;

/** Toutes les opérations du contrat, dans l'ordre de la doc. */
export const OPERATIONS = Object.freeze([
  VERSION,
  JWKS,
  ETAT_PLATEFORME,
  CONNEXION,
  DEMO,
  DECONNEXION,
  MOI,
  METHODES,
  DEBUT_SSO,
  FIN_SSO,
  COQUILLE,
  ...Object.values(ECRANS),
  ...Object.values(ECRANS_ADMIN),
  ...Object.values(COMMANDES),
]);

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
