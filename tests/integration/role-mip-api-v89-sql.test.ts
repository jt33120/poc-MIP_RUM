// P4 — migration-v89 : le rôle `mip_api`, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans la migration :
//
//   · qu'une session ouverte en `mip_api` est en lecture seule PAR DÉFAUT, et
//     qu'en levant ce défaut elle ne peut TOUJOURS RIEN écrire : ni table, ni
//     fonction à droits de propriétaire ;
//   · qu'elle lit la télémétrie (policy de lecture), mais ni un hachage de mot
//     de passe, ni le contenu d'un rejeu, ni une référence de secret de ticket ;
//   · que `verifierRoleApi` (la garde CI) voit chaque écart qu'on lui glisse :
//     un droit de trop, une policy d'écriture, une fonction rouverte, une
//     relation lue par le bundle sans droit ;
//   · que la migration REFUSE un `mip_api` préexistant aux droits trop larges.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module ESM, sans déclarations
import { verifierRoleApi } from "../../scripts/ci/verify-db-roles.mjs";
// @ts-expect-error module ESM, sans déclarations
import { COLONNES, TABLES } from "../../packages/db/roles/mip-api.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const V89 = readFileSync(join(SQL_DIR, "migration-v89.sql"), "utf8");
const APP = "p4-mip-api";

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

type Constat = { ok: boolean; niveau?: string; message: string };
const fautes = (constats: Constat[]) => constats.filter((k) => !k.ok).map((k) => k.message);

/** Un bundle fictif qui nomme toute la liste blanche : la garde « bundle » passe. */
const BUNDLE_CONFORME = [...TABLES, ...Object.keys(COLONNES), "event_metric_baseline"].map((t) => `select * from ${t};`).join("\n");

