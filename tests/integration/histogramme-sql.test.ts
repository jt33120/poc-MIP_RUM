// Les deux affirmations que le test unitaire ne PEUT PAS prouver, sur un vrai
// moteur PostgreSQL.
//
//   1. mip_seau() en SQL rend exactement le même index que seau() en TypeScript.
//      Le test unitaire compare les constantes et la forme écrite ; il ne peut
//      pas exécuter du SQL. Deux implémentations d'une même formule divergent
//      pour des raisons que la lecture ne montre pas — arrondi de `floor` sur un
//      `double precision`, `ln` de la libc contre `Math.log`.
//
//   2. La partition lecture/pré-agrégat est exacte. La console additionne les
//      seaux pré-agrégés sous la borne de rafraîchissement et recalcule le reste
//      à la volée ; si les deux morceaux se recouvraient, un percentile serait
//      tiré vers les valeurs comptées deux fois, et rien ne le signalerait.
//
// COMMENT L'EXÉCUTER. Ce fichier applique le schéma COMPLET : il lui faut une
// base JETABLE, jamais une base qui porte des données.
//
//   SQL_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/histo_test \
//     pnpm test:sql
//
// `--no-file-parallelism` (dans le script) n'est pas un confort : chaque fichier
// applique le schéma complet, et deux `create or replace function` simultanés sur
// la même base échouent avec « tuple concurrently updated ».
//
// Sans cette variable, la suite est SAUTÉE — et le dit, plutôt que de passer en
// vert sans avoir rien vérifié.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { percentileDepuisSeaux, seau } from "../../apps/console/lib/histogramme";

const URL_TEST = process.env.SQL_TEST_DATABASE_URL;
const RACINE = join(__dirname, "..", "..");
const SQL_DIR = join(RACINE, "apps", "ingest", "sql");

/** Le schéma puis TOUTES les migrations, dans l'ordre NUMÉRIQUE — `sort()`
 *  alphabétique placerait v10 avant v2 et casserait des dépendances. */
function fichiersSql(): string[] {
  const migrations = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return ["schema.sql", ...migrations].map((f) => join(SQL_DIR, f));
}

/** La requête de lecture de la console, extraite du module plutôt que recopiée :
 *  un test qui recopie le SQL vérifie sa propre copie. */
function sqlDeLaConsole(): string {
  const src = readFileSync(join(RACINE, "apps", "console", "lib", "queries-histogramme.ts"), "utf8");
  const debut = src.indexOf("const SQL = `") + "const SQL = `".length;
  return src.slice(debut, src.indexOf("`;", debut));
}

const c = new pg.Client(URL_TEST ? { connectionString: URL_TEST } : {});
const suite = URL_TEST ? describe : describe.skip;

if (!URL_TEST) {
  // Un `skip` silencieux se confond avec un succès dans un journal de CI.
  console.warn("[histogramme-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable) pour l'exécuter.");
}

// Connexion et schéma UNE fois pour tout le fichier : deux `beforeAll` de suite
// qui ouvrent puis ferment le même client se marchent dessus, et l'un des deux
// échoue sur un client déjà fermé — ce qui ressemble à un défaut du produit.
beforeAll(async () => {
  if (!URL_TEST) return;
  await c.connect();
  for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
}, 180_000);
afterAll(async () => {
  if (URL_TEST) await c.end();
});

suite("mip_seau() et seau() sur un vrai PostgreSQL", () => {
  it("rend le MÊME index de seau, valeur par valeur", async () => {
    // Couverture de toute l'échelle du produit — d'un CLS sous le plancher à un
    // TTFB de 30 s — plus les valeurs de BORD, celles qui tombent exactement sur
    // une frontière de seau et où un arrondi divergent se voit.
    const valeurs: number[] = [];
    for (let v = 0.0001; v < 40_000; v *= 1.017) valeurs.push(v);
    for (const idx of [1, 2, 137, 500, 900]) {
      const borne = 0.001 * 1.02 ** idx;
      valeurs.push(borne, borne * (1 - 1e-9), borne * (1 + 1e-9));
    }
    valeurs.push(0, 0.001, 0.0009999, 0.0010001, 2500, 30_000);

    const { rows } = await c.query<{ v: number; sql: number }>(
      "select v, mip_seau(v) as sql from unnest($1::float8[]) as v",
      [valeurs],
    );
    const divergences = rows
      .map((r) => ({ v: Number(r.v), sql: Number(r.sql), ts: seau(Number(r.v)) }))
      .filter((r) => r.sql !== r.ts);
    expect(divergences).toEqual([]);
    expect(rows.length).toBeGreaterThan(700);
  });

  it("range NULL dans le seau 0, comme le TypeScript range NaN", async () => {
    const { rows } = await c.query("select mip_seau(null) as s");
    expect(Number(rows[0].s)).toBe(0);
    expect(seau(NaN)).toBe(0);
  });
});

