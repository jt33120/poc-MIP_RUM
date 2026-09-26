// Recette du 26/09/2026 — les chiffres faux, prouvés sur PostgreSQL.
//
// Ce que seule la base peut dire, pour chaque correction du lot « chiffres » :
//   - `apiCalls` / `cheminAppelSql` : /api/items/42, /api/items/7?x=1 et
//     https://…/api/items/28 sont UN appel `/api/items/:id` (l'expression
//     régulière est celle de PostgreSQL, pas celle de JavaScript) ;
//   - `signauxDesSessions` : frustration comptée par session et DANS SON APP, rejeu
//     lu, `null` pour une session React Native (jamais 0) ;
//   - `listCustomers` : « Dernière donnée reçue » d'une app mobile sans Web Vital ;
//   - `slo_status()` (v94) : le taux d'erreur ne compte que les erreurs navigateur, et
//     le budget consommé n'est plus plafonné à 999 % ;
//   - `releasesDuGroupe` / `releasesDeLIssue` : la dernière release est la plus
//     récente, chacune avec ses occurrences.
//
// Base JETABLE : SQL_TEST_DATABASE_URL (le fichier y applique le schéma complet).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const WEB = "rc26-web";
const MOBILE = "rc26-mobile";
const AUTRE = "rc26-autre";
const APPS = [WEB, MOBILE, AUTRE];
const ISSUE = "26092026-0000-4000-8000-000000000001";

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
  for (const table of [
    "replay_chunk", "rum_event", "rum_span", "rum_error", "rum_metric", "rum_pageview", "error_issue_alias", "error_issue",
    "slo", "deploy_marker", "rum_session", "app_registry",
  ]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

async function semer(c: pg.Client): Promise<void> {
  await c.query("begin");
  try {
    await semerDans(c);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

async function semerDans(c: pg.Client): Promise<void> {
  await c.query(
    `insert into app_registry (app_id, name, active) select a, a, true from unnest($1::text[]) a
     on conflict (app_id) do update set active = true`,
    [APPS],
  );
  // Sessions : deux navigateur (WEB), une React Native (WEB aussi : la garde de
  // capteur est PAR SESSION), une mobile seule (MOBILE, sans Web Vital).
  await c.query(
    `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at, sample_rate, error_sample_rate, runtime)
     values ('rc26-s1', $1, 'desktop', false, now() - interval '50 minutes', now() - interval '40 minutes', 1, 1, null),
            ('rc26-s2', $1, 'desktop', false, now() - interval '45 minutes', now() - interval '35 minutes', 1, 1, 'browser'),
            ('rc26-rn', $1, 'mobile', false, now() - interval '30 minutes', now() - interval '20 minutes', 1, 1, 'react_native'),
            ('rc26-m1', $2, 'mobile', false, now() - interval '3 hours', now() - interval '2 hours', 1, 1, 'react_native')`,
    [WEB, MOBILE],
  );
  // Trois signaux de frustration pour s1, un chez une AUTRE app qui cite le même
  // identifiant de session (émis par le client) : il ne doit pas compter.
  await c.query(
    `insert into rum_event (app_id, session_id, name, ts)
     values ($1, 'rc26-s1', 'frustration.dead', now() - interval '45 minutes'),
            ($1, 'rc26-s1', 'frustration.dead', now() - interval '44 minutes'),
            ($1, 'rc26-s1', 'frustration.rage', now() - interval '43 minutes'),
            ($1, 'rc26-s1', 'partner_search', now() - interval '43 minutes'),
            ($2, 'rc26-m1', 'ouvrir_recherche', now() - interval '2 hours')`,
    [WEB, MOBILE],
  );
  await c.query(`insert into rum_session (session_id, app_id, device_type, is_bot, sample_rate, error_sample_rate)
                 values ('rc26-autre-s', $1, 'desktop', false, 1, 1)`, [AUTRE]);
  await c.query(`insert into rum_event (app_id, session_id, name, ts) values ($1, 'rc26-autre-s', 'frustration.dead', now() - interval '44 minutes')`, [AUTRE]);
  await c.query(`insert into replay_chunk (session_id, app_id, seq, events_count, body) values ('rc26-s1', $1, 0, 3, '\\x00'::bytea)`, [WEB]);

  // Appels navigateur : trois identifiants, une requête, une origine absolue.
  for (const [i, u] of ["/api/items/42", "/api/items/7?x=1", "https://api.rc26.test/api/items/28", "/api/search"].entries()) {
    await c.query(
      `insert into rum_span (span_id, trace_id, tier, app_id, session_id, method, url, status_code, duration_ms, ts)
       values ($1, $2, 'front', $3, 'rc26-s1', 'GET', $4, 200, $5, now() - interval '42 minutes')`,
      [`rc26sp${i}`.padEnd(16, "0"), `rc26tr${i}`.padEnd(32, "0"), WEB, u, 100 + i],
    );
  }

  // SLO (route /slo) : 10 pages vues, 2 erreurs navigateur, 5 exceptions serveur (sans page vue).
  for (let i = 0; i < 10; i++) {
    await c.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, url, nav_type, started_at)
       values ($1, 'rc26-s1', $2, '/slo', 'https://web.rc26.test/slo', 'navigate', now() - interval '41 minutes')`,
      [`rc26-pv${i}`, WEB],
    );
  }
  await c.query(
    `insert into rum_error (app_id, session_id, route, fingerprint, occurrences, message, kind, error_source, release, ts)
     values ($1, 'rc26-s1', '/slo', 'rc26-fp-slo', 2, 'boom', 'error', 'browser_js', null, now() - interval '40 minutes'),
            ($1, null, '/slo', 'rc26-fp-node', 5, 'serveur', 'error', 'node', null, now() - interval '40 minutes')`,
    [WEB],
  );
  await c.query(
    `insert into slo (app_id, name, metric, objective, window_days, active, route)
     values ($1, 'rc26 pages sans erreur JS', 'error_rate', 0.97, 28, true, '/slo')`,
    [WEB],
  );

  // Releases d'un groupe : 4.13.0 porte 48 occurrences, 4.12.0 en porte 7 mais a la
  // DERNIÈRE occurrence dans le temps (les deux tournent en même temps).
  await c.query(
    `insert into rum_error (app_id, session_id, fingerprint, occurrences, message, kind, error_source, release, ts)
     values ($1, 'rc26-s2', 'rc26-fp-rel', 48, 'x', 'error', 'browser_js', '4.13.0', now() - interval '30 minutes'),
            ($1, 'rc26-s2', 'rc26-fp-rel', 7, 'x', 'error', 'browser_js', '4.12.0', now() - interval '10 minutes')`,
    [WEB],
  );
  // La même chose sous une issue (grouping v2) : ses lignes, et sa release persistée.
  await c.query(
    `insert into error_issue (id, app_id, grouping_version, grouping_key, grouping_basis, origin, status, status_source,
                              first_seen, last_seen, first_release, last_release)
     values ($1, $2, 2, 'c26000000000000000000000000000aa', 'normalized_frame', 'new', 'open', 'system',
             now() - interval '40 days', now() - interval '10 minutes', '4.10.0', '4.12.0')`,
    [ISSUE, WEB],
  );
  await c.query(
    `insert into rum_error (app_id, session_id, fingerprint, occurrences, message, kind, error_source, release, ts,
                            grouping_version, grouping_key, grouping_basis, issue_id)
     values ($1, 'rc26-s2', 'rc26-fp-iss', 5, 'y', 'error', 'browser_js', '4.13.0', now() - interval '30 minutes',
             2, 'c26000000000000000000000000000aa', 'normalized_frame', $2),
            ($1, 'rc26-s2', 'rc26-fp-iss', 5, 'y', 'error', 'browser_js', '4.12.0', now() - interval '10 minutes',
             2, 'c26000000000000000000000000000aa', 'normalized_frame', $2)`,
    [WEB, ISSUE],
  );
}

async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const tracing = await import("../../apps/console/lib/queries-tracing");
  const sessions = await import("../../apps/console/lib/queries-sessions");
  const clients = await import("../../apps/console/lib/queries-customers");
  const erreurs = await import("../../apps/console/lib/queries-errors");
  const filters = await import("../../apps/console/lib/filters");
  const { q, pool } = await import("../../apps/console/lib/db");
  return { ...tracing, ...sessions, ...clients, ...erreurs, ...filters, q, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const ADMIN: ScopePrincipal = { role: "admin", apps: null };

(url ? describe : describe.skip)("recette du 26/09/2026 — chiffres corrigés, sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;
  const filtres = (qs: string) => {
    const p = parseAnalyticsQuery(new URLSearchParams(qs), { principal: ADMIN, nowMs: Date.now() });
    if (!p.ok) throw new Error(p.error.code);
    return lib.filtersOfQuery(p.value);
  };

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

  it("/tracing : les identifiants d'URL sont normalisés comme une route — un appel, pas trois", async () => {
    const appels = await lib.apiCalls(filtres(`app=${WEB}&period=24h`));
    const items = appels.filter((a) => a.url.startsWith("/api/items"));
    expect(items).toEqual([expect.objectContaining({ url: "/api/items/:id", method: "GET", n: 3 })]);
    expect(appels.map((a) => a.url)).toContain("/api/search");
  });

  it("/sessions : frustration et rejeu par session, dans son app ; React Native → null, jamais 0", async () => {
    const lignes = [
      { app_id: WEB, session_id: "rc26-s1", runtime: null, started_at: new Date(Date.now() - 50 * 60_000), last_seen_at: new Date(Date.now() - 40 * 60_000) },
      { app_id: WEB, session_id: "rc26-s2", runtime: "browser", started_at: new Date(Date.now() - 45 * 60_000), last_seen_at: new Date(Date.now() - 35 * 60_000) },
      { app_id: WEB, session_id: "rc26-rn", runtime: "react_native", started_at: new Date(Date.now() - 30 * 60_000), last_seen_at: new Date(Date.now() - 20 * 60_000) },
    ];
    const s = await lib.signauxDesSessions(lignes);
    expect(s[lib.cleSession(lignes[0])]).toEqual({ frustration: 3, rejeu: true });
    expect(s[lib.cleSession(lignes[1])]).toEqual({ frustration: 0, rejeu: false });
    expect(s[lib.cleSession(lignes[2])]).toEqual({ frustration: null, rejeu: false });
    expect(await lib.signauxDesSessions([])).toEqual({});
  });

  it("/admin/customers : une app mobile sans Web Vital a une « dernière donnée », pas « jamais »", async () => {
    const clients = await lib.listCustomers();
    const mobile = clients.find((r) => r.app_id === MOBILE);
    expect(mobile?.last_event_at).not.toBeNull();
  });

  it("slo_status (v94) : erreurs navigateur seulement, budget consommé non plafonné", async () => {
    const [slo] = await lib.q<{ attainment: number; burned_pct: number }>(
      "select attainment, burned_pct from slo_status($1)",
      [WEB],
    );
    // 1 − 2/10, pas 1 − 7/10 : les 5 exceptions serveur n'ont aucune page vue en face.
    expect(slo.attainment).toBeCloseTo(0.8, 10);
    // (1 − 0,8) / (1 − 0,97) × 100 ≈ 667 % : écrit tel quel.
    expect(slo.burned_pct).toBeCloseTo((0.2 / 0.03) * 100, 6);
    expect(slo.burned_pct).toBeGreaterThan(0);
    // Au-delà de 999 : plus de plafond.
    await c.query("update slo set objective = 0.9999 where app_id = $1", [WEB]);
    const [haut] = await lib.q<{ burned_pct: number }>("select burned_pct from slo_status($1)", [WEB]);
    expect(haut.burned_pct).toBeGreaterThan(999);
  });

  it("releases d'un groupe : la plus récente est la dernière, chacune avec ses occurrences", async () => {
    const r = await lib.releasesDuGroupe({ app_id: WEB, fingerprint: "rc26-fp-rel" }, filtres(`app=${WEB}&period=24h`));
    expect(r.derniere?.release).toBe("4.13.0");
    expect(r.premiere?.release).toBe("4.12.0");
    expect(r.distinctes).toBe(2);
    expect(r.parRelease.map((l) => [l.release, l.occurrences])).toEqual([
      ["4.13.0", 48],
      ["4.12.0", 7],
    ]);
  });

  it("releases d'une issue : ses lignes, plus la release persistée de sa première occurrence (purgée)", async () => {
    const r = await lib.releasesDeLIssue({ app_id: WEB, issue_id: ISSUE, first_release: "4.10.0", first_seen: new Date(Date.now() - 40 * 86_400_000) });
    expect(r.derniere?.release).toBe("4.13.0");
    expect(r.premiere?.release).toBe("4.10.0");
    expect(r.parRelease.map((l) => [l.release, l.occurrences])).toEqual([
      ["4.13.0", 5],
      ["4.12.0", 5],
      ["4.10.0", null],
    ]);
  });
});
