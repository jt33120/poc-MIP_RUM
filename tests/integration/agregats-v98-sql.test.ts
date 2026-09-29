// L0 — migration-v98 : des agrégats justes, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans la migration :
//
//   · qu'une erreur arrivée tard dans une heure ancienne ne remet plus ses vues
//     ni ses vitals à 0 (T4 du relevé du 28/09/2026 : deux heures de la console
//     passées de 7 et 13 vues à 0) — et que ses erreurs ne comptent pas double ;
//   · que la reprise des agrégats part du filigrane quand un passage a manqué,
//     et qu'elle reste bornée ;
//   · que le comptage d'usage rattrape un jour jamais compté (T6 : le 24/09), sans
//     recompter un jour déjà compté, et qu'un appel avec un jour ne change pas ;
//   · qu'aucun rôle applicatif ne lit ni n'écrit le filigrane.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const V98 = readFileSync(join(SQL_DIR, "migration-v98.sql"), "utf8");
const APP = "l0-v98-test";
const SESSION = "l0-v98-session";

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

(url ? describe : describe.skip)("L0 — migration-v98 : agrégats justes et reprises sur filigrane", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 3 } : {});

  async function nettoyer() {
    for (const table of ["rum_rollup_hourly", "rum_error", "rum_metric", "rum_pageview", "tenant_usage_daily"]) {
      await pool.query(`delete from ${table} where app_id = $1`, [APP]);
    }
    await pool.query("delete from rum_session where app_id = $1", [APP]);
    // Sans filigrane, les deux fonctions se comportent comme avant v98 : c'est
    // l'état que les autres fichiers de test attendent.
    await pool.query("delete from agregat_filigrane");
  }

  /** `n` vues et un LCP « bon » dans l'heure qui a commencé `heures` heures avant l'heure en cours. */
  async function semerHeure(heures: number, n: number) {
    await pool.query(
      `insert into rum_pageview (app_id, session_id, route, started_at)
       select $1, $2, '/', date_trunc('hour', now()) - make_interval(hours => $3) + interval '10 minutes'
         from generate_series(1, $4)`,
      [APP, SESSION, heures, n],
    );
    await pool.query(
      `insert into rum_metric (app_id, session_id, name, value, rating, ts)
       values ($1, $2, 'LCP', 1800, 'good', date_trunc('hour', now()) - make_interval(hours => $3) + interval '11 minutes')`,
      [APP, SESSION, heures],
    );
  }

  /** Une erreur de l'heure `heures`, écrite MAINTENANT (`ingested_at` par défaut). */
  async function erreur(heures: number, occurrences = 1) {
    await pool.query(
      `insert into rum_error (app_id, session_id, ts, message, occurrences)
       values ($1, $2, date_trunc('hour', now()) - make_interval(hours => $3) + interval '12 minutes', 'boom', $4)`,
      [APP, SESSION, heures, occurrences],
    );
  }

  async function cellule(heures: number) {
    const { rows } = await pool.query<{ pageviews: string; total_w: number; good_w: number; errors: string }>(
      `select pageviews, total_w, good_w, errors from rum_rollup_hourly
        where app_id = $1 and hour = date_trunc('hour', now()) - make_interval(hours => $2)`,
      [APP, heures],
    );
    return rows[0]
      ? { pageviews: Number(rows[0].pageviews), total_w: rows[0].total_w, good_w: rows[0].good_w, errors: Number(rows[0].errors) }
      : null;
  }

  async function poserFiligrane(source: string, expression: string) {
    await pool.query(
      `insert into agregat_filigrane (source, complet_avant, refreshed_at) values ($1, ${expression}, now())
       on conflict (source) do update set complet_avant = excluded.complet_avant`,
      [source],
    );
  }

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
    await nettoyer();
  });

  beforeEach(async () => {
    await nettoyer();
    await pool.query("insert into rum_session (session_id, app_id, device_type) values ($1, $2, 'desktop')", [SESSION, APP]);
  });

  afterAll(async () => {
    await nettoyer();
    await pool.end();
  });

  it("la migration se rejoue sans erreur", async () => {
    await pool.query(V98);
    await pool.query(V98);
  });

  // ─────────────────────────── (a) l'erreur arrivée tard ─────────────────────

  it("une erreur arrivée tard ne remet plus les vues ni les vitals d'une heure ancienne à 0", async () => {
    await semerHeure(72, 7);
    await pool.query("select refresh_rum_rollups(100)");
    expect(await cellule(72)).toEqual({ pageviews: 7, total_w: 2, good_w: 2, errors: 0 });

    // Un rejeu hors ligne : l'erreur date de l'heure ancienne, elle est écrite maintenant.
    await erreur(72);
    await pool.query("select refresh_rum_rollups(26)");
    // Avant v98 : { pageviews: 0, total_w: 0, good_w: 0, errors: 1 }.
    expect(await cellule(72)).toEqual({ pageviews: 7, total_w: 2, good_w: 2, errors: 1 });
  });

  it("l'heure tardive est recomptée en entier, ses erreurs une seule fois", async () => {
    await semerHeure(72, 3);
    await erreur(72, 2);
    await pool.query("update rum_error set ingested_at = now() - interval '72 hours' where app_id = $1", [APP]);
    await pool.query("select refresh_rum_rollups(100)");
    expect((await cellule(72))?.errors).toBe(2);

    await erreur(72, 5);
    await pool.query("select refresh_rum_rollups(26)");
    await pool.query("select refresh_rum_rollups(26)");
    expect(await cellule(72)).toEqual({ pageviews: 3, total_w: 2, good_w: 2, errors: 7 });
  });

  // ─────────────────────────── (b) la reprise au filigrane ───────────────────

  it("un passage abouti pose le filigrane à l'heure en cours", async () => {
    await pool.query("select refresh_rum_rollups(26)");
    const { rows } = await pool.query<{ ok: boolean }>(
      "select complet_avant = date_trunc('hour', now()) as ok from agregat_filigrane where source = 'rum_rollup_hourly'",
    );
    expect(rows[0]?.ok).toBe(true);
  });

  it("sans filigrane, la fenêtre reste celle demandée : une heure de 30 h n'est pas reprise", async () => {
    await semerHeure(30, 4);
    await pool.query("select refresh_rum_rollups(26)");
    expect(await cellule(30)).toBeNull();
  });

  it("après un passage manqué, la reprise part du filigrane", async () => {
    await semerHeure(30, 4);
    // Dernier passage abouti il y a 40 h : le scheduler s'est arrêté depuis.
    await poserFiligrane("rum_rollup_hourly", "date_trunc('hour', now()) - interval '40 hours'");
    await pool.query("select refresh_rum_rollups(26)");
    expect((await cellule(30))?.pageviews).toBe(4);
  });

  it("la reprise au filigrane est bornée à 35 jours", async () => {
    await semerHeure(24 * 40, 2);
    await semerHeure(24 * 20, 3);
    await poserFiligrane("rum_rollup_hourly", "date_trunc('hour', now()) - interval '100 days'");
    await pool.query("select refresh_rum_rollups(26)");
    expect(await cellule(24 * 40)).toBeNull();
    expect((await cellule(24 * 20))?.pageviews).toBe(3);
  });

  // ─────────────────────────── (c) le comptage d'usage ───────────────────────

  async function vueLe(joursAvant: number) {
    await pool.query(
      `insert into rum_pageview (app_id, session_id, route, started_at)
       values ($1, $2, '/', (current_date - $3::int)::timestamptz + interval '10 hours')`,
      [APP, SESSION, joursAvant],
    );
  }

  async function usage() {
    const { rows } = await pool.query<{ ecart: number; events: string }>(
      "select (current_date - day)::int as ecart, events from tenant_usage_daily where app_id = $1 order by day",
      [APP],
    );
    return Object.fromEntries(rows.map((r) => [r.ecart, Number(r.events)]));
  }

  it("premier passage sans filigrane : la veille, et les jours jamais comptés — pas les autres", async () => {
    await vueLe(5);
    await vueLe(3);
    await vueLe(1);
    // J-3 a été compté à son heure ; la purge l'aurait depuis entamé. Ne pas y toucher.
    await pool.query(
      "insert into tenant_usage_daily (app_id, day, events, sessions, errors, metered_at) values ($1, current_date - 3, 999, 1, 0, now())",
      [APP],
    );
    const { rows } = await pool.query<{ r: { day: string; apps_metered: number } }>("select meter_tenant_usage() as r");
    expect(rows[0].r.apps_metered).toBeGreaterThanOrEqual(2);
    expect(await usage()).toEqual({ 5: 1, 3: 999, 1: 1 });

    const { rows: f } = await pool.query<{ ok: boolean }>(
      "select complet_avant::date = current_date as ok from agregat_filigrane where source = 'tenant_usage_daily'",
    );
    expect(f[0]?.ok).toBe(true);
  });

  it("avec un filigrane, rattrape chaque jour depuis lui, et seulement ceux-là", async () => {
    await vueLe(6);
    await vueLe(4);
    await vueLe(2);
    // Dernier passage abouti : il a compté jusqu'à J-5 inclus.
    await poserFiligrane("tenant_usage_daily", "(current_date - 4)::timestamptz");
    await pool.query("select mip_rattraper_usage(14)");
    expect(await usage()).toEqual({ 4: 1, 2: 1 });
    // Le passage suivant, le même jour, n'a plus rien à compter.
    const { rows } = await pool.query<{ r: { days: string[] } }>("select mip_rattraper_usage(14) as r");
    expect(rows[0].r.days).toEqual([]);
  });

  it("le rattrapage est borné", async () => {
    await vueLe(10);
    await vueLe(2);
    await poserFiligrane("tenant_usage_daily", "(current_date - 30)::timestamptz");
    await pool.query("select mip_rattraper_usage(5)");
    expect(await usage()).toEqual({ 2: 1 });
  });

  it("avec un jour, le comptage ne change pas : ce jour-là, écrasé, sans filigrane", async () => {
    await vueLe(8);
    await pool.query(
      "insert into tenant_usage_daily (app_id, day, events, sessions, errors, metered_at) values ($1, current_date - 8, 999, 1, 0, now())",
      [APP],
    );
    const { rows } = await pool.query<{ r: { day: string; apps_metered: number } }>(
      "select meter_tenant_usage(current_date - 8) as r",
    );
    expect(rows[0].r.apps_metered).toBeGreaterThanOrEqual(1);
    expect(await usage()).toEqual({ 8: 1 });
    const { rows: f } = await pool.query("select 1 from agregat_filigrane where source = 'tenant_usage_daily'");
    expect(f).toHaveLength(0);
  });

  // ─────────────────────────── les droits ────────────────────────────────────

  it("le filigrane est sous RLS, et aucun rôle applicatif n'y a droit", async () => {
    const { rows } = await pool.query<{ actif: boolean }>(
      "select relrowsecurity as actif from pg_class where relname = 'agregat_filigrane'",
    );
    expect(rows[0].actif).toBe(true);
    const { rows: roles } = await pool.query<{ rolname: string }>(
      "select rolname from pg_roles where rolname in ('console_ro', 'mip_api', 'mip_console', 'mip_identity')",
    );
    for (const { rolname } of roles) {
      const { rows: droits } = await pool.query<{ ok: boolean }>(
        "select has_table_privilege($1, 'agregat_filigrane', 'SELECT, INSERT, UPDATE, DELETE') as ok",
        [rolname],
      );
      expect(droits[0].ok, rolname).toBe(false);
    }
  });
});
