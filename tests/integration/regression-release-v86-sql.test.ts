// B52 — migration-v86 : le mode `release` de check_alerts, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le code :
//
//   · que v86 se rejoue sans effet et sans toucher une ligne : aucune table, aucun
//     index, une contrainte NOT VALID, les règles et événements existants intacts ;
//   · qu'une règle de release compare le p75 de la release LA PLUS RÉCENTE (premier
//     déploiement déclaré) à celui de la PRÉCÉDENTE, sur la même fenêtre, et se
//     franchit à +20 % exactement — la règle de `assessRegression` ;
//   · qu'elle n'évalue pas, et le dit, sans deux releases déclarées, sous 100
//     mesures de l'une des deux, ou sur un p75 précédent nul — jamais un zéro,
//     jamais une valeur écrite ;
//   · que l'app et la route de la règle bornent mesures ET marqueurs ;
//   · que les autres modes n'ont pas bougé ;
//   · enfin, sur une seconde base restée en v85, que le code déjà déployé (tick du
//     scheduler, dispatcher) tourne avant ET après l'application de v86 — et
//     pourquoi la console doit refuser ce mode tant que v86 manque.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_PRE_V86_DATABASE_URL=<autre base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery } from "../../apps/console/lib/query-contract";
import type { RuleInput } from "../../apps/console/lib/queries-v2";
// @ts-expect-error module JS partagé sans déclarations
import { dispatchOnce, selectionSql } from "../../apps/ingest/dispatch-alerts.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { travaux } from "../../apps/ingest/jobs/planifie.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlFenetre = process.env.SQL_TEST_PRE_V86_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");
const V86 = readFileSync(join(SQL_DIR, "migration-v86.sql"), "utf8");
const PHRASE = "même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte";
const muet = { info() {}, warn() {}, error() {} };

/** Préfixe des apps de ce fichier : le nettoyage ne touche rien d'autre. */
const PREFIXE = "b52-";

function migrations(maxVersion = Number.POSITIVE_INFINITY): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f) && version(f) <= maxVersion)
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(db: pg.Pool): Promise<void> {
  // `alert_event` et `alert_delivery` partent en cascade avec leur règle.
  await db.query("delete from alert_rule where app_id like $1", [`${PREFIXE}%`]);
  await db.query("delete from deploy_marker where app_id like $1", [`${PREFIXE}%`]);
  await db.query("delete from rum_metric where app_id like $1", [`${PREFIXE}%`]);
  await db.query("delete from rum_session where app_id like $1", [`${PREFIXE}%`]);
  await db.query("delete from app_registry where app_id like $1", [`${PREFIXE}%`]);
}

async function app(db: pg.Pool, id: string): Promise<void> {
  await db.query("insert into app_registry (app_id, name, active) values ($1, $1, true) on conflict (app_id) do nothing", [id]);
  await db.query("insert into rum_session (session_id, app_id) values ($1, $2) on conflict do nothing", [`${id}-s`, id]);
}

/** Un déploiement déclaré, `ilYA` avant maintenant (intervalle SQL ; négatif = futur). */
async function deploiement(db: pg.Pool, id: string, version: string, ilYA: string): Promise<void> {
  await db.query(
    "insert into deploy_marker (app_id, ts, version, env, source) values ($1, now() - $2::interval, $3, 'prod', 'ci')",
    [id, ilYA, version],
  );
}

let lot = 0;
/** `n` mesures de même valeur, toutes dans les 50 dernières minutes : leur p75 vaut `valeur`. */
async function mesures(
  db: pg.Pool,
  id: string,
  release: string | null,
  valeur: number,
  n: number,
  { name = "LCP", route = "/" }: { name?: string; route?: string } = {},
): Promise<void> {
  lot += 1;
  await db.query(
    `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts, release)
     select $1 || g, $2, $3, $4, $5, $6, 'good', now() - make_interval(mins => 1 + (g % 50)), $7
       from generate_series(1, $8::int) g`,
    [`${id}-${lot}-`, `${id}-s`, id, route, name, valeur, release, n],
  );
}

