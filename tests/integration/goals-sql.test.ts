// F66 — lectures de l'écran Conversions (§ 5.14.3) sur un vrai PostgreSQL.
//
// Ce que la base seule peut dire :
//   · la requête UNIQUE rend les mêmes conversions que l'ancienne boucle (une
//     requête par objectif) sur un seed de 5 objectifs d'une app ;
//   · le périmètre est celui du PRINCIPAL : un viewer restreint à A qui demande
//     « toutes les apps » ne lit ni objectif, ni conversion, ni session de B, dans
//     `listGoals`, `goalConversions` et `goalConversionsByDevice` ; `apps = []` ne
//     lit rien ;
//   · un objectif se rapporte aux sessions de SON app, par appareil compris, et
//     l'appareil inconnu reste une ligne à part ;
//   · plage personnalisée, tablette et « Inconnu » s'appliquent ; `shift` lit la
//     période précédente.
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

const A = "f66-sql-a";
const B = "f66-sql-b";
const APPS_F66 = [A, B];

const HEURE = 3_600_000;
const NOW = Date.now();
const IL_Y_A = (ms: number) => new Date(NOW - ms);

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return [
    "schema.sql",
    ...readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f))
      .sort((a, b) => version(a) - version(b)),
  ].map((f) => join(SQL_DIR, f));
}

async function nettoyerF66(c: pg.Client): Promise<void> {
  for (const table of ["goal", "rum_event", "rum_pageview", "rum_session"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS_F66]);
  }
}

interface SessionF66 {
  id: string;
  app: string;
  device: string | null;
  quand: Date;
  vues: string[];
  evenements?: string[];
  bot?: boolean;
}

// App A : cinq sessions humaines dans les dernières 24 h (a1-a5), un robot (a6),
// une session d'il y a 30 h (a9, période précédente) et une de 3 jours (a8, hors
// des deux). App B : deux sessions, un objectif « /merci ».
const SESSIONS_F66: SessionF66[] = [
  { id: "f66-a1", app: A, device: "desktop", quand: IL_Y_A(2 * HEURE), vues: ["/", "/merci"], evenements: ["checkout_start"] },
  { id: "f66-a2", app: A, device: "mobile", quand: IL_Y_A(3 * HEURE), vues: ["/", "/produit/1"], evenements: ["checkout_start", "purchase"] },
  { id: "f66-a3", app: A, device: "mobile", quand: IL_Y_A(4 * HEURE), vues: ["/merci"] },
  { id: "f66-a4", app: A, device: "tablet", quand: IL_Y_A(5 * HEURE), vues: ["/panier"], evenements: ["purchase_ok"] },
  { id: "f66-a5", app: A, device: null, quand: IL_Y_A(6 * HEURE), vues: ["/"] },
  { id: "f66-a6", app: A, device: "desktop", quand: IL_Y_A(2 * HEURE), vues: ["/merci"], bot: true },
  { id: "f66-a8", app: A, device: "desktop", quand: IL_Y_A(72 * HEURE), vues: ["/merci"], evenements: ["purchase"] },
  { id: "f66-a9", app: A, device: "desktop", quand: IL_Y_A(30 * HEURE), vues: ["/merci"] },
  { id: "f66-b1", app: B, device: "desktop", quand: IL_Y_A(2 * HEURE), vues: ["/merci"] },
  { id: "f66-b2", app: B, device: "mobile", quand: IL_Y_A(3 * HEURE), vues: ["/"] },
];

// Cinq objectifs actifs dans A (exact / contient, page vue / événement, un jamais
// atteint), un inactif ; un dans B.
const OBJECTIFS_F66 = [
  { app: A, name: "Merci", kind: "pageview", pattern: "/merci", match: "exact", active: true },
  { app: A, name: "Produit", kind: "pageview", pattern: "/produit", match: "contains", active: true },
  { app: A, name: "Début checkout", kind: "event", pattern: "checkout_start", match: "exact", active: true },
  { app: A, name: "Achat", kind: "event", pattern: "purchase", match: "contains", active: true },
  { app: A, name: "Jamais", kind: "pageview", pattern: "/nulle-part", match: "exact", active: true },
  { app: A, name: "Inactif", kind: "pageview", pattern: "/", match: "exact", active: false },
  { app: B, name: "Merci B", kind: "pageview", pattern: "/merci", match: "exact", active: true },
];

