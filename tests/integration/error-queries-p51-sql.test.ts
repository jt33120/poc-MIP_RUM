// P5.1 — la lecture console des erreurs, prouvée sur PostgreSQL avec le jeu de
// recette partagé (§6 du contrat P5.1, repris par l'E2E error-tracking).
//
// Pourquoi une base réelle. Le test unitaire verrouille la FORME du SQL ; il ne
// prouve ni qu'une session d'un autre tenant ne prête pas son appareil, ni que
// 37 + 1 donnent 38 dans la liste, le détail, la tendance et le widget, ni qu'un
// curseur survit à deux occurrences séparées d'une microseconde. Seul PostgreSQL
// dit tout cela.
//
// Deux bases jetables : SQL_TEST_DATABASE_URL (schéma courant, v69 comprise) et,
// si fournie, SQL_TEST_V68_DATABASE_URL — la fenêtre de déploiement où Vercel
// publie la console avant que Railway n'applique v69.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Filters } from "../../apps/console/lib/filters";
import type { ErrorFilters } from "../../apps/console/lib/queries-errors";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlV68 = process.env.SQL_TEST_V68_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

const A = "p51-app-a";
const B = "p51-app-b";
const C = "p51-app-c";
const APPS = [A, B, C];
const H1 = "a".repeat(64);
const T1 = "1".repeat(32);
const T2 = "2".repeat(32);
const P1 = "aaaaaaaaaaaaaaa1";
const ACT1 = "0123456789abcdef0123456789abcdef";
const DIAGNOSTIC_PRE_V69 =
  "migration v69 absente : corrélation trace/identité indisponible, compteurs historiques conservés";

const MINUTE_US = 60_000_000;
const JOUR_US = 1_440 * MINUTE_US;

interface Occurrence {
  nom: string;
  app: string;
  fingerprint: string | null;
  session: string | null;
  /** Décalage avant l'instant de référence, en microsecondes. */
  avantUs: number;
  occurrences: number;
  trace?: string;
  parent?: string;
  action?: string;
  user?: string;
  source?: string;
  handled?: boolean;
}

// Ordre d'insertion = ordre des `id`. r9 est écrite AVANT r8 : son id est plus
// petit alors que son horodatage est plus grand d'une microseconde. Un curseur
// tronqué à la milliseconde (ce que ferait un passage par Date) exclurait donc r8
// de la page suivante — la perte que le curseur microseconde existe pour éviter.
const OCCURRENCES: Occurrence[] = [
  { nom: "r1", app: A, fingerprint: "p51fp001", session: "p51-a-desktop", avantUs: 10 * MINUTE_US, occurrences: 37,
    trace: T1, parent: P1, action: ACT1, user: H1, source: "browser_js", handled: false },
  { nom: "r2", app: A, fingerprint: "p51fp001", session: "p51-a-desktop", avantUs: 9 * MINUTE_US, occurrences: 1,
    trace: T2, parent: "bbbbbbbbbbbbbbb1" },
  { nom: "r3", app: A, fingerprint: "p51fp001", session: "p51-a-desktop", avantUs: 3 * JOUR_US, occurrences: 5 },
  { nom: "r4", app: A, fingerprint: "p51fp001", session: "p51-a-tablet", avantUs: 8 * MINUTE_US, occurrences: 7 },
  { nom: "r5", app: A, fingerprint: "p51fp001", session: "p51-a-bot", avantUs: 7 * MINUTE_US, occurrences: 11 },
  { nom: "r6", app: A, fingerprint: "p51fp001", session: null, avantUs: 6 * MINUTE_US, occurrences: 2 },
  { nom: "r7", app: B, fingerprint: "p51fp001", session: "p51-b-desktop", avantUs: 5 * MINUTE_US, occurrences: 13,
    trace: T2 },
  { nom: "r9", app: C, fingerprint: "p51fp002", session: "p51-c-desktop", avantUs: 4 * MINUTE_US - 1, occurrences: 1 },
  { nom: "r8", app: C, fingerprint: "p51fp002", session: "p51-c-desktop", avantUs: 4 * MINUTE_US, occurrences: 1 },
  // Référence d'une session d'un AUTRE tenant : elle ne doit lui prêter ni
  // appareil, ni visiteur, ni lien.
  { nom: "r10", app: A, fingerprint: "p51fp004", session: "p51-b-desktop", avantUs: 3 * MINUTE_US, occurrences: 3 },
];

