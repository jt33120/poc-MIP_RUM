// P6.2 — la matrice écran × filtre, exécutée sur PostgreSQL.
//
// Le test unitaire verrouille la FORME des prédicats compilés ; seul PostgreSQL dit
// qu'ils comptent les bonnes lignes. Chaque famille de signaux (sessions, pages vues,
// événements, actions, erreurs) reçoit la MÊME forme de population — deux sessions
// humaines de l'app A (une desktop en FR, une tablette en DE), une session robot, une
// ligne juste avant la fenêtre, une ligne sur la borne haute, une ligne de l'app B,
// une ligne d'une app interne — de sorte qu'une seule table de résultats attendus
// vaut pour toutes les lectures. Ce qui diverge est alors un défaut, pas une nuance.
//
// S'y ajoutent : le périmètre vide (aucun accès), l'intersection d'un widget avec une
// autre app, les bornes [from,to) à la milliseconde, la journée locale de Paris qui
// dure 23 h au passage à l'heure d'été, et le refus typé d'une dimension qu'un jeu de
// données ne porte pas.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Filters } from "../../apps/console/lib/filters";
import {
  localInputToUtc,
  parseAnalyticsQuery,
  type AnalyticsQuery,
  type ScopePrincipal,
} from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

const A = "p62-app-a";
const B = "p62-app-b";
const I = "p62-app-interne";
const APPS = [A, B, I];
const PARIS = "Europe/Paris";
const PAGE = { limit: 100, offset: 0 };

// Fenêtre de recette : une heure pleine, terminée (jamais dans le futur), et ses bords.
const TO = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);
const FROM = new Date(TO.getTime() - 3_600_000);
const DEDANS = new Date(FROM.getTime() + 60_000);
const AVANT = new Date(FROM.getTime() - 1);
const BORNE_HAUTE = TO;

// Passage à l'heure d'été 2026 : la journée locale du 29/03 ne dure que 23 h.
const JOUR_DST_DEBUT = localInputToUtc("2026-03-29T00:00", PARIS)!;
const JOUR_DST_FIN = localInputToUtc("2026-03-30T00:00", PARIS)!;

interface Ligne {
  nom: string;
  app: string;
  session: string;
  ts: Date;
}