async function regle(
  db: pg.Pool,
  id: string,
  { metric = "LCP", route = null as string | null, seuil = 20, mode = "release", fenetre = 120 } = {},
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `insert into alert_rule (app_id, metric, route, comparator, threshold, window_minutes, mode, severity)
     values ($1, $2, $3, '>', $4, $5, $6, 'warning') returning id`,
    [id, metric, route, seuil, fenetre, mode],
  );
  return Number(rows[0].id);
}

type Etat = { last_state: string | null; last_value: number | null; last_reason: string | null };
const etat = async (db: pg.Pool, id: number): Promise<Etat> =>
  (await db.query<Etat>("select last_state, last_value, last_reason from alert_rule where id = $1", [id])).rows[0];
const evenements = async (db: pg.Pool, id: number) =>
  (await db.query<{ value: number; message: string }>("select value, message from alert_event where rule_id = $1", [id])).rows;
const evaluer = async (db: pg.Pool): Promise<number> => Number((await db.query("select check_alerts() as n")).rows[0].n);

/** Modules console branchés sur une base jetable (même patron qu'alertes-sql). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const v2 = await import("../../apps/console/lib/queries-v2");
  const filters = await import("../../apps/console/lib/filters");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...v2, ...filters, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

/** Une règle telle que l'action serveur la remet à `insertAlertRule`. */
const regleConsole = (app_id: string, over: Partial<RuleInput> = {}): RuleInput => ({
  app_id, metric: "LCP", route: null, comparator: ">", threshold: 20, window_minutes: 1440, webhook_url: null,
  mode: "release", severity: "warning", sensitivity: 3, baseline_weeks: 4, env: null, ...over,
});

const suite = url ? describe : describe.skip;
const suiteFenetre = urlFenetre ? describe : describe.skip;