(url ? describe : describe.skip)("P4 — migration-v89 : mip_api en lecture seule, sur PostgreSQL", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 3 } : {});
  const motDePasse = randomBytes(18).toString("base64url");
  let api: pg.Client;

  /** `fn` dans une transaction annulée : les droits se prêtent, puis se rendent. */
  async function dansUneParenthese<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("begin");
      return await fn(c);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  }

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
    await pool.query("insert into app_registry (app_id, name) values ($1, $1) on conflict do nothing", [APP]);
    await pool.query("delete from rum_session where app_id = $1", [APP]);
    await pool.query("insert into rum_session (session_id, app_id) values ('p4-s1', $1)", [APP]);
    // Le rôle est global à l'instance : on l'ouvre le temps du fichier, et on le referme.
    await pool.query(`alter role mip_api login password '${motDePasse}'`);
    const cible = new URL(url!);
    cible.username = "mip_api";
    cible.password = motDePasse;
    api = new pg.Client({ connectionString: cible.toString() });
    await api.connect();
  });

  afterAll(async () => {
    await api?.end().catch(() => {});
    await pool.query("alter role mip_api nologin password null").catch(() => {});
    await pool.query("delete from rum_session where app_id = $1", [APP]);
    await pool.query("delete from app_registry where app_id = $1", [APP]);
    await pool.end();
  });

  it("la base migrée est conforme à la liste blanche, dans les deux sens", async () => {
    const c = await pool.connect();
    try {
      const constats: Constat[] = await verifierRoleApi(c, { code: BUNDLE_CONFORME });
      expect(fautes(constats)).toEqual([]);
      expect(constats.filter((k) => k.niveau === "alerte")).toEqual([]);
    } finally {
      c.release();
    }
  });

  it("la migration se rejoue sans erreur", async () => {
    await pool.query(V89);
  });

  it("une session mip_api est en lecture seule par défaut, requête bornée à 15 s", async () => {
    const { rows } = await api.query(
      "select current_setting('default_transaction_read_only') as lecture, current_setting('statement_timeout') as delai",
    );
    expect(rows[0]).toEqual({ lecture: "on", delai: "15s" });
    await expect(api.query("insert into app_registry (app_id, name) values ('p4-intrus', 'x')")).rejects.toMatchObject({ code: "25006" });
  });

  it("en levant la lecture seule, elle n'écrit toujours rien : ni table, ni fonction de propriétaire", async () => {
    await api.query("begin");
    try {
      await api.query("set transaction read write");
      for (const sql of [
        "insert into app_registry (app_id, name) values ('p4-intrus', 'x')",
        `update rum_session set app_id = 'p4-intrus' where app_id = '${APP}'`,
        `delete from rum_session where app_id = '${APP}'`,
        "truncate rum_metric",
        "select upsert_svi_call('{}'::jsonb)",
        "select check_new_errors()",
        "select reconcile_alert_deliveries()",
        "select check_ai_op_anomalies()",
        "create table p4_intrus (x int)",
      ]) {
        await api.query("savepoint essai");
        await expect(api.query(sql), sql).rejects.toMatchObject({ code: "42501" });
        await api.query("rollback to savepoint essai");
      }
    } finally {
      await api.query("rollback");
    }
  });

  it("elle lit la télémétrie, mais aucun secret ni contenu de rejeu", async () => {
    const { rows } = await api.query("select session_id from rum_session where app_id = $1", [APP]);
    expect(rows).toEqual([{ session_id: "p4-s1" }]);
    await api.query("select id from console_user limit 1");
    await api.query("select app_id, session_id from replay_chunk limit 1");
    await api.query("select id, provider, target from ticket_integration limit 1");
    for (const sql of [
      "select password_hash from console_user",
      "select email from console_user",
      "select * from console_user",
      "select * from analytics_saved_view",
      "select body from replay_chunk",
      "select credential_ref from ticket_integration",
      "select webhook_secret_ref from ticket_integration",
      "select * from audit_log",
      "select * from notify_channel",
    ]) {
      await expect(api.query(sql), sql).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("la garde voit un droit de trop, une policy d'écriture, une fonction rouverte", async () => {
    await dansUneParenthese(async (c) => {
      await c.query("grant insert on app_registry to mip_api");
      await c.query("grant update (name) on app_registry to mip_api");
      await c.query("grant select on notify_channel to mip_api");
      await c.query("grant select (password_hash) on console_user to mip_api");
      await c.query("create policy p4_ecrit on rum_session for update to mip_api using (true)");
      await c.query("grant execute on function upsert_svi_call(jsonb) to public");
      await c.query("grant usage on all sequences in schema public to mip_api");
      const f = fautes(await verifierRoleApi(c, { code: BUNDLE_CONFORME }));
      expect(f).toEqual(expect.arrayContaining([
        expect.stringContaining("app_registry : droits SELECT, INSERT"),
        expect.stringContaining("app_registry.name : UPDATE accordé"),
        expect.stringContaining("notify_channel : droits SELECT"),
        expect.stringContaining("console_user : colonnes id, password_hash"),
        expect.stringContaining("policy rum_session.p4_ecrit"),
        expect.stringContaining("hors liste — upsert_svi_call(jsonb)"),
        expect.stringContaining("upsert_svi_call : encore exécutable"),
        expect.stringContaining("séquences :"),
      ]));
    });
  });

  it("la garde voit une relation ou une fonction que le bundle lit sans droit", async () => {
    await dansUneParenthese(async (c) => {
      const f = fautes(await verifierRoleApi(c, { code: `${BUNDLE_CONFORME}\nselect * from uptime_check;\nselect slo_status($1);` }));
      expect(f).toEqual([
        expect.stringContaining("relations lues sans droit — uptime_check"),
        expect.stringContaining("fonctions appelées sans droit — slo_status(text)"),
      ]);
    });
  });

  it("la garde signale, sans refuser, une entrée que le bundle ne nomme plus", async () => {
    await dansUneParenthese(async (c) => {
      const constats: Constat[] = await verifierRoleApi(c, { code: BUNDLE_CONFORME.replace("select * from syn_snapshot;", "") });
      expect(fautes(constats)).toEqual([]);
      expect(constats.filter((k) => k.niveau === "alerte").map((k) => k.message)).toEqual([
        expect.stringContaining("syn_snapshot : accordée, mais le bundle ne la nomme plus"),
      ]);
    });
  });

  it("la migration refuse un mip_api préexistant aux droits trop larges", async () => {
    await dansUneParenthese(async (c) => {
      await c.query("alter role mip_api createdb");
      await expect(c.query(V89)).rejects.toMatchObject({
        message: expect.stringContaining("le rôle mip_api existe déjà avec des droits plus larges"),
      });
    });
    await dansUneParenthese(async (c) => {
      await c.query("create role p4_large nologin");
      await c.query("grant p4_large to mip_api");
      await expect(c.query(V89)).rejects.toMatchObject({ message: expect.stringContaining("mip_api existe déjà") });
    });
  });
});
