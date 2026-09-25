// C0c — LA MATRICE D'AUTORISATIONS de console-api, générée depuis sa table.
//
// Chaque opération de la table du service, et un banc d'opérations d'essai qui
// couvre chaque combinaison de politique (session, admin, admin de plateforme ×
// portée globale, app, ressource × lecture, écriture), est appelée par chaque
// PROFIL, sur chaque CIBLE — et le statut obtenu est confronté à celui qu'un
// oracle déduit de la politique seule. L'oracle est écrit ici, indépendamment du
// pipeline : si l'un des deux se trompe, ils divergent.
//
// Tout est RÉEL sauf le serveur HTTP : PostgreSQL migré (v90), comptes et
// sessions en base, jetons ES256 signés par un trousseau fabriqué pour le test,
// vérificateur et résolveur de ressource du service. La « fixture d'une autre
// app » est une vue enregistrée de l'Explorer appartenant à une application hors
// du périmètre : elle doit être indiscernable d'une vue qui n'existe pas.
//
// Une opération ajoutée à la table sans exemple d'appel ici fait ÉCHOUER le
// fichier : la matrice ne peut pas oublier une ligne.
//
//   CONSOLE_API_AUTHZ_DATABASE_URL=<base migrée> pnpm test:contract
import { gzipSync } from "node:zlib";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { COMMANDES, ECRANS, ECRANS_ADMIN, operation } from "@mip/console-contract";
import {
  chargerTrousseau,
  creerConsoleApi,
  creerDebitAuth,
  creerTable,
  creerVerificateurSession,
  emettreJetonSession,
  servir,
  type Enregistrement,
  type Politique,
  type Trousseau,
} from "@mip/console-api";

const url = process.env.CONSOLE_API_AUTHZ_DATABASE_URL || null;
if (process.env.CI && !url) throw new Error("CI : CONSOLE_API_AUTHZ_DATABASE_URL est requise");

const SECRET = "authz-".padEnd(40, "s");
const A = "authz-app-a";
const B = "authz-app-b";
const EMAILS = { viewer: "authz-viewer@test.local", admin: "authz-admin@test.local", plateforme: "authz-plateforme@test.local", desactive: "authz-desactive@test.local" };
const DEMO_EMAIL = "authz-demo@test.local";
const journal = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// ─── Le banc : une opération par combinaison de politique ────────────────────
const RESSOURCE = { table: "analytics_saved_view", parametre: "id", format: "uuid" } as const;
const retour = async ({ apps, principal }: { apps: readonly string[] | null; principal: { kind: string } }) => ({ apps, qui: principal.kind });
const BANC: Enregistrement[] = [
  servir(operation("banc.session.globale", "GET", "/v1/banc/session"), { auth: "session", portee: "globale", demo: "lecture" }, retour),
  servir(operation("banc.session.app", "GET", "/v1/banc/session/app"), { auth: "session", portee: "app", demo: "lecture" }, retour),
  servir(operation("banc.session.ressource", "GET", "/v1/banc/session/vues/{id}"), { auth: "session", portee: "ressource", demo: "lecture", ressource: RESSOURCE }, retour),
  servir(operation("banc.admin.globale", "GET", "/v1/banc/admin"), { auth: "admin", portee: "globale", demo: "lecture" }, retour),
  servir(operation("banc.admin.app", "GET", "/v1/banc/admin/app"), { auth: "admin", portee: "app", demo: "lecture" }, retour),
  servir(operation("banc.admin.ressource", "GET", "/v1/banc/admin/vues/{id}"), { auth: "admin", portee: "ressource", demo: "lecture", ressource: RESSOURCE }, retour),
  servir(operation("banc.plateforme", "GET", "/v1/banc/plateforme"), { auth: "admin-plateforme", portee: "globale", demo: "lecture" }, retour),
  servir(operation("banc.ecrire.app", "POST", "/v1/banc/ecritures"), { auth: "session", portee: "app", demo: "refus", audit: "banc.ecrire" }, retour),
  servir(operation("banc.ecrire.ressource", "PATCH", "/v1/banc/admin/vues/{id}"), { auth: "admin", portee: "ressource", demo: "refus", audit: "banc.modifier", ressource: RESSOURCE }, retour),
];

/** Exemple d'appel des opérations RÉELLES qui prennent des paramètres. */
const EXEMPLES: Record<string, string> = {
  "ops.version": "?nonce=authz-nonce-000000000000000000",
};

/** Une session de l'app A, avec un segment de rejeu : ce que les pages de détail (C3) ouvrent. */
const SESSION_A = "authz-session-a-0000000000000001";
/**
 * Les paramètres de chemin des écrans de détail : la ressource de l'app A. Le
 * pipeline ne la résout pas (portée `app`) — le chargeur relit son app et la
 * confronte au périmètre.
 */
const EMPREINTE_A = "authz-fp-a-0001";
const ISSUE_A = "00000000-0000-4000-8000-0000000a1551";
const TRACE_A = "0123456789abcdef0123456789abcdef";
/** Un tableau de bord de l'app A, sans propriétaire : ce que l'écran d'un tableau et son export ouvrent (C6). */
const TABLEAU_A = { id: "" };
/** Des identifiants qu'aucune ligne ne porte : la commande répond `introuvable` ou `interdit`, sans rien écrire. */
const ABSENT = "999999999";
const VUE_ABSENTE = "00000000-0000-4000-8000-00000000dead";
const ISSUE_ABSENTE = "00000000-0000-4000-8000-00000000beef";
const CHEMINS: Record<string, Record<string, string>> = {
  "screens.session": { id: SESSION_A },
  "replay.session": { sessionId: SESSION_A },
  "screens.errorGroup": { fingerprint: EMPREINTE_A },
  "screens.issue": { id: ISSUE_A },
  "screens.trace": { traceId: TRACE_A },
  "screens.sviCall": { callId: "authz-appel-inconnu" },
  // C6 — un tableau réel pour ses écrans ; des identifiants absents pour ses écritures.
  get "screens.dashboard"() {
    return { id: TABLEAU_A.id };
  },
  get "dashboards.export"() {
    return { id: TABLEAU_A.id };
  },
  "dashboards.cloneTemplate": { modele: "performance" },
  "dashboards.clone": { id: ABSENT },
  "dashboards.update": { id: ABSENT },
  "dashboards.delete": { id: ABSENT },
  "dashboards.addWidget": { id: ABSENT },
  "dashboards.addSection": { id: ABSENT },
  "dashboards.saveAnalysis": { id: ABSENT },
  "dashboards.configureWidget": { id: ABSENT, index: "0" },
  "dashboards.removeWidget": { id: ABSENT, index: "0" },
  "dashboards.moveWidget": { id: ABSENT, index: "0" },
  "savedViews.update": { id: VUE_ABSENTE },
  "savedViews.delete": { id: VUE_ABSENTE },
  "goals.update": { id: ABSENT },
  "goals.delete": { id: ABSENT },
  // C7 — une issue qu'aucune ligne ne porte (la commande répond `not_found`) ; le groupe de l'app A.
  "issues.triage": { id: ISSUE_ABSENTE },
  "issues.comment": { id: ISSUE_ABSENTE },
  "issues.link": { id: ISSUE_ABSENTE },
  "issues.requestTicket": { id: ISSUE_ABSENTE },
  "errors.setStatus": { fingerprint: EMPREINTE_A },
  // C8 — des identifiants qu'aucune ligne ne porte : `introuvable`, sans rien écrire.
  "alerts.updateRule": { id: ABSENT },
  "alerts.setRuleActive": { id: ABSENT },
  "alerts.acknowledgeEvent": { id: ABSENT },
  "slo.setActive": { id: ABSENT },
  "slo.delete": { id: ABSENT },
  "channels.setActive": { id: ABSENT },
  "channels.delete": { id: ABSENT },
  "uptime.setEnabled": { id: ABSENT },
  "uptime.delete": { id: ABSENT },
  // C9 — des identifiants qu'aucune ligne ne porte.
  "readTokens.revoke": { id: ABSENT },
  "sourcemapTokens.revoke": { id: VUE_ABSENTE },
  "ticketIntegrations.update": { id: ABSENT },
  "extensionScopes.setActive": { id: ABSENT },
  "extensionInstalls.forget": { installId: VUE_ABSENTE },
};

