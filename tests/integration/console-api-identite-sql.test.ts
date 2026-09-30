// C1 — l'identité de console-api, sur PostgreSQL : connexion, démo, déconnexion,
// `/v1/me`, et le débit d'authentification partagé.
//
// Le pipeline réel (secret client, session, audit), la table réelle, bcrypt réel
// (celui du service), une base migrée jusqu'à v90. Ce que ce fichier prouve :
//   · une connexion ouvre une LIGNE de session, et son jeton ne dit que son id ;
//   · un mauvais mot de passe et un compte inconnu rendent la MÊME réponse ;
//   · le 9ᵉ échec est refusé AVANT bcrypt, et le blocage vaut pour toute réplique
//     (il est en base) ; un succès efface les compteurs du compte ;
//   · la déconnexion révoque : le même jeton ne vaut plus rien, tout de suite ;
//   · la démo : fermée → 404 ; ouverte → viewer à périmètre fixe, 5 par heure et
//     par IP, et jamais l'adresse IP dans le journal ;
//   · chaque écriture laisse sa ligne d'audit, avec le `request_id` de l'appel ;
//   · l'inscription en libre-service (v107), SOUS `mip_identity` quand la base a
//     les rôles : le compte (administrateur de son seul site) et le site (débit
//     plafonné) ensemble ou rien ; adresse déjà prise → 409 sans rien créer ;
//     plafond du jour, 4ᵉ tentative d'une même IP → 429 ; fermée → 404.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  chargerTrousseau,
  creerConsoleApi,
  creerDebitAuth,
  creerTable,
  creerVerificateurSession,
  type Transacteur,
} from "@mip/console-api";
import { ECRANS_FACTICES } from "../fixtures/ecrans-factices";
import { poolsSousRoles } from "../fixtures/roles-c13";
import { COMMANDES_FACTICES } from "../fixtures/commandes-factices";

// bcrypt du SERVICE (sa dépendance), pas une copie.
const bcrypt = createRequire(join(__dirname, "..", "..", "services", "console-api", "package.json"))("bcryptjs") as {
  compare(a: string, b: string): Promise<boolean>;
  hashSync(a: string, cout: number): string;
};

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const SECRET = randomBytes(24).toString("hex");
const EMAIL = "c1-identite@test.local";
const INACTIF = "c1-inactif@test.local";
const MDP = "c1-mot-de-passe-local";
const DEMO_EMAIL = "c1-demo@test.local";
/** Les comptes de l'inscription : un préfixe à eux, que `nettoyer()` efface avec leurs sites. */
const INSCRIT = "c1-inscription";
const DEBIT_INSCRIT = 90;
const journal = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

