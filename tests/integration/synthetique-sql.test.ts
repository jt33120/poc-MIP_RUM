// migration-v64 sur un vrai PostgreSQL : l'idempotence de l'import et le témoin.
//
// Ce que ce fichier prouve ne se lit pas dans le code : qu'un import rejoué ne
// duplique ni n'efface, et qu'un import qui échoue laisse une trace exploitable.
//
//   SQL_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/sqltest pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { surEchec } from "../outils/diagnostic";

const URL_TEST = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");
const APP = "syn-test";

function fichiersSql(): string[] {
  const migrations = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return ["schema.sql", ...migrations].map((f) => join(SQL_DIR, f));
}

const c = new pg.Client(URL_TEST ? { connectionString: URL_TEST } : {});
const suite = URL_TEST ? describe : describe.skip;

if (!URL_TEST) console.warn("[synthetique-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");

/** Écrit un passage comme le fait sync.mjs : upsert sur (app, mesure, instant). */
async function passage(measureId: string, quand: string, latence: number, etat = "ok") {
  const { rowCount } = await c.query(
    `insert into syn_snapshot
       (app_id, site, measure_id, measure_name, execution_id, measure_type,
        route_hint, score, state, state_source, latency_ms, metrics, captured_at)
     values ($1,'S',$2,'M',null,'T','/',100,$3,upper($3),$4,'{"first_load_time":"1"}'::jsonb,$5)
     on conflict (app_id, measure_id, captured_at)
       do update set latency_ms = excluded.latency_ms, state = excluded.state,
                     metrics = excluded.metrics, ingested_at = now()`,
    [APP, measureId, etat, latence, quand],
  );
  return rowCount;
}

beforeAll(async () => {
  if (!URL_TEST) return;
  await c.connect();
  for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
  await c.query("delete from syn_snapshot where app_id = $1", [APP]);
  await c.query("delete from syn_import");
}, 180_000);
afterAll(async () => {
  if (URL_TEST) await c.end();
});

suite("l'import ne détruit plus l'historique", () => {
  it("rejouer le même passage ne duplique pas et n'efface rien", async () => {
    // LE défaut d'origine : `delete from syn_snapshot where measure_id = any(...)`
    // sans borne de temps effaçait tout l'historique d'une mesure à chaque
    // passage. Le miroir ne portait jamais plus d'une journée — et la matrice de
    // corrélation, qui exige huit seaux appariés, était impossible par construction.
    for (let h = 0; h < 30; h++) {
      await passage("m1", `2026-06-10T${String(h % 24).padStart(2, "0")}:00:00Z`, 300 + h);
    }
    const avant = Number((await c.query("select count(*)::int n from syn_snapshot where app_id=$1", [APP])).rows[0].n);

    // Second import couvrant les six dernières heures seulement.
    for (let h = 0; h < 6; h++) {
      await passage("m1", `2026-06-10T${String(h).padStart(2, "0")}:00:00Z`, 999);
    }
    const apres = Number((await c.query("select count(*)::int n from syn_snapshot where app_id=$1", [APP])).rows[0].n);

    surEchec("un import partiel ne doit pas amputer l'historique", () => ({ avant, apres }));
    expect(apres).toBe(avant);
    // Et il MET À JOUR ce qu'il recouvre, plutôt que d'ignorer.
    const maj = await c.query<{ latency_ms: number }>(
      "select latency_ms from syn_snapshot where app_id=$1 and captured_at='2026-06-10T03:00:00Z'",
      [APP],
    );
    expect(Number(maj.rows[0].latency_ms)).toBe(999);
  });

  it("deux mesures au même instant sont deux lignes, pas un conflit", async () => {
    // La clé porte sur (app, mesure, instant) : deux robots qui passent à la même
    // heure sur deux pages différentes ne doivent pas s'écraser.
    await passage("m2", "2026-06-10T00:00:00Z", 111);
    const { rows } = await c.query<{ n: string }>(
      "select count(*) n from syn_snapshot where app_id=$1 and captured_at='2026-06-10T00:00:00Z'",
      [APP],
    );
    expect(Number(rows[0].n)).toBe(2);
  });

  it("conserve les six métriques en jsonb, interrogeables", async () => {
    await c.query(
      `update syn_snapshot set metrics = $2::jsonb where app_id = $1 and measure_id = 'm2'`,
      [APP, JSON.stringify({ completion_time: "10015", first_load_time: "281", dns_time: "32", nb_requests: "115", nb_requests_ko: "6", http_status: "200 - OK" })],
    );
    const { rows } = await c.query<{ nb: string; http: string }>(
      `select metrics->>'nb_requests' nb, metrics->>'http_status' http
         from syn_snapshot where app_id=$1 and measure_id='m2'`,
      [APP],
    );
    expect(rows[0].nb).toBe("115");
    expect(rows[0].http).toBe("200 - OK");
  });
});