/** Une analyse de l'Explorer (AST v1) sur l'app A : ce qu'une vue enregistre. */
const AST_A = {
  version: 1,
  app: A,
  range: { preset: "24h" },
  dataset: "errors",
  measure: { aggregation: "sum", field: "occurrences" },
  filters: [],
  groupBy: ["release"],
  visualization: "toplist",
  limit: 10,
};
/** Une carte d'analyse (configuration v2) : ce que l'Explorer enregistre sur un tableau. */
const CARTE_V2 = {
  schemaVersion: 2,
  type: "analytics",
  title: "Erreurs par release",
  query: { version: 1, dataset: "errors", measure: { aggregation: "sum", field: "occurrences" }, filters: [], groupBy: ["release"], limit: 10 },
  visualization: "toplist",
  filters: [],
};

/**
 * Des variantes d'URL par écran, en plus de l'URL nue : ce qui ouvre d'autres
 * branches du chargeur (comparaison, panneau, exécution de l'Explorer, onglet).
 * Chacune doit aboutir, section par section.
 */
const VARIANTES: Record<string, string[]> = {
  actions: ["cmp=prev", "offset=50"],
  mobile: ["cmp=prev"],
  sessions: ["cmp=prev", `panel=session:${SESSION_A}`, "split=browser"],
  session: ["tab=vitals"],
  explorer: ["run=1", "run=1&viz=timeseries&cmp=prev", "run=1&viz=table"],
  overview: ["cmp=prev", "cmp=release", "split=browser&tri=volume"],
  pages: ["cmp=prev", "cmp=release", "vital=INP", "panel=route:%2Fpanier"],
  ux: ["cmp=prev", "type=rage"],
  map: ["panel=noeud:front:%2Fpanier"],
  errors: ["cmp=prev", "split=browser", `panel=error:${EMPREINTE_A}`],
  erreur: ["legacy=1"],
  tracing: ["cmp=prev", "appel=GET%20%2Fapi"],
  correlation: ["cmp=prev"],
  acquisition: ["cmp=prev"],
  forms: ["cmp=prev", "form=inscription"],
  retention: ["weeks=4", "weeks=26", "device=mobile"],
  paths: ["cmp=prev", "s1=%2Faccueil&s2=%2Fpanier", "depuis=%2Faccueil"],
  experience: ["cmp=prev"],
  goals: ["cmp=prev"],
};

/**
 * Les états d'un chargeur qui disent qu'il a ABOUTI (défaut : `ok`). La liste des
 * erreurs bifurque (issues ou groupes historiques, P5.5) ; une issue demandée sous
 * `app=all` est ramenée à son app (la page redirige) — deux décisions, pas des échecs.
 */
const ABOUTIS: Record<string, readonly string[]> = {
  errors: ["groupes", "issues"],
  issue: ["ok", "autre_app"],
  // Capacités FERMÉES (`lib/capacites.ts`) : le chargeur ne lit rien et le dit.
  svi: ["fermee"],
  sviAppels: ["fermee"],
  sviAppel: ["fermee"],
  logs: ["fermee"],
  ai: ["fermee"],
};

/**
 * C1 — les opérations d'identité PUBLIQUES rendent autre chose que 200 à tout le
 * monde, et c'est leur contrat : une connexion aux identifiants inconnus est
 * refusée (401) quelle que soit la session présentée, et la démo est fermée ici
 * (404). La politique (publique) est la même pour tous ; le statut fixe le dit.
 */
const STATUT_FIXE: Record<string, number> = { "auth.login": 401, "auth.demo": 404, "auth.oidcStart": 404, "auth.oidc": 400 };
const CORPS: Record<string, unknown> = {
  "auth.login": { email: "authz-inconnu@test.local", mot_de_passe: "pas-le-bon" },
  // C6 — un corps VALIDE par écriture : la matrice éprouve l'accès, pas l'entrée.
  "dashboards.create": { name: "authz", app_id: A },
  "dashboards.cloneTemplate": { app_id: A },
  "dashboards.update": { name: "authz", app_id: A, revision: "1" },
  "dashboards.addWidget": { type: "traffic", revision: "1" },
  "dashboards.addSection": { title: "Où ?", revision: "1" },
  "dashboards.saveAnalysis": { widget: CARTE_V2, revision: "1" },
  "dashboards.configureWidget": { filters: "", range_preset: "", revision: "1" },
  "dashboards.removeWidget": { revision: "1" },
  "dashboards.moveWidget": { dir: "down", revision: "1" },
  "savedViews.create": { name: "authz", query: AST_A },
  "savedViews.update": { name: "authz", expectedRevision: "1" },
  "goals.create": { name: "authz", kind: "pageview", pattern: "/merci", match_type: "exact" },
  "goals.update": { active: false },
  "issues.triage": { status: "resolved", expectedRevision: "1" },
  "issues.comment": { body: "authz", expectedRevision: "1" },
  "issues.link": { url: "https://tickets.exemple.fr/AUTHZ-1", label: "AUTHZ-1", expectedRevision: "1" },
  "issues.requestTicket": { integrationId: "1", expectedRevision: "1", origine: "" },
  "errors.setStatus": { status: "open" },
  // C8 — les champs d'un formulaire (des chaînes), tels que la console les envoie.
  "alerts.createRule": { app_id: A, metric: "LCP", comparator: ">", threshold: "2500", window_minutes: "15", mode: "threshold", severity: "warning" },
  "alerts.updateRule": { app_id: A, metric: "LCP", comparator: ">", threshold: "3000", window_minutes: "15", mode: "threshold", severity: "warning" },
  "alerts.setRuleActive": { active: false },
  "slo.create": { app_id: A, name: "authz", metric: "error_rate", objective: "99", window_days: "28" },
  "slo.setActive": { active: false },
  "channels.create": { app_id: A, kind: "webhook", target: "https://hooks.exemple.fr/authz", severity_min: "warning" },
  "channels.setActive": { active: false },
  "uptime.create": { name: "authz", url: "https://exemple.fr/sante" },
  "uptime.setEnabled": { enabled: false },
  // C9 — des comptes et des lignes qu'aucune écriture ne trouve (`introuvable`), ou
  // des créations dédiées à la matrice, nettoyées par `nettoyer()`.
  "users.create": { email: "authz-c9-compte@test.local", role: "viewer", apps: A },
  "users.setActive": { email: "authz-c9-inconnu@test.local", active: true },
  "users.resetPassword": { email: "authz-c9-inconnu@test.local" },
  "apps.create": { app_id: "authz-c9-app", name: "authz", origins: "https://authz-c9.exemple.fr" },
  "apps.createSite": { name: "authz c9 site", url: "https://authz-c9-site.exemple.fr", mode: "sdk" },
  "apps.setActive": { active: true },
  "apps.updateOrigins": { origins: "https://authz.exemple.fr" },
  "readTokens.create": { label: "authz" },
  "sourcemapTokens.create": { name: "authz" },
  "ticketIntegrations.create": { provider: "github", target: "authz/depot", credentialRef: "env:TICKET_AUTHZ" },
  "ticketIntegrations.update": { champ: "enabled", valeur: true },
  "extensionScopes.create": { domain: "authz-a.exemple.fr" },
  "extensionScopes.setActive": { active: true },
  "mobileCapabilities.verify": { app_id: A, runtime: "react_native", release: null, capability: "js_errors", note: "" },
};
/** Hors de la boucle : la déconnexion RÉVOQUE la session du profil — testée à part, en dernier. */
const HORS_MATRICE = new Set(["auth.logout"]);

