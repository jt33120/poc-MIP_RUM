// Concordance quotidienne robot ↔ réel (P*.8, dépendance B61) sur un vrai
// PostgreSQL : ce que le test unitaire ne peut pas prouver.
//
//   1. le grain « jour » agrège bien par JOUR DE PARIS (de minuit à minuit, heure
//      de Paris : `bucketExpr`, seaux d'un jour alignés sur l'heure murale depuis
//      le 29/09/2026), avec un p75 réel par jour — jamais une moyenne de p75,
//      jamais un jour à cheval. Les mesures sont posées à 00:30 et à 23:30 heure
//      de Paris : sur des jours UTC, le robot tomberait la veille et aucun jour
//      ne serait commun ;
//   2. un jour vu d'un seul côté sort avec `null` de l'autre : c'est le JS qui
//      l'écarte, la requête n'invente rien ;
//   3. `app_id` est lié partout (V7) : une app hors périmètre rend 0 ligne, et
//      deux apps qui ont la même route ne se mélangent pas ;
//   4. bout en bout : les jours lus donnent le ρ attendu, et 4 jours donnent le
//      refus chiffré.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { concordanceParCouple } from "../../apps/console/lib/correlation";
import { ecrireSerie } from "../../apps/console/lib/correlation-serie";
import type { Filters } from "../../apps/console/lib/filters";
import { parseAnalyticsQuery, type AnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const SUIT = "ps8-suit";
const COURT = "ps8-court";
const JUMEAU = "ps8-jumeau";
const APPS = [SUIT, COURT, JUMEAU];
const ROUTE = "/panier";

const JOUR = 86_400_000;
const HEURE = 3_600_000;

const MUR_PARIS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** Heure murale de Paris d'un instant, « AAAA-MM-JJ HH:MM ». */
function murParis(d: Date): string {
  const p = Object.fromEntries(MUR_PARIS.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
/**
 * Minuit, heure de Paris, de la date civile `annee-mois-jour` (mois de 0 à 11,
 * débordements admis comme `Date.UTC`). Calculé ici sans le code de la console :
 * Paris est à +1 h ou +2 h, minuit y tombe donc à 23:00Z ou 22:00Z la veille (un
 * changement d'heure a lieu à 2 h ou 3 h, jamais à minuit).
 */
function minuitParis(annee: number, mois: number, jourDuMois: number): Date {
  for (const decalage of [2, 1]) {
    const d = new Date(Date.UTC(annee, mois, jourDuMois) - decalage * HEURE);
    if (murParis(d).endsWith(" 00:00")) return d;
  }
  throw new Error(`minuit de Paris introuvable pour ${annee}-${mois + 1}-${jourDuMois}`);
}

/**
 * Plage de recette : 14 jours pleins de Paris (le seau du grain « jour »), qui
 * finit au dernier minuit de Paris passé. Un jour peut durer 23 ou 25 h si la
 * plage recoupe un changement d'heure : chaque borne est calculée à part.
 */
const AUJ = new Date();
const jour = (i: number) => minuitParis(AUJ.getUTCFullYear(), AUJ.getUTCMonth(), AUJ.getUTCDate() - 14 + i);
const FROM = jour(0);
const TO = jour(14);

// Les douze jours du cas « le robot suit » : mêmes valeurs que le test unitaire
// (tests/unit/concordance.test.ts), pour que SQL et JS se recoupent.
const ROBOT = [800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200, 1250, 1300, 1350];
const REEL = [2000, 2100, 1900, 2300, 2200, 2500, 2400, 2700, 2600, 3000, 2900, 3100];

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return [
    "schema.sql",
    ...readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f))
      .sort((a, b) => version(a) - version(b)),
  ].map((f) => join(SQL_DIR, f));
}