suite("migration-v86 — régression de release dans check_alerts (PostgreSQL)", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 2 } : { max: 2 });

  beforeAll(async () => {
    for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    await nettoyer(pool);
  }, 300_000);

  afterAll(async () => {
    await nettoyer(pool);
    await pool.end();
  });

  describe("la migration elle-même", () => {
    it("se rejoue sans effet : une fonction, une contrainte NOT VALID, aucune table ni index, aucune ligne touchée", async () => {
      const A = `${PREFIXE}rejeu`;
      await app(pool, A);
      const seuil = await regle(pool, A, { mode: "threshold", seuil: 2500 });
      await pool.query("insert into alert_event (rule_id, value, message, severity) values ($1, 1, 'b52-rejeu', 'info')", [seuil]);
      const empreinte = async () =>
        (await pool.query(`select (select md5(string_agg(t::text, ',' order by t.id)) from alert_rule t) as regles,
                                  (select md5(string_agg(t::text, ',' order by t.id)) from alert_event t) as evenements,
                                  (select count(*)::int from rum_metric) as mesures`)).rows[0];
      const avant = await empreinte();

      await pool.query(V86);
      await pool.query(V86);

      expect(await empreinte()).toEqual(avant);
      const fonctions = await pool.query(
        "select proname from pg_proc where proname in ('alert_release_p75', 'check_alerts') order by proname",
      );
      expect(fonctions.rows).toEqual([{ proname: "alert_release_p75" }, { proname: "check_alerts" }]);
      const contrainte = await pool.query(
        "select convalidated from pg_constraint where conname = 'alert_rule_release_v86'",
      );
      expect(contrainte.rows).toEqual([{ convalidated: false }]);
      expect((await pool.query("select indexname from pg_indexes where indexname like '%v86%'")).rowCount).toBe(0);
      expect((await pool.query("select to_regprocedure('public.alert_release_p75(text,text,text,integer)') is not null as ok")).rows[0].ok)
        .toBe(true);
    });

    it("la contrainte refuse une règle de release hors Web Vital ou sans hausse tolérée positive", async () => {
      const A = `${PREFIXE}contrainte`;
      await app(pool, A);
      await expect(regle(pool, A, { metric: "error_rate" })).rejects.toThrow(/alert_rule_release_v86/);
      await expect(regle(pool, A, { metric: "event:checkout" })).rejects.toThrow(/alert_rule_release_v86/);
      await expect(regle(pool, A, { seuil: 0 })).rejects.toThrow(/alert_rule_release_v86/);
      // Les autres modes restent libres de leur métrique.
      await expect(regle(pool, A, { metric: "error_rate", mode: "threshold", seuil: 0.05 })).resolves.toBeGreaterThan(0);
    });
  });

  describe("l'évaluation", () => {
    it("régression : +30 % entre la release la plus récente et la précédente se déclenche, avec la phrase du plan", async () => {
      const A = `${PREFIXE}regression`;
      await app(pool, A);
      await deploiement(pool, A, "1.0.0", "3 hours");
      await deploiement(pool, A, "1.1.0", "1 hour");
      // Un marqueur FUTUR n'est pas une release déployée.
      await deploiement(pool, A, "2.0.0", "-1 hour");
      // Redéployer une version ne la rajeunit pas : c'est son PREMIER déploiement qui compte.
      await deploiement(pool, A, "1.0.0", "30 minutes");
      await mesures(pool, A, "1.0.0", 2000, 120);
      await mesures(pool, A, "1.1.0", 2600, 120);
      // Des mesures sans release ne sont d'aucune des deux.
      await mesures(pool, A, null, 9000, 200);
      const id = await regle(pool, A);

      await evaluer(pool);

      const e = await etat(pool, id);
      expect(e.last_state).toBe("breached");
      expect(e.last_value).toBe(2600);
      expect(e.last_reason).toBe("1.1.0 : p75 2600 (120 mesures) contre 1.0.0 : p75 2000 (120 mesures), +30 % pour +20 % tolérés");
      const [evt, ...autres] = await evenements(pool, id);
      expect(autres).toEqual([]);
      expect(evt.value).toBe(2600);
      expect(evt.message).toContain("LCP p75 en hausse de 30 % d'une release à l'autre : 1.1.0 = 2600 contre 1.0.0 = 2000");
      expect(evt.message).toContain("seuil +20 %, 120 et 120 mesures, fenêtre 120 min");
      expect(evt.message).toContain(`app ${A}`);
      expect(evt.message.endsWith(PHRASE)).toBe(true);

      // Un second passage dans la fenêtre ne redéclenche pas (événement non acquitté).
      await evaluer(pool);
      expect(await evenements(pool, id)).toHaveLength(1);
    });

    it("pas de régression : +10 % reste « ok », sans événement, et dit ce qu'il a comparé", async () => {
      const A = `${PREFIXE}stable`;
      await app(pool, A);
      await deploiement(pool, A, "4.1", "2 hours");
      await deploiement(pool, A, "4.2", "20 minutes");
      await mesures(pool, A, "4.1", 2000, 150);
      await mesures(pool, A, "4.2", 2200, 110);
      const id = await regle(pool, A);

      await evaluer(pool);

      expect(await etat(pool, id)).toEqual({
        last_state: "ok",
        last_value: 2200,
        last_reason: "4.2 : p75 2200 (110 mesures) contre 4.1 : p75 2000 (150 mesures), +10 % pour +20 % tolérés",
      });
      expect(await evenements(pool, id)).toEqual([]);
    });

    it("à +20 % exactement, la règle se franchit (≥, comme assessRegression) ; à +20,1 % tolérés, non", async () => {
      const A = `${PREFIXE}borne`;
      await app(pool, A);
      await deploiement(pool, A, "a", "2 hours");
      await deploiement(pool, A, "b", "1 hour");
      await mesures(pool, A, "a", 2000, 100);
      await mesures(pool, A, "b", 2400, 100);
      const pile = await regle(pool, A, { seuil: 20 });
      const juste = await regle(pool, A, { seuil: 20.1 });

      await evaluer(pool);

      expect((await etat(pool, pile)).last_state).toBe("breached");
      expect((await etat(pool, juste)).last_state).toBe("ok");
    });

    it("une seule release déclarée : pas d'évaluation, la raison le dit, aucune valeur", async () => {
      const A = `${PREFIXE}seule`;
      await app(pool, A);
      await deploiement(pool, A, "1.0.0", "2 hours");
      await mesures(pool, A, "1.0.0", 2000, 300);
      // Une release MESURÉE mais jamais déclarée ne compte pas : son ordre est inconnu.
      await mesures(pool, A, "0.9.9", 1500, 300);
      const id = await regle(pool, A);

      await evaluer(pool);

      expect(await etat(pool, id)).toEqual({
        last_state: "no_data",
        last_value: null,
        last_reason: "une seule release déclarée (1.0.0) : il en faut deux pour comparer",
      });
      expect(await evenements(pool, id)).toEqual([]);
    });

    it("aucune release déclarée : la raison nomme le point d'entrée des marqueurs", async () => {
      const A = `${PREFIXE}aucune`;
      await app(pool, A);
      await mesures(pool, A, "1.0.0", 2000, 300);
      const id = await regle(pool, A);

      await evaluer(pool);

      const e = await etat(pool, id);
      expect(e.last_state).toBe("no_data");
      expect(e.last_value).toBeNull();
      expect(e.last_reason).toContain("POST /api/v1/deploys");
    });

    it("sous 100 mesures d'un côté : pas de verdict ; à 100, la règle juge", async () => {
      const A = `${PREFIXE}effectif`;
      await app(pool, A);
      await deploiement(pool, A, "r1", "2 hours");
      await deploiement(pool, A, "r2", "1 hour");
      await mesures(pool, A, "r1", 2000, 120);
      await mesures(pool, A, "r2", 5000, 99);
      const id = await regle(pool, A);

      await evaluer(pool);
      expect(await etat(pool, id)).toEqual({
        last_state: "no_data",
        last_value: null,
        last_reason: "effectif insuffisant sur la fenêtre : 99 mesure(s) LCP pour r2, 120 pour r1 ; 100 requises par release",
      });
      expect(await evenements(pool, id)).toEqual([]);

      await mesures(pool, A, "r2", 5000, 1);
      await evaluer(pool);
      expect((await etat(pool, id)).last_state).toBe("breached");
    });

    it("la release la plus récente sans aucune mesure (retour arrière) : « 0 mesure », pas un p75 à 0", async () => {
      const A = `${PREFIXE}retour`;
      await app(pool, A);
      await deploiement(pool, A, "5.0", "3 hours");
      await deploiement(pool, A, "5.1", "2 hours");
      await deploiement(pool, A, "5.2", "10 minutes");
      await mesures(pool, A, "5.0", 2000, 200);
      await mesures(pool, A, "5.1", 2000, 200);
      const id = await regle(pool, A);

      await evaluer(pool);

      expect((await etat(pool, id)).last_reason).toBe(
        "effectif insuffisant sur la fenêtre : 0 mesure(s) LCP pour 5.2, 200 pour 5.1 ; 100 requises par release",
      );
    });

    it("p75 précédent nul (CLS parfait) : aucun écart relatif, pas de verdict", async () => {
      const A = `${PREFIXE}zero`;
      await app(pool, A);
      await deploiement(pool, A, "z1", "2 hours");
      await deploiement(pool, A, "z2", "1 hour");
      await mesures(pool, A, "z1", 0, 150, { name: "CLS" });
      await mesures(pool, A, "z2", 0.2, 150, { name: "CLS" });
      const id = await regle(pool, A, { metric: "CLS" });

      await evaluer(pool);

      expect(await etat(pool, id)).toEqual({
        last_state: "no_data",
        last_value: null,
        last_reason: "p75 CLS nul pour z1 : aucun écart relatif calculable",
      });
    });

    it("CLS : trois décimales dans le détail, pas un arrondi à l'unité", async () => {
      const A = `${PREFIXE}cls`;
      await app(pool, A);
      await deploiement(pool, A, "c1", "2 hours");
      await deploiement(pool, A, "c2", "1 hour");
      await mesures(pool, A, "c1", 0.1, 150, { name: "CLS" });
      await mesures(pool, A, "c2", 0.125, 150, { name: "CLS" });
      const id = await regle(pool, A, { metric: "CLS" });

      await evaluer(pool);

      expect((await etat(pool, id)).last_reason).toBe(
        "c2 : p75 0.125 (150 mesures) contre c1 : p75 0.100 (150 mesures), +25 % pour +20 % tolérés",
      );
    });

    it("périmètre : ni les mesures ni les marqueurs d'une autre app ne comptent ; la route borne les mesures", async () => {
      const A = `${PREFIXE}perimetre-a`;
      const B = `${PREFIXE}perimetre-b`;
      await app(pool, A);
      await app(pool, B);
      await deploiement(pool, A, "1.0.0", "3 hours");
      await deploiement(pool, A, "1.1.0", "1 hour");
      // B : les mêmes versions, très lentes, et un déploiement plus récent.
      await deploiement(pool, B, "1.0.0", "3 hours");
      await deploiement(pool, B, "1.1.0", "1 hour");
      await deploiement(pool, B, "1.2.0", "5 minutes");
      await mesures(pool, B, "1.1.0", 9000, 500);
      await mesures(pool, B, "1.2.0", 9000, 500);
      // A : stable sur `/`, dégradée sur `/panier`.
      await mesures(pool, A, "1.0.0", 2000, 120);
      await mesures(pool, A, "1.1.0", 2000, 120);
      await mesures(pool, A, "1.0.0", 2000, 120, { route: "/panier" });
      await mesures(pool, A, "1.1.0", 3000, 120, { route: "/panier" });
      const racine = await regle(pool, A, { route: "/" });
      const panier = await regle(pool, A, { route: "/panier" });

      await evaluer(pool);

      expect(await etat(pool, racine)).toEqual({
        last_state: "ok",
        last_value: 2000,
        last_reason: "1.1.0 : p75 2000 (120 mesures) contre 1.0.0 : p75 2000 (120 mesures), +0 % pour +20 % tolérés",
      });
      const e = await etat(pool, panier);
      expect(e.last_state).toBe("breached");
      expect(e.last_value).toBe(3000);
      const [evt] = await evenements(pool, panier);
      expect(evt.message).toContain(`app ${A}, route /panier`);
    });

    it("les autres modes n'ont pas bougé : un seuil fixe se déclenche comme avant, sans détail de comparaison", async () => {
      const A = `${PREFIXE}seuil`;
      await app(pool, A);
      await deploiement(pool, A, "x", "2 hours");
      await mesures(pool, A, "x", 3000, 5);
      const id = await regle(pool, A, { mode: "threshold", seuil: 2500, fenetre: 120 });

      await evaluer(pool);

      expect(await etat(pool, id)).toEqual({ last_state: "breached", last_value: 3000, last_reason: null });
      const [evt] = await evenements(pool, id);
      expect(evt.message).toBe(`LCP > 3000.0 (seuil 2500, fenêtre 120 min, app ${A})`);
    });
  });

  describe("F68 — la console sur une base v86", () => {
    let lib: Console;
    beforeAll(async () => {
      lib = await consoleSur(url!);
    });
    afterAll(async () => {
      await lib?.pool.end();
    });

    it("détecte B52, écrit une règle de release sur un vital, la relit avec son mode et sa hausse", async () => {
      const A = `${PREFIXE}console`;
      await app(pool, A);
      expect(await lib.releaseRegressionDisponible()).toBe(true);
      await lib.insertAlertRule(regleConsole(A, { threshold: 25 }));
      const parsed = parseAnalyticsQuery(new URLSearchParams(`app=${A}`), {
        principal: { role: "admin", apps: null },
        nowMs: Date.now(),
      });
      if (!parsed.ok) throw new Error(parsed.error.message);
      const [lue, ...autres] = await lib.alertRules(lib.filtersOfQuery(parsed.value));
      expect(autres).toEqual([]);
      expect(lue).toMatchObject({ app_id: A, metric: "LCP", mode: "release", threshold: 25, comparator: ">" });
      // La console refuse avant la contrainte : message lisible, rien d'écrit.
      await expect(lib.insertAlertRule(regleConsole(A, { metric: "error_rate" }))).rejects.toThrow(/Web Vitals/);
      expect((await pool.query("select count(*)::int as n from alert_rule where app_id = $1", [A])).rows[0].n).toBe(1);
    });
  });
});