// ─── Les profils ─────────────────────────────────────────────────────────────
type Profil = "anonyme" | "invalide" | "revoquee" | "desactive" | "demo" | "viewer" | "admin" | "plateforme";
/** Ce qu'un profil VAUT, pour l'oracle : `null` = pas de session valide. */
const DROITS: Record<Profil, { role: "admin" | "viewer"; apps: string[] | null; demo: boolean } | null> = {
  anonyme: null,
  invalide: null,
  revoquee: null,
  desactive: null,
  demo: { role: "viewer", apps: [A], demo: true },
  viewer: { role: "viewer", apps: [A], demo: false },
  admin: { role: "admin", apps: [A], demo: false },
  plateforme: { role: "admin", apps: null, demo: false },
};
const PROFILS = Object.keys(DROITS) as Profil[];

type Cible = { nom: string; app?: string; vue?: "a" | "b" | "absente" };

/** L'ORACLE : le statut attendu, déduit de la politique seule. */
function attendu(p: Politique, profil: Profil, cible: Cible): number {
  if (p.auth === "public") return 200;
  const d = DROITS[profil];
  if (!d) return 401;
  if (d.demo && p.demo === "refus") return 403;
  if ((p.auth === "admin" || p.auth === "admin-plateforme") && d.role !== "admin") return 403;
  if (p.auth === "admin-plateforme" && d.apps !== null) return 403;
  if (p.portee === "app") {
    if (cible.app === "all") return d.apps === null || d.apps.length > 0 ? 200 : 403;
    return d.apps === null || d.apps.includes(cible.app!) ? 200 : 403;
  }
  // Une écriture (C6 → C9) vise UNE application nommée : `all` n'en est pas une.
  if (p.portee === "une-app") {
    if (cible.app === "all") return 400;
    return d.apps === null || d.apps.includes(cible.app!) ? 200 : 403;
  }
  if (p.portee === "ressource") {
    if (cible.vue === "absente") return 404;
    const app = cible.vue === "a" ? A : B;
    return d.apps === null || d.apps.includes(app) ? 200 : 404;
  }
  return 200;
}

function cibles(p: Politique): Cible[] {
  if (p.portee === "app" || p.portee === "une-app") return [{ nom: "app A", app: A }, { nom: "app B", app: B }, { nom: "app=all", app: "all" }];
  if (p.portee === "ressource") return [{ nom: "vue de A", vue: "a" }, { nom: "vue de B (autre app)", vue: "b" }, { nom: "vue absente", vue: "absente" }];
  return [{ nom: "—" }];
}

