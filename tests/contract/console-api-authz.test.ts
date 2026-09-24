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
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { operation } from "@mip/console-contract";
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

/**
 * C1 — les opérations d'identité PUBLIQUES rendent autre chose que 200 à tout le
 * monde, et c'est leur contrat : une connexion aux identifiants inconnus est
 * refusée (401) quelle que soit la session présentée, et la démo est fermée ici
 * (404). La politique (publique) est la même pour tous ; le statut fixe le dit.
 */
const STATUT_FIXE: Record<string, number> = { "auth.login": 401, "auth.demo": 404, "auth.oidcStart": 404, "auth.oidc": 400 };
const CORPS: Record<string, unknown> = { "auth.login": { email: "authz-inconnu@test.local", mot_de_passe: "pas-le-bon" } };
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
  if (p.portee === "ressource") {
    if (cible.vue === "absente") return 404;
    const app = cible.vue === "a" ? A : B;
    return d.apps === null || d.apps.includes(app) ? 200 : 404;
  }
  return 200;
}

function cibles(p: Politique): Cible[] {
  if (p.portee === "app") return [{ nom: "app A", app: A }, { nom: "app B", app: B }, { nom: "app=all", app: "all" }];
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
    const { chargerCoquille } = await import("../../apps/console/lib/chargeurs/coquille");
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
      // C2 — le VRAI chargeur de la coquille, celui de la console, sur la base de la matrice.
      ecrans: { coquille: (p) => chargerCoquille({ role: p.role, apps: p.apps === null ? null : [...p.apps] }) },
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
    const sansExemple = table.filter((e) => e.operation.chemin.includes("{") && !e.politique.ressource).map((e) => e.operation.id);
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
    // Par profil : 9 opérations réelles (logout à part), 3 du banc à portée globale, 6 à trois cibles.
    expect(cases).toBeGreaterThanOrEqual(PROFILS.length * (9 + 3 + 6 * 3));
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