function fichiersSql(maxVersion = Number.POSITIVE_INFINITY): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f) && version(f) <= maxVersion)
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(c: pg.Client): Promise<void> {
  // Les erreurs d'abord : r10 référence la session de B depuis A (clé étrangère).
  for (const table of ["error_status", "rum_error", "replay_chunk", "rum_span", "rum_action", "rum_session", "app_registry"])
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
}

async function semer(c: pg.Client, v69: boolean): Promise<void> {
  await c.query("begin");
  try {
    // Une transaction = une horloge : tous les décalages partent du même now(),
    // tronqué à la milliseconde pour que r8 tombe exactement sur une frontière.
    const [{ ref_ms: refMs }] = (await c.query<{ ref_ms: number }>(
      "select (extract(epoch from date_trunc('milliseconds', now())) * 1000)::float8 as ref_ms",
    )).rows;
    await c.query(
      `insert into app_registry (app_id, name, active, internal)
       select app, app, true, false from unnest($1::text[]) as app
       on conflict (app_id) do update set active = true, internal = false`,
      [APPS],
    );
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, visitor_id, user_id_hash, sample_rate, error_sample_rate)
       values ('p51-a-desktop', $1, 'desktop', false, 'vis-a1', $4, 1, 1),
              ('p51-a-tablet',  $1, 'tablet',  false, null,     null, 1, 1),
              ('p51-a-bot',     $1, 'desktop', true,  'vis-bot', null, 1, 1),
              ('p51-b-desktop', $2, 'desktop', false, 'vis-b1', null, 1, 1),
              ('p51-c-desktop', $3, 'desktop', false, 'vis-c1', null, 1, 1)`,
      [A, B, C, H1],
    );
    await c.query(
      `insert into rum_span (span_id, trace_id, parent_span_id, tier, session_id, app_id, duration_ms, name, kind, ts)
       values ($1, $2, null, 'front', 'p51-a-desktop', $3, 120, 'POST /api/pay', 'client', now() - interval '10 minutes'),
              ('aaaaaaaaaaaaaaa2', $2, $1, 'back', null, $3, 80, 'POST /api/pay', 'server', now() - interval '10 minutes'),
              ('bbbbbbbbbbbbbbb1', $4, null, 'front', 'p51-b-desktop', $5, 50, 'GET /api/cart', 'client', now() - interval '5 minutes')`,
      [P1, T1, A, T2, B],
    );
    await c.query(
      `insert into rum_action (action_id, span_id, session_id, app_id, type, name, ts)
       values ($1, 'ccccccccccccccc1', 'p51-a-desktop', $2, 'click', 'Payer', now() - interval '10 minutes 1 second')`,
      [ACT1, A],
    );
    const minute = 60_000;
    const evenements = [
      { type: 4, data: { href: "https://recette.example/checkout", width: 1280, height: 720 }, timestamp: refMs - 11 * minute },
      { type: 2, data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { left: 0, top: 0 } }, timestamp: refMs - 11 * minute },
      { type: 3, data: { source: 1, positions: [{ x: 40, y: 60, id: 1, timeOffset: 0 }] }, timestamp: refMs - 10 * minute },
      { type: 3, data: { source: 1, positions: [{ x: 80, y: 90, id: 1, timeOffset: 0 }] }, timestamp: refMs - 8 * minute },
    ];
    await c.query(
      "insert into replay_chunk (session_id, app_id, seq, events_count, body) values ('p51-a-desktop', $1, 0, $2, $3)",
      [A, evenements.length, gzipSync(JSON.stringify(evenements))],
    );
    for (const o of OCCURRENCES) {
      const colonnes = ["app_id", "fingerprint", "session_id", "occurrences", "action_id", "error_type", "message", "kind", "release"];
      const valeurs: unknown[] = [o.app, o.fingerprint, o.session, o.occurrences, o.action ?? null, "TypeError",
        `boom ${o.nom}`, "error", "1.4.2"];
      if (v69) {
        colonnes.push("trace_id", "source_parent_span_id", "user_id_hash", "error_source", "handled");
        valeurs.push(o.trace ?? null, o.parent ?? null, o.user ?? null, o.source ?? null, o.handled ?? null);
      }
      valeurs.push(o.avantUs);
      await c.query(
        `insert into rum_error (${colonnes.join(", ")}, ts)
         values (${colonnes.map((_, i) => `$${i + 1}`).join(", ")},
                 date_trunc('milliseconds', now()) - $${valeurs.length}::bigint * interval '1 microsecond')`,
        valeurs,
      );
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

/**
 * Modules console branchés sur `databaseUrl`. db.ts lit DATABASE_URL à
 * l'évaluation et mémorise son pool sur globalThis : viser une autre base exige
 * d'oublier ce pool ET le registre de modules.
 */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const errors = await import("../../apps/console/lib/queries-errors");
  const widgets = await import("../../apps/console/lib/widget-data");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...errors, ...widgets, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const filtres = (over: Partial<ErrorFilters> = {}): ErrorFilters => ({
  app: A,
  period: "24h",
  device: "desktop",
  segment: [],
  includeBots: false,
  includeInternal: false,
  ...over,
});
const somme = (values: number[]) => values.reduce((s, v) => s + v, 0);
const PAGE = { limit: 100, offset: 0 };
const MESSAGE = (o: Occurrence["nom"]) => `boom ${o}`;

// ═══════════════════════════ Schéma courant (v69) ═════════════════════════════

(url ? describe : describe.skip)("lecture des erreurs P5.1 sur PostgreSQL (schéma courant)", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyer(c);
    await semer(c, true);
    lib = await consoleSur(url!);
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  it("A, desktop : 38 dans la ligne, les totaux, la tendance, les séries, le détail et le widget", async () => {
    const list = await lib.listErrorGroups(filtres(), PAGE, { series: true });
    // p51fp004 n'a aucune session de son app : le filtre d'appareil l'exclut.
    expect(list.total).toBe(1);
    expect(list.groups).toHaveLength(1);
    const [g] = list.groups;
    expect(g).toMatchObject({
      app_id: A, fingerprint: "p51fp001", error_type: "TypeError", occurrences: 38, sessions: 1, users_affected: 1,
      sessions_affected: 1, visitors_affected: 1, identified_users_affected: 1, session_coverage: 1, identity_coverage: 1,
      status: "open", resolved_at: null, regressed: false,
    });
    // Première vue « depuis toujours » : r3, hors fenêtre de 24 h.
    expect(Date.now() - g.first_seen.getTime()).toBeGreaterThan(2 * 86_400_000);
    expect(list.totals).toEqual({
      occurrences: 38, sessions_affected: 1, visitors_affected: 1, identified_users_affected: 1,
      session_coverage: 1, identity_coverage: 1, groups: 1, unfingerprinted: 0,
    });
    expect(list.unfingerprinted).toBe(0);
    expect(list.trend).toHaveLength(25);
    expect(somme(list.trend.map((p) => p.occurrences))).toBe(38);
    expect(g.series).toEqual(list.trend.map((p) => p.occurrences));
    expect(list.sampling).toEqual({ min_inclusion_probability: 1, message: null });
    expect(list.enrichment).toEqual({ available: true, diagnostic: null });
    expect(list.page).toEqual(PAGE);

    const detail = await lib.errorGroupDetail({ app_id: A, fingerprint: "p51fp001" }, filtres(), { limit: 100, cursor: null });
    expect(detail?.group.occurrences).toBe(38);
    expect(detail?.trend).toHaveLength(25);
    expect(somme(detail!.trend.map((p) => p.occurrences))).toBe(38);
    expect(somme(detail!.occurrences.map((o) => o.occurrences))).toBe(38);

    // Même lecture pour le widget, filtres du tableau de bord tels quels.
    const widgetFilters: Filters = { app: A, period: "24h", device: "desktop", segment: [], includeBots: false, includeInternal: false };
    const tuile = await lib.resolveWidget({ type: "top_errors", title: "Top erreurs" }, widgetFilters);
    expect(tuile).toEqual({ kind: "table", columns: ["Erreur", "Occurrences", "Sessions"], rows: [["TypeError", 38, 1]] });
    expect(lib.widgetToCsv("Top erreurs", tuile)).toContain("TypeError,38,1");
  });

  it("A, tous appareils : 47 et 3, un impact inconnu reste NULL et n'est jamais un zéro", async () => {
    const list = await lib.listErrorGroups(filtres({ device: null }), PAGE);
    expect(list.total).toBe(2);
    // Visiteur connu avant visiteur inconnu (`nulls last`).
    expect(list.groups.map((g) => g.fingerprint)).toEqual(["p51fp001", "p51fp004"]);
    const [fp001, fp004] = list.groups;
    expect(fp001).toMatchObject({
      occurrences: 47, sessions_affected: 2, visitors_affected: 1, identified_users_affected: 1, sessions: 2, users_affected: 1,
    });
    expect(fp001.session_coverage).toBeCloseTo(45 / 47, 12);
    expect(fp001.identity_coverage).toBeCloseTo(38 / 47, 12);
    // La session citée par r10 appartient à B : elle ne prête rien à A.
    expect(fp004).toMatchObject({
      occurrences: 3, sessions_affected: null, visitors_affected: null, identified_users_affected: null,
      session_coverage: 0, identity_coverage: 0, sessions: 0, users_affected: 0,
    });
    expect(list.totals).toMatchObject({
      occurrences: 50, groups: 2, unfingerprinted: 0, sessions_affected: 2, visitors_affected: 1, identified_users_affected: 1,
    });
    expect(list.totals.session_coverage).toBeCloseTo(45 / 50, 12);
    expect(list.totals.identity_coverage).toBeCloseTo(38 / 50, 12);
    expect(somme(list.trend.map((p) => p.occurrences))).toBe(50);
  });

  it("A, desktop : 1 h → 38 sur 13 seaux, 7 j → 43 sur 29 seaux, bots inclus → 49", async () => {
    const heure = await lib.listErrorGroups(filtres({ period: "1h" }), PAGE);
    expect(heure.groups[0].occurrences).toBe(38);
    expect(heure.trend).toHaveLength(13);
    const semaine = await lib.listErrorGroups(filtres({ period: "7d" }), PAGE);
    expect(semaine.groups[0].occurrences).toBe(43);
    expect(semaine.trend).toHaveLength(29);
    expect(somme(semaine.trend.map((p) => p.occurrences))).toBe(43);
    const bots = await lib.listErrorGroups(filtres({ includeBots: true }), PAGE);
    expect(bots.groups[0].occurrences).toBe(49);
    expect(bots.totals.occurrences).toBe(49);
  });

  it("une empreinte partagée par deux apps : choix explicite dans le périmètre, jamais arbitraire", async () => {
    const tous = filtres({ app: null });
    await expect(lib.resolveErrorGroup("p51fp001", tous, null)).resolves.toEqual({
      kind: "ambiguous",
      candidates: [
        { app_id: A, occurrences: 38, last_seen: expect.any(Date) },
        { app_id: B, occurrences: 13, last_seen: expect.any(Date) },
      ],
    });
    await expect(lib.resolveErrorGroup("p51fp001", tous, [A])).resolves.toEqual({
      kind: "found", ref: { app_id: A, fingerprint: "p51fp001" },
    });
    await expect(lib.resolveErrorGroup("p51fp001", tous, [])).resolves.toEqual({ kind: "not_found" });
    await expect(lib.resolveErrorGroup("p51fp001", filtres({ app: B }), null)).resolves.toEqual({
      kind: "found", ref: { app_id: B, fingerprint: "p51fp001" },
    });
    await expect(lib.resolveErrorGroup("p51fp001", filtres({ app: C }), null)).resolves.toEqual({ kind: "not_found" });

    // La liste « toutes apps » d'un principal scopé : chaque (app, empreinte) est un groupe.
    const scoped = await lib.listErrorGroups(tous, PAGE, { apps: APPS });
    expect(scoped.groups.map((g) => [g.app_id, g.fingerprint, g.occurrences])).toEqual([
      [A, "p51fp001", 38], [B, "p51fp001", 13], [C, "p51fp002", 2],
    ]);
    expect(scoped.total).toBe(3);
    expect(scoped.totals.visitors_affected).toBe(3);
  });

  it("détail : exemplaire et occurrences de la même base, liens vérifiés dans la même app", async () => {
    const detail = await lib.errorGroupDetail({ app_id: A, fingerprint: "p51fp001" }, filtres(), { limit: 100, cursor: null });
    expect(detail).not.toBeNull();
    // L'exemplaire est la plus récente occurrence DE LA FENÊTRE FILTRÉE : r2, pas le bot r5.
    expect(detail!.last).toMatchObject({
      message: MESSAGE("r2"), occurrences: 1, trace_id: T2, source_parent_span_id: "bbbbbbbbbbbbbbb1",
      session_id: "p51-a-desktop", release: "1.4.2", error_source: null, handled: null, action_id: null,
    });
    expect(detail!.occurrences.map((o) => o.message)).toEqual([MESSAGE("r2"), MESSAGE("r1")]);
    const [r2, r1] = detail!.occurrences;
    expect(r1).toMatchObject({
      occurrences: 37, device_type: "desktop", trace_id: T1, source_parent_span_id: P1,
      error_source: "browser_js", handled: false, is_fatal: null,
    });
    expect(r1.links).toEqual({
      session: true, replay: true, trace: true, parent_span: true,
      action: { id: ACT1, name: "Payer", type: "click" },
    });
    // T2 n'a de spans que dans B : ni trace ni span parent depuis A.
    expect(r2.links).toEqual({ session: true, replay: true, trace: false, parent_span: false, action: null });
    for (const o of detail!.occurrences) {
      expect(o).not.toHaveProperty("cursor_ts");
      expect(o).not.toHaveProperty("cursor_id");
    }
    expect(detail!.page).toEqual({ limit: 100, next_cursor: null });
    expect(detail!.enrichment).toEqual({ available: true, diagnostic: null });

    const croise = await lib.errorGroupDetail({ app_id: A, fingerprint: "p51fp004" }, filtres({ device: null }), { limit: 100, cursor: null });
    expect(croise!.occurrences).toHaveLength(1);
    expect(croise!.occurrences[0]).toMatchObject({ session_id: "p51-b-desktop", device_type: null });
    expect(croise!.occurrences[0].links).toEqual({ session: false, replay: false, trace: false, parent_span: false, action: null });

    await expect(lib.errorGroupDetail({ app_id: C, fingerprint: "p51fp001" }, filtres({ app: C }), { limit: 100, cursor: null }))
      .resolves.toBeNull();
  });

  it("curseur (ts, id) : deux occurrences à 1 µs d'écart, aucune perdue entre les pages", async () => {
    const ref = { app_id: C, fingerprint: "p51fp002" };
    const f = filtres({ app: C });
    const page1 = await lib.errorGroupDetail(ref, f, { limit: 1, cursor: null });
    expect(page1!.occurrences.map((o) => o.message)).toEqual([MESSAGE("r9")]);
    const curseur1 = lib.parseErrorCursor(page1!.page.next_cursor);
    expect(curseur1?.ts).toMatch(/\.\d{6}Z$/);
    const page2 = await lib.errorGroupDetail(ref, f, { limit: 1, cursor: curseur1! });
    expect(page2!.occurrences.map((o) => o.message)).toEqual([MESSAGE("r8")]);
    const page3 = await lib.errorGroupDetail(ref, f, { limit: 1, cursor: lib.parseErrorCursor(page2!.page.next_cursor)! });
    expect(page3!.occurrences).toEqual([]);
    expect(page3!.page.next_cursor).toBeNull();

    // Le jeu est sensible au défaut : le même curseur tronqué à la milliseconde,
    // comme le produirait un passage par Date, perd r8.
    const tronque = { ts: page1!.occurrences[0].ts.toISOString().replace("Z", "000Z"), id: curseur1!.id };
    const perdue = await lib.errorGroupDetail(ref, f, { limit: 1, cursor: tronque });
    expect(perdue!.occurrences).toEqual([]);
  });

  it("échantillonnage : avertissement selon la probabilité d'inclusion d'une erreur, sans pondération", async () => {
    const lire = async () => (await lib.listErrorGroups(filtres(), PAGE)).sampling;
    try {
      expect(await lire()).toEqual({ min_inclusion_probability: 1, message: null });
      // Session hors échantillon mais erreurs toujours promues : p = 0,1 + 0,9 × 1 = 1.
      await c.query("update rum_session set sample_rate = 0.1, error_sample_rate = 1 where session_id = 'p51-a-desktop'");
      expect(await lire()).toEqual({ min_inclusion_probability: 1, message: null });
      await c.query("update rum_session set sample_rate = 0.1, error_sample_rate = 0 where session_id = 'p51-a-desktop'");
      const notice = await lire();
      expect(notice.min_inclusion_probability).toBeCloseTo(0.1, 12);
      expect(notice.message).toBe(
        "Erreurs observées sur un échantillon (probabilité d'inclusion minimale 10 %). Aucune extrapolation n'est appliquée.",
      );
      // Aucun compteur n'est extrapolé.
      expect((await lib.listErrorGroups(filtres(), PAGE)).totals.occurrences).toBe(38);
      const detail = await lib.errorGroupDetail({ app_id: A, fingerprint: "p51fp001" }, filtres(), { limit: 100, cursor: null });
      expect(detail!.sampling.message).toBe(notice.message);
    } finally {
      await c.query("update rum_session set sample_rate = 1, error_sample_rate = 1 where session_id = 'p51-a-desktop'");
    }
  });

  it("triage : une régression n'est jamais NULL et passe devant les groupes ouverts", async () => {
    try {
      await c.query(
        "insert into error_status (app_id, fingerprint, status, resolved_at) values ($1, 'p51fp001', 'resolved', now() - interval '1 hour')",
        [A],
      );
      const regression = await lib.listErrorGroups(filtres({ device: null }), PAGE);
      expect(regression.groups.map((g) => [g.fingerprint, g.status, g.regressed])).toEqual([
        ["p51fp001", "resolved", true], ["p51fp004", "open", false],
      ]);
      await c.query("update error_status set resolved_at = now() + interval '1 hour' where app_id = $1", [A]);
      const resolue = await lib.listErrorGroups(filtres({ device: null }), PAGE);
      expect(resolue.groups.map((g) => [g.fingerprint, g.status, g.regressed])).toEqual([
        ["p51fp004", "open", false], ["p51fp001", "resolved", false],
      ]);
    } finally {
      await c.query("delete from error_status where app_id = $1", [A]);
    }
  });

  it("totaux : les distincts se comptent sur la population, jamais en additionnant les groupes", async () => {
    // Ligne hors jeu §6, retirée aussitôt : le même visiteur touché par deux groupes.
    const { rows: [{ id }] } = await c.query<{ id: string }>(
      `insert into rum_error (app_id, fingerprint, session_id, occurrences, error_type, message, ts)
       values ($1, 'p51fp003', 'p51-c-desktop', 1, 'RangeError', 'boom r11', now() - interval '2 minutes') returning id`,
      [C],
    );
    try {
      const list = await lib.listErrorGroups(filtres({ app: C }), PAGE);
      expect(list.groups.map((g) => g.visitors_affected)).toEqual([1, 1]);
      expect(list.totals).toMatchObject({ occurrences: 3, groups: 2, sessions_affected: 1, visitors_affected: 1 });
    } finally {
      await c.query("delete from rum_error where id = $1", [id]);
    }
  });
});

// ═════════════════════ Fenêtre de déploiement : schéma v68 ════════════════════

(urlV68 ? describe : describe.skip)("lecture des erreurs P5.1 avant migration v69", () => {
  const c = new pg.Client(urlV68 ? { connectionString: urlV68 } : {});
  let lib: Console;

  beforeAll(async () => {
    await c.connect();
    // Base dédiée à l'ancien schéma : repartir de zéro garantit qu'aucun rejeu
    // précédent n'y a laissé v69.
    await c.query("drop schema public cascade; create schema public;");
    for (const file of fichiersSql(68)) await c.query(readFileSync(file, "utf8"));
    await semer(c, false);
    lib = await consoleSur(urlV68!);
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  it("compteurs historiques conservés, corrélation absente et dite, identité lue sur la session", async () => {
    const list = await lib.listErrorGroups(filtres(), PAGE, { series: true });
    expect(list.groups[0]).toMatchObject({
      fingerprint: "p51fp001", occurrences: 38, sessions: 1, users_affected: 1, identified_users_affected: 1,
    });
    expect(list.totals.occurrences).toBe(38);
    expect(somme(list.groups[0].series!)).toBe(38);
    expect(list.enrichment).toEqual({ available: false, diagnostic: DIAGNOSTIC_PRE_V69 });

    const detail = await lib.errorGroupDetail({ app_id: A, fingerprint: "p51fp001" }, filtres(), { limit: 100, cursor: null });
    expect(detail!.last).toMatchObject({
      message: MESSAGE("r2"), trace_id: null, source_parent_span_id: null, error_source: null, handled: null,
      is_fatal: null, view_name: null, env: null, service: null,
    });
    const r1 = detail!.occurrences.find((o) => o.message === MESSAGE("r1"))!;
    expect(r1.links).toEqual({
      session: true, replay: true, trace: false, parent_span: false,
      action: { id: ACT1, name: "Payer", type: "click" },
    });
    expect(detail!.enrichment).toEqual({ available: false, diagnostic: DIAGNOSTIC_PRE_V69 });
    await expect(lib.resolveErrorGroup("p51fp001", filtres({ app: null }), [A, B])).resolves.toMatchObject({ kind: "ambiguous" });
  });

  it("la sonde est relue à chaque lecture : v69 appliquée, la corrélation revient sans redémarrage", async () => {
    await c.query(readFileSync(join(SQL_DIR, "migration-v69.sql"), "utf8"));
    await c.query(
      "update rum_error set trace_id = $1, source_parent_span_id = $2 where app_id = $3 and message = $4",
      [T1, P1, A, MESSAGE("r1")],
    );
    const detail = await lib.errorGroupDetail({ app_id: A, fingerprint: "p51fp001" }, filtres(), { limit: 100, cursor: null });
    expect(detail!.enrichment).toEqual({ available: true, diagnostic: null });
    expect(detail!.occurrences.find((o) => o.message === MESSAGE("r1"))!.links).toMatchObject({ trace: true, parent_span: true });
  });
});
