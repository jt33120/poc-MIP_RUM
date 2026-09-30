// Vague 3a — migration-v101 : détections horaires, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans la migration :
//
//   · que `refresh_vital_horaire` rend les p75 de `percentile_cont`, l'intervalle
//     par statistiques d'ordre aux rangs de `packages/stats/src/incertitude.ts` (exacts
//     sous 30 mesures, normaux au-delà), une ligne par route seulement à 13
//     mesures, et le même résultat quand on le rejoue ;
//   · que la purge efface au-delà de 8 semaines et rien d'autre ;
//   · que l'effacement d'une app vide les deux tables ;
//   · que `console_ro` ne lit que sa portée, et `anon` rien ;
//   · que le travail JS ouvre UN épisode sur une marche, le suit au rejeu sans le
//     doubler, et suspend une app sans ingestion récente.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm vitest run tests/integration/detections-v101-sql.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detecterPlages } from "../../packages/backend/jobs/detections.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const V101 = readFileSync(join(SQL_DIR, "migration-v101.sql"), "utf8");
const A = "det-v101-a";
const B = "det-v101-b";
const C = "det-v101-c";
const H = 3_600_000;

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

(url ? describe : describe.skip)("v101 — détections horaires : vital_horaire, signal_detecte", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 3 } : {});

  async function nettoyer() {
    await pool.query("delete from signal_detecte where app_id like 'det-v101-%'").catch(() => {});
    await pool.query("delete from vital_horaire where app_id like 'det-v101-%'").catch(() => {});
    await pool.query("delete from rum_metric where app_id like 'det-v101-%'");
  }

  /** `n` mesures de 1 à n (ms) dans l'heure fermée `ilYa` heures avant l'heure en cours. */
  async function mesures(app: string, route: string | null, name: string, n: number, ilYa: number) {
    await pool.query(
      `insert into rum_metric (app_id, route, name, value, ts)
       select $1, $2, $3, g::float8, date_trunc('hour', now()) - make_interval(hours => $5) + make_interval(secs => g)
         from generate_series(1, $4) g`,
      [app, route, name, n, ilYa],
    );
  }

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
    await nettoyer();
  });

  afterAll(async () => {
    await nettoyer();
    await pool.end();
  });

  it("rejouable : réappliquer v101 ne change rien et n'échoue pas", async () => {
    await pool.query(V101);
    const { rows } = await pool.query(
      "select count(*)::int n from pg_proc where proname = 'erase_app_data' and prosrc like '%from vital_horaire %'",
    );
    expect(rows[0].n).toBe(1);
    const { rows: src } = await pool.query("select prosrc from pg_proc where proname = 'erase_app_data'");
    expect((src[0].prosrc.match(/delete from vital_horaire/g) ?? []).length).toBe(1);
  });

  it("p75 de percentile_cont, intervalle aux rangs exacts (20 mesures) et normaux (100), ligne de route à 13 mesures", async () => {
    await mesures(A, "/a", "LCP", 20, 2);
    await mesures(A, "/b", "LCP", 100, 2);
    await mesures(A, "/c", "LCP", 12, 2);
    // Une phase réseau partage rum_metric : elle n'est pas un vital.
    await mesures(A, "/a", "DNS", 50, 2);
    const { rows: ecrites } = await pool.query("select refresh_vital_horaire(3) as n");
    expect(ecrites[0].n).toBeGreaterThanOrEqual(3);

    const { rows } = await pool.query(
      "select route, name, n, p50, p75, p75_bas, p75_haut, p95 from vital_horaire where app_id = $1 order by route, name",
      [A],
    );
    expect(rows.map((r) => [r.route, r.name, r.n])).toEqual([
      ["", "LCP", 132],
      ["/a", "LCP", 20],
      ["/b", "LCP", 100],
    ]);
    const a = rows.find((r) => r.route === "/a")!;
    // percentile_cont(0,75) de 1…20 = 15,25 ; rangs exacts de n = 20 : 11 et 19.
    expect(a.p75).toBeCloseTo(15.25, 9);
    expect([a.p75_bas, a.p75_haut]).toEqual([11, 19]);
    const b = rows.find((r) => r.route === "/b")!;
    // Rangs normaux de n = 100 : floor(75 − 1,96 × √18,75) = 66 ; ceil(75 + 8,487) + 1 = 85.
    expect([b.p75_bas, b.p75_haut]).toEqual([66, 85]);
    expect(b.p50).toBeCloseTo(50.5, 9);
    expect(b.p95).toBeCloseTo(95.05, 9);
  });

  it("idempotent : rejouer le calcul rend les mêmes lignes, et les mesures tardives sont absorbées", async () => {
    const avant = (await pool.query("select route, n, p75, p75_bas, p75_haut from vital_horaire where app_id = $1 order by route", [A])).rows;
    await pool.query("select refresh_vital_horaire(3)");
    const apres = (await pool.query("select route, n, p75, p75_bas, p75_haut from vital_horaire where app_id = $1 order by route", [A])).rows;
    expect(apres).toEqual(avant);
    await mesures(A, "/c", "LCP", 1, 2); // la 13ᵉ mesure de /c arrive en retard
    await pool.query("select refresh_vital_horaire(3)");
    const { rows } = await pool.query("select n from vital_horaire where app_id = $1 and route = '/c'", [A]);
    expect(rows).toEqual([{ n: 13 }]);
  });

  it("l'heure en cours n'est jamais calculée", async () => {
    await pool.query(
      "insert into rum_metric (app_id, route, name, value, ts) values ($1, '/a', 'LCP', 1, now())",
      [A],
    );
    await pool.query("select refresh_vital_horaire(3)");
    const { rows } = await pool.query(
      "select count(*)::int n from vital_horaire where app_id = $1 and hour >= date_trunc('hour', now())",
      [A],
    );
    expect(rows[0].n).toBe(0);
  });

  it("purge : au-delà de 8 semaines seulement", async () => {
    await pool.query(
      `insert into vital_horaire (app_id, route, name, hour, n, p75) values
         ($1, '', 'LCP', date_trunc('hour', now()) - interval '57 days', 20, 1),
         ($1, '', 'LCP', date_trunc('hour', now()) - interval '50 days', 20, 1)`,
      [A],
    );
    await pool.query(
      `insert into signal_detecte (app_id, detecteur, entite, debut, fin, methode, preuves, impact, priorite, statut) values
         ($1, 'plage', 'vital:LCP', now() - interval '60 days', now() - interval '59 days', '{}', '{}', '{}', 0.1, 'clos'),
         ($1, 'plage', 'vital:LCP', now() - interval '10 days', now() - interval '9 days', '{}', '{}', '{}', 0.1, 'clos')`,
      [A],
    );
    const { rows } = await pool.query("select purge_detections(8) as r");
    expect(rows[0].r.vital_horaire).toBeGreaterThanOrEqual(1);
    expect(rows[0].r.signal_detecte).toBeGreaterThanOrEqual(1);
    const reste = await pool.query(
      "select (select count(*)::int from vital_horaire where app_id = $1 and hour < now() - interval '40 days') vh, (select count(*)::int from signal_detecte where app_id = $1) sd",
      [A],
    );
    expect(reste.rows[0]).toEqual({ vh: 1, sd: 1 });
  });

  it("contraintes : détecteur, statut et priorité bornés", async () => {
    const ins = (detecteur: string, statut: string, priorite: number) =>
      pool.query(
        `insert into signal_detecte (app_id, detecteur, entite, debut, methode, preuves, impact, priorite, statut)
         values ($1, $2, 'x', now(), '{}', '{}', '{}', $3, $4)`,
        [A, detecteur, priorite, statut],
      );
    await expect(ins("devine", "ouvert", 0.5)).rejects.toThrow(/signal_detecte_detecteur_v101/);
    await expect(ins("plage", "peut-etre", 0.5)).rejects.toThrow(/signal_detecte_statut_v101/);
    await expect(ins("plage", "ouvert", 1.5)).rejects.toThrow(/signal_detecte_priorite_v101/);
  });

  it("RLS : console_ro lit sa portée seulement ; anon ne lit rien", async () => {
    const { rows: rls } = await pool.query(
      "select relname, relrowsecurity from pg_class where relname in ('vital_horaire', 'signal_detecte') order by relname",
    );
    expect(rls).toEqual([
      { relname: "signal_detecte", relrowsecurity: true },
      { relname: "vital_horaire", relrowsecurity: true },
    ]);
    const { rows: pol } = await pool.query(
      "select tablename, policyname, roles::text, cmd, qual from pg_policies where tablename in ('vital_horaire', 'signal_detecte') order by tablename, policyname",
    );
    // Trois familles, et rien d'autre : celle de `console_ro` (v101), bornée à la
    // portée ; celle de `mip_console` (v104), en LECTURE seule — console-api borne
    // sa lecture par la requête, comme sur toutes ses tables (v93) ; celle de
    // `mip_api` (v106), en LECTURE seule, sur `signal_detecte` seulement — le service
    // api lit les épisodes pour `GET /api/v1/detections` et borne sa lecture au
    // périmètre du jeton par la requête (v89 § 5).
    for (const p of pol) {
      if (p.policyname === "mip_console_acces") {
        expect(p.roles).toBe("{mip_console}");
        expect(p.cmd).toBe("SELECT");
      } else if (p.policyname === "mip_api_lecture") {
        expect(p).toMatchObject({ tablename: "signal_detecte", roles: "{mip_api}", cmd: "SELECT", qual: "true" });
      } else {
        expect(p.roles).toBe("{console_ro}");
        expect(p.qual).toContain("current_app_ids()");
      }
    }
    const { rows: consoleApi } = await pool.query(
      "select has_table_privilege('mip_console', 'vital_horaire', 'select') vs, has_table_privilege('mip_console', 'signal_detecte', 'select') ss, " +
        "has_table_privilege('mip_console', 'vital_horaire', 'insert') vi, has_table_privilege('mip_console', 'signal_detecte', 'update') su " +
        "where exists (select 1 from pg_roles where rolname = 'mip_console')",
    );
    for (const r of consoleApi) expect(r).toEqual({ vs: true, ss: true, vi: false, su: false });
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role console_ro");
      await c.query("select set_config('app.current_app_id', $1, true)", [B]);
      const vus = await c.query("select count(*)::int n from vital_horaire where app_id = $1", [A]);
      expect(vus.rows[0].n).toBe(0);
      await c.query("rollback");
    } finally {
      c.release();
    }
    const droits = await pool.query(
      "select has_table_privilege('anon', 'vital_horaire', 'select') a, has_table_privilege('anon', 'signal_detecte', 'select') b " +
        "where exists (select 1 from pg_roles where rolname = 'anon')",
    );
    for (const r of droits.rows) expect(r).toEqual({ a: false, b: false });
  });

  it("travail JS : une marche ouvre UN épisode ; le rejeu le suit sans le doubler ; une app muette est suspendue", async () => {
    const maintenant = Date.now();
    const courante = Math.floor(maintenant / H) * H;
    // 60 heures de référence stables (~2 s), puis quatre heures évaluées : deux normales, deux à +40 %.
    for (const app of [B, C]) {
      await pool.query(
        `insert into vital_horaire (app_id, route, name, hour, n, p75, p75_bas, p75_haut)
         select $1, '', 'LCP', to_timestamp($2::float8 / 1000) - make_interval(hours => k), 100,
                case when k <= 2 then 2800 when k <= 4 then 2000 else 2000 * (1 + 0.01 * ((k % 5) - 2)) end,
                null, null
           from generate_series(1, 64) k`,
        [app, courante],
      );
    }
    // B a une ingestion fraîche ; C n'en a pas depuis des heures (panne de collecte).
    await pool.query("insert into rum_metric (app_id, route, name, value, ts) values ($1, '/', 'LCP', 1, now() - interval '1 minute')", [B]);

    const premier = await detecterPlages(pool, { maintenantMs: maintenant });
    expect(premier.ouverts).toBe(1);
    expect(premier.suspendues.map((s: { app_id: string }) => s.app_id)).toContain(C);

    const { rows } = await pool.query(
      "select entite, statut, debut, preuves, priorite from signal_detecte where app_id = $1 and detecteur = 'plage'",
      [B],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].entite).toBe("vital:LCP");
    expect(rows[0].statut).toBe("ouvert");
    expect(new Date(rows[0].debut).getTime()).toBe(courante - 2 * H);
    expect(rows[0].preuves.phrase).toContain("écarts robustes");
    expect(rows[0].preuves.n).toBe(100);
    expect(rows[0].priorite).toBeGreaterThan(0);

    const second = await detecterPlages(pool, { maintenantMs: maintenant });
    expect(second.ouverts).toBe(0);
    const { rows: apres } = await pool.query("select count(*)::int n from signal_detecte where app_id = $1", [B]);
    expect(apres[0].n).toBe(1);
    const { rows: rienC } = await pool.query("select count(*)::int n from signal_detecte where app_id = $1", [C]);
    expect(rienC[0].n).toBe(0);
  });

  it("l'effacement d'une app vide vital_horaire et signal_detecte", async () => {
    await pool.query("insert into app_registry (app_id) values ($1) on conflict do nothing", [B]).catch(() => {});
    const { rows } = await pool.query("select erase_app_data($1) as r", [B]);
    expect(rows[0].r.vital_horaire).toBeGreaterThan(0);
    expect(rows[0].r.signal_detecte).toBe(1);
    const reste = await pool.query(
      "select (select count(*)::int from vital_horaire where app_id = $1) vh, (select count(*)::int from signal_detecte where app_id = $1) sd",
      [B],
    );
    expect(reste.rows[0]).toEqual({ vh: 0, sd: 0 });
    await pool.query("delete from app_registry where app_id = $1", [B]).catch(() => {});
    await pool.query("delete from privacy_erasure_barrier where app_id = $1", [B]).catch(() => {});
  });
});
