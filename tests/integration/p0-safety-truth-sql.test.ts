// P0 : ce test joue la migration complète sur PostgreSQL. Un SQL lu mais non
// exécuté ne prouve ni le watermark transactionnel, ni le rollup idempotent.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SQL_TEST_DATABASE_URL;
const dir = join(__dirname, "..", "..", "packages", "db", "sql");
const c = new pg.Client(url ? { connectionString: url } : {});
const suite = url ? describe : describe.skip;

function migrations() {
  return ["schema.sql", ...readdirSync(dir)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))]
    .map((f) => join(dir, f));
}

beforeAll(async () => {
  if (!url) return;
  await c.connect();
  for (const file of migrations()) await c.query(readFileSync(file, "utf8"));
}, 180_000);
afterAll(async () => { if (url) await c.end(); });

async function cleanFixture(app: string): Promise<void> {
  // `alert_event` ne porte pas app_id : le libellé stable généré par
  // check_new_errors() est la frontière précise de cette fixture. Les deux
  // suppressions ne peuvent donc atteindre ni les alertes ni les données d'une
  // autre app du même PostgreSQL jetable.
  const pattern = `%nouvelle erreur % / app ${app}%`;
  await c.query(
    `delete from alert_delivery d
      using alert_event e
      where d.alert_event_id = e.id and e.message like $1`,
    [pattern],
  );
  await c.query("delete from alert_event where message like $1", [pattern]);
  await c.query("delete from rum_rollup_hourly where app_id=$1", [app]);
  await c.query("delete from rum_error where app_id=$1", [app]);
  await c.query("delete from rum_session where app_id=$1", [app]);
}

suite("watermark nouvelles erreurs et volumes réels", () => {
  it("alerte une erreur arrivée tardivement une seule fois et somme 37 + 1", async () => {
    const app = "p0-late-watermark";
    await cleanFixture(app);
    try {
      // Ne pas réinitialiser le watermark singleton : il appartient à toute la
      // base de test. Les lignes de fixture arrivent juste APRÈS sa position
      // actuelle, ce qui rend le scénario rejouable sans toucher à une autre app.
      const watermark = (await c.query<{ last_ingested_at: Date }>(
        "select last_ingested_at from rum_new_error_watermark where singleton=true",
      )).rows[0];
      await c.query("insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true", [app]);
      await c.query("insert into rum_session (session_id,app_id) values ('p0-late-session',$1)", [app]);
      await c.query(
        `insert into rum_error (session_id,app_id,fingerprint,error_type,message,occurrences,ts,ingested_at)
         values ('p0-late-session',$1,'late-only','Error','late',37,now()-interval '2 days',greatest(clock_timestamp(), $2::timestamptz + interval '1 microsecond')),
                ('p0-late-session',$1,'volume-only','Error','volume',1,now()-interval '2 days',greatest(clock_timestamp(), $2::timestamptz + interval '1 microsecond'))`,
        [app, watermark.last_ingested_at],
      );
      expect(Number((await c.query("select check_new_errors() as n")).rows[0].n)).toBeGreaterThanOrEqual(2);
      const lateAlert = "%nouvelle erreur late-only / app p0-late-watermark%";
      expect(Number((await c.query(
        "select count(*)::int as n from alert_event where message like $1", [lateAlert],
      )).rows[0].n)).toBe(1);
      expect(Number((await c.query(
        "select value::int as value from alert_event where message like $1", [lateAlert],
      )).rows[0].value)).toBe(37);
      await c.query("select check_new_errors() as n");
      expect(Number((await c.query(
        "select count(*)::int as n from alert_event where message like $1", [lateAlert],
      )).rows[0].n)).toBe(1);
      // La fenêtre normale (26 h) prend aussi une arrivée récente au ts ancien
      // et corrige son bucket historique, sans backfill de tous les rollups.
      await c.query("select refresh_rum_rollups()");
      expect(Number((await c.query(
        "select errors::int as errors from rum_rollup_hourly where app_id=$1 and hour=date_trunc('hour', now()-interval '2 days')", [app],
      )).rows[0].errors)).toBe(38);
    } finally {
      await cleanFixture(app);
    }
  });

  it("date ingested_at à l'écriture effective, même dans une transaction longue", async () => {
    const app = "p0-write-clock";
    await cleanFixture(app);
    try {
      await c.query("insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true", [app]);
      await c.query("insert into rum_session (session_id,app_id) values ('p0-clock-session',$1)", [app]);
      await c.query("begin");
      const started = (await c.query<{ t: Date }>("select transaction_timestamp() as t")).rows[0].t;
      await c.query("select pg_sleep(0.02)");
      const ingested = (await c.query<{ ingested_at: Date }>(
        "insert into rum_error (session_id,app_id,message,error_type,ts) values ('p0-clock-session',$1,'clock','Error',now()) returning ingested_at",
        [app],
      )).rows[0].ingested_at;
      await c.query("commit");
      expect(ingested.getTime()).toBeGreaterThan(started.getTime());
    } finally {
      await c.query("rollback").catch(() => {});
      await cleanFixture(app);
    }
  });

  it("rumSummary lit 37 + 1 occurrences comme 38, jamais deux lignes", async () => {
    const app = "p0-summary-occurrences";
    await cleanFixture(app);
    try {
      await c.query("insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true", [app]);
      await c.query("insert into rum_session (session_id,app_id) values ('p0-summary-session',$1)", [app]);
      await c.query(
        `insert into rum_error (session_id,app_id,fingerprint,error_type,message,occurrences,ts)
         values ('p0-summary-session',$1,'summary-37','Error','summary boom',37,now()),
                ('p0-summary-session',$1,'summary-1','Error','summary boom',1,now())`,
        [app],
      );
      // Import après DATABASE_URL : la vraie requête console s'exécute contre
      // cette DB jetable (la section IA reste explicitement unavailable sans xSOM).
      process.env.DATABASE_URL = url;
      const { rumSummary } = await import("../../apps/console/lib/queries-summary");
      const summary = await rumSummary(app, "24h", "24 hours", new Date().toISOString());
      expect(summary.top_errors[0]?.count).toBe(38);
      const { pool } = await import("../../apps/console/lib/db");
      await pool.end();
    } finally {
      await cleanFixture(app);
    }
  });
});
