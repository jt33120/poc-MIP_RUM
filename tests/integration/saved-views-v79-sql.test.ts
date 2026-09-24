// P6.5 — migration-v79 et les lectures/écritures qu'elle rend possibles, jouées
// sur PostgreSQL. Un SQL lu mais non exécuté ne prouve ni l'idempotence, ni la
// portée tenant, ni l'effacement d'app.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_V68_DATABASE_URL=<autre base jetable> pnpm test:sql
//
// La seconde base joue la FENÊTRE DE DÉPLOIEMENT : la console publiée avant la
// migration doit s'annoncer indisponible, pas échouer.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlFenetre = process.env.SQL_TEST_V68_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const poolFenetre = new pg.Pool(urlFenetre ? { connectionString: urlFenetre, max: 4 } : { max: 4 });

const A = "p65-app-a";
const B = "p65-app-b";
const APPS = [A, B];
const MOI = "p65-moi@example.test";
const AUTRUI = "p65-autrui@example.test";

function migrations(maxVersion = Number.POSITIVE_INFINITY): string[] {
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f) && Number(f.match(/\d+/)![0]) <= maxVersion)
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))]
    .map((f) => join(SQL_DIR, f));
}

async function enregistrer(db: pg.Pool, apps: string[]) {
  for (const app of apps) {
    await db.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [app],
    );
  }
}