(url ? describe : describe.skip)("C0c — matrice d'autorisations de console-api (PostgreSQL, sessions réelles)", () => {
  const pool = new pg.Pool({ connectionString: url ?? undefined, max: 4 });
  let trousseau: Trousseau;
  let table: Enregistrement[];
  let servirRequete: (req: Request) => Promise<Response>;
  let maintenant = Date.now();
  const jetons = {} as Record<Profil, string | null>;
  const sessions = {} as Record<Profil, string>;
  const vues = { a: "", b: "", absente: "00000000-0000-4000-8000-00000000abcd" };

  async function jeu(kid: string) {
    const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", paire.privateKey);
    return JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, kid, alg: "ES256", use: "sig" }] });
  }

  async function nettoyer() {
    await pool.query("delete from console_session where demo_email = $1 or user_id in (select id from console_user where email = any($2))", [DEMO_EMAIL, Object.values(EMAILS)]);
    await pool.query("delete from analytics_saved_view where app_id = any($1)", [[A, B]]);
    await pool.query("delete from dashboard where app_id = any($1) or created_by = any($2)", [[A, B], Object.values(EMAILS)]);
    await pool.query("delete from goal where app_id = any($1)", [[A, B]]);
    await pool.query("delete from error_status where app_id = any($1)", [[A, B]]);
    await pool.query("delete from error_issue_activity where app_id = any($1)", [[A, B]]);
    await pool.query("delete from error_issue_ticket where app_id = any($1)", [[A, B]]);
    await pool.query("delete from alert_rule where app_id = any($1)", [[A, B]]);
    await pool.query("delete from slo where app_id = any($1)", [[A, B]]);
    await pool.query("delete from notify_channel where app_id = any($1) or target like 'https://hooks.exemple.fr/authz%'", [[A, B]]);
    await pool.query("delete from uptime_check where app_id = any($1)", [[A, B]]);
    await pool.query("delete from read_tokens where app_id = any($1)", [[A, B]]);
    await pool.query("delete from sourcemap_upload_token where app_id = any($1)", [[A, B]]);
    await pool.query("delete from ticket_outbox where app_id = any($1)", [[A, B]]);
    await pool.query("delete from ticket_integration where app_id = any($1)", [[A, B]]);
    await pool.query("delete from extension_scope where app_id = any($1) or domain like 'authz-%'", [[A, B]]);
    await pool.query("delete from mobile_capabilities where app_id = any($1)", [[A, B]]);
    await pool.query("delete from console_user where email like 'authz-c9-%'");
    await pool.query("delete from app_registry where app_id like 'authz-c9%'");
    await pool.query("delete from replay_chunk where app_id = any($1)", [[A, B]]);
    await pool.query("delete from rum_error where app_id = any($1)", [[A, B]]);
    await pool.query("delete from error_issue where app_id = any($1)", [[A, B]]);
    await pool.query("delete from rum_span where app_id = any($1)", [[A, B]]);
    // Base dédiée à la matrice : les compteurs de débit d'authentification d'un passage
    // précédent (clés HMAC, illisibles) ne doivent pas refuser celui-ci en 429.
    await pool.query("delete from auth_throttle");
    await pool.query("delete from rum_session where app_id = any($1)", [[A, B]]);
    await pool.query("delete from console_user where email = any($1)", [Object.values(EMAILS)]);
    await pool.query("delete from app_registry where app_id = any($1)", [[A, B]]);
  }

  async function ouvrir(sql: string, valeurs: unknown[]): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(sql, valeurs);
    return rows[0].id;
  }

  beforeAll(async () => {
    await nettoyer();
    for (const app of [A, B]) await pool.query("insert into app_registry (app_id, name) values ($1, $1)", [app]);
    const compte = async (email: string, role: string, apps: string[] | null, active = true) =>
      ouvrir("insert into console_user (email, password_hash, role, apps, active) values ($1, 'x', $2, $3, $4) returning id", [email, role, apps, active]);
    const ids = {
      viewer: await compte(EMAILS.viewer, "viewer", [A]),
      admin: await compte(EMAILS.admin, "admin", [A]),
      plateforme: await compte(EMAILS.plateforme, "admin", null),
      desactive: await compte(EMAILS.desactive, "viewer", [A], false),
    };
    const session = (userId: string, revoquee = false) =>
      ouvrir(
        `insert into console_session (user_id, expires_at, revoked_at, revoked_reason)
         values ($1, now() + interval '8 hours', ${revoquee ? "now(), 'logout'" : "null, null"}) returning id`,
        [userId],
      );
    sessions.viewer = await session(ids.viewer);
    sessions.admin = await session(ids.admin);
    sessions.plateforme = await session(ids.plateforme);
    sessions.desactive = await session(ids.desactive);
    sessions.revoquee = await session(ids.viewer, true);
    sessions.demo = await ouvrir(
      "insert into console_session (demo, demo_email, demo_apps, expires_at) values (true, $1, $2, now() + interval '8 hours') returning id",
      [DEMO_EMAIL, [A]],
    );
    const vue = (app: string) =>
      ouvrir("insert into analytics_saved_view (app_id, name, query_json) values ($1, 'authz', '{\"version\":1}') returning id", [app]);
    vues.a = await vue(A);
    vues.b = await vue(B);
    await pool.query("insert into rum_session (session_id, app_id, started_at, last_seen_at, page_count) values ($1, $2, now() - interval '5 minutes', now(), 1)", [SESSION_A, A]);
    // Un segment de rejeu (gzip d'une liste d'événements rrweb) : la lecture passe par la fenêtre SQL du plafond.
    await pool.query("insert into replay_chunk (session_id, app_id, seq, body) values ($1, $2, 0, $3)", [SESSION_A, A, gzipSync(JSON.stringify([{ type: 4 }, { type: 2 }]))]);
    // Un groupe d'erreurs, une issue et une trace de l'app A : ce que les pages de détail de C4 ouvrent.
    await pool.query(
      "insert into rum_error (app_id, ts, fingerprint, error_type, message, session_id) values ($1, now() - interval '2 minutes', $2, 'TypeError', 'authz', $3)",
      [A, EMPREINTE_A, SESSION_A],
    );
    await pool.query(
      `insert into error_issue (id, app_id, grouping_version, grouping_key, grouping_basis, origin, status_source, first_seen, last_seen)
       values ($1, $2, 2, $3, 'normalized_frame', 'migration', 'migration', now() - interval '1 hour', now())`,
      [ISSUE_A, A, "a".repeat(32)],
    );
    await pool.query(
      "insert into rum_span (span_id, trace_id, tier, app_id, duration_ms, ts, session_id) values ('0123456789abcdef', $1, 'front', $2, 120, now() - interval '2 minutes', $3)",
      [TRACE_A, A, SESSION_A],
    );
    // C6 — un tableau de bord de l'app A, avec une carte : son écran, et son export.
    TABLEAU_A.id = await ouvrir(
      `insert into dashboard (name, app_id, layout) values ('authz', $1, '[{"type":"traffic","title":"Trafic"}]'::jsonb) returning id::text as id`,
      [A],
    );

    trousseau = await chargerTrousseau(await jeu("session-authz-a"), { production: false });
    const etranger = await chargerTrousseau(await jeu("session-authz-z"), { production: false });
    const s0 = Math.floor(maintenant / 1000);
    // La démo porte `demo: true` dans son jeton (immuable, vérifié contre la ligne).
    const emettre = (t: Trousseau, sid: string, demo = false) =>
      emettreJetonSession(t, { sid, iat: s0, exp: s0 + 8 * 3600, ...(demo ? { demo: true as const } : {}) });
    jetons.anonyme = null;
    // Une signature valide… d'une AUTRE clé, pour une session qui existe.
    jetons.invalide = await emettre(etranger, sessions.viewer);
    for (const p of ["revoquee", "desactive", "demo", "viewer", "admin", "plateforme"] as const) jetons[p] = await emettre(trousseau, sessions[p], p === "demo");

    const verificateur = await creerVerificateurSession({ trousseau, db: pool, horloge: () => maintenant });
    // La couche de données de la console lit `DATABASE_URL` : la base de la matrice.
    process.env.DATABASE_URL = url!;
    // Les chargeurs d'écrans du SERVICE (`services/console-api/ecrans.mjs`) : ceux
    // de la console, à la signature du service — le même module que le bundle.
    const { ecrans } = await import("../../services/console-api/ecrans.mjs");
    const { commandes } = await import("../../services/console-api/commandes.mjs");
    const transacteur = {
      async transaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
        const c = await pool.connect();
        try {
          await c.query("begin");
          const r = await fn(c);
          await c.query("commit");
          return r;
        } catch (e) {
          await c.query("rollback").catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
    };
    const reel = await creerTable({
      trousseau,
      version: "authz",
      db: pool,
      identite: {
        transacteur,
        debit: await creerDebitAuth(SECRET),
        verifierMotDePasse: async () => false,
        hachageFactice: "",
        demo: null,
        oublierSession: (sid) => verificateur.oublier(sid),
      },
      // C2 → C6 — les VRAIS chargeurs (coquille, écrans), ceux de la console, sur la
      // base de la matrice : chaque écran s'exécute pour chaque profil et chaque cible.
      ecrans,
      // C6 → C9 — les VRAIES commandes, de même : chaque écriture pour chaque profil.
      commandes,
    });
    table = [...reel.table, ...BANC];
    servirRequete = creerConsoleApi({
      table,
      secretsClient: [SECRET],
      journal,
      verifierSession: verificateur.verifier,
      lecteur: pool,
      debitParMinute: 0,
      horloge: () => maintenant,
    });
  });

  afterAll(async () => {
    await nettoyer();
    await pool.end();
  });

  function requete(e: Enregistrement, profil: Profil, cible: Cible): Request {
    let chemin = e.operation.chemin;
    if (cible.vue) chemin = chemin.replace("{id}", vues[cible.vue]);
    for (const [nom, valeur] of Object.entries(CHEMINS[e.operation.id] ?? {})) chemin = chemin.replace(`{${nom}}`, encodeURIComponent(valeur));
    const q = cible.app ? `?app=${encodeURIComponent(cible.app)}` : EXEMPLES[e.operation.id] ?? "";
    // Une adresse de visiteur par profil : les échecs de connexion de la matrice ne
    // s'additionnent pas sur un seul compteur.
    const entetes: Record<string, string> = { "x-mip-client": SECRET, "x-mip-visitor-ip": `198.51.100.${PROFILS.indexOf(profil) + 1}` };
    if (jetons[profil]) entetes.authorization = `Bearer ${jetons[profil]}`;
    const corps = CORPS[e.operation.id];
    if (corps !== undefined) entetes["content-type"] = "application/json";
    return new Request(`https://console-api.test${chemin}${q}`, { method: e.operation.methode, headers: entetes, body: corps === undefined ? undefined : JSON.stringify(corps) });
  }

  it("chaque opération réelle a un exemple d'appel, ou n'en demande pas", () => {
    const sansExemple = table
      .filter((e) => e.operation.chemin.includes("{") && !e.politique.ressource && !(e.operation.id in CHEMINS))
      .map((e) => e.operation.id);
    expect(sansExemple).toEqual([]);
  });

  it("la matrice : chaque opération × chaque profil × chaque cible rend le statut de l'oracle", async () => {
    const ecarts: string[] = [];
    let cases = 0;
    for (const e of table.filter((x) => !HORS_MATRICE.has(x.operation.id))) {
      for (const profil of PROFILS) {
        for (const cible of cibles(e.politique)) {
          cases++;
          const res = await servirRequete(requete(e, profil, cible));
          const voulu = STATUT_FIXE[e.operation.id] ?? attendu(e.politique, profil, cible);
          if (res.status !== voulu) {
            ecarts.push(`${e.operation.id} · ${profil} · ${cible.nom} : ${res.status} au lieu de ${voulu} (${await res.text()})`);
            continue;
          }
          // Ce que le traitement a VU : l'application résolue avant lui.
          if (voulu === 200 && e.operation.id.startsWith("banc.")) {
            const { data } = (await res.json()) as { data: { apps: string[] | null } };
            const d = DROITS[profil]!;
            const apps =
              e.politique.portee === "globale" ? null
              : cible.vue ? [cible.vue === "a" ? A : B]
              : cible.app === "all" ? d.apps
              : [cible.app!];
            if (JSON.stringify(data.apps) !== JSON.stringify(apps)) ecarts.push(`${e.operation.id} · ${profil} · ${cible.nom} : apps ${JSON.stringify(data.apps)} au lieu de ${JSON.stringify(apps)}`);
          }
        }
      }
    }
    expect(ecarts).toEqual([]);
    // Par profil : 9 opérations réelles (logout à part), 3 du banc à portée globale, 6 à trois cibles,
    // et chaque écran (portée `app`) sur ses trois cibles.
    expect(cases).toBeGreaterThanOrEqual(PROFILS.length * (9 + 3 + 6 * 3 + Object.keys(ECRANS).length * 3));
  });

  it("une vue d'une autre application est indiscernable d'une vue qui n'existe pas", async () => {
    const e = BANC.find((x) => x.operation.id === "banc.session.ressource")!;
    const [ailleurs, absente] = await Promise.all([
      servirRequete(requete(e, "viewer", { nom: "", vue: "b" })),
      servirRequete(requete(e, "viewer", { nom: "", vue: "absente" })),
    ]);
    expect(ailleurs.status).toBe(404);
    expect((await ailleurs.json()).error).toEqual((await absente.json()).error);
  });

  it("la coquille (C2) : les projets du PÉRIMÈTRE relu en base, les connecteurs pour l'administrateur seulement", async () => {
    const e = table.find((x) => x.operation.id === "console.shell")!;
    const lire = async (profil: Profil) => {
      const r = await servirRequete(requete(e, profil, { nom: "" }));
      expect(r.status, profil).toBe(200);
      const { data } = (await r.json()) as { data: { projets: { ok: boolean; data?: { app_id: string }[] }; tickets: unknown } };
      expect(data.projets.ok, profil).toBe(true);
      return { apps: (data.projets.data ?? []).map((p) => p.app_id).filter((x) => x === A || x === B).sort(), tickets: data.tickets === null ? null : "section" };
    };
    expect(await lire("demo")).toEqual({ apps: [A], tickets: null });
    expect(await lire("viewer")).toEqual({ apps: [A], tickets: null });
    // Un administrateur AVEC une liste voit aujourd'hui tous les projets : c'est la
    // règle de la console (`authorizedAppsOf` : admin ⇒ toutes les apps), que le
    // chargeur partage à l'identique. Le pipeline, lui, confronte déjà `app` à la
    // liste. C9 alignera la console (« un admin avec une liste n'administre que
    // ces apps ») ; relevé P0 : aucun administrateur restreint en production.
    expect(await lire("admin")).toEqual({ apps: [A, B], tickets: "section" });
    expect(await lire("plateforme")).toEqual({ apps: [A, B], tickets: "section" });
  });

  it("chaque écran (C3 → C5) : pour un viewer, sur son app et sur `all`, le chargeur aboutit — aucune section en échec", async () => {
    /** Les sections en échec d'une réponse, par leur chemin (`lignes`, `series.3`…). */
    const echecs = (v: unknown, chemin = ""): string[] => {
      if (Array.isArray(v)) return v.flatMap((x, i) => echecs(x, `${chemin}.${i}`));
      if (v === null || typeof v !== "object") return [];
      const o = v as Record<string, unknown>;
      if (o.ok === false && o.code === "lecture_en_echec") return [chemin || "(racine)"];
      return Object.entries(o).flatMap(([k, x]) => echecs(x, chemin ? `${chemin}.${k}` : k));
    };
    const ecarts: string[] = [];
    for (const cle of Object.keys(ECRANS) as (keyof typeof ECRANS)[]) {
      const e = table.find((x) => x.operation.id === ECRANS[cle].id)!;
      for (const app of [A, "all"]) {
        for (const variante of ["", ...(VARIANTES[cle] ?? [])]) {
          const base = requete(e, "viewer", { nom: "", app });
          const url = variante ? `${base.url}&${variante}` : base.url;
          const res = await servirRequete(new Request(url, { headers: base.headers }));
          const nom = `${cle} · ${app}${variante ? ` · ${variante}` : ""}`;
          if (res.status !== 200) {
            ecarts.push(`${nom} : ${res.status} ${await res.text()}`);
            continue;
          }
          const { data } = (await res.json()) as { data: { etat?: string } };
          if (!(ABOUTIS[cle] ?? ["ok"]).includes(data.etat ?? "")) ecarts.push(`${nom} : état ${data.etat}`);
          for (const chemin of echecs(data)) ecarts.push(`${nom} : section ${chemin} en échec`);
        }
      }
    }
    expect(ecarts).toEqual([]);
  });

  it("chaque écran d'administration (C8 → C9) : pour un administrateur, le chargeur aboutit — et pour un viewer, 403 avant lui", async () => {
    const ecarts: string[] = [];
    for (const cle of Object.keys(ECRANS_ADMIN) as (keyof typeof ECRANS_ADMIN)[]) {
      const e = table.find((x) => x.operation.id === ECRANS_ADMIN[cle].id)!;
      for (const profil of ["admin", "plateforme"] as const) {
        const res = await servirRequete(requete(e, profil, { nom: "" }));
        if (res.status !== 200) {
          ecarts.push(`${cle} · ${profil} : ${res.status} ${await res.text()}`);
          continue;
        }
        const { data } = (await res.json()) as { data: { etat?: string } };
        if (data.etat !== "ok") ecarts.push(`${cle} · ${profil} : état ${data.etat}`);
      }
      expect((await servirRequete(requete(e, "viewer", { nom: "" }))).status, cle).toBe(403);
    }
    expect(ecarts).toEqual([]);
  });

  it("les écritures (C6 → C9), de bout en bout : chaque commande aboutit pour qui a le droit, et s'inscrit au journal", async () => {
    /** Appelle une commande comme la console le fera : son opération, sa portée, son corps. */
    const appeler = async (cle: keyof typeof COMMANDES, profil: Profil, o: { app?: string; chemin?: Record<string, string>; corps?: unknown } = {}) => {
      const op = COMMANDES[cle];
      let chemin: string = op.chemin;
      for (const [nom, valeur] of Object.entries(o.chemin ?? {})) chemin = chemin.replace(`{${nom}}`, encodeURIComponent(valeur));
      const entetes: Record<string, string> = { "x-mip-client": SECRET, authorization: `Bearer ${jetons[profil]}`, "x-request-id": `authz-c6-${cle}`.slice(0, 64) };
      if (o.corps !== undefined) entetes["content-type"] = "application/json";
      const r = await servirRequete(
        new Request(`https://console-api.test${chemin}${o.app ? `?app=${o.app}` : ""}`, {
          method: op.methode,
          headers: entetes,
          body: o.corps === undefined ? undefined : JSON.stringify(o.corps),
        }),
      );
      expect(r.status, `${cle} : ${r.status}`).toBe(200);
      return ((await r.json()) as { data: Record<string, unknown> }).data;
    };
    const revisionDe = async (id: string) => (await pool.query<{ r: string }>("select revision::text as r from dashboard where id = $1", [id])).rows[0]?.r;

    // Un tableau : créé par un viewer dans son app, édité carte par carte en citant sa révision.
    const cree = await appeler("creerTableau", "viewer", { corps: { name: "C6 bout en bout", app_id: A } });
    expect(cree).toMatchObject({ etat: "cree" });
    const id = String(cree.id);
    expect(await appeler("ajouterCarte", "viewer", { chemin: { id }, corps: { type: "traffic", revision: await revisionDe(id) } })).toMatchObject({ etat: "ok" });
    // Une révision dépassée : refusée, rien d'écrit.
    expect(await appeler("ajouterCarte", "viewer", { chemin: { id }, corps: { type: "traffic", revision: "1" } })).toEqual({ etat: "conflit" });
    expect(await appeler("ajouterSection", "viewer", { chemin: { id }, corps: { title: "Où ?", position: "0", revision: await revisionDe(id) } })).toMatchObject({ etat: "ok" });
    expect(await appeler("enregistrerAnalyse", "viewer", { chemin: { id }, corps: { widget: CARTE_V2, revision: await revisionDe(id) } })).toMatchObject({ etat: "ok" });
    expect(
      await appeler("configurerCarte", "viewer", { chemin: { id, index: "2" }, corps: { filters: "v2:browser:eq:Firefox", range_preset: "7d", revision: await revisionDe(id) } }),
    ).toMatchObject({ etat: "ok" });
    expect(await appeler("deplacerCarte", "viewer", { chemin: { id, index: "0" }, corps: { dir: "down", revision: await revisionDe(id) } })).toMatchObject({ etat: "ok" });
    expect(await appeler("retirerCarte", "viewer", { chemin: { id, index: "1" }, corps: { revision: await revisionDe(id) } })).toMatchObject({ etat: "ok" });
    const { rows: [apres] } = await pool.query<{ layout: { type?: string; kind?: string }[] }>("select layout from dashboard where id = $1", [id]);
    expect(apres.layout).toHaveLength(2);
    // Le tableau d'un autre compte : un viewer ne l'édite pas ; un administrateur de l'app, si.
    expect(await appeler("ajouterCarte", "viewer", { chemin: { id: TABLEAU_A.id }, corps: { type: "traffic", revision: await revisionDe(TABLEAU_A.id) } })).toEqual({ etat: "interdit" });
    expect(await appeler("modifierTableau", "viewer", { chemin: { id }, corps: { name: "Renommé", app_id: A, revision: await revisionDe(id) } })).toMatchObject({ etat: "ok" });
    const clone = await appeler("clonerTableau", "admin", { chemin: { id } });
    expect(clone).toMatchObject({ etat: "cree" });
    const modele = await appeler("clonerModele", "viewer", { chemin: { modele: "erreurs" }, corps: { app_id: A } });
    expect(modele).toMatchObject({ etat: "cree", app: A });
    // Cloner vers une app hors du périmètre : refusé par la commande (la règle est `session`).
    expect(await appeler("clonerModele", "viewer", { chemin: { modele: "erreurs" }, corps: { app_id: B } })).toEqual({ etat: "refus" });
    expect(await appeler("supprimerTableau", "viewer", { chemin: { id } })).toEqual({ etat: "ok" });
    expect((await pool.query("select 1 from dashboard where id = $1", [id])).rowCount).toBe(0);

    // Une vue enregistrée : créée, renommée, supprimée par son propriétaire.
    const vue = await appeler("creerVue", "viewer", { corps: { name: "C6 vue", query: AST_A } });
    expect(vue).toMatchObject({ kind: "ok" });
    const idVue = String((vue.value as { id: string }).id);
    expect(await appeler("modifierVue", "viewer", { chemin: { id: idVue }, corps: { name: "C6 vue renommée", expectedRevision: "1" } })).toMatchObject({ kind: "ok" });
    // Un administrateur de l'app la LIT, mais ne la supprime pas : elle est personnelle.
    expect(await appeler("supprimerVue", "admin", { chemin: { id: idVue } })).toMatchObject({ kind: "forbidden" });
    expect(await appeler("supprimerVue", "viewer", { chemin: { id: idVue } })).toMatchObject({ kind: "ok" });

    // Un objectif : créé, suspendu, supprimé par l'administrateur de l'app — et jamais par l'id seul.
    const objectif = await appeler("creerObjectif", "admin", { app: A, corps: { name: "C6", kind: "event", pattern: "achat", match_type: "exact" } });
    expect(objectif).toMatchObject({ etat: "cree" });
    const idObjectif = String(objectif.id);
    // Le même identifiant sous une AUTRE application (celle de la plateforme) : introuvable.
    expect(await appeler("activerObjectif", "plateforme", { app: B, chemin: { id: idObjectif }, corps: { active: false } })).toEqual({ etat: "introuvable" });
    expect(await appeler("activerObjectif", "admin", { app: A, chemin: { id: idObjectif }, corps: { active: false } })).toEqual({ etat: "ok", active: false });
    expect(await appeler("supprimerObjectif", "admin", { app: A, chemin: { id: idObjectif } })).toEqual({ etat: "ok" });

    // C7 — une issue : commentée puis résolue par l'administrateur de son app, en citant sa révision.
    const revisionIssue = async () => (await pool.query<{ r: string }>("select revision::text as r from error_issue where id = $1", [ISSUE_A])).rows[0].r;
    expect(await appeler("commenterIssue", "admin", { app: A, chemin: { id: ISSUE_A }, corps: { body: "je regarde", expectedRevision: await revisionIssue() } })).toMatchObject({ kind: "ok" });
    expect(await appeler("trierIssue", "admin", { app: A, chemin: { id: ISSUE_A }, corps: { status: "resolved", expectedRevision: "1" } })).toMatchObject({ kind: "conflict" });
    expect(await appeler("trierIssue", "admin", { app: A, chemin: { id: ISSUE_A }, corps: { status: "resolved", expectedRevision: await revisionIssue() } })).toMatchObject({
      kind: "ok",
      value: { status: "resolved" },
    });
    // La même issue, demandée sous une AUTRE application par la plateforme : introuvable.
    expect(await appeler("lierTicket", "plateforme", { app: B, chemin: { id: ISSUE_A }, corps: { url: "https://t.exemple.fr/9", label: "T-9", expectedRevision: await revisionIssue() } })).toEqual({
      kind: "not_found",
    });
    expect(await appeler("trierGroupe", "admin", { app: A, chemin: { fingerprint: EMPREINTE_A }, corps: { status: "ignored" } })).toEqual({ etat: "ok" });
    expect((await pool.query("select status from error_status where app_id = $1 and fingerprint = $2", [A, EMPREINTE_A])).rows[0]?.status).toBe("ignored");

    // C8 — une règle, un SLO, un canal et une sonde de l'app A, par son administrateur ; chaque
    // ligne relue DANS son application (un identifiant sous une autre : introuvable).
    const regle = await appeler("creerRegle", "admin", { app: A, corps: { app_id: A, metric: "LCP", comparator: ">", threshold: "2500", window_minutes: "15", mode: "threshold", severity: "warning" } });
    expect(regle).toMatchObject({ etat: "cree" });
    const idRegle = String(regle.id);
    expect(await appeler("activerRegle", "plateforme", { app: B, chemin: { id: idRegle }, corps: { active: false } })).toEqual({ etat: "introuvable" });
    expect(await appeler("activerRegle", "admin", { app: A, chemin: { id: idRegle }, corps: { active: false } })).toEqual({ etat: "ok" });
    const regleInp = (app_id: string) => ({ app_id, metric: "INP", comparator: ">", threshold: "300", window_minutes: "30", mode: "threshold", severity: "critical" });
    expect(await appeler("modifierRegle", "admin", { app: A, chemin: { id: idRegle }, corps: regleInp(A) })).toEqual({ etat: "ok" });
    // Déplacer la règle vers une application hors de sa liste : refusé par la commande.
    expect(await appeler("modifierRegle", "admin", { app: A, chemin: { id: idRegle }, corps: regleInp(B) })).toEqual({ etat: "hors_perimetre" });
    expect((await pool.query("select metric, active, app_id from alert_rule where id = $1", [idRegle])).rows[0]).toEqual({ metric: "INP", active: false, app_id: A });
    // Un webhook vers le réseau privé : refusé à l'écriture, avec son code.
    expect(
      await appeler("creerRegle", "admin", {
        app: A,
        corps: { app_id: A, metric: "LCP", comparator: ">", threshold: "1", window_minutes: "15", mode: "threshold", severity: "warning", webhook_url: "http://10.0.0.1/x" },
      }),
    ).toEqual({ etat: "url_refusee", code: "ip_litterale" });
    const slo = await appeler("creerSlo", "admin", { app: A, corps: { app_id: A, name: "C8", metric: "error_rate", objective: "99", window_days: "28" } });
    expect(slo).toMatchObject({ etat: "cree" });
    expect(await appeler("activerSlo", "admin", { app: A, chemin: { id: String(slo.id) }, corps: { active: false } })).toEqual({ etat: "ok" });
    expect(await appeler("supprimerSlo", "admin", { app: A, chemin: { id: String(slo.id) } })).toEqual({ etat: "ok" });
    // Un canal GLOBAL : l'administrateur de la plateforme seul.
    const corpsCanal = (app_id: string) => ({ app_id, kind: "webhook", target: "https://hooks.exemple.fr/authz-c8", severity_min: "warning" });
    expect(await appeler("creerCanal", "admin", { corps: corpsCanal("") })).toEqual({ etat: "hors_perimetre" });
    const global = await appeler("creerCanal", "plateforme", { corps: corpsCanal("") });
    expect(global).toMatchObject({ etat: "cree" });
    // Un administrateur de l'app A ne touche pas au canal global.
    expect(await appeler("supprimerCanal", "admin", { chemin: { id: String(global.id) } })).toEqual({ etat: "introuvable" });
    expect(await appeler("activerCanal", "plateforme", { chemin: { id: String(global.id) }, corps: { active: false } })).toEqual({ etat: "ok" });
    expect(await appeler("supprimerCanal", "plateforme", { chemin: { id: String(global.id) } })).toEqual({ etat: "ok" });
    const sonde = await appeler("creerSonde", "admin", { app: A, corps: { name: "C8", url: "https://exemple.fr/sante" } });
    expect(sonde).toMatchObject({ etat: "cree" });
    expect(await appeler("activerSonde", "admin", { app: A, chemin: { id: String(sonde.id) }, corps: { enabled: false } })).toEqual({ etat: "ok" });
    expect(await appeler("supprimerSonde", "admin", { app: A, chemin: { id: String(sonde.id) } })).toEqual({ etat: "ok" });
    // « Évaluer maintenant » touche toutes les applications : la plateforme seule.
    expect(await appeler("evaluerAlertes", "plateforme")).toMatchObject({ etat: "ok" });

    // C9 — l'administration. Un compte : l'administrateur de la PLATEFORME seul ; le mot
    // de passe rendu une fois ; désactiver révoque ses sessions.
    const compte = await appeler("creerCompte", "plateforme", { corps: { email: "authz-c9-bob@test.local", role: "viewer", apps: A } });
    expect(compte).toMatchObject({ etat: "cree", email: "authz-c9-bob@test.local" });
    expect(String(compte.motDePasse)).toMatch(/^[A-Za-z0-9_-]{18}$/);
    expect(await appeler("creerCompte", "plateforme", { corps: { email: "authz-c9-bob@test.local", role: "viewer", apps: "" } })).toEqual({ etat: "existe" });
    const idBob = (await pool.query<{ id: string }>("select id::text as id from console_user where email = 'authz-c9-bob@test.local'")).rows[0].id;
    await pool.query("insert into console_session (user_id, expires_at) values ($1, now() + interval '1 hour')", [idBob]);
    expect(await appeler("activerCompte", "plateforme", { corps: { email: "authz-c9-bob@test.local", active: false } })).toEqual({ etat: "ok" });
    expect((await pool.query("select count(*)::int as n from console_session where user_id = $1 and revoked_at is null", [idBob])).rows[0].n).toBe(0);
    expect(await appeler("activerCompte", "plateforme", { corps: { email: EMAILS.plateforme, active: false } })).toEqual({ etat: "soi_meme" });
    expect(await appeler("reinitialiserMotDePasse", "plateforme", { corps: { email: "authz-c9-bob@test.local" } })).toMatchObject({ etat: "ok" });
    // Une application : la créer, la plateforme ; renouveler sa clé, son administrateur.
    const cle = await appeler("renouvelerCle", "admin", { app: A });
    expect(cle).toMatchObject({ etat: "ok", app: A });
    expect(String(cle.cle)).toMatch(/^mip_[0-9a-f]{32}$/);
    // Un jeton de lecture et un jeton de CI de l'app A : créés, puis révoqués dans elle.
    const lecture = await appeler("creerJetonLecture", "admin", { app: A, corps: { label: "C9" } });
    const idLecture = (await pool.query<{ id: string }>("select id::text as id from read_tokens where app_id = $1 and label = 'C9'", [A])).rows[0].id;
    expect(lecture).toMatchObject({ etat: "cree", app: A });
    expect(await appeler("revoquerJetonLecture", "plateforme", { app: B, chemin: { id: idLecture } })).toEqual({ etat: "introuvable" });
    expect(await appeler("revoquerJetonLecture", "admin", { app: A, chemin: { id: idLecture } })).toEqual({ etat: "ok" });
    const ci = await appeler("creerJetonSourcemap", "admin", { app: A, corps: { name: "C9" } });
    expect(ci).toMatchObject({ etat: "cree" });
    const idCi = (ci.token as { id: string }).id;
    expect(await appeler("revoquerJetonSourcemap", "plateforme", { app: B, chemin: { id: idCi } })).toEqual({ etat: "introuvable" });
    expect(await appeler("revoquerJetonSourcemap", "admin", { app: A, chemin: { id: idCi } })).toMatchObject({ etat: "ok" });
    // Un connecteur de tickets : une RÉFÉRENCE, jamais un jeton collé.
    expect(await appeler("creerIntegration", "admin", { app: A, corps: { provider: "github", target: "authz/c9", credentialRef: "ghp_pas_une_reference" } })).toMatchObject({ etat: "refus" });
    const integration = await appeler("creerIntegration", "admin", { app: A, corps: { provider: "github", target: "authz/c9", credentialRef: "env:TICKET_C9" } });
    expect(integration).toMatchObject({ etat: "cree" });
    expect(await appeler("majIntegration", "plateforme", { app: B, chemin: { id: String(integration.id) }, corps: { champ: "enabled", valeur: false } })).toEqual({ etat: "introuvable" });
    expect(await appeler("majIntegration", "admin", { app: A, chemin: { id: String(integration.id) }, corps: { champ: "enabled", valeur: false } })).toEqual({ etat: "ok" });
    // Un domaine de l'extension déjà rattaché à B : l'administrateur de A ne le reprend pas.
    expect(await appeler("creerDomaineExtension", "plateforme", { app: B, corps: { domain: "authz-c9-b.exemple.fr" } })).toEqual({ etat: "ok" });
    expect(await appeler("creerDomaineExtension", "admin", { app: A, corps: { domain: "https://authz-c9-b.exemple.fr/x" } })).toMatchObject({ etat: "refus" });
    expect(await appeler("creerDomaineExtension", "admin", { app: A, corps: { domain: "authz-c9-a.exemple.fr" } })).toEqual({ etat: "ok" });
    // R5 — la recette d'une capacité mobile DÉCLARÉE : la plateforme seule, auditée.
    await pool.query("insert into mobile_capabilities (app_id, runtime, release, capability, declared) values ($1, 'react_native', '1.0.0', 'js_errors', true)", [A]);
    expect(await appeler("validerCapaciteMobile", "plateforme", { corps: { app_id: A, runtime: "react_native", release: "1.0.0", capability: "js_errors", note: "vu sur Pixel 8" } })).toEqual({ etat: "ok" });
    expect((await pool.query("select verified_by, verified_note from mobile_capabilities where app_id = $1", [A])).rows[0]).toEqual({ verified_by: EMAILS.plateforme, verified_note: "vu sur Pixel 8" });

    // Le journal : une ligne par écriture auditée, avec la requête, l'acteur et l'application.
    const { rows } = await pool.query<{ action: string; actor_kind: string; app_id: string | null; request_id: string }>(
      "select action, actor_kind, app_id, request_id from audit_log where request_id like 'authz-c6-%' order by id",
    );
    const actions = rows.map((r) => r.action);
    for (const a of [
      "dashboard.create",
      "dashboard.update",
      "dashboard.clone",
      "dashboard.clone_template",
      "dashboard.delete",
      "goal.create",
      "goal.update",
      "goal.delete",
      "issue.comment",
      "issue.triage",
      "error.set_status",
      "alert_rule.create",
      "alert_rule.update",
      "alert_rule.set_active",
      "slo.create",
      "slo.set_active",
      "slo.delete",
      "uptime_check.create",
      "uptime_check.set_enabled",
      "uptime_check.delete",
      "user.create",
      "user.set_active",
      "user.reset_password",
      "app.rotate_key",
      "read_token.create",
      "read_token.revoke",
      "sourcemap_token.create",
      "sourcemap_token.revoke",
      "ticket_integration.create",
      "ticket_integration.update",
      "extension_scope.create",
      "mobile_capability.verify",
    ]) {
      expect(actions, a).toContain(a);
    }
    // L'édition des cartes et les vues personnelles sont exemptées : aucune ligne.
    expect(actions.some((a) => a.startsWith("dashboard.add") || a.startsWith("savedViews") || a.startsWith("saved_view"))).toBe(false);
    // Chaque ligne porte l'application de ce qu'elle touche ; un canal global et l'évaluation, aucune.
    const sansApp = new Set(["notify_channel.create", "notify_channel.set_active", "notify_channel.delete", "alert.evaluate", "user.create", "user.set_active", "user.reset_password"]);
    // Un domaine de B enregistré par la plateforme : sa ligne porte B.
    const appAttendue = (r: { action: string; detail?: string }) => (sansApp.has(r.action) ? null : A);
    expect(rows.filter((r) => r.actor_kind !== "user" || (r.app_id !== appAttendue(r) && !(r.action === "extension_scope.create" && r.app_id === B)))).toEqual([]);
    expect(actions).toEqual(expect.arrayContaining([...sansApp]));
  });

  it("révoquer une session, désactiver un compte : refusé en 30 s au plus, sans nouveau jeton", async () => {
    const e = BANC.find((x) => x.operation.id === "banc.session.globale")!;
    expect((await servirRequete(requete(e, "admin", { nom: "" }))).status).toBe(200);
    expect((await servirRequete(requete(e, "plateforme", { nom: "" }))).status).toBe(200);
    await pool.query("update console_session set revoked_at = now(), revoked_reason = 'admin' where id = $1", [sessions.admin]);
    await pool.query("update console_user set active = false where email = $1", [EMAILS.plateforme]);
    // Dans la fenêtre du cache, la réplique ne le sait pas encore…
    expect((await servirRequete(requete(e, "admin", { nom: "" }))).status).toBe(200);
    // … au-delà, si.
    maintenant += 30_001;
    expect((await servirRequete(requete(e, "admin", { nom: "" }))).status).toBe(401);
    expect((await servirRequete(requete(e, "plateforme", { nom: "" }))).status).toBe(401);
  });

  it("rétrograder un administrateur vaut sans reconnexion : le rôle vient du compte, pas du jeton", async () => {
    const e = BANC.find((x) => x.operation.id === "banc.admin.globale")!;
    await pool.query("update console_user set role = 'admin' where email = $1", [EMAILS.viewer]);
    maintenant += 30_001;
    expect((await servirRequete(requete(e, "viewer", { nom: "" }))).status).toBe(200);
    await pool.query("update console_user set role = 'viewer' where email = $1", [EMAILS.viewer]);
    maintenant += 30_001;
    expect((await servirRequete(requete(e, "viewer", { nom: "" }))).status).toBe(403);
  });
  it("déconnexion (C1) : une session la ferme, une démo aussi — et le jeton ne vaut plus rien ; sans session, 401", async () => {
    const e = table.find((x) => x.operation.id === "auth.logout")!;
    const moi = table.find((x) => x.operation.id === "auth.me")!;
    for (const profil of ["anonyme", "invalide"] as const) {
      expect((await servirRequete(requete(e, profil, { nom: "" }))).status, profil).toBe(401);
    }
    for (const profil of ["demo", "viewer"] as const) {
      expect((await servirRequete(requete(moi, profil, { nom: "" }))).status, `${profil} avant`).toBe(200);
      expect((await servirRequete(requete(e, profil, { nom: "" }))).status, profil).toBe(200);
      // Révoquée par CETTE réplique : refusée tout de suite, sans attendre le cache.
      expect((await servirRequete(requete(moi, profil, { nom: "" }))).status, `${profil} après`).toBe(401);
    }
  });
});