async function semerF66(c: pg.Client): Promise<void> {
  for (const s of SESSIONS_F66) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $3, $4, $5, $5, $6)`,
      [s.id, s.app, s.device, s.bot ?? false, s.quand, s.vues.length],
    );
    for (const [i, route] of s.vues.entries()) {
      await c.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, url, started_at) values ($1, $2, $3, $4, $5, $6)`,
        [`${s.id}-pv${i}`, s.id, s.app, route, `https://site.example${route}`, new Date(s.quand.getTime() + i * 60_000)],
      );
    }
    for (const [i, nom] of (s.evenements ?? []).entries()) {
      await c.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, ts) values ($1, $2, $3, '/', $4, $5)`,
        [`${s.id}-ev${i}`, s.id, s.app, nom, new Date(s.quand.getTime() + (i + 5) * 60_000)],
      );
    }
  }
  for (const g of OBJECTIFS_F66) {
    await c.query(
      `insert into goal (app_id, name, kind, pattern, match_type, active) values ($1, $2, $3, $4, $5, $6)`,
      [g.app, g.name, g.kind, g.pattern, g.match, g.active],
    );
  }
}

/**
 * L'ANCIENNE boucle (queries-goals.ts avant F66), recopiée telle quelle : une
 * requête pour le dénominateur, puis une par objectif. Référence du test
 * d'équivalence, sur une app nommée (seul cas où elle lisait juste).
 */
async function ancienneBoucleF66(c: pg.Client, app: string): Promise<{ total: number; parObjectif: Record<string, number> }> {
  const [d] = (
    await c.query<{ n: number }>(
      `select count(distinct p.session_id)::int as n
       from rum_pageview p
       join rum_session s on s.session_id = p.session_id
       where p.started_at > now() - interval '24 hours'
         and ($1::text is null or p.app_id = $1)
         and ($2::text is null or s.device_type = $2) and not coalesce(s.is_bot, false)`,
      [app, null],
    )
  ).rows;
  const goals = (
    await c.query<{ name: string; kind: string; pattern: string; match_type: string }>(
      `select name, kind, pattern, match_type from goal where app_id = $1 and active`,
      [app],
    )
  ).rows;
  const parObjectif: Record<string, number> = {};
  for (const g of goals) {
    const table = g.kind === "event" ? "rum_event" : "rum_pageview";
    const col = g.kind === "event" ? "name" : "route";
    const tsCol = g.kind === "event" ? "ts" : "started_at";
    const cond = g.match_type === "contains" ? `position($3 in coalesce(ev.${col}, '')) > 0` : `ev.${col} = $3`;
    const [r] = (
      await c.query<{ n: number }>(
        `select count(distinct ev.session_id)::int as n
         from ${table} ev
         join rum_session s on s.session_id = ev.session_id
         where ev.${tsCol} > now() - interval '24 hours'
           and ($1::text is null or ev.app_id = $1)
           and ($2::text is null or s.device_type = $2) and not coalesce(s.is_bot, false)
           and ${cond}`,
        [app, null, g.pattern],
      )
    ).rows;
    parObjectif[g.name] = r.n;
  }
  return { total: d.n, parObjectif };
}

/** Modules console branchés sur la base jetable (cf. echantillonnage-sql). */
async function consoleSurF66(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const goals = await import("../../apps/console/lib/queries-goals");
  const filters = await import("../../apps/console/lib/filters");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...goals, ...filters, pool };
}

const ADMIN_F66: ScopePrincipal = { role: "admin", apps: null };
const VIEWER_A_F66: ScopePrincipal = { role: "viewer", apps: [A] };

function requeteF66(qs: string, principal: ScopePrincipal = ADMIN_F66): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
  return parsed.value;
}

(url ? describe : describe.skip)("F66 — lectures de /goals sur le contrat (PostgreSQL)", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Awaited<ReturnType<typeof consoleSurF66>>;
  const f = (qs: string, principal: ScopePrincipal = ADMIN_F66) => lib.deviceFiltersOfQuery(requeteF66(qs, principal));
  const parNom = <T extends { name: string }>(rows: T[]) => Object.fromEntries(rows.map((r) => [r.name, r]));

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyerF66(c);
    await semerF66(c);
    lib = await consoleSurF66(url!);
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyerF66(c);
    await c.end();
  });

  it("requête unique = ancienne boucle, sur 5 objectifs d'une app", async () => {
    const ancien = await ancienneBoucleF66(c, A);
    const nouveau = await lib.goalConversions(f(`app=${A}&period=24h`));
    expect(nouveau.total).toBe(ancien.total);
    expect(nouveau.total).toBe(5); // a1-a5 ; le robot a6 exclu, a8 et a9 hors fenêtre
    expect(Object.fromEntries(nouveau.rows.map((r) => [r.name, r.conversions]))).toEqual(ancien.parObjectif);
    expect(ancien.parObjectif).toEqual({ Merci: 2, Produit: 1, "Début checkout": 2, Achat: 2, Jamais: 0 });
  });

  it("taux sur les sessions de l'app de l'objectif ; dernière conversion ; inactif absent", async () => {
    const { rows } = await lib.goalConversions(f(`app=${A}&period=24h`));
    const g = parNom(rows);
    expect(g.Merci).toMatchObject({ app_id: A, sessions: 5, conversions: 2, rate: 0.4 });
    expect(g.Jamais).toMatchObject({ conversions: 0, rate: 0, derniere: null });
    // a1 : « /merci » vue 1 min après son début, il y a 2 h — plus récente que a3.
    expect(new Date(g.Merci.derniere!).getTime()).toBe(IL_Y_A(2 * HEURE).getTime() + 60_000);
    expect(g.Inactif).toBeUndefined();
  });

  it("viewer restreint à A + app=all : aucun objectif, aucune conversion, aucune session de B", async () => {
    const viewer = f("period=24h", VIEWER_A_F66);
    expect((await lib.listGoals([A])).every((g) => g.app_id === A)).toBe(true);
    expect((await lib.listGoals([A])).map((g) => g.name)).not.toContain("Merci B");
    const rep = await lib.goalConversions(viewer);
    expect(rep.total).toBe(5); // 7 si B était lue
    expect(rep.rows.every((r) => r.app_id === A)).toBe(true);
    const idsA = new Set(rep.rows.map((r) => r.id));
    const parAppareil = await lib.goalConversionsByDevice(viewer);
    expect(parAppareil.length).toBeGreaterThan(0);
    expect(parAppareil.every((l) => idsA.has(l.goal_id))).toBe(true);
  });

  it("apps = [] : zéro ligne partout", async () => {
    expect(await lib.listGoals([])).toEqual([]);
    const q = requeteF66("period=24h");
    const aucun = lib.deviceFiltersOfQuery({ ...q, scope: { requestedApp: null, authorizedApps: [], effectiveApps: [] } });
    expect(await lib.goalConversions(aucun)).toEqual({ total: 0, rows: [] });
    expect(await lib.goalConversionsByDevice(aucun)).toEqual([]);
  });

  it("admin + toutes les apps : chaque objectif se rapporte aux sessions de SON app", async () => {
    const rep = await lib.goalConversions(f("period=24h"));
    const g = parNom(rep.rows);
    expect(g["Merci B"]).toMatchObject({ app_id: B, sessions: 2, conversions: 1, rate: 0.5 });
    expect(g.Merci).toMatchObject({ app_id: A, sessions: 5, conversions: 2 });
    expect(rep.total).toBeGreaterThanOrEqual(7);
  });

  it("par appareil : dénominateur de l'appareil dans l'app de l'objectif ; « Inconnu » à part", async () => {
    const { rows } = await lib.goalConversions(f(`app=${A}&period=24h`));
    const merci = parNom(rows).Merci.id;
    const lignes = (await lib.goalConversionsByDevice(f(`app=${A}&period=24h`))).filter((l) => l.goal_id === merci);
    expect(lignes).toEqual([
      { goal_id: merci, device: "desktop", sessions: 1, conversions: 1 }, // a1 (le robot a6 exclu)
      { goal_id: merci, device: "mobile", sessions: 2, conversions: 1 }, // a2, a3
      { goal_id: merci, device: "tablet", sessions: 1, conversions: 0 }, // a4
      { goal_id: merci, device: null, sessions: 1, conversions: 0 }, // a5
    ]);
  });

  it("tablette et appareil inconnu s'appliquent (plus de lecture historique)", async () => {
    expect((await lib.goalConversions(f(`app=${A}&period=24h&device=tablet`))).total).toBe(1); // a4
    expect((await lib.goalConversions(f(`app=${A}&period=24h&seg=v2:device:is_null`))).total).toBe(1); // a5
  });

  it("plage personnalisée : [from, to) du contrat", async () => {
    const from = IL_Y_A(31 * HEURE).toISOString();
    const to = IL_Y_A(29 * HEURE).toISOString();
    const rep = await lib.goalConversions(f(`app=${A}&from=${from}&to=${to}`));
    expect(rep.total).toBe(1); // a9 seule
    expect(parNom(rep.rows).Merci).toMatchObject({ sessions: 1, conversions: 1, rate: 1 });
  });

  it("shift : la même lecture sur la période précédente contiguë", async () => {
    const prec = await lib.goalConversions(f(`app=${A}&period=24h`), true);
    expect(prec.total).toBe(1); // a9 (il y a 30 h) ; a8 (3 jours) hors des deux périodes
    expect(parNom(prec.rows).Merci.conversions).toBe(1);
  });

  it("une conversion hors du dénominateur n'est pas comptée : le taux reste une part", async () => {
    // a7 : un achat dans la fenêtre, mais aucune page vue — hors des sessions de la fenêtre.
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at) values ('f66-a7', $1, 'desktop', $2, $2)`,
      [A, IL_Y_A(HEURE)],
    );
    await c.query(`insert into rum_event (span_id, session_id, app_id, route, name, ts) values ('f66-a7-ev', 'f66-a7', $1, '/', 'purchase', $2)`, [
      A,
      IL_Y_A(HEURE),
    ]);
    const rep = await lib.goalConversions(f(`app=${A}&period=24h`));
    expect(parNom(rep.rows).Achat).toMatchObject({ conversions: 2, sessions: 5 });
    expect(rep.rows.every((r) => r.rate == null || r.rate <= 1)).toBe(true);
  });
});
