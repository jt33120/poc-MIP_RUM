// AUDIT DU 07/10/2026 — LES LECTURES D'UNE SESSION DE DÉMO, EN TRANSACTION READ ONLY.
//
// La démo est déjà refusée sur toute écriture par le code (pipeline de console-api,
// middleware de la console). Défense en profondeur : ce qu'un chargeur exécute pour
// elle part dans une transaction `READ ONLY`, et c'est POSTGRES qui refuse une
// écriture (SQLSTATE 25006). Prouvé ici sur une vraie base, pour les deux couches
// de données : le shim du service (`services/console-api/shims/db.mjs`) et celle de
// la console (`apps/console/lib/db.ts`, son repli local) — et par le chargeur d'un
// écran réel servi comme console-api le sert.
//
//   SQL_TEST_DATABASE_URL=<base jetable migrée> pnpm test:sql
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enLectureSeule, lectureSeuleSiDemo } from "../../apps/console/lib/lecture-seule";

const url = process.env.SQL_TEST_DATABASE_URL;
const TABLE = "lecture_seule_demo_essai";

(url ? describe : describe.skip)("lecture seule de la démo, tenue par PostgreSQL", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : {});
  // @ts-expect-error module ESM du service, sans déclarations
  let shim: typeof import("../../services/console-api/shims/db.mjs");
  let consoleDb: typeof import("../../apps/console/lib/db");

  beforeAll(async () => {
    await pool.query(`create table if not exists ${TABLE} (x int)`);
    await pool.query(`truncate ${TABLE}`);
    shim = await import("../../services/console-api/shims/db.mjs");
    shim.brancherPool(pool);
    // La couche de la console lit `DATABASE_URL` à son chargement.
    process.env.DATABASE_URL = url!;
    consoleDb = await import("../../apps/console/lib/db");
  });

  afterAll(async () => {
    await pool.query(`drop table if exists ${TABLE}`);
    await consoleDb?.pool.end();
    await pool.end();
  });

  for (const couche of ["service (shim)", "console (repli local)"] as const) {
    const db = () => (couche === "service (shim)" ? shim : consoleDb);

    it(`${couche} : en lecture seule, une écriture est refusée par Postgres (25006), par q() comme par tx()`, async () => {
      await expect(enLectureSeule(() => db().q(`insert into ${TABLE} values (1)`))).rejects.toMatchObject({ code: "25006" });
      await expect(enLectureSeule(() => db().tx((c: pg.PoolClient) => c.query(`insert into ${TABLE} values (2)`)))).rejects.toMatchObject({ code: "25006" });
      await expect(
        enLectureSeule(() => db().withTenant("app-essai", (c: pg.PoolClient) => c.query(`update ${TABLE} set x = 3`))),
      ).rejects.toMatchObject({ code: "25006" });
      const { rows } = await pool.query(`select count(*)::int as n from ${TABLE}`);
      expect(rows[0].n).toBe(0);
    });

    it(`${couche} : en lecture seule, une lecture passe — en parallèle, sans épuiser le pool`, async () => {
      const lus = await enLectureSeule(() =>
        Promise.all(Array.from({ length: 12 }, (_, i) => db().q<{ n: number }>("select $1::int as n, current_setting('transaction_read_only') as ro", [i]))),
      );
      expect(lus.map((r: { n: number }[]) => r[0].n)).toEqual(Array.from({ length: 12 }, (_, i) => i));
      expect(lus.every((r: { ro: string }[]) => r[0].ro === "on")).toBe(true);
      // Les connexions rendues au pool ne gardent rien de la lecture seule.
      const [hors] = await db().q<{ ro: string }>("select current_setting('transaction_read_only') as ro");
      expect(hors.ro).toBe("off");
    });

    it(`${couche} : hors démo, rien ne change — l'écriture passe`, async () => {
      await lectureSeuleSiDemo(false, () => db().q(`insert into ${TABLE} values (9)`));
      const { rows } = await pool.query(`delete from ${TABLE} where x = 9 returning x`);
      expect(rows).toHaveLength(1);
    });
  }

  it("un écran réel servi comme console-api le sert, pour une démo : il aboutit (aucun chargeur n'écrit)", async () => {
    const { ecrans } = await import("../../services/console-api/ecrans.mjs");
    const demo = { email: "demo@mip-rum.local", role: "viewer" as const, apps: ["app-essai"], demo: true };
    const coquille = await ecrans.coquille(demo);
    expect(coquille.projets.ok).toBe(true);
    const projets = (await ecrans.session.projets(demo, {}, {}, "req-lecture-seule")) as { etat: string };
    expect(projets.etat).toBe("ok");
  });
});