(url ? describe : describe.skip)("C1 — identité de console-api, sur PostgreSQL", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : {});
  /** C13 — les pools du service sous `mip_console` et `mip_identity`, si la base a les rôles. */
  let sousRoles: Awaited<ReturnType<typeof poolsSousRoles>> | undefined;
  const transacteur: Transacteur = {
    async transaction(fn) {
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
  /** Deux services : démo fermée, démo ouverte — même base, mêmes clés. Le premier a
   *  aussi l'inscription fermée ; `inscrit`, elle ouverte (20 par jour). */
  let ferme: (r: Request) => Promise<Response>;
  let ouvert: (r: Request) => Promise<Response>;
  let inscrit: (r: Request) => Promise<Response>;
  let n = 0;

  async function service(demo: { email: string; apps: string[] } | null, inscription: { parJour: number } | null = null) {
    const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", paire.privateKey);
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, kid: "session-c1-a", alg: "ES256", use: "sig" }] }), { production: false });
    // C13 — l'identité SOUS `mip_identity`, le reste sous `mip_console`, quand la base a les rôles (v93).
    const roles = (sousRoles ??= await poolsSousRoles(url!, pool));
    const dbIdentite = roles?.identite ?? pool;
    const dbService = roles?.console ?? pool;
    const sessions = await creerVerificateurSession({ trousseau, db: dbIdentite });
    const { table } = await creerTable({
      trousseau,
      version: "c1",
      db: dbService,
      identite: {
        db: dbIdentite,
        transacteur: roles?.transacteur ?? transacteur,
        debit: await creerDebitAuth(SECRET),
        verifierMotDePasse: (a, b) => bcrypt.compare(a, b),
        hachageFactice: bcrypt.hashSync("factice", 4),
        demo,
        oublierSession: (sid) => sessions.oublier(sid),
        inscription: inscription && { parJour: inscription.parJour, debitMaxMin: DEBIT_INSCRIT, hacherMotDePasse: async (clair) => bcrypt.hashSync(clair, 4) },
      },
      ecrans: ECRANS_FACTICES,
      commandes: COMMANDES_FACTICES,
    });
    return creerConsoleApi({ table, secretsClient: [SECRET], journal, verifierSession: sessions.verifier, lecteur: dbService, debitParMinute: 0 });
  }

  function appel(chemin: string, o: { methode?: string; corps?: unknown; ip?: string | null; jeton?: string } = {}) {
    const entetes: Record<string, string> = { "x-mip-client": SECRET, "x-request-id": `c1-requete-${++n}` };
    if (o.ip !== null) entetes["x-mip-visitor-ip"] = o.ip ?? "203.0.113.10";
    if (o.jeton) entetes.authorization = `Bearer ${o.jeton}`;
    if (o.corps !== undefined) entetes["content-type"] = "application/json";
    return new Request(`https://console-api.test${chemin}`, { method: o.methode ?? "GET", headers: entetes, body: o.corps === undefined ? undefined : JSON.stringify(o.corps) });
  }
  const connexion = (api: typeof ferme, email: string, mdp: string, ip?: string) =>
    api(appel("/v1/auth/sessions", { methode: "POST", corps: { email, mot_de_passe: mdp }, ip }));

  async function nettoyer() {
    await pool.query("delete from console_session where demo_email = $1 or user_id in (select id from console_user where email = any($2) or email like $3)", [DEMO_EMAIL, [EMAIL, INACTIF], `${INSCRIT}%`]);
    await pool.query("delete from console_user where email = any($1) or email like $2", [[EMAIL, INACTIF], `${INSCRIT}%`]);
    await pool.query("delete from app_registry where created_by like $1", [`${INSCRIT}%`]);
    await pool.query("delete from auth_throttle");
  }
  /** Une adresse d'inscription neuve, propre à ce passage. */
  const adresse = (nom: string) => `${INSCRIT}-${nom}-${randomBytes(3).toString("hex")}@test.local`;
  const inscrire = (api: typeof ferme, corps: Record<string, string>, ip: string) =>
    api(appel("/v1/auth/accounts", { methode: "POST", corps: { mot_de_passe: "c1-inscription-mdp", nom_site: "Ma Boutique", url_site: "https://ma-boutique.test/panier", ...corps }, ip }));
  const compter = async (sql: string, p: unknown[]) => (await pool.query<{ n: number }>(sql, p)).rows[0].n;

  beforeAll(async () => {
    for (const f of migrations()) await pool.query(readFileSync(f, "utf8"));
    await nettoyer();
    await pool.query(
      "insert into console_user (email, password_hash, role, apps, active) values ($1, $2, 'admin', array['app-c1'], true), ($3, $2, 'viewer', null, false)",
      [EMAIL, bcrypt.hashSync(MDP, 4), INACTIF],
    );
    ferme = await service(null);
    ouvert = await service({ email: DEMO_EMAIL, apps: ["app-demo-c1"] });
    inscrit = await service(null, { parJour: 20 });
  });

  afterAll(async () => {
    await nettoyer();
    await sousRoles?.fermer();
    await pool.end();
  });

  it("connexion : une ligne de session, un jeton qui ne dit que son id, `/v1/me` relu en base", async () => {
    const res = await connexion(ferme, "  C1-Identite@Test.local ", MDP);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.connexion_precedente).toBeNull();
    const [, charge] = data.jeton.split(".");
    expect(Object.keys(JSON.parse(Buffer.from(charge, "base64url").toString())).sort()).toEqual(["aud", "exp", "iat", "iss", "sid"]);

    const moi = await ferme(appel("/v1/me", { jeton: data.jeton }));
    expect(moi.status).toBe(200);
    expect((await moi.json()).data).toEqual({ email: EMAIL, role: "admin", apps: ["app-c1"], demo: false });

    const { rows } = await pool.query("select action, request_id, actor_kind from audit_log where user_email = $1 and action = 'auth.login' order by id desc limit 1", [EMAIL]);
    expect(rows[0]).toMatchObject({ action: "auth.login", actor_kind: "user" });
    expect(rows[0].request_id).toMatch(/^c1-requete-/);

    // La connexion suivante dit quand était la précédente (le briefing d'accueil).
    const seconde = await (await connexion(ferme, EMAIL, MDP)).json();
    expect(seconde.data.connexion_precedente).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("mauvais mot de passe, compte inconnu, compte désactivé : la MÊME réponse", async () => {
    const corps = async (r: Response) => ({ statut: r.status, code: (await r.json()).error.code });
    const attendu = { statut: 401, code: "identifiants_refuses" };
    expect(await corps(await connexion(ferme, EMAIL, "faux", "198.51.100.1"))).toEqual(attendu);
    expect(await corps(await connexion(ferme, "personne@test.local", "faux", "198.51.100.1"))).toEqual(attendu);
    expect(await corps(await connexion(ferme, INACTIF, MDP, "198.51.100.1"))).toEqual(attendu);
    const { rows } = await pool.query("select count(*)::int as n from audit_log where action = 'auth.login_failed' and user_email = any($1)", [[EMAIL, INACTIF, "personne@test.local"]]);
    expect(rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it("sans l'adresse du visiteur : 400 — jamais un compteur partagé par tous", async () => {
    const res = await ferme(appel("/v1/auth/sessions", { methode: "POST", corps: { email: EMAIL, mot_de_passe: MDP }, ip: null }));
    expect(res.status).toBe(400);
  });

  it("8 échecs depuis un poste : le 9ᵉ est refusé AVANT bcrypt, même avec le bon mot de passe ; ailleurs, le compte passe", async () => {
    await pool.query("delete from auth_throttle");
    const ip = "192.0.2.77";
    for (let i = 0; i < 8; i++) expect((await connexion(ferme, EMAIL, "faux", ip)).status).toBe(401);
    const bloque = await connexion(ferme, EMAIL, MDP, ip);
    expect(bloque.status).toBe(429);
    expect(Number(bloque.headers.get("retry-after"))).toBeGreaterThan(500);
    // Le blocage est EN BASE : un autre service (une autre réplique) le voit aussi.
    expect((await connexion(ouvert, EMAIL, MDP, ip)).status).toBe(429);
    const { rows } = await pool.query("select count(*)::int as n from audit_log where action = 'auth.login_blocked' and user_email = $1", [EMAIL]);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    // Depuis un autre poste, le compte n'est pas bloqué (8 < 20 échecs par e-mail).
    expect((await connexion(ferme, EMAIL, MDP, "192.0.2.78")).status).toBe(200);
  });

  it("une connexion réussie efface les compteurs du compte, pas celui du poste", async () => {
    await pool.query("delete from auth_throttle");
    const ip = "192.0.2.90";
    for (let i = 0; i < 3; i++) await connexion(ferme, EMAIL, "faux", ip);
    expect((await pool.query("select key from auth_throttle")).rows.map((r) => r.key.split(":")[0]).sort()).toEqual(["email", "ip", "ip_email"]);
    expect((await connexion(ferme, EMAIL, MDP, ip)).status).toBe(200);
    expect((await pool.query("select key from auth_throttle")).rows.map((r) => r.key.split(":")[0])).toEqual(["ip"]);
  });

  it("déconnexion : la session est révoquée, le même jeton ne vaut plus rien — tout de suite", async () => {
    const { data } = await (await connexion(ferme, EMAIL, MDP, "192.0.2.91")).json();
    expect((await ferme(appel("/v1/me", { jeton: data.jeton }))).status).toBe(200);
    const sortie = await ferme(appel("/v1/auth/sessions/current", { methode: "DELETE", jeton: data.jeton }));
    expect(sortie.status).toBe(200);
    expect((await sortie.json()).data).toEqual({ revoquee: true });
    expect((await ferme(appel("/v1/me", { jeton: data.jeton }))).status).toBe(401);
    expect((await ferme(appel("/v1/auth/sessions/current", { methode: "DELETE", jeton: data.jeton }))).status).toBe(401);
    const { rows } = await pool.query("select revoked_reason from console_session where revoked_at is not null and user_id = (select id from console_user where email = $1) order by revoked_at desc limit 1", [EMAIL]);
    expect(rows[0].revoked_reason).toBe("logout");
  });

  it("démo fermée : 404, le même qu'un chemin inconnu", async () => {
    const res = await ferme(appel("/v1/auth/demo-sessions", { methode: "POST" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("route_inconnue");
  });

  it("démo ouverte : viewer à périmètre fixe, lecture seule ; 5 par heure et par IP ; jamais l'IP au journal", async () => {
    await pool.query("delete from auth_throttle");
    const ip = "203.0.113.55";
    const res = await ouvert(appel("/v1/auth/demo-sessions", { methode: "POST", ip }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect((await (await ouvert(appel("/v1/me", { jeton: data.jeton }))).json()).data).toEqual({
      email: DEMO_EMAIL, role: "viewer", apps: ["app-demo-c1"], demo: true,
    });
    for (let i = 0; i < 4; i++) expect((await ouvert(appel("/v1/auth/demo-sessions", { methode: "POST", ip }))).status).toBe(200);
    expect((await ouvert(appel("/v1/auth/demo-sessions", { methode: "POST", ip }))).status).toBe(429);
    const { rows } = await pool.query("select detail, actor_kind from audit_log where action = 'auth.demo' order by id desc limit 1");
    expect(rows[0].actor_kind).toBe("demo");
    expect(rows[0].detail).not.toContain(ip);
    // Une démo peut fermer SA session — la seule écriture qui lui soit permise.
    expect((await ouvert(appel("/v1/auth/sessions/current", { methode: "DELETE", jeton: data.jeton }))).status).toBe(200);
  });

  it("inscription : le compte, administrateur de SON site, et le site plafonné, en une fois ; session ouverte, audit", async () => {
    await pool.query("delete from auth_throttle");
    const email = adresse("ok");
    const res = await inscrire(inscrit, { email: `  ${email.toUpperCase()} ` }, "198.51.100.20");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.app).toMatch(/^ma-boutique-[0-9a-f]{4}$/);
    expect(data.cle).toMatch(/^mip_[0-9a-f]{32}$/);
    expect(data.session.connexion_precedente).toBeNull();

    // Le compte : administrateur de ce seul site — jamais la portée plateforme.
    const compte = (await pool.query("select role, apps, active, inscrit_le, password_hash from console_user where email = $1", [email])).rows[0];
    expect(compte).toMatchObject({ role: "admin", apps: [data.app], active: true });
    expect(compte.inscrit_le).toBeInstanceOf(Date);
    expect(await bcrypt.compare("c1-inscription-mdp", compte.password_hash)).toBe(true);

    // Le site : l'origine seule, la clé en empreinte, le débit plafonné, qui l'a créé.
    const site = (await pool.query("select name, api_key_hash, active, allowed_origins, created_by, debit_max_min from app_registry where app_id = $1", [data.app])).rows[0];
    expect(site).toEqual({
      name: "Ma Boutique",
      api_key_hash: createHash("sha256").update(data.cle).digest("hex"),
      active: true,
      allowed_origins: ["https://ma-boutique.test"],
      created_by: email,
      debit_max_min: DEBIT_INSCRIT,
    });

    // La session est celle du compte, relue en base.
    const moi = await inscrit(appel("/v1/me", { jeton: data.session.jeton }));
    expect((await moi.json()).data).toEqual({ email, role: "admin", apps: [data.app], demo: false });

    // L'audit : l'action, le site, l'appel — jamais l'adresse IP.
    const audit = (await pool.query("select detail, app_id, actor_kind, request_id from audit_log where action = 'auth.signup' and user_email = $1", [email])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ app_id: data.app, actor_kind: "user" });
    expect(JSON.parse(audit[0].detail)).toEqual({ origine: "https://ma-boutique.test" });
    expect(audit[0].request_id).toMatch(/^c1-requete-/);
    expect(audit[0].detail).not.toContain("198.51.100.20");
    // La tentative est comptée, sous une empreinte.
    expect((await pool.query("select key from auth_throttle")).rows.map((r) => r.key.split(":")[0])).toEqual(["inscription_ip"]);
  });

  it("inscription : une adresse déjà inscrite → 409, et rien n'est créé", async () => {
    await pool.query("delete from auth_throttle");
    const sites = () => compter("select count(*)::int as n from app_registry where created_by = $1", [EMAIL]);
    const avant = await sites();
    const res = await inscrire(inscrit, { email: EMAIL }, "198.51.100.21");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflit");
    expect(await sites()).toBe(avant);
    // Le compte existant n'est pas touché : ni son rôle, ni son périmètre.
    expect((await pool.query("select role, apps, inscrit_le from console_user where email = $1", [EMAIL])).rows[0]).toEqual({ role: "admin", apps: ["app-c1"], inscrit_le: null });
  });

  it("inscription : la 4ᵉ tentative d'une même IP dans l'heure → 429, même pour une adresse neuve", async () => {
    await pool.query("delete from auth_throttle");
    const ip = "198.51.100.22";
    // Trois refus comptent comme trois tentatives : sonder les adresses inscrites n'est pas gratuit.
    for (let i = 0; i < 3; i++) expect((await inscrire(inscrit, { email: EMAIL }, ip)).status).toBe(409);
    const email = adresse("quatrieme");
    const bloque = await inscrire(inscrit, { email }, ip);
    expect(bloque.status).toBe(429);
    expect((await bloque.json()).error.code).toBe("debit_depasse");
    expect(await compter("select count(*)::int as n from console_user where email = $1", [email])).toBe(0);
    // Ailleurs, l'inscription passe.
    expect((await inscrire(inscrit, { email }, "198.51.100.23")).status).toBe(200);
  });

  it("inscription : le plafond du jour, compté sur `inscrit_le`, pour toute la plateforme → 429", async () => {
    await pool.query("delete from auth_throttle");
    const dejaInscrits = await compter("select count(*)::int as n from console_user where inscrit_le > now() - interval '24 hours'", []);
    expect(dejaInscrits).toBeGreaterThan(0);
    const plein = await service(null, { parJour: dejaInscrits });
    const email = adresse("plafond");
    const res = await inscrire(plein, { email }, "198.51.100.24");
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("debit_depasse");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await compter("select count(*)::int as n from console_user where email = $1", [email])).toBe(0);
    expect(await compter("select count(*)::int as n from app_registry where created_by = $1", [email])).toBe(0);
  });

  it("inscription fermée : 404, le même qu'un chemin inconnu, et `methods` la dit fermée", async () => {
    const res = await inscrire(ferme, { email: adresse("fermee") }, "198.51.100.25");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("route_inconnue");
    expect((await (await ferme(appel("/v1/auth/methods"))).json()).data.inscription).toBe(false);
    expect((await (await inscrit(appel("/v1/auth/methods"))).json()).data.inscription).toBe(true);
  });
});