async function nettoyer(c: pg.Client): Promise<void> {
  for (const table of ["rum_metric", "syn_snapshot", "rum_session", "app_registry"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

let compteur = 0;

/**
 * `n` mesures LCP identiques (le p75 du jour vaut donc `valeur`) à 23:30, heure
 * de Paris, du jour `i` : la dernière demi-heure du jour de Paris.
 */
async function reel(c: pg.Client, app: string, route: string | null, i: number, valeur: number, n = 20): Promise<void> {
  await c.query(
    `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
     select $1 || '-' || g, $2, $3, $4, 'LCP', $5, $6::timestamptz + make_interval(secs => g)
       from generate_series(1, $7) g`,
    [`ps8m${(compteur += 1)}`, `ps8-s-${app}`, app, route, valeur, new Date(jour(i + 1).getTime() - HEURE / 2), n],
  );
}

/**
 * Un passage du robot le jour `i`, à 00:30 heure de Paris — 22:30Z ou 23:30Z la
 * VEILLE en UTC : sur des jours UTC, il ne rejoindrait pas les mesures réelles.
 */
async function robot(c: pg.Client, app: string, route: string | null, i: number, latence: number): Promise<void> {
  await c.query(
    `insert into syn_snapshot (app_id, site, measure_id, measure_name, route_hint, score, state, latency_ms, captured_at)
     values ($1, 'recette P*.8', $2, $2, $3, 90, 'ok', $4, $5)`,
    [app, "Parcours panier", route, latence, new Date(jour(i).getTime() + HEURE / 2)],
  );
}

async function semer(c: pg.Client): Promise<void> {
  await c.query(
    `insert into app_registry (app_id, name, active, internal)
     select a, a, true, false from unnest($1::text[]) a
     on conflict (app_id) do update set active = true, internal = false`,
    [APPS],
  );
  for (const app of APPS) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, client_id, collection_source, started_at, last_seen_at, sample_rate, error_sample_rate)
       values ($1, $2, 'desktop', false, 'mip', 'sdk', $3, $4, 1, 1)
       on conflict (session_id) do nothing`,
      [`ps8-s-${app}`, app, FROM, TO],
    );
  }

  // SUIT — douze jours complets, puis trois jours volontairement incomplets.
  for (let i = 0; i < 12; i++) {
    await robot(c, SUIT, ROUTE, i, ROBOT[i]);
    await reel(c, SUIT, ROUTE, i, REEL[i]);
  }
  await robot(c, SUIT, ROUTE, 12, 1400); // robot seul
  await reel(c, SUIT, ROUTE, 13, 3200); // réel seul
  await robot(c, SUIT, ROUTE, 12, 1400);
  await reel(c, SUIT, ROUTE, 12, 3300, 12); // les deux, mais 12 mesures
  // Une journée sans route des deux côtés : aucun couple, donc aucune ligne.
  await robot(c, SUIT, null, 0, 900);
  await reel(c, SUIT, null, 0, 2400);

  // COURT — quatre jours communs : sous le minimum, le refus doit être chiffré.
  for (let i = 0; i < 4; i++) {
    await robot(c, COURT, ROUTE, i, ROBOT[i]);
    await reel(c, COURT, ROUTE, i, REEL[i]);
  }

  // JUMEAU — la MÊME route que SUIT, dans une autre app, en sens inverse.
  for (let i = 0; i < 12; i++) {
    await robot(c, JUMEAU, ROUTE, i, ROBOT[i]);
    await reel(c, JUMEAU, ROUTE, i, REEL[11 - i]);
  }
}

/** Modules console branchés sur la base jetable (cf. correlation-sql). */
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

(url ? describe : describe.skip)("P*.8 — concordance quotidienne robot et réel sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;

  const requete = (qs: string, principal: ScopePrincipal = { role: "admin", apps: null }): AnalyticsQuery => {
    const params = new URLSearchParams(qs);
    if (!params.has("from")) {
      params.set("from", FROM.toISOString());
      params.set("to", TO.toISOString());
    }
    const parsed = parseAnalyticsQuery(params, { principal, nowMs: Date.now() });
    if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
    return parsed.value;
  };
  const filtres = (qs: string, principal?: ScopePrincipal): Filters => lib.filtersOfQuery(requete(qs, principal));

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyer(c);
    await semer(c);
    lib = await consoleSur(url!);
  }, 300_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  it("un seau par JOUR DE PARIS, avec le p75 réel du jour et la latence robot du jour", async () => {
    const lignes = await lib.correlationQuotidienne(null, null, filtres(`app=${SUIT}`));
    // 12 jours complets + le jour 12 (robot et 12 mesures) + le jour 13 (réel seul).
    expect(lignes).toHaveLength(14);
    // Chaque seau part de minuit, heure de Paris — jamais de minuit UTC.
    expect(lignes.map((l) => murParis(l.jour).slice(11))).toEqual(Array(14).fill("00:00"));
    expect(lignes.every((l) => l.jour.getTime() % JOUR !== 0)).toBe(true);
    expect(lignes.map((l) => l.jour.getTime())).toEqual([...Array(14)].map((_, i) => jour(i).getTime()));
    expect(lignes.slice(0, 12).map((l) => Number(l.rum_lcp_p75))).toEqual(REEL);
    expect(lignes.slice(0, 12).map((l) => Number(l.syn_latency_avg))).toEqual(ROBOT);
    expect(lignes.slice(0, 12).every((l) => l.rum_lcp_n === 20)).toBe(true);
    // Aucune ligne sans route : un jour sans route ne désigne aucun couple.
    expect(lignes.every((l) => l.route === ROUTE)).toBe(true);
  });

  it("un jour vu d'un seul côté garde son `null` : la requête n'invente rien", async () => {
    const lignes = await lib.correlationQuotidienne(SUIT, ROUTE, filtres(`app=${SUIT}`));
    const douze = lignes.find((l) => l.jour.getTime() === jour(12).getTime())!;
    expect(douze.rum_lcp_n).toBe(12); // sous le minimum de la p75 : c'est le JS qui l'écarte
    expect(Number(douze.syn_latency_avg)).toBe(1400);
    const treize = lignes.find((l) => l.jour.getTime() === jour(13).getTime())!;
    expect(treize.syn_latency_avg).toBeNull(); // réel seul
    expect(Number(treize.rum_lcp_p75)).toBe(3200);
  });

  it("bout en bout : douze jours communs → ρ de Spearman, issue « suit »", async () => {
    const lignes = await lib.correlationQuotidienne(null, null, filtres(`app=${SUIT}`));
    const res = concordanceParCouple(lignes).get(ecrireSerie(SUIT, ROUTE))!;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.n).toBe(12); // les jours 12 et 13 sont écartés, pas comptés
    expect(res.rho).toBeCloseTo(0.951049, 6);
    expect(res.intervalle.bas).toBeCloseTo(0.824273, 6);
    expect(res.issue).toBe("suit");
  });

  it("quatre jours : refus chiffré, jamais un coefficient", async () => {
    const lignes = await lib.correlationQuotidienne(null, null, filtres(`app=${COURT}`));
    expect(lignes).toHaveLength(4);
    const res = concordanceParCouple(lignes).get(ecrireSerie(COURT, ROUTE))!;
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.raison).toBe("4 jours communs, 10 requis");
  });

  it("deux apps, même route : deux couples distincts, deux verdicts opposés (V7)", async () => {
    const f = filtres("", { role: "viewer", apps: [SUIT, JUMEAU] });
    const rhos = concordanceParCouple(await lib.correlationQuotidienne(null, null, f));
    expect([...rhos.keys()].sort()).toEqual([ecrireSerie(JUMEAU, ROUTE), ecrireSerie(SUIT, ROUTE)].sort());
    const suit = rhos.get(ecrireSerie(SUIT, ROUTE))!;
    const jumeau = rhos.get(ecrireSerie(JUMEAU, ROUTE))!;
    expect(suit.ok && suit.issue).toBe("suit");
    expect(jumeau.ok && jumeau.issue).toBe("ne_suit_pas");
    expect(jumeau.ok && jumeau.rho).toBeCloseTo(-0.951049, 6);
  });

  it("une app hors périmètre rend 0 ligne, même avec la bonne route", async () => {
    expect(await lib.correlationQuotidienne(JUMEAU, ROUTE, filtres(`app=${SUIT}`))).toEqual([]);
    const lignes = await lib.correlationQuotidienne(null, null, filtres(`app=${SUIT}`));
    expect(lignes.every((l) => l.app_id === SUIT)).toBe(true);
  });

  it("une route inconnue rend 0 ligne ; `apps = []` aussi", async () => {
    expect(await lib.correlationQuotidienne(SUIT, "/inconnue", filtres(`app=${SUIT}`))).toEqual([]);
    const vide = lib.filtersOfQuery({
      ...requete(`app=${SUIT}`),
      scope: { requestedApp: SUIT, authorizedApps: [SUIT], effectiveApps: [] },
    });
    expect(await lib.correlationQuotidienne(null, null, vide)).toEqual([]);
    expect(await lib.correlationQuotidienne(SUIT, ROUTE, vide)).toEqual([]);
  });
});
