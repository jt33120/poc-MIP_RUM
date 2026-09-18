// P6.6 — la lecture hybride agrégat + brut, exécutée sur PostgreSQL.
//
// Les tests unitaires prouvent la RÈGLE (quel agrégat a le droit de répondre) et
// l'ARITHMÉTIQUE (fusionner puis calculer le quantile). Seul PostgreSQL prouve
// que les deux branches partitionnent réellement la fenêtre. La recette :
//
//   · hybride et brut rendent le MÊME percentile, à la largeur de seau près, et
//     `meta.source` dit laquelle des deux sources a répondu ;
//   · l'heure EN COURS n'est comptée qu'une fois — un double comptage se verrait
//     immédiatement sur l'effectif ;
//   · une mesure ARRIVÉE EN RETARD dans une heure déjà agrégée est comptée une
//     fois, et une seule, grâce au filigrane d'identifiant ;
//   · un effacement DSAR invalide l'heure : l'agrégat cesse d'être cru, le brut
//     reprend, et le compte redevient juste sans recalcul massif ;
//   · une cellule antérieure à v80 (`observed_count = 0`) fait retomber son heure
//     sur le brut, au lieu de compter zéro ;
//   · une dimension que l'agrégat ne porte pas le disqualifie, avec sa raison ;
//   · le budget est posé en `SET LOCAL` et ne fuit pas vers la requête suivante
//     du même pool ;
//   · sur une base restée en v79, la lecture reste brute et le dit.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_V68_DATABASE_URL=<autre base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseExplorerQuery, type ExplorerRequest } from "../../apps/console/lib/analytics-schema";
import { GAMMA } from "../../apps/console/lib/histogramme";
import type { ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlFenetre = process.env.SQL_TEST_V68_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

const A = "p66-app-a";
const B = "p66-app-b";
/** App dédiée au budget : assez de lignes pour qu'un délai d'une milliseconde expire. */
const LOURD = "p66-app-lourd";
const LIGNES_LOURD = 20_000;
const FENETRE = "p66-fenetre-v79";
const APPS = [A, B, LOURD];
const ADMIN: ScopePrincipal = { role: "admin", apps: null };

/** Tolérance d'un percentile lu sur des seaux de 2 % : une largeur de seau. */
const TOLERANCE = GAMMA - 1;

function migrations(maxVersion = Number.POSITIVE_INFINITY): string[] {
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f) && Number(f.match(/\d+/)![0]) <= maxVersion)
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))]
    .map((f) => join(SQL_DIR, f));
}