suiteFenetre("fenêtre de déploiement : base restée en v85, puis v86 appliquée sous le code en service", () => {
  const poolFenetre = new pg.Pool(urlFenetre ? { connectionString: urlFenetre, max: 2 } : { max: 2 });
  const W = `${PREFIXE}fenetre`;
  let lib: Console;

  beforeAll(async () => {
    await poolFenetre.query("drop schema public cascade; create schema public;");
    for (const file of migrations(85)) await poolFenetre.query(readFileSync(file, "utf8"));
    await app(poolFenetre, W);
    await deploiement(poolFenetre, W, "1.0.0", "3 hours");
    await deploiement(poolFenetre, W, "1.1.0", "1 hour");
    await mesures(poolFenetre, W, "1.0.0", 2000, 120);
    await mesures(poolFenetre, W, "1.1.0", 2600, 120);
    lib = await consoleSur(urlFenetre!);
  }, 300_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(poolFenetre);
    await poolFenetre.end();
  });

  it("F68 — la nouvelle console sur la base v85 : option indisponible, écriture d'une règle de release REFUSÉE", async () => {
    expect(await lib.releaseRegressionDisponible()).toBe(false);
    await expect(lib.insertAlertRule(regleConsole(W))).rejects.toThrow(/migration-v86 non appliquée/);
    expect((await poolFenetre.query("select count(*)::int as n from alert_rule where mode = 'release'")).rows[0].n).toBe(0);
    // Les autres modes s'écrivent comme avant.
    await lib.insertAlertRule(regleConsole(W, { mode: "threshold", threshold: 9000 }));
    await poolFenetre.query("delete from alert_rule where app_id = $1", [W]);
  });

  it("sans v86, une règle « release » serait lue comme un SEUIL FIXE (LCP > 20 ms) : la console doit la refuser", async () => {
    expect((await poolFenetre.query("select to_regprocedure('public.alert_release_p75(text,text,text,integer)') as f")).rows[0].f)
      .toBeNull();
    const id = await regle(poolFenetre, W, { mode: "release", seuil: 20 });
    await evaluer(poolFenetre);
    const e = await etat(poolFenetre, id);
    expect(e.last_state).toBe("breached");
    expect((await evenements(poolFenetre, id))[0].message).toMatch(/^LCP > \d+\.0 \(seuil 20,/);
    await poolFenetre.query("delete from alert_rule where id = $1", [id]);
  });

  it("v86 appliquée sous le tick et le dispatcher en service : ils tournent avant et après, les règles existantes ne changent pas", async () => {
    const seuil = await regle(poolFenetre, W, { mode: "threshold", seuil: 2500 });
    const avant = await travaux(poolFenetre, { log: muet, dispatch: dispatchOnce }).tick();
    expect(avant.resultats.check_alerts).toMatchObject({ ok: true });
    expect(avant.resultats.dispatch_alerts).toMatchObject({ ok: true });
    const etatAvant = await etat(poolFenetre, seuil);

    await poolFenetre.query(V86);

    // La sélection du dispatcher (inchangée) se prépare sur le nouveau schéma.
    const client = await poolFenetre.connect();
    try {
      await client.query("begin");
      await client.query(selectionSql(true), [5]);
      await client.query("rollback");
    } finally {
      client.release();
    }
    const apres = await travaux(poolFenetre, { log: muet, dispatch: dispatchOnce }).tick();
    expect(apres.resultats.check_alerts).toMatchObject({ ok: true });
    expect(apres.resultats.dispatch_alerts).toMatchObject({ ok: true });
    const etatApres = await etat(poolFenetre, seuil);
    expect({ ...etatApres }).toEqual({ ...etatAvant });
    // Déjà déclenchée et non acquittée : pas de second événement.
    expect(await evenements(poolFenetre, seuil)).toHaveLength(1);

    // Et le mode release est désormais évalué comme tel ; la console le voit sans
    // redémarrer (aucune mise en cache de la détection).
    expect(await lib.releaseRegressionDisponible()).toBe(true);
    await lib.insertAlertRule(regleConsole(W, { window_minutes: 120 }));
    const [{ id: release }] = (await poolFenetre.query<{ id: string }>(
      "select id from alert_rule where app_id = $1 and mode = 'release'",
      [W],
    )).rows;
    await evaluer(poolFenetre);
    expect(await etat(poolFenetre, Number(release))).toMatchObject({ last_state: "breached", last_value: 2600 });
  }, 120_000);
});
