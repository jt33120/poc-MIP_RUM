// F65 — les lectures quotidiennes de /forecast (lib/queries-grid.ts), prouvées sur
// PostgreSQL : 14 jours COMPLETS dans le fuseau de l'app, aujourd'hui exclu.
//
// Pourquoi une base réelle. Ce qui compte se joue dans `at time zone` : le premier
// jour doit commencer à SON minuit local (l'ancienne borne, `now() − 14 jours` à
// l'heure près, le coupait en deux), la journée en cours doit sortir, et un jour
// sans mesure doit rester une ligne (`p75: null`, `n: 0`) — pas disparaître, sans
// quoi un graphe relie deux jours séparés par un trou. Sans l'option, la Vue
// d'ensemble garde sa fenêtre d'avant (aujourd'hui compris).
//
// Base jetable : SQL_TEST_DATABASE_URL (schéma courant appliqué ici).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Filters } from "../../apps/console/lib/filters";
import { cleJour } from "../../apps/console/lib/forecast";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const A = "f65-grille-a";
const B = "f65-grille-b";
const APPS = [A, B];
const TZ = "Europe/Paris";
/** Jour local sans aucune mesure ni page vue : il doit rester une ligne. */
const JOUR_VIDE = 5;

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(c: pg.Client): Promise<void> {
  for (const table of ["rum_metric", "rum_pageview", "rum_error", "rum_session", "app_registry"])
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
}

/** Instant « jour local J−k, à hh:mm locale » — calculé par PostgreSQL, comme la lecture. */
const aLocale = (k: number, heure: string) =>
  `((date_trunc('day', now() at time zone '${TZ}') - interval '${k} days' + interval '${heure}') at time zone '${TZ}')`;