/** Modules console branchés sur la base jetable (cf. analytics-explorer-sql). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  // UNE seule connexion : sans cela, la vérification du budget transactionnel
  // interrogerait une connexion neuve, où `statement_timeout` vaut 0 quoi qu'il
  // arrive — un test qui passerait sans rien prouver.
  process.env.PGPOOL_MAX = "1";
  const explorer = await import("../../apps/console/lib/queries-explorer");
  const schema = await import("../../apps/console/lib/query-schema");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...explorer, ...schema, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const hex = (prefixe: string, i: number) => (prefixe + i.toString(16).padStart(4, "0")).padEnd(16, "0");

(url ? describe : describe.skip)("Agrégats et lecture hybride P6.6 sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;
  /** Début de l'heure en cours : la frontière que l'agrégat ne franchit jamais. */
  let heureEnCours: Date;
  let compteur = 0;

  /** Requête validée, sur une fenêtre de 24 h qui englobe tout le semis. */
  function requete(ast: Record<string, unknown>, principal: ScopePrincipal = ADMIN): ExplorerRequest {
    const parsed = parseExplorerQuery(
      { version: 1, app: A, range: { preset: "24h" }, ...ast },
      { principal, nowMs: Date.now() },
    );
    if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
    return parsed.value;
  }

  const lcp = (ast: Record<string, unknown> = {}) =>
    requete({ dataset: "vitals", measure: { aggregation: "p75", field: "value" }, variant: "LCP", ...ast });

  /**
   * Percentile de référence, lu sur les lignes brutes, robots exclus.
   *
   * `disc` (défaut) pour comparer au chemin AGRÉGAT : une distribution en seaux
   * rend toujours une valeur observée, jamais une interpolation entre deux
   * mesures. `cont` pour comparer au chemin BRUT, qui emploie `percentile_cont`.
   * Confondre les deux définitions mesurerait leur écart, pas l'erreur du
   * découpage en seaux — la seule que ce lot borne.
   */
  async function exact(app: string, definition: "disc" | "cont" = "disc", p = 0.75): Promise<{ valeur: number | null; lignes: number }> {
    const { rows } = await c.query<{ valeur: string | null; lignes: string }>(
      `select percentile_${definition === "disc" ? "disc" : "cont"}($2) within group (order by m.value) as valeur,
              count(*)::bigint as lignes
         from rum_metric m
         left join rum_session s on s.app_id = m.app_id and s.session_id = m.session_id
        where m.app_id = $1 and m.name = 'LCP' and not coalesce(s.is_bot, false)
          and m.ts >= now() - interval '24 hours' and m.ts < now()`,
      [app, p],
    );
    return { valeur: rows[0].valeur === null ? null : Number(rows[0].valeur), lignes: Number(rows[0].lignes) };
  }

  /** Une mesure LCP, à un instant donné, sur une session donnée. */
  async function mesurer(app: string, session: string, valeur: number, ts: Date): Promise<void> {
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       values ($1, $2, $3, '/p66', 'LCP', $4, 'good', $5)`,
      [hex("aa", ++compteur), session, app, valeur, ts],
    );
  }

  async function nettoyer(): Promise<void> {
    for (const table of ["analytics_rollup_invalidation", "metric_histogram_hourly", "rum_metric", "rum_session", "app_registry"]) {
      await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
    }
    await c.query("delete from metric_histogram_state");
  }

  beforeAll(async () => {
    await c.connect();
    for (const file of migrations()) await c.query(readFileSync(file, "utf8"));
    await nettoyer();

    const { rows } = await c.query<{ h: Date }>("select date_trunc('hour', now()) as h");
    heureEnCours = rows[0].h;

    await c.query(
      `insert into app_registry (app_id, name, active, internal)
       values ($1, 'A', true, false), ($2, 'B', true, false), ($3, 'Lourd', true, false)
       on conflict (app_id) do update set active = true, internal = excluded.internal`,
      [A, B, LOURD],
    );
    const sessions: [string, string, boolean, string][] = [
      ["p66-a-1", A, false, "desktop"],
      ["p66-a-2", A, false, "mobile"],
      ["p66-a-dsar", A, false, "desktop"],
      ["p66-a-robot", A, true, "desktop"],
      ["p66-b-1", B, false, "desktop"],
      ["p66-lourd-1", LOURD, false, "desktop"],
    ];
    for (const [id, app, bot, appareil] of sessions) {
      await c.query(
        `insert into rum_session (session_id, app_id, device_type, is_bot, geo_country, collection_source, started_at, last_seen_at, sample_rate, error_sample_rate, browser)
         values ($1, $2, $3, $4, 'FR', 'sdk', now() - interval '20 hours', now(), 1, 1, 'Chrome')`,
        [id, app, appareil, bot],
      );
    }

    // Trois heures ENTIÈRES révolues, puis l'heure en cours. Les valeurs sont
    // distinctes et croissantes : un double comptage déplacerait le percentile.
    const heure = (n: number) => new Date(heureEnCours.getTime() - n * 3_600_000 + 60_000);
    for (const [i, valeur] of [1000, 1100, 1200, 1300, 1400, 1500].entries()) {
      await mesurer(A, i % 2 === 0 ? "p66-a-1" : "p66-a-2", valeur, heure(3 - Math.floor(i / 2)));
    }
    // La session qui sera effacée : deux mesures très hautes, dans l'heure -3.
    await mesurer(A, "p66-a-dsar", 9000, heure(3));
    await mesurer(A, "p66-a-dsar", 9500, heure(3));
    // Bruit qui ne doit jamais entrer : une autre app, un robot.
    await mesurer(B, "p66-b-1", 4000, heure(2));
    await mesurer(A, "p66-a-robot", 8000, heure(2));
    // L'heure EN COURS, jamais agrégée.
    await mesurer(A, "p66-a-1", 1600, new Date(heureEnCours.getTime() + 60_000));

    await c.query("select refresh_metric_histogram(26)");

    // APRÈS le rafraîchissement : ces lignes restent brutes, et donnent au test
    // du budget une lecture qu'une milliseconde ne peut pas terminer. Bornées et
    // écrites en une instruction : la CI n'y passe pas plus d'une seconde.
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       select lpad(to_hex(1000000 + i), 16, '0'), 'p66-lourd-1', $1, '/p66', 'LCP',
              500 + (i % 4000), 'good', now() - make_interval(secs => (i % 3000))
         from generate_series(1, $2) i`,
      [LOURD, LIGNES_LOURD],
    );

    lib = await consoleSur(url!);
  }, 300_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer();
    await c.end();
  });

  it("l'agrégat a bien été rempli, avec son compte observé", async () => {
    const { rows } = await c.query<{ cellules: string; observees: string }>(
      `select count(*)::bigint as cellules, coalesce(sum(observed_count), 0)::bigint as observees
         from metric_histogram_hourly where app_id = $1 and name = 'LCP'`,
      [A],
    );
    expect(Number(rows[0].cellules)).toBeGreaterThan(0);
    // Les neuf mesures non robots de l'app A, robot exclu. La neuvième est celle
    // de l'heure EN COURS : le rafraîchissement l'écrit dans la cellule de cette
    // heure — c'est la LECTURE qui refuse de croire une heure non terminée.
    expect(Number(rows[0].observees)).toBe(9);
  });

  it("hybride et brut rendent le même p75, et meta le dit sans le cacher", async () => {
    const reference = await exact(A);
    const resultat = await lib.exploreAnalytics(lcp());
    expect(resultat.meta.source).toBe("rollup+raw");
    expect(resultat.meta.approximate).toBe(true);
    expect(resultat.meta.rollup).toEqual({ eligible: true, source: "vitals_histogram", reason: null });
    expect(resultat.meta.warnings.some((w) => /seaux/.test(w))).toBe(true);
    expect(resultat.data.total).not.toBeNull();
    expect(Math.abs(resultat.data.total! - reference.valeur!) / reference.valeur!).toBeLessThan(TOLERANCE);
  });

  it("l'heure EN COURS est comptée une fois : l'effectif vaut celui des lignes", async () => {
    const reference = await exact(A);
    const resultat = await lib.exploreAnalytics(lcp());
    // 9 mesures : 6 régulières + 2 de la session DSAR + celle de l'heure en cours.
    expect(reference.lignes).toBe(9);
    expect(resultat.data.samples).toBe(reference.lignes);
  });

  it("isole les apps et exclut les robots des DEUX branches", async () => {
    const autre = await lib.exploreAnalytics(lcp({ app: B }));
    const referenceB = await exact(B);
    expect(autre.data.samples).toBe(referenceB.lignes);
    expect(autre.data.samples).toBe(1);
    // Le robot de l'app A n'entre ni dans l'agrégat ni dans le rattrapage brut.
    expect((await lib.exploreAnalytics(lcp())).data.samples).toBe(9);
  });

  it("une mesure arrivée EN RETARD dans une heure déjà agrégée est comptée une fois", async () => {
    const avant = await lib.exploreAnalytics(lcp());
    // `ts` ancien, identifiant récent : le filigrane d'identifiant la sépare.
    await mesurer(A, "p66-a-1", 1250, new Date(heureEnCours.getTime() - 2 * 3_600_000 + 120_000));
    const apres = await lib.exploreAnalytics(lcp());
    expect(apres.data.samples).toBe(avant.data.samples + 1);
    expect(apres.data.samples).toBe((await exact(A)).lignes);
    // Un second rafraîchissement l'absorbe dans l'agrégat, sans la dupliquer.
    await c.query("select refresh_metric_histogram(26)");
    const consolide = await lib.exploreAnalytics(lcp());
    expect(consolide.data.samples).toBe(apres.data.samples);
  });

  it("un effacement DSAR invalide l'heure : l'agrégat n'est plus cru, le brut reprend", async () => {
    const avant = await lib.exploreAnalytics(lcp());
    const efface = await c.query<{ erase_session: { rum_metric: number } }>("select erase_session($1)", ["p66-a-dsar"]);
    expect(efface.rows[0].erase_session.rum_metric).toBe(2);

    // La cellule d'agrégat EXISTE toujours et contient encore les mesures
    // effacées : c'est précisément pourquoi une marque, et non une suppression.
    const { rows: cellules } = await c.query<{ n: string }>(
      `select coalesce(sum(observed_count), 0)::bigint as n from metric_histogram_hourly where app_id = $1`,
      [A],
    );
    expect(Number(cellules[0].n)).toBeGreaterThan(0);
    // P8.1 : les DEUX projections horaires sont faussées par l'effacement —
    // l'histogramme des vitals, lu par l'Explorer, et la heatmap `rum_rollup_hourly`,
    // lue par le tableau de bord. Marquer la première seulement laissait la
    // seconde afficher indéfiniment l'effectif d'une personne effacée.
    const { rows: marques } = await c.query<{ source: string; reason: string }>(
      "select source, reason from analytics_rollup_invalidation where app_id = $1 order by source",
      [A],
    );
    expect(marques).toEqual([
      { source: "metric_histogram_hourly", reason: "dsar" },
      { source: "rum_rollup_hourly", reason: "dsar" },
    ]);

    const reference = await exact(A);
    const apres = await lib.exploreAnalytics(lcp());
    expect(apres.data.samples).toBe(reference.lignes);
    expect(Math.abs(apres.data.total! - reference.valeur!) / reference.valeur!).toBeLessThan(TOLERANCE);
    // Les deux mesures effacées ont réellement quitté la mesure : retirer deux
    // valeurs hautes abaisse le percentile, il ne le laisse pas inchangé.
    expect(apres.data.total!).toBeLessThan(avant.data.total!);

    // Un rafraîchissement recalcule l'heure et lève la marque : le résultat ne
    // change pas, seul le chemin le fait. Chaque projection lève SA marque —
    // une marque qu'aucun rafraîchissement ne recalcule ne serait pas une
    // sécurité, seulement une dette.
    await c.query("select refresh_metric_histogram(26)");
    await c.query("select refresh_rum_rollups(26)");
    const { rows: restantes } = await c.query<{ n: string }>(
      "select count(*)::bigint as n from analytics_rollup_invalidation where app_id = $1",
      [A],
    );
    expect(Number(restantes[0].n)).toBe(0);
    const recalcule = await lib.exploreAnalytics(lcp());
    expect(recalcule.data.samples).toBe(reference.lignes);
    expect(recalcule.data.total).toBeCloseTo(apres.data.total!, 6);
  });

  it("une cellule antérieure à v80 fait retomber son heure sur le brut, pas sur zéro", async () => {
    const reference = await exact(A);
    // Exactement ce qu'une base migrée puis jamais rafraîchie porterait.
    await c.query("update metric_histogram_hourly set observed_count = 0 where app_id = $1", [A]);
    const resultat = await lib.exploreAnalytics(lcp());
    expect(resultat.meta.source).toBe("raw");
    // La valeur reste ANNONCÉE approchée : la branche brute de la lecture hybride
    // range elle aussi ses mesures en seaux, pour être fusionnable avec l'autre.
    expect(resultat.meta.approximate).toBe(true);
    expect(resultat.data.samples).toBe(reference.lignes);
    expect(Math.abs(resultat.data.total! - reference.valeur!) / reference.valeur!).toBeLessThan(TOLERANCE);
    await c.query("select refresh_metric_histogram(26)");
    expect((await lib.exploreAnalytics(lcp())).meta.source).toBe("rollup+raw");
  });

  it("le regroupement par appareil se lit sur l'agrégat, et compte comme le brut", async () => {
    const resultat = await lib.exploreAnalytics(lcp({ visualization: "toplist", groupBy: ["device"], limit: 10 }));
    expect(resultat.meta.source).toBe("rollup+raw");
    const { rows } = await c.query<{ device_type: string; n: string }>(
      `select s.device_type, count(*)::bigint as n
         from rum_metric m join rum_session s on s.app_id = m.app_id and s.session_id = m.session_id
        where m.app_id = $1 and m.name = 'LCP' and not s.is_bot and m.ts >= now() - interval '24 hours'
        group by 1`,
      [A],
    );
    const attendu = new Map(rows.map((r) => [r.device_type, Number(r.n)]));
    expect(resultat.data.groups.length).toBe(attendu.size);
    for (const groupe of resultat.data.groups) {
      expect(groupe.samples, String(groupe.key[0])).toBe(attendu.get(groupe.key[0] as string));
    }
    // Le total porte sur toute la population, pas sur la somme des groupes.
    expect(resultat.data.samples).toBe([...attendu.values()].reduce((s, n) => s + n, 0));
  });

  it("une dimension hors de l'agrégat le disqualifie, avec sa raison, sans changer la valeur", async () => {
    const reference = await exact(A, "cont");
    const parNavigateur = await lib.exploreAnalytics(
      lcp({ filters: [{ field: "browser", operator: "eq", type: "string", value: "Chrome" }] }),
    );
    expect(parNavigateur.meta.source).toBe("raw");
    expect(parNavigateur.meta.approximate).toBe(false);
    expect(parNavigateur.meta.rollup.eligible).toBe(false);
    expect(parNavigateur.meta.rollup.reason).toMatch(/browser/);
    // Chrome est le navigateur de toutes les sessions semées : même population.
    expect(parNavigateur.data.samples).toBe(reference.lignes);
    // Et la valeur brute est EXACTE, non approchée.
    expect(parNavigateur.data.total).toBeCloseTo(reference.valeur!, 6);
  });

  it("un dénombrement de distincts ne passe jamais par un agrégat", async () => {
    const sessions = await lib.exploreAnalytics(
      requete({ dataset: "vitals", variant: "LCP", measure: { aggregation: "distinct", field: "sessions" } }),
    );
    expect(sessions.meta.source).toBe("raw");
    expect(sessions.meta.rollup.eligible).toBe(false);
    const { rows } = await c.query<{ n: string }>(
      `select count(distinct m.session_id)::bigint as n from rum_metric m
         join rum_session s on s.app_id = m.app_id and s.session_id = m.session_id
        where m.app_id = $1 and m.name = 'LCP' and not s.is_bot and m.ts >= now() - interval '24 hours'`,
      [A],
    );
    expect(sessions.data.total).toBe(Number(rows[0].n));
  });

  it("le budget est transactionnel : il ne fuit pas vers la requête suivante du pool", async () => {
    // Une lecture de 20 000 lignes qu'une milliseconde ne peut pas terminer :
    // l'instruction est interrompue et rendue en `query_budget_exceeded`, jamais
    // en série de zéros.
    const lourd = lcp({ app: LOURD });
    await expect(lib.exploreAnalytics(lourd, { timeoutMs: 1 })).rejects.toMatchObject({
      name: "ExplorerBudgetError",
      code: "query_budget_exceeded",
    });
    // La connexion est rendue au pool. `PGPOOL_MAX = 1` garantit que c'est LA
    // même : si le budget avait été posé en session, il serait encore là — c'est
    // exactement ce qu'un pooler en mode transaction propagerait.
    for (let i = 0; i < 4; i++) {
      const { rows } = await lib.pool.query<{ statement_timeout: string }>("show statement_timeout");
      expect(rows[0].statement_timeout).toBe("0");
    }
    // Et la lecture suivante aboutit avec le budget normal.
    expect((await lib.exploreAnalytics(lourd)).data.total).not.toBeNull();
  });

  it("la purge et l'effacement d'app emportent les marques d'invalidation", async () => {
    await c.query(
      `insert into analytics_rollup_invalidation (source, app_id, hour, reason)
       values ('metric_histogram_hourly', $1, date_trunc('hour', now() - interval '40 hours'), 'dsar'),
              ('metric_histogram_hourly', $2, date_trunc('hour', now() - interval '40 hours'), 'dsar')`,
      [A, B],
    );
    const purge = await c.query<{ purge_rum_app: Record<string, number> }>("select purge_rum_app($1, $2)", [
      A,
      new Date(Date.now() - 30 * 3_600_000),
    ]);
    expect(purge.rows[0].purge_rum_app.analytics_rollup_invalidation).toBe(1);

    const efface = await c.query<{ erase_app_data: Record<string, number> }>("select erase_app_data($1)", [B]);
    expect(efface.rows[0].erase_app_data.analytics_rollup_invalidation).toBe(1);
    const { rows } = await c.query<{ n: string }>(
      "select count(*)::bigint as n from analytics_rollup_invalidation where app_id = any($1::text[])",
      [APPS],
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});

(urlFenetre ? describe : describe.skip)("fenêtre de déploiement : code P6.6 sur une base restée en v79", () => {
  const c = new pg.Client(urlFenetre ? { connectionString: urlFenetre } : {});
  let lib: Console;

  beforeAll(async () => {
    await c.connect();
    // Repartir d'un schéma vide : un passage précédent a pu y appliquer v80.
    await c.query("drop schema public cascade; create schema public;");
    for (const file of migrations(79)) await c.query(readFileSync(file, "utf8"));
    await c.query(
      `insert into app_registry (app_id, name, active, internal) values ($1, 'Fenêtre', true, false)
       on conflict (app_id) do nothing`,
      [FENETRE],
    );
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, collection_source, started_at, last_seen_at, sample_rate, error_sample_rate)
       values ('p66-f-1', $1, 'desktop', false, 'sdk', now() - interval '3 hours', now(), 1, 1)`,
      [FENETRE],
    );
    for (const [i, valeur] of [900, 1000, 1100, 1200].entries()) {
      await c.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         values ($1, 'p66-f-1', $2, '/p66', 'LCP', $3, 'good', now() - interval '90 minutes')`,
        [(`ff${i}`).padEnd(16, "0"), FENETRE, valeur],
      );
    }
    lib = await consoleSur(urlFenetre!);
  }, 300_000);

  afterAll(async () => {
    await lib?.pool.end();
    await c.end();
  });

  it("sans les colonnes de v80, la lecture reste brute et EXACTE, puis bascule dès la migration", async () => {
    const demande = parseExplorerQuery(
      {
        version: 1,
        app: FENETRE,
        range: { preset: "24h" },
        dataset: "vitals",
        variant: "LCP",
        measure: { aggregation: "p75", field: "value" },
      },
      { principal: ADMIN, nowMs: Date.now() },
    );
    if (!demande.ok) throw new Error(demande.error.message);

    const avant = await lib.exploreAnalytics(demande.value);
    expect(avant.meta.source).toBe("raw");
    expect(avant.meta.rollup).toEqual({ eligible: false, source: "vitals_histogram", reason: expect.stringMatching(/v80/) });
    // 900, 1000, 1100, 1200 : `percentile_cont` du chemin brut interpole et rend
    // 1125, une valeur qu'aucune mesure n'a portée. C'est sa définition, et elle
    // reste celle du brut ; l'agrégat, lui, rendra une valeur observée.
    expect(avant.data.total).toBeCloseTo(1125, 6);
    expect(avant.data.samples).toBe(4);

    await c.query(readFileSync(join(SQL_DIR, "migration-v80.sql"), "utf8"));
    await c.query("select refresh_metric_histogram(26)");
    // La sonde de schéma a une mémoire de 5 s : la vider est ce que fait un
    // redémarrage, et ce que le test doit simuler sans attendre.
    lib.forgetDimensionSchema();

    const apres = await lib.exploreAnalytics(demande.value);
    expect(apres.meta.source).toBe("rollup+raw");
    expect(apres.meta.rollup).toEqual({ eligible: true, source: "vitals_histogram", reason: null });
    expect(apres.data.samples).toBe(4);
    // Le percentile de rang de ces quatre valeurs est 1100 : l'agrégat s'en
    // approche à une largeur de seau près, et ne prétend pas mieux.
    expect(Math.abs(apres.data.total! - 1100) / 1100).toBeLessThan(GAMMA - 1);
  });
});
