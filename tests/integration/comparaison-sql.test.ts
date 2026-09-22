// F06 — couverture de la période précédente sur un vrai PostgreSQL (plan § 3.2).
//
// Le test unitaire verrouille l'ordre des règles et leurs textes ; seule la base
// dit que `debutCollecte` lit le bon minimum : sur le PÉRIMÈTRE d'apps et lui seul
// (une app récente n'hérite pas de l'historique d'une autre), avec la colonne
// requise quand elle est nommée, et avec la date de v58 pour `sample_rate`.
//
// Surtout : une plage personnalisée de 30 jours rend `partielle` même quand la
// donnée remonte bien plus loin — la purge de rétention décide, pas le hasard de ce
// qui reste en base.
//
// COMMENT L'EXÉCUTER. Ce fichier applique le schéma COMPLET : base JETABLE.
//   SQL_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/<jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery, type AnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

const A = "f06-app-recente"; // première mesure hier
const B = "f06-app-historique"; // dix jours d'historique
const C = "f06-app-ancienne"; // données de 70 jours, que la purge aurait retirées
const D = "f06-app-vide"; // aucune ligne
const APPS = [A, B, C, D];

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;
const NOW = Date.now();
const HIER = new Date(NOW - 20 * HEURE);
const DIX_JOURS = new Date(NOW - 10 * JOUR);
const DEUX_JOURS = new Date(NOW - 2 * JOUR);
const SOIXANTE_DIX_JOURS = new Date(NOW - 70 * JOUR);
const AOUT = new Date("2026-08-01T00:00:00Z"); // avant v58 : sample_rate vaut 1 par défaut

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
  for (const table of ["rum_metric", "rum_pageview", "rum_session"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

async function semer(c: pg.Client): Promise<void> {
  const sessions: [string, string, Date][] = [
    ["f06-a", A, AOUT],
    ["f06-b", B, DIX_JOURS],
    ["f06-c", C, SOIXANTE_DIX_JOURS],
  ];
  for (const [id, app, debut] of sessions) {
    await c.query(
      `insert into rum_session (session_id, app_id, started_at, last_seen_at) values ($1, $2, $3, $3)
       on conflict (session_id) do update set started_at = excluded.started_at, last_seen_at = excluded.last_seen_at`,
      [id, app, debut],
    );
  }
  const mesures: [string, string, Date][] = [
    ["f06-m-a1", A, HIER],
    ["f06-m-a2", A, new Date(NOW - HEURE)],
    ["f06-m-b1", B, DIX_JOURS],
    ["f06-m-b2", B, new Date(NOW - HEURE)],
    ["f06-m-c1", C, SOIXANTE_DIX_JOURS],
    ["f06-m-c2", C, new Date(NOW - HEURE)],
  ];
  for (const [span, app, ts] of mesures) {
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       values ($1, $2, $3, '/', 'LCP', 1800, 'good', $4)`,
      [span, `f06-${app === A ? "a" : app === B ? "b" : "c"}`, app, ts],
    );
  }
  // Pages vues de A depuis dix jours ; la release n'est déclarée que depuis deux jours.
  const vues: [string, Date, string | null][] = [
    ["f06-v-a1", DIX_JOURS, null],
    ["f06-v-a2", DEUX_JOURS, "1.4.2"],
    ["f06-v-a3", new Date(NOW - HEURE), "1.4.2"],
  ];
  for (const [span, debut, release] of vues) {
    await c.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at, release) values ($1, 'f06-a', $2, '/', $3, $4)`,
      [span, A, debut, release],
    );
  }
}

/** Modules console branchés sur la base jetable (cf. query-contract-sql). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  // La rétention par défaut (30 jours) : c'est elle que la règle 1 doit lire.
  delete process.env.RETENTION_DAYS;
  const comparaison = await import("../../apps/console/lib/comparaison");
  const filters = await import("../../apps/console/lib/filters");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...comparaison, ...filters, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const ADMIN: ScopePrincipal = { role: "admin", apps: null };

function requete(qs: string, principal: ScopePrincipal = ADMIN): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
  return parsed.value;
}

/** Plage personnalisée de 30 jours, terminée à la minute passée (jamais dans le futur). */
function trenteJours(app: string): AnalyticsQuery {
  const to = Math.floor(Date.now() / 60_000) * 60_000;
  return requete(`app=${app}&from=${new Date(to - 30 * JOUR).toISOString()}&to=${new Date(to).toISOString()}`);
}

const METRIQUE = { table: "rum_metric", colonneTemps: "ts", additive: false } as const;
const VUES = { table: "rum_pageview", colonneTemps: "started_at", additive: true } as const;

(url ? describe : describe.skip)("couverture de la période précédente sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyer(c);
    await semer(c);
    lib = await consoleSur(url!);
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  it("plage personnalisée de 30 jours → partielle (rétention), même avec 70 jours de données en base", async () => {
    for (const app of [C, B, A]) {
      const couverture = await lib.couverturePrecedente(trenteJours(app), METRIQUE);
      expect(couverture, app).toEqual({
        etat: "partielle",
        raison: "période précédente hors rétention (30 jours) : les données les plus anciennes ont été purgées",
      });
      expect(lib.deltasDeLaRangee("prev", [couverture]).deltas).toBe(false);
    }
  });

  it("première mesure d'hier sous period=7d → partielle, avec la date lue en base", async () => {
    const debut = await lib.debutCollecte(lib.filtersOfQuery(requete(`app=${A}`)), METRIQUE);
    expect(debut?.toISOString()).toBe(HIER.toISOString());
    const couverture = await lib.couverturePrecedente(requete(`app=${A}&period=7d`), METRIQUE);
    expect(couverture.etat).toBe("partielle");
    expect(couverture.raison).toMatch(/^mesures de performance collectées depuis le \d{2}\/\d{2} \d{2}:\d{2} UTC seulement$/);
  });

  it("period=24h avec historique complet → complète", async () => {
    expect(await lib.couverturePrecedente(requete(`app=${B}&period=24h`), METRIQUE)).toEqual({ etat: "complete", raison: null });
  });

  it("le périmètre décide : A n'hérite pas de l'historique de B", async () => {
    const viewerAB: ScopePrincipal = { role: "viewer", apps: [A, B] };
    const viewerA: ScopePrincipal = { role: "viewer", apps: [A] };
    expect((await lib.couverturePrecedente(requete("period=24h", viewerAB), METRIQUE)).etat).toBe("complete");
    expect((await lib.couverturePrecedente(requete("period=24h", viewerA), METRIQUE)).etat).toBe("partielle");
  });

  it("les filtres de population n'avancent pas le début de collecte", async () => {
    // Un segment qui ne retient aucune session n'est pas « un signal qui commence plus tard ».
    const debut = await lib.debutCollecte(lib.filtersOfQuery(requete(`app=${B}&device=tablet&browser=Inexistant`)), METRIQUE);
    expect(debut?.toISOString()).toBe(DIX_JOURS.toISOString());
  });

  it("period=1h sur un compte → partielle (retard d'ingestion) ; sur un p75 → complète", async () => {
    expect((await lib.couverturePrecedente(requete(`app=${A}&period=1h`), VUES)).raison).toContain("période en cours");
    expect((await lib.couverturePrecedente(requete(`app=${B}&period=1h`), METRIQUE)).etat).toBe("complete");
  });

  it("colonne requise : la release n'est déclarée que depuis deux jours", async () => {
    const source = { ...VUES, colonneRequise: "release" };
    expect((await lib.couverturePrecedente(requete(`app=${A}&period=24h`), VUES)).etat).toBe("complete");
    const couverture = await lib.couverturePrecedente(requete(`app=${A}&period=7d`), source);
    expect(couverture.etat).toBe("partielle");
    expect(couverture.raison).toMatch(/^champ « release » collecté depuis le /);
  });

  it("sample_rate : collecté depuis v58, quelle que soit la date des sessions", async () => {
    const source = { table: "rum_session", colonneTemps: "started_at", colonneRequise: "sample_rate", additive: true };
    const debut = await lib.debutCollecte(lib.filtersOfQuery(requete(`app=${A}`)), source);
    expect(debut?.toISOString()).toBe(lib.DEBUT_SAMPLE_RATE);
  });

  it("aucune ligne sur le périmètre → partielle, jamais complète", async () => {
    expect(await lib.couverturePrecedente(requete(`app=${D}&period=24h`), METRIQUE)).toEqual({
      etat: "partielle",
      raison: "aucune donnée collectée sur le périmètre",
    });
  });

  it("lecture en échec → inconnue", async () => {
    const source = { ...METRIQUE, colonneRequise: "colonne_absente" };
    expect(await lib.couverturePrecedente(requete(`app=${B}&period=24h`), source)).toEqual({
      etat: "inconnue",
      raison: "début de collecte non lu",
    });
  });
});