suite("le témoin d'import parle, y compris quand l'import meurt", () => {
  it("un passage ouvert puis clos en succès", async () => {
    const { rows } = await c.query<{ id: string }>("select syn_import_ouvrir('essai') as id");
    await c.query("select syn_import_clore($1, true, 9, 9, 0, null)", [rows[0].id]);
    const f = (await c.query("select * from syn_fraicheur()")).rows[0];
    expect(f.dernier_import_ok).toBe(true);
    expect(Number(f.imports_24h)).toBeGreaterThan(0);
  });

  it("un passage JAMAIS CLOS compte comme un échec", async () => {
    // « Parti et jamais revenu » est un état distinct de l'échec propre, et il
    // doit compter : un import tué par un redémarrage ne doit pas se lire comme
    // un import qui n'a jamais été planifié.
    await c.query("select syn_import_ouvrir('mort-en-route')");
    const f = (await c.query("select * from syn_fraicheur()")).rows[0];
    surEchec("un import ouvert et jamais clos", () => ({ fraicheur: f }));
    expect(Number(f.echecs_24h)).toBeGreaterThan(0);
    // Mais il ne masque PAS le dernier verdict connu.
    expect(f.dernier_import_ok).toBe(true);
  });

  it("un échec conserve son message", async () => {
    const { rows } = await c.query<{ id: string }>("select syn_import_ouvrir('casse') as id");
    await c.query("select syn_import_clore($1, false, 3, 0, 3, $2)", [rows[0].id, "mesure non mappée: X"]);
    const { rows: j } = await c.query<{ erreur: string; ok: boolean }>(
      "select erreur, ok from syn_import where id = $1",
      [rows[0].id],
    );
    expect(j[0].ok).toBe(false);
    expect(j[0].erreur).toContain("mesure non mappée");
  });

  it("les DEUX âges sont distincts — robot et miroir sont deux pannes", async () => {
    const f = (await c.query("select * from syn_fraicheur()")).rows[0];
    // La capture est datée de 2026-06-10 (le jeu de test), l'import de maintenant.
    expect(Number(f.age_capture_s)).toBeGreaterThan(Number(f.age_import_s));
  });

  it("la purge du journal borne la table sans toucher aux captures", async () => {
    await c.query("insert into syn_import (source, demarre_le) values ('vieux', now() - interval '200 days')");
    const capturesAvant = Number((await c.query("select count(*)::int n from syn_snapshot")).rows[0].n);
    const { rows } = await c.query<{ syn_import_purger: string }>("select syn_import_purger(90)");
    expect(Number(rows[0].syn_import_purger)).toBe(1);
    expect(Number((await c.query("select count(*)::int n from syn_snapshot")).rows[0].n)).toBe(capturesAvant);
  });
});

suite("une base sans aucune donnée synthétique dit « jamais », pas « à l'instant »", () => {
  it("les âges valent null quand rien n'existe", async () => {
    await c.query("delete from syn_snapshot");
    await c.query("delete from syn_import");
    const f = (await c.query("select * from syn_fraicheur()")).rows[0];
    surEchec("base vide", () => ({ fraicheur: f }));
    // null, et surtout pas 0 : 0 se lirait « capture à l'instant », c'est-à-dire
    // le contraire de la vérité.
    expect(f.age_capture_s).toBeNull();
    expect(f.age_import_s).toBeNull();
    expect(f.dernier_import_ok).toBeNull();
    expect(Number(f.imports_24h)).toBe(0);
  });
});