async function semer(c: pg.Client): Promise<void> {
  await c.query("begin");
  try {
    await c.query(
      `insert into app_registry (app_id, name, active, internal, timezone)
       select app, app, true, false, $2 from unnest($1::text[]) as app
       on conflict (app_id) do update set active = true, internal = false, timezone = excluded.timezone`,
      [APPS, TZ],
    );
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, sample_rate, error_sample_rate, started_at, last_seen_at)
       values ('f65-sa', $1, 'desktop', false, 1, 1, now() - interval '20 days', now()),
              ('f65-sb', $2, 'desktop', false, 1, 1, now() - interval '20 days', now())`,
      [A, B],
    );
    let id = 0;
    const lcp = async (app: string, session: string, quand: string, valeur: number) =>
      c.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         values ($1, $2, $3, '/', 'LCP', $4, 'good', ${quand})`,
        [`f65-m-${++id}`, session, app, valeur],
      );
    const vue = async (quand: string) =>
      c.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, 'f65-sa', $2, '/', ${quand})`,
        [`f65-p-${++id}`, A],
      );
    const erreur = async (quand: string, occurrences: number) =>
      c.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, occurrences, ts)
         values ($1, 'f65-sa', $2, '/', 'error', 'f65', $3, ${quand})`,
        [`f65-e-${++id}`, A, occurrences],
      );

    // J−1 … J−14 : trois mesures à midi local (valeurs 1 000 + 10k, +100, +200), deux
    // pages vues, une ligne d'erreur de 3 occurrences ; sauf le jour vide.
    for (let k = 1; k <= 14; k++) {
      if (k === JOUR_VIDE) continue;
      for (const d of [0, 100, 200]) await lcp(A, "f65-sa", aLocale(k, "12 hours"), 1000 + 10 * k + d);
      await vue(aLocale(k, "12 hours"));
      await vue(aLocale(k, "13 hours"));
      await erreur(aLocale(k, "12 hours"), 3);
    }
    // Premier jour : une mesure à 00:30 locale, qui ouvre la journée. Complet, il la compte.
    await lcp(A, "f65-sa", aLocale(14, "30 minutes"), 5000);
    // Veille de la fenêtre (J−15, 23:30 locale) : jamais lue.
    await lcp(A, "f65-sa", aLocale(15, "23 hours 30 minutes"), 9000);
    await vue(aLocale(15, "23 hours 30 minutes"));
    // Aujourd'hui (journée entamée), une minute avant maintenant — jamais dans le futur.
    const aujourdhui = `greatest(${aLocale(0, "0 seconds")}, now() - interval '1 minute')`;
    await lcp(A, "f65-sa", aujourdhui, 7000);
    await vue(aujourdhui);
    // Autre app, même jour : n'entre pas dans les comptes de A.
    await lcp(B, "f65-sb", aLocale(3, "12 hours"), 8000);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const grille = await import("../../apps/console/lib/queries-grid");
  const comparaison = await import("../../apps/console/lib/forecast-comparaison");
  const { queryOf } = await import("../../apps/console/lib/filters");
  const { oublierFuseaux } = await import("../../apps/console/lib/fuseau");
  const { pool } = await import("../../apps/console/lib/db");
  oublierFuseaux();
  return { ...grille, ...comparaison, queryOf, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const filtres = (app = A): Filters => ({
  app,
  period: "24h",
  device: null,
  segment: [],
  includeBots: false,
  includeInternal: false,
});

(url ? describe : describe.skip)("lectures quotidiennes F65 sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;
  /** Jours locaux attendus, du plus ancien au plus récent : J−14 … J (lus par PostgreSQL, même horloge). */
  let jours: string[];

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyer(c);
    await semer(c);
    const { rows } = await c.query<{ jour: string }>(
      `select to_char(date_trunc('day', now() at time zone $1) - k * interval '1 day', 'YYYY-MM-DD') as jour
         from generate_series(14, 0, -1) as k order by k desc`,
      [TZ],
    );
    jours = rows.map((r) => r.jour);
    lib = await consoleSur(url!);
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  describe("dailyLcpSeries(f, { exclureAujourdhui: true }) — fenêtre des Tendances", () => {
    it("14 lignes, de J−14 à J−1 : aujourd'hui exclu, la veille de la fenêtre aussi", async () => {
      const lignes = await lib.dailyLcpSeries(filtres(), { exclureAujourdhui: true });
      expect(lignes.map((l) => l.jour)).toEqual(jours.slice(0, 14));
      expect(lignes.some((l) => l.p75 === 9000 || l.p75 === 7000)).toBe(false);
    });

    it("jour sans mesure : une ligne, p75 null et n = 0 — jamais absente, jamais 0 ms", async () => {
      const lignes = await lib.dailyLcpSeries(filtres(), { exclureAujourdhui: true });
      expect(lignes[14 - JOUR_VIDE]).toEqual({ jour: jours[14 - JOUR_VIDE], p75: null, n: 0 });
    });

    it("p75 et effectif du jour ; le premier jour est complet (sa mesure de 00:30 comptée)", async () => {
      const lignes = await lib.dailyLcpSeries(filtres(), { exclureAujourdhui: true });
      // J−1 : 1 010, 1 110, 1 210 → p75 = 1 160.
      expect(lignes[13]).toEqual({ jour: jours[13], p75: 1160, n: 3 });
      expect(lignes[0].n).toBe(4);
      // Le jour texte, pas un Date à minuit du serveur (piège n° 4).
      expect(typeof lignes[0].jour).toBe("string");
    });

    it("périmètre : B ne voit que sa mesure, A n'hérite pas de celle de B", async () => {
      const b = await lib.dailyLcpSeries(filtres(B), { exclureAujourdhui: true });
      expect(b.reduce((s, l) => s + l.n, 0)).toBe(1);
      const a = await lib.dailyLcpSeries(filtres(), { exclureAujourdhui: true });
      expect(a[11].n).toBe(3); // J−3 : trois mesures de A, pas quatre
    });
  });

  describe("sans l'option : la fenêtre d'avant, pour la Vue d'ensemble", () => {
    it("dailyLcpSeries(f) : J−13 … J, aujourd'hui compris", async () => {
      const lignes = await lib.dailyLcpSeries(filtres());
      expect(lignes.map((l) => l.jour)).toEqual(jours.slice(1));
      expect(lignes[13]).toMatchObject({ jour: jours[14], p75: 7000, n: 1 });
    });

    it("dailyTraffic(f) : 14 jours dont aujourd'hui", async () => {
      const lignes = await lib.dailyTraffic(filtres());
      expect(lignes.map((l) => cleJour(l.day))).toEqual(jours.slice(1));
      expect(lignes[13].pageviews).toBe(1);
    });
  });

  describe("dailyTraffic(f, { exclureAujourdhui: true })", () => {
    it("14 jours complets, jours vides à 0, occurrences sommées (V1)", async () => {
      const lignes = await lib.dailyTraffic(filtres(), { exclureAujourdhui: true });
      expect(lignes.map((l) => cleJour(l.day))).toEqual(jours.slice(0, 14));
      expect(lignes[13]).toMatchObject({ pageviews: 2, errors: 3 });
      expect(lignes[14 - JOUR_VIDE]).toMatchObject({ pageviews: 0, errors: 0 });
      // Ni aujourd'hui ni la veille de la fenêtre : 13 jours × 2 pages vues.
      expect(lignes.reduce((s, l) => s + l.pageviews, 0)).toBe(26);
    });
  });

  // Revue de F65 : les tuiles comparent J−1 à J−8. Le jour de référence n'est
  // comparable que si la collecte l'a couvert EN ENTIER, lu sur le périmètre d'apps.
  describe("couvertureJour — le jour de référence des tuiles", () => {
    it("A, collectée depuis J−15 : J−8 est complet", async () => {
      const c = await lib.couvertureJour(lib.queryOf(filtres()), lib.SOURCES_TENDANCES.lcp, jours[6], TZ, 3);
      expect(c).toEqual({ etat: "complete", raison: null, n: 3 });
    });

    it("B, collectée depuis J−3 seulement : J−8 est partiel, date lue en base ; B n'hérite pas de l'historique de A", async () => {
      const c = await lib.couvertureJour(lib.queryOf(filtres(B)), lib.SOURCES_TENDANCES.lcp, jours[6], TZ, 0);
      expect(c.etat).toBe("partielle");
      expect(c.raison).toMatch(/^mesures de performance collectées depuis le \d{2}\/\d{2} \d{2}:\d{2} UTC seulement$/);
    });

    it("B : aucune page vue ni erreur collectée → partielle, jamais « complète »", async () => {
      const c = await lib.couvertureJour(lib.queryOf(filtres(B)), lib.SOURCES_TENDANCES.ratio, jours[6], TZ, 0);
      expect(c).toMatchObject({ etat: "partielle", raison: "aucune donnée collectée sur le périmètre" });
    });
  });
});