async function compte(db: pg.Pool, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into console_user (email, password_hash, role) values ($1, 'x', 'viewer')
     on conflict (email) do update set active = true returning id::text as id`,
    [email],
  );
  return rows[0].id;
}

/** Caractere de controle accepte par l’encodage, refuse par la contrainte. */
const CTRL = String.fromCharCode(1);
/** NUL : refuse plus tot encore, par l’encodage de PostgreSQL lui-meme. */
const NUL = String.fromCharCode(0);

const AST = {
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

type Lib = {
  createSavedView: typeof import("../../apps/console/lib/queries-saved-views").createSavedView;
  deleteSavedView: typeof import("../../apps/console/lib/queries-saved-views").deleteSavedView;
  getSavedView: typeof import("../../apps/console/lib/queries-saved-views").getSavedView;
  listSavedViews: typeof import("../../apps/console/lib/queries-saved-views").listSavedViews;
  updateSavedView: typeof import("../../apps/console/lib/queries-saved-views").updateSavedView;
  savedViewsAvailable: typeof import("../../apps/console/lib/queries-saved-views").savedViewsAvailable;
};

const suite = url ? describe : describe.skip;
const suiteFenetre = urlFenetre ? describe : describe.skip;

/**
 * Les modules de la console lisent DATABASE_URL À LEUR IMPORT et mémoïsent leur
 * pool sur globalThis. Les deux suites de ce fichier visent DEUX bases : la
 * seconde doit donc repartir d'un pool neuf, sinon elle interrogerait la première
 * — et prouverait exactement le contraire de ce qu'elle annonce.
 */
async function rebrancherConsole(cible: string): Promise<void> {
  const global = globalThis as unknown as { pgPool?: pg.Pool };
  if (global.pgPool) {
    await global.pgPool.end().catch(() => {});
    delete global.pgPool;
  }
  process.env.DATABASE_URL = cible;
  vi.resetModules();
}

suite("migration-v79 — vues enregistrées et propriété des tableaux de bord", () => {
  let lib: Lib;
  let moi = "";
  let autrui = "";

  beforeAll(async () => {
    // Rejouée DEUX FOIS avant toute écriture, comme un pré-déploiement relancé.
    for (let passe = 0; passe < 2; passe++) {
      for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    }
    await enregistrer(pool, APPS);
    moi = await compte(pool, MOI);
    autrui = await compte(pool, AUTRUI);
    await pool.query("delete from analytics_saved_view where app_id = any($1::text[])", [APPS]);
    await pool.query("delete from dashboard where app_id = any($1::text[])", [APPS]);
    await rebrancherConsole(url!);
    lib = (await import("../../apps/console/lib/queries-saved-views")) as unknown as Lib;
  }, 300_000);

  afterAll(async () => {
    await pool.query("delete from analytics_saved_view where app_id = any($1::text[])", [APPS]);
    await pool.query("delete from dashboard where app_id = any($1::text[])", [APPS]);
    await pool.query("delete from console_user where email = any($1::text[])", [[MOI, AUTRUI]]);
    await pool.query("delete from app_registry where app_id = any($1::text[])", [APPS]);
    await pool.end();
  });

  // Chaque cas repart d'une table vide : plusieurs d'entre eux COMPTENT des lignes,
  // et un reliquat du cas précédent ferait passer un test pour vert à tort.
  beforeEach(async () => {
    await pool.query("delete from analytics_saved_view where app_id = any($1::text[])", [APPS]);
    await pool.query("delete from dashboard where app_id = any($1::text[]) or created_by = $2", [APPS, MOI]);
  });

  const lecteur = (accountId: string | null, apps: string[] | null, role: "admin" | "viewer" = "viewer") => ({
    role, apps, accountId, demo: false,
  });

  it("crée la table, ses contraintes et son index, une seule fois malgré le rejeu", async () => {
    const colonnes = (await pool.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'analytics_saved_view' order by ordinal_position`,
    )).rows;
    expect(colonnes.map((c) => c.column_name)).toEqual([
      "id", "app_id", "owner_id", "name", "query_json", "revision", "created_at", "updated_at",
    ]);
    // Le propriétaire est la SEULE colonne nullable : une vue orpheline reste lisible
    // d'un admin, une vue sans app ou sans requête n'existe pas.
    expect(colonnes.filter((c) => c.is_nullable === "YES").map((c) => c.column_name)).toEqual(["owner_id"]);

    const contraintes = (await pool.query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint where conname like '%\\_v79' order by conname`,
    )).rows;
    expect(contraintes).toEqual([
      { conname: "analytics_saved_view_v79", convalidated: true },
      // Sur une table EXISTANTE, les contraintes restent NOT VALID : les valider
      // parcourrait la table sous verrou sans rien prouver des lignes déjà là.
      { conname: "dashboard_owner_v79", convalidated: false },
      { conname: "dashboard_revision_v79", convalidated: false },
    ]);
    expect((await pool.query("select indexname from pg_indexes where indexname like '%v79' order by indexname")).rows)
      .toEqual([{ indexname: "idx_analytics_saved_view_owner_v79" }, { indexname: "idx_dashboard_owner_v79" }]);
  });

  it("refuse un nom hors bornes, un AST non versionné et une révision nulle", async () => {
    const refus = (sql: string, params: unknown[]) =>
      expect(pool.query(sql, params), sql).rejects.toMatchObject({
        code: "23514",
        constraint: "analytics_saved_view_v79",
      });
    const inserer = `insert into analytics_saved_view (app_id, owner_id, name, query_json, revision)
                     values ($1, $2::bigint, $3, $4::jsonb, coalesce($5::bigint, 1))`;
    await refus(inserer, [A, moi, "", JSON.stringify(AST), null]);
    await refus(inserer, [A, moi, "x".repeat(101), JSON.stringify(AST), null]);
    await refus(inserer, [A, moi, `a${CTRL}b`, JSON.stringify(AST), null]);
    // Le NUL, lui, n’atteint même pas la contrainte : PostgreSQL le refuse à
    // l’encodage (22021). Les deux barrières comptent, elles ne se remplacent pas.
    await expect(
      pool.query(inserer, [A, moi, `a${NUL}b`, JSON.stringify(AST), null]),
    ).rejects.toMatchObject({ code: "22021" });
    // Schéma VERSIONNÉ : un AST sans numéro de version ne se relit pas.
    await refus(inserer, [A, moi, "sans version", JSON.stringify({ dataset: "errors" }), null]);
    await refus(inserer, [A, moi, "version texte", JSON.stringify({ ...AST, version: "1" }), null]);
    await refus(inserer, [A, moi, "pas un objet", JSON.stringify([1, 2]), null]);
    await refus(inserer, [A, moi, "trop gros", JSON.stringify({ version: 1, x: "y".repeat(40_000) }), null]);
    await refus(inserer, [A, moi, "révision nulle", JSON.stringify(AST), "0"]);
    // Une app inconnue n'existe pas : la clé étrangère le dit.
    await expect(
      pool.query(inserer, ["p65-app-fantome", moi, "app inconnue", JSON.stringify(AST), null]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("crée, liste et relit une vue ; le périmètre est revérifié après résolution", async () => {
    const cree = await lib.createSavedView(lecteur(moi, [A]), { app: A, name: "Mes erreurs", query: AST });
    expect(cree.kind).toBe("ok");
    if (cree.kind !== "ok") return;
    expect(cree.value).toMatchObject({ app_id: A, name: "Mes erreurs", revision: "1", mine: true });
    // Le propriétaire relit la sienne.
    expect((await lib.getSavedView(lecteur(moi, [A]), cree.value.id)).kind).toBe("ok");
    // Un autre compte de la même app ne la voit pas.
    expect((await lib.getSavedView(lecteur(autrui, [A]), cree.value.id)).kind).toBe("not_found");
    // Un admin de l'app la lit, avec l'adresse du propriétaire.
    const parAdmin = await lib.getSavedView(lecteur(autrui, [A], "admin"), cree.value.id);
    expect(parAdmin.kind).toBe("ok");
    expect(parAdmin.kind === "ok" && parAdmin.value.owner_email).toBe(MOI);
    expect(parAdmin.kind === "ok" && parAdmin.value.mine).toBe(false);
    // Un admin d'une AUTRE app ne la voit pas : le rôle ne franchit pas le périmètre.
    expect((await lib.getSavedView(lecteur(autrui, [B], "admin"), cree.value.id)).kind).toBe("not_found");
    // Un viewer ne reçoit jamais l'adresse d'un compte, même la sienne.
    const liste = await lib.listSavedViews(lecteur(moi, [A]));
    expect(liste.kind === "ok" && liste.value.map((v) => v.owner_email)).toEqual([null]);
    // Une app hors périmètre est refusée, jamais rabattue.
    expect((await lib.listSavedViews(lecteur(moi, [A]), { app: B })).kind).toBe("forbidden");
    expect((await lib.listSavedViews(lecteur(moi, []))).kind).toBe("forbidden");

    await lib.deleteSavedView(lecteur(moi, [A]), cree.value.id);
  });

  it("le propriétaire seul écrit, en citant la révision lue", async () => {
    const cree = await lib.createSavedView(lecteur(moi, [A]), { app: A, name: "À renommer", query: AST });
    if (cree.kind !== "ok") throw new Error(cree.kind);
    const id = cree.value.id;

    // Un admin lit, mais ne renomme pas le travail d'un autre.
    const parAdmin = await lib.updateSavedView(lecteur(autrui, [A], "admin"), id, {
      name: "détournée", query: null, app: null, expectedRevision: "1",
    });
    expect(parAdmin.kind).toBe("forbidden");

    // Révision périmée : refus, avec la révision courante.
    const conflit = await lib.updateSavedView(lecteur(moi, [A]), id, {
      name: "x", query: null, app: null, expectedRevision: "99",
    });
    expect(conflit).toMatchObject({ kind: "conflict", revision: "1" });

    const ok = await lib.updateSavedView(lecteur(moi, [A]), id, {
      name: "Renommée", query: null, app: null, expectedRevision: "1",
    });
    expect(ok).toMatchObject({ kind: "ok" });
    expect(ok.kind === "ok" && ok.value).toMatchObject({ name: "Renommée", revision: "2" });

    // Déplacer une vue vers une autre app serait un partage déguisé.
    const deplacee = await lib.updateSavedView(lecteur(moi, [A, B]), id, {
      name: null, query: { ...AST, app: B }, app: B, expectedRevision: "2",
    });
    expect(deplacee.kind).toBe("forbidden");

    // Suppression : propriétaire seul, et l'identifiant inconnu reste « introuvable ».
    expect((await lib.deleteSavedView(lecteur(autrui, [A], "admin"), id)).kind).toBe("forbidden");
    expect((await lib.deleteSavedView(lecteur(moi, [A]), "pas-un-uuid")).kind).toBe("not_found");
    expect(await lib.deleteSavedView(lecteur(moi, [A]), id)).toEqual({ kind: "ok", value: { app: A } });
    expect((await lib.getSavedView(lecteur(moi, [A]), id)).kind).toBe("not_found");
  });

  it("plafonne à 50 vues par compte ET par app, sans bloquer l'app voisine", async () => {
    const mien = lecteur(moi, [A, B]);
    for (let i = 0; i < 50; i++) {
      const r = await lib.createSavedView(mien, { app: A, name: `vue ${i}`, query: AST });
      expect(r.kind, `vue ${i}`).toBe("ok");
    }
    const refus = await lib.createSavedView(mien, { app: A, name: "la 51e", query: AST });
    expect(refus.kind).toBe("limit");
    // L'app voisine et l'autre compte gardent leur propre compteur.
    expect((await lib.createSavedView(mien, { app: B, name: "sur B", query: { ...AST, app: B } })).kind).toBe("ok");
    expect((await lib.createSavedView(lecteur(autrui, [A]), { app: A, name: "à moi", query: AST })).kind).toBe("ok");
    await pool.query("delete from analytics_saved_view where app_id = any($1::text[])", [APPS]);
  });

  it("RLS et droits : console_ro écrit dans sa portée, jamais l'app voisine ni l'app_id", async () => {
    expect((await pool.query(
      `select policyname, cmd, roles::text from pg_policies where tablename = 'analytics_saved_view'`,
    )).rows).toEqual([{ policyname: "tenant_scope", cmd: "ALL", roles: "{console_ro}" }]);

    if (!(await pool.query("select 1 from pg_roles where rolname = 'console_ro'")).rowCount) return;
    const priv = (await pool.query(
      `select has_table_privilege('console_ro', 'analytics_saved_view', 'SELECT') as lit,
              has_table_privilege('console_ro', 'analytics_saved_view', 'INSERT') as insere,
              has_table_privilege('console_ro', 'analytics_saved_view', 'DELETE') as supprime,
              has_column_privilege('console_ro', 'analytics_saved_view', 'name', 'UPDATE') as renomme,
              has_column_privilege('console_ro', 'analytics_saved_view', 'app_id', 'UPDATE') as deplace,
              has_column_privilege('console_ro', 'analytics_saved_view', 'owner_id', 'UPDATE') as donne`,
    )).rows[0];
    // Renommer oui ; changer d'app ou de propriétaire, jamais : ce serait un partage.
    expect(priv).toEqual({ lit: true, insere: true, supprime: true, renomme: true, deplace: false, donne: false });

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role console_ro");
      await client.query("select set_config('app.current_app_id', $1, true)", [A]);
      await client.query(
        "insert into analytics_saved_view (app_id, owner_id, name, query_json) values ($1, $2::bigint, 'dans la portée', $3::jsonb)",
        [A, moi, JSON.stringify(AST)],
      );
      await client.query("savepoint s");
      await expect(client.query(
        "insert into analytics_saved_view (app_id, owner_id, name, query_json) values ($1, $2::bigint, 'intrusion', $3::jsonb)",
        [B, moi, JSON.stringify({ ...AST, app: B })],
      )).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback to savepoint s");
      await client.query("select set_config('app.current_app_id', '', true)");
      expect((await client.query("select count(*)::int as n from analytics_saved_view")).rows[0].n).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("le propriétaire d'un tableau est résolu depuis created_by, ou reste hérité", async () => {
    const { rows: [connu] } = await pool.query<{ id: number }>(
      "insert into dashboard (name, app_id, created_by) values ('Connu', $1, $2) returning id::int as id",
      [A, MOI],
    );
    const { rows: [inconnu] } = await pool.query<{ id: number }>(
      "insert into dashboard (name, app_id, created_by) values ('Hérité', $1, 'p65-disparu@example.test') returning id::int as id",
      [A],
    );
    // Rejouer la migration résout le compte connu, et laisse l'autre en legacy.
    await pool.query(readFileSync(join(SQL_DIR, "migration-v79.sql"), "utf8"));
    const { rows } = await pool.query<{ id: number; owner_id: string | null; revision: string }>(
      "select id::int as id, owner_id::text as owner_id, revision::text as revision from dashboard where id = any($1::int[]) order by id",
      [[connu.id, inconnu.id]],
    );
    expect(rows).toEqual([
      { id: connu.id, owner_id: moi, revision: "1" },
      { id: inconnu.id, owner_id: null, revision: "1" },
    ]);
    // Un compte supprimé ne fait pas disparaître le tableau : le propriétaire redevient hérité.
    await pool.query("delete from dashboard where id = any($1::int[])", [[connu.id, inconnu.id]]);
  });

  it("effacer une app emporte ses vues et ses tableaux, et garde ce que v72 supprimait déjà", async () => {
    await lib.createSavedView(lecteur(moi, [A]), { app: A, name: "à effacer", query: AST });
    await lib.createSavedView(lecteur(moi, [B]), { app: B, name: "voisine", query: { ...AST, app: B } });
    await pool.query("insert into dashboard (name, app_id, created_by) values ('Scopé A', $1, $2)", [A, MOI]);
    await pool.query("insert into dashboard (name, app_id, created_by) values ('Transverse', null, $1)", [MOI]);
    await pool.query(
      `insert into error_grouping_config (app_id, active_version) values ($1, 2)
       on conflict (app_id) do update set active_version = 2`,
      [A],
    );
    await pool.query(
      `insert into sourcemap_upload_token (id, app_id, name, secret_hash, scope, created_by, expires_at)
       values (gen_random_uuid(), $1, 'ci', repeat('a', 64), 'sourcemaps:write', $2, now() + interval '1 day')`,
      [A, MOI],
    );

    const { rows: [efface] } = await pool.query<{ erase_app_data: Record<string, number> }>(
      "select erase_app_data($1) as erase_app_data",
      [A],
    );
    // Les deux lignes neuves de v79…
    expect(efface.erase_app_data.analytics_saved_view).toBe(1);
    expect(efface.erase_app_data.dashboard).toBe(1);
    // …et celles que v72 supprimait déjà, reprises intégralement.
    expect(efface.erase_app_data).toMatchObject({
      error_issue: expect.any(Number),
      error_grouping_config: 1,
      sourcemap_upload_token: 1,
    });
    // L'app voisine et le tableau transverse sont intacts.
    expect((await pool.query("select count(*)::int as n from analytics_saved_view where app_id = $1", [B])).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int as n from dashboard where app_id is null and created_by = $1", [MOI])).rows[0].n).toBe(1);

    await pool.query("delete from dashboard where created_by = $1", [MOI]);
    await pool.query("delete from analytics_saved_view where app_id = any($1::text[])", [APPS]);
  });

  it("la rétention ne supprime NI vue NI tableau : ce n'est pas une observation datée", async () => {
    await pool.query("delete from analytics_saved_view where app_id = any($1::text[])", [APPS]);
    await pool.query("delete from dashboard where app_id = any($1::text[])", [APPS]);
    await lib.createSavedView(lecteur(moi, [B]), { app: B, name: "vieille", query: { ...AST, app: B } });
    await pool.query("insert into dashboard (name, app_id, created_by) values ('Vieux', $1, $2)", [B, MOI]);
    await pool.query("update analytics_saved_view set created_at = now() - interval '400 days', updated_at = now() - interval '400 days' where app_id = $1", [B]);
    await pool.query("update dashboard set created_at = now() - interval '400 days', updated_at = now() - interval '400 days' where app_id = $1", [B]);

    const { rows: [purge] } = await pool.query<{ purge_rum_app: Record<string, number> }>(
      "select purge_rum_app($1, now()) as purge_rum_app",
      [B],
    );
    expect(purge.purge_rum_app).not.toHaveProperty("analytics_saved_view");
    expect(purge.purge_rum_app).not.toHaveProperty("dashboard");
    expect((await pool.query("select count(*)::int as n from analytics_saved_view where app_id = $1", [B])).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int as n from dashboard where app_id = $1", [B])).rows[0].n).toBe(1);
    await pool.query("delete from dashboard where app_id = $1", [B]);
    await pool.query("delete from analytics_saved_view where app_id = $1", [B]);
  });
});

suiteFenetre("fenêtre de déploiement : la console P6.5 sur une base restée en v78", () => {
  beforeAll(async () => {
    // Repartir d'un schéma vide : un passage précédent a pu y appliquer v79.
    await poolFenetre.query("drop schema public cascade; create schema public;");
    for (const file of migrations(78)) await poolFenetre.query(readFileSync(file, "utf8"));
    await enregistrer(poolFenetre, [A]);
  }, 300_000);

  afterAll(async () => {
    await poolFenetre.end();
    const global = globalThis as unknown as { pgPool?: pg.Pool };
    await global.pgPool?.end().catch(() => {});
    delete global.pgPool;
  });

  it("annonce les vues indisponibles au lieu d'échouer, et lit un tableau sans propriétaire", async () => {
    await rebrancherConsole(urlFenetre!);
    const vues = await import("../../apps/console/lib/queries-saved-views");
    const tableaux = await import("../../apps/console/lib/queries-dashboards");

    expect(await vues.savedViewsAvailable()).toBe(false);
    const lecteur = { role: "viewer" as const, apps: [A], accountId: "1", demo: false };
    expect((await vues.listSavedViews(lecteur)).kind).toBe("unavailable");
    expect((await vues.createSavedView(lecteur, { app: A, name: "x", query: AST })).kind).toBe("unavailable");

    // Le tableau de bord reste lisible ET modifiable : propriétaire hérité, révision figée.
    const id = await tableaux.insertDashboard({ name: "Avant v79", app_id: A, created_by: MOI, owner_id: null });
    const lu = await tableaux.getDashboard(id);
    expect(lu).toMatchObject({ name: "Avant v79", owner_id: null, revision: "1" });
    const ecrit = await tableaux.updateLayout(id, [{ kind: "v1", type: "traffic", title: "Trafic" }], "1");
    expect(ecrit.kind).toBe("ok");
    expect((await tableaux.getDashboard(id))?.layout).toEqual([{ kind: "v1", type: "traffic", title: "Trafic" }]);

    // La migration appliquée EN COURS DE ROUTE est vue sans redémarrage.
    await poolFenetre.query(readFileSync(join(SQL_DIR, "migration-v79.sql"), "utf8"));
    tableaux.forgetDashboardSchema();
    expect(await tableaux.dashboardOwnershipAvailable()).toBe(true);
    expect(await vues.savedViewsAvailable()).toBe(true);
    expect((await tableaux.getDashboard(id))?.revision).toBe("1");
  }, 120_000);
});