suite("la partition pré-agrégé / vif ne perd ni ne double aucune ligne", () => {
  const APP = "histo-app";

  beforeAll(async () => {
    await c.query("delete from rum_metric where app_id = $1", [APP]);
    await c.query("delete from rum_session where app_id = $1", [APP]);
    await c.query("delete from metric_histogram_hourly where app_id = $1", [APP]);

    // Trois sessions : une non échantillonnée (poids 1), une échantillonnée à
    // 10 % sans erreur (poids 10), une à 10 % AVEC erreur — dont le poids suit la
    // probabilité d'inclusion réelle, pas 1/sample_rate.
    const sessions: Array<[string, number, number, boolean, boolean]> = [
      ["h-plein", 1, 1, false, false],
      ["h-echant", 0.1, 1, false, false],
      ["h-erreur", 0.1, 1, true, false],
      ["h-robot", 1, 1, false, true],
    ];
    for (const [id, sr, esr, err, bot] of sessions) {
      await c.query(
        `insert into rum_session (session_id, app_id, device_type, sample_rate, error_sample_rate, has_error, is_bot)
         values ($1, $2, 'desktop', $3, $4, $5, $6)`,
        [id, APP, sr, esr, err, bot],
      );
    }
    const poidsDe = new Map<string, number>();
    for (const r of (await c.query<{ session_id: string; weight: number }>(
      "select session_id, weight from rum_session where app_id = $1",
      [APP],
    )).rows) {
      poidsDe.set(r.session_id, Number(r.weight));
    }

    // Des mesures ÉTALÉES sur 30 heures, y compris dans l'heure en cours et à
    // cheval sur les frontières d'heure — c'est là que la partition se casse.
    let i = 0;
    for (const [id] of sessions) {
      for (let h = 29; h >= 0; h--) {
        for (const [name, base] of [["LCP", 900], ["INP", 60]] as const) {
          const value = base * (1 + ((i * 37) % 61) / 20);
          await c.query(
            `insert into rum_metric (session_id, app_id, route, name, value, rating, ts)
             values ($1, $2, '/x', $3, $4, 'good', now() - make_interval(hours => $5, mins => $6))`,
            [id, APP, name, value, h, (i * 13) % 60],
          );
          i++;
        }
      }
    }

    // DANS L'HEURE PARTIELLE DU DÉBUT DE FENÊTRE. C'est le morceau que le
    // pré-agrégat ne couvre pas et que le calcul vif doit rattraper ; sans
    // mesure placée là exprès, retirer ce morceau de la requête ne changerait
    // rien et le test ne prouverait pas ce qu'il annonce.
    // Ancrés sur le DÉBUT D'HEURE et non sur la minute courante : la largeur de
    // cette heure partielle vaut 60 − minute(now), donc un offset « +1 minute »
    // tombe hors de la fenêtre 59 fois sur 60. Un offset de 59 min 59 s après le
    // début d'heure, lui, est TOUJOURS dans la fenêtre et TOUJOURS avant hb.
    for (const [k, offset] of [
      "59 minutes 59 seconds",
      "55 minutes",
      "40 minutes",
      "20 minutes",
      "3 minutes",
    ].entries()) {
      await c.query(
        `insert into rum_metric (session_id, app_id, route, name, value, rating, ts)
         values ('h-plein', $1, '/x', 'LCP', $2, 'good',
                 date_trunc('hour', now() - interval '24 hours') + $3::interval)`,
        [APP, 1500 + k, offset],
      );
    }

    // Le rafraîchissement horaire, PUIS des mesures qui décrivent une heure
    // qu'il vient d'agréger. C'est le cas du REJEU : après une coupure, la file
    // du SDK renvoie des mesures dont le `ts` a plusieurs heures. Sans la borne
    // d'identifiant, elles ne sont dans aucune des deux sources — invisibles
    // exactement après l'incident qu'on cherche à lire.
    //
    // Portées par la session échantillonnée (poids 10) et très au-dessus du
    // reste : leur absence DÉPLACE le p95, donc le test ci-dessous la voit.
    await c.query("select refresh_metric_histogram(48)");
    for (let k = 0; k < 20; k++) {
      await c.query(
        `insert into rum_metric (session_id, app_id, route, name, value, rating, ts)
         values ('h-echant', $1, '/x', 'LCP', $2, 'poor',
                 date_trunc('hour', now() - interval '5 hours') + make_interval(mins => $3))`,
        [APP, 25_000 + k, k],
      );
    }
  }, 180_000);

/**
 * Requête de RÉFÉRENCE : les lignes brutes de la fenêtre, sans partition, sans
 * pré-agrégat. Volontairement naïve — c'est ce qui en fait une référence.
 */
const SQL_REFERENCE = `
  select m.name, m.value, coalesce(s.weight, 1) as poids
    from rum_metric m left join rum_session s using (session_id)
   where m.app_id = $1 and m.ts >= now() - $2::interval
     and m.name = any($3::text[]) and not coalesce(s.is_bot, false)`;

  /**
   * Lit les seaux de la console ET la référence DANS LA MÊME TRANSACTION.
   *
   * Ce n'est pas un détail : `now()` vaut l'instant de DÉBUT DE TRANSACTION, donc
   * les deux requêtes découpent la fenêtre au même endroit. Exécutées séparément,
   * elles seraient distantes de quelques millisecondes et une ligne posée près du
   * bord entrerait dans l'une et pas dans l'autre — l'écart serait imputé à la
   * partition alors qu'il viendrait de l'horloge.
   */
  async function lireEnsemble(interval: string, noms: string[]) {
    await c.query("begin");
    try {
      const lus = (
        await c.query<{ name: string; bucket: number; weighted_count: number }>(sqlDeLaConsole(), [APP, interval, noms])
      ).rows.map((r) => ({ name: r.name, bucket: Number(r.bucket), weighted_count: Number(r.weighted_count) }));
      const brut = (
        await c.query<{ name: string; value: number; poids: number }>(SQL_REFERENCE, [APP, interval, noms])
      ).rows.map((r) => ({ name: r.name, value: Number(r.value), poids: Number(r.poids) }));
      return { lus, brut };
    } finally {
      await c.query("commit");
    }
  }

  it("additionne EXACTEMENT le poids semé, ni plus ni moins", async () => {
    // L'assertion qui attrape à la fois le trou et le recouvrement : un trou
    // baisse la somme, un recouvrement la monte. Δ=0 exclut les deux.
    const { lus, brut } = await lireEnsemble("24 hours", ["LCP", "INP"]);
    for (const nom of ["LCP", "INP"]) {
      const somme = lus.filter((r) => r.name === nom).reduce((s, r) => s + r.weighted_count, 0);
      const cible = brut.filter((a) => a.name === nom).reduce((s, a) => s + a.poids, 0);
      expect(somme).toBeCloseTo(cible, 6);
    }
    // Anti-tautologie : deux zéros seraient « égaux » sans rien prouver.
    expect(brut.length).toBeGreaterThan(100);
  });

  it("rend le même percentile que le calcul direct sur les lignes brutes", async () => {
    // Même découpage des deux côtés, donc ÉGALITÉ stricte attendue — pas une
    // tolérance. Une tolérance masquerait exactement le défaut qu'on cherche.
    const { lus, brut } = await lireEnsemble("24 hours", ["LCP"]);
    const direct = new Map<number, number>();
    for (const a of brut) {
      direct.set(seau(a.value), (direct.get(seau(a.value)) ?? 0) + a.poids);
    }
    const attenduP75 = percentileDepuisSeaux(
      [...direct].map(([bucket, weighted_count]) => ({ bucket, weighted_count })),
      0.75,
    );
    expect(percentileDepuisSeaux(lus.filter((r) => r.name === "LCP"), 0.75)).toBe(attenduP75);
  });

  it("VOIT les mesures arrivées depuis le dernier rafraîchissement", async () => {
    // Anti-tautologie du test précédent : si la lecture se contentait des seaux
    // pré-agrégés, le p95 serait celui d'AVANT le rejeu. On vérifie que le
    // pré-agrégat seul donne une autre réponse — donc que le calcul vif sert, et
    // qu'il sert précisément pour des mesures dont le `ts` est ancien.
    const { lus } = await lireEnsemble("24 hours", ["LCP"]);
    const { rows } = await c.query<{ bucket: number; weighted_count: number }>(
      `select bucket, sum(weighted_count)::float8 as weighted_count from metric_histogram_hourly
        where app_id = $1 and name = 'LCP' and hour > now() - interval '24 hours' group by 1`,
      [APP],
    );
    const seulPre = percentileDepuisSeaux(
      rows.map((r) => ({ bucket: Number(r.bucket), weighted_count: Number(r.weighted_count) })),
      0.95,
    );
    const complet = percentileDepuisSeaux(lus.filter((r) => r.name === "LCP"), 0.95);
    expect(complet).not.toBe(seulPre);
    expect(complet!).toBeGreaterThan(seulPre!);
  });

  it("exclut les robots des deux côtés de la partition", async () => {
    // Semés avec les autres, ils ne doivent apparaître NULLE PART — ni dans les
    // seaux pré-agrégés, ni dans le calcul vif. Le marqueur : leur poids n'entre
    // pas dans la somme vérifiée plus haut, qui est exacte à 1e-6 près.
    const { rows } = await c.query<{ n: number }>(
      "select count(*)::int as n from rum_metric where app_id = $1 and session_id = 'h-robot'",
      [APP],
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);
    const { lus, brut } = await lireEnsemble("24 hours", ["LCP", "INP"]);
    const total = lus.reduce((s, r) => s + r.weighted_count, 0);
    // Le poids du robot, s'il entrait quelque part, ferait dépasser la référence
    // — qui, elle, l'exclut explicitement.
    expect(total).toBeCloseTo(brut.reduce((s, a) => s + a.poids, 0), 6);
  });
});