/** La même forme pour chaque famille de signaux : une seule table d'attendus. */
const LIGNES: Ligne[] = [
  { nom: "a-desktop", app: A, session: "p62-a-desktop", ts: DEDANS },
  { nom: "a-tablette", app: A, session: "p62-a-tablette", ts: DEDANS },
  { nom: "a-robot", app: A, session: "p62-a-robot", ts: DEDANS },
  { nom: "a-avant", app: A, session: "p62-a-desktop", ts: AVANT },
  { nom: "a-borne", app: A, session: "p62-a-desktop", ts: BORNE_HAUTE },
  { nom: "b-desktop", app: B, session: "p62-b-desktop", ts: DEDANS },
  { nom: "interne", app: I, session: "p62-i-desktop", ts: DEDANS },
];
const DST: Ligne[] = [
  { nom: "dst-avant", app: A, session: "p62-a-desktop", ts: new Date(Date.parse(JOUR_DST_DEBUT) - 1) },
  { nom: "dst-debut", app: A, session: "p62-a-desktop", ts: new Date(JOUR_DST_DEBUT) },
  { nom: "dst-saut", app: A, session: "p62-a-desktop", ts: new Date("2026-03-29T01:30:00Z") },
  { nom: "dst-fin", app: A, session: "p62-a-desktop", ts: new Date(Date.parse(JOUR_DST_FIN) - 1) },
  { nom: "dst-apres", app: A, session: "p62-a-desktop", ts: new Date(JOUR_DST_FIN) },
];
const TOUTES = [...LIGNES, ...DST];

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
  for (const table of ["rum_error", "rum_event_index", "rum_event", "rum_action", "rum_metric", "rum_pageview", "rum_session", "app_registry"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

/** Identifiants de span et d'action : hexadécimaux, comme l'exige l'ingestion. */
const hex = (prefixe: string, i: number, taille: number) => (prefixe + i.toString(16).padStart(2, "0")).padEnd(taille, "0");

async function semer(c: pg.Client): Promise<void> {
  await c.query(
    `insert into app_registry (app_id, name, active, internal)
     values ($1, 'A', true, false), ($2, 'B', true, false), ($3, 'Interne', true, true)
     on conflict (app_id) do update set active = true, internal = excluded.internal`,
    [A, B, I],
  );
  // Sessions des signaux (toutes vues dans la fenêtre) + deux sessions aux bords,
  // qui servent la même matrice à la famille « sessions ».
  const sessions: [string, string, string, boolean, string, Date][] = [
    ["p62-a-desktop", A, "desktop", false, "FR", DEDANS],
    ["p62-a-tablette", A, "tablet", false, "DE", DEDANS],
    ["p62-a-robot", A, "desktop", true, "FR", DEDANS],
    ["p62-a-avant", A, "desktop", false, "FR", AVANT],
    ["p62-a-borne", A, "desktop", false, "FR", BORNE_HAUTE],
    ["p62-b-desktop", B, "desktop", false, "FR", DEDANS],
    ["p62-i-desktop", I, "desktop", false, "FR", DEDANS],
    // Journée locale du changement d'heure : la famille « sessions » y retrouve
    // la même forme que les signaux (trois dedans, deux de part et d'autre).
    ...DST.map((l): [string, string, string, boolean, string, Date] => [`p62-${l.nom}`, A, "desktop", false, "FR", l.ts]),
  ];
  for (const [id, app, device, bot, pays, vue] of sessions) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, geo_country, client_id, collection_source, started_at, last_seen_at, sample_rate, error_sample_rate)
       values ($1, $2, $3, $4, $5, 'mip', 'sdk', $6, $6, 1, 1)
       on conflict (session_id) do update set last_seen_at = excluded.last_seen_at`,
      [id, app, device, bot, pays, vue],
    );
  }
  for (const [i, ligne] of TOUTES.entries()) {
    const vue = hex("bb", i, 16);
    const evenement = hex("ee", i, 16);
    await c.query(`insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, '/pay', $4)`, [
      vue,
      ligne.session,
      ligne.app,
      ligne.ts,
    ]);
    await c.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, event_type, props, context, ts)
       values ($1, $2, $3, '/pay', 'checkout', 'custom', '{}'::jsonb, '{}'::jsonb, $4)`,
      [evenement, ligne.session, ligne.app, ligne.ts],
    );
    await c.query(
      `insert into rum_event_index (app_id, session_id, ts, route, kind, source_name, source_span_id)
       values ($1, $2, $3, '/pay', 'event', 'track', $4)`,
      [ligne.app, ligne.session, ligne.ts, evenement],
    );
    await c.query(
      `insert into rum_action (action_id, span_id, session_id, app_id, type, name, route, ts)
       values ($1, $2, $3, $4, 'click', 'Payer', '/pay', $5)`,
      [hex("aa", i, 32), hex("ac", i, 16), ligne.session, ligne.app, ligne.ts],
    );
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       values ($1, $2, $3, '/pay', 'LCP', 1200, 'good', $4)`,
      [hex("cc", i, 16), ligne.session, ligne.app, ligne.ts],
    );
    await c.query(
      `insert into rum_error (app_id, session_id, fingerprint, error_type, message, kind, route, occurrences, ts)
       values ($1, $2, 'p62fp1', 'TypeError', 'boom', 'error', '/pay', 1, $3)`,
      [ligne.app, ligne.session, ligne.ts],
    );
  }
}

/** Modules console branchés sur la base jetable (cf. error-queries-p51-sql). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const queries = await import("../../apps/console/lib/queries");
  const events = await import("../../apps/console/lib/queries-events");
  const actions = await import("../../apps/console/lib/queries-actions");
  const errors = await import("../../apps/console/lib/queries-errors");
  const filters = await import("../../apps/console/lib/filters");
  const schema = await import("../../apps/console/lib/query-schema");
  const compiler = await import("../../apps/console/lib/query-compiler");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...queries, ...events, ...actions, ...errors, ...filters, ...schema, ...compiler, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

(url ? describe : describe.skip)("contrat de filtres P6.2 sur PostgreSQL", () => {
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

  /** Une lecture par écran migré, ramenée au nombre de lignes de sa population. */
  const COMPTEURS: { ecran: string; lire: (f: Filters) => Promise<number> }[] = [
    { ecran: "Vue d'ensemble — pages vues", lire: async (f) => (await lib.overviewStats(f)).pageviews },
    { ecran: "Sessions", lire: async (f) => (await lib.listSessions(f, PAGE)).length },
    { ecran: "Pages lentes — vues", lire: async (f) => (await lib.slowRoutes(f)).reduce((s, r) => s + r.views, 0) },
    { ecran: "Vitals — mesures", lire: async (f) => (await lib.vitalsP75(f)).reduce((s, v) => s + Number(v.n), 0) },
    {
      ecran: "Explorer d'événements",
      lire: async (f) => (await lib.exploreEvents(f, { kind: "event", name: null, attribute: null }, PAGE, null)).total,
    },
    { ecran: "Actions", lire: async (f) => (await lib.topActionsSummary(f)).actions },
    { ecran: "Erreurs", lire: async (f) => (await lib.listErrorGroups(f, PAGE)).totals.occurrences },
  ];

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

  // Une ligne par cas de la matrice, le même nombre attendu de chaque écran.
  const MATRICE: { cas: string; qs: string; principal?: ScopePrincipal; attendu: number }[] = [
    { cas: "app A, humains", qs: `app=${A}`, attendu: 2 },
    { cas: "app A, robots inclus", qs: `app=${A}&bots=1`, attendu: 3 },
    { cas: "app A, tablette", qs: `app=${A}&device=tablet`, attendu: 1 },
    { cas: "app A, desktop", qs: `app=${A}&device=desktop`, attendu: 1 },
    { cas: "app A, segment pays FR", qs: `app=${A}&seg=geo==FR`, attendu: 1 },
    { cas: "app A, segment pays hors FR", qs: `app=${A}&seg=geo!=FR`, attendu: 1 },
    { cas: "app A, segment v2 client", qs: `app=${A}&seg=v2:client:eq:mip`, attendu: 2 },
    { cas: "app A, segment v2 source inconnue", qs: `app=${A}&seg=v2:source:is_null`, attendu: 0 },
    { cas: "app B", qs: `app=${B}`, attendu: 1 },
    { cas: "app interne nommée", qs: `app=${I}`, attendu: 1 },
    { cas: "viewer scopé sur A et B", qs: "", principal: { role: "viewer", apps: [A, B] }, attendu: 3 },
    { cas: "viewer scopé sur B seul", qs: "", principal: { role: "viewer", apps: [B] }, attendu: 1 },
  ];

  it.each(MATRICE)("$cas : chaque écran compte $attendu", async ({ qs, principal, attendu }) => {
    for (const { ecran, lire } of COMPTEURS) {
      expect(await lire(filtres(qs, principal)), ecran).toBe(attendu);
    }
  });

  it("vue « toutes apps » : l'app interne n'entre qu'avec le toggle, l'app B toujours", async () => {
    // La base jetable porte aussi les autres suites SQL : on mesure l'ÉCART, pas un total.
    for (const { ecran, lire } of COMPTEURS) {
      const sansInternes = await lire(filtres(""));
      const avecInternes = await lire(filtres("internal=1"));
      expect(avecInternes - sansInternes, ecran).toBe(1);
      // Un viewer dont le périmètre est A et B voit les deux, et rien d'autre.
      expect(await lire(filtres("", { role: "viewer", apps: [A, B] })), ecran).toBe(3);
      expect(await lire(filtres("internal=1", { role: "viewer", apps: [A, B] })), ecran).toBe(3);
    }
  });

  it("périmètre vide : aucun écran ne rend une ligne, sur aucune app", async () => {
    const vide = lib.filtersOfQuery({
      ...requete(`app=${A}`),
      scope: { requestedApp: A, authorizedApps: [A], effectiveApps: [] },
    });
    for (const { ecran, lire } of COMPTEURS) expect(await lire(vide), ecran).toBe(0);
  });

  it("intersection d'un widget avec une autre app : zéro, jamais les chiffres de l'autre app", async () => {
    const { intersectApp } = await import("../../apps/console/lib/query-contract");
    // Tableau de bord lié à A lu sur l'écran A : les chiffres de A.
    const memeApp = lib.filtersOfQuery(intersectApp(requete(`app=${A}`), A));
    // Tableau de bord lié à B lu sur l'écran A : intersection vide, pas les chiffres de B.
    const autreApp = lib.filtersOfQuery(intersectApp(requete(`app=${A}`), B));
    // Tableau lié à B lu en vue « toutes apps » : les chiffres de B seul.
    const toutesVersB = lib.filtersOfQuery(intersectApp(requete(""), B));
    for (const { ecran, lire } of COMPTEURS) {
      expect(await lire(memeApp), ecran).toBe(2);
      expect(await lire(autreApp), ecran).toBe(0);
      expect(await lire(toutesVersB), ecran).toBe(1);
    }
  });

  it("bornes [from,to) : la ligne d'avant entre quand la fenêtre recule, celle de `to` jamais", async () => {
    const elargie = `app=${A}&from=${new Date(FROM.getTime() - 1).toISOString()}&to=${TO.toISOString()}`;
    const jusquApres = `app=${A}&from=${FROM.toISOString()}&to=${new Date(TO.getTime() + 1).toISOString()}`;
    for (const { ecran, lire } of COMPTEURS) {
      expect(await lire(filtres(elargie)), ecran).toBe(3);
      expect(await lire(filtres(jusquApres)), ecran).toBe(3);
    }
  });

  it("journée locale de Paris au passage à l'heure d'été : 23 h, bornes comprises", async () => {
    const jour = `app=${A}&from=${JOUR_DST_DEBUT}&to=${JOUR_DST_FIN}`;
    expect(Date.parse(JOUR_DST_FIN) - Date.parse(JOUR_DST_DEBUT)).toBe(23 * 3_600_000);
    for (const { ecran, lire } of COMPTEURS) {
      // dst-debut, dst-saut et dst-fin ; ni dst-avant, ni dst-apres.
      expect(await lire(filtres(jour)), ecran).toBe(3);
    }
    const trend = await lib.listErrorGroups(filtres(jour), PAGE, { series: true });
    // Seaux d'une heure alignés UTC : 23 heures réelles, plus le seau de bord.
    expect(trend.trend.length).toBeGreaterThanOrEqual(23);
    expect(trend.trend.reduce((s, p) => s + p.occurrences, 0)).toBe(3);
  });

  // Les jeux de données qui PORTENT `service` : les erreurs depuis v69, la
  // projection d'événements depuis migration-v75 (P6.1). Sur eux, le filtre
  // s'applique — c'est la bascule annoncée par la matrice « — → oui ». Partout
  // ailleurs, il reste refusé : une session n'a pas de service.
  const PORTENT_SERVICE = ["Erreurs", "Explorer d'événements"];

  it("une dimension qu'un jeu de données ne porte pas est refusée, jamais ignorée", async () => {
    // `service` n'est déclaré que là où un émetteur backend le pose : les erreurs
    // (v69) et la projection d'événements (v75). Partout ailleurs, le filtre est
    // refusé — jamais appliqué à moitié.
    for (const { ecran, lire } of COMPTEURS.filter((c) => !PORTENT_SERVICE.includes(c.ecran))) {
      await expect(lire(filtres(`app=${A}&service=api`)), ecran).rejects.toThrow(/Service/);
    }
    // Là où il est porté, il s'applique vraiment : aucune ligne de la recette ne
    // déclare `service`, donc zéro — et non le total non filtré, qui lui est > 0.
    for (const { ecran, lire } of COMPTEURS.filter((c) => PORTENT_SERVICE.includes(c.ecran))) {
      expect(await lire(filtres(`app=${A}&service=api`)), ecran).toBe(0);
      expect(await lire(filtres(`app=${A}`)), ecran).toBeGreaterThan(0);
    }
  });

  it("la sonde de schéma voit exactement les colonnes présentes", async () => {
    const schema = await lib.dimensionSchema();
    const { tables, columns } = lib.registryColumns();
    const { rows } = await c.query<{ key: string }>(
      `select table_name || '.' || column_name as key
         from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[]) and column_name = any($2::text[])`,
      [tables, columns],
    );
    expect([...schema].sort()).toEqual(rows.map((r) => r.key).sort());
    expect(schema.has("rum_session.device_type")).toBe(true);
    expect(schema.has("rum_error.service")).toBe(true);
  });
});
