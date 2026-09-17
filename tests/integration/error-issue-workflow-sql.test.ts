// P5.6 — workflow, régression et alerte par issue, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve et qu'aucun test unitaire ne peut prouver :
//   • migration-v73 se rejoue, ses contraintes, sa RLS et ses droits tiennent ;
//   • une nouvelle issue naît avec UNE notification, dans sa transaction ;
//   • check_new_errors garde son watermark pour l'historique et ignore les issues ;
//   • régression CONFIRMÉE seulement sur release postérieure vérifiée par marqueur,
//     « à vérifier » sinon ; deux écrivains concurrents, un commit tardif ;
//   • triage : 409, assigné dans le périmètre, référence de résolution, audit ;
//   • commentaires et liens scrubbés et bornés, historique paginé ;
//   • note historique importée une seule fois ;
//   • pic issue:<uuid> : somme observée, bots/env/route, no_data, baseline exacte,
//     MAD=0, clé de fenêtre ;
//   • routage et livraison vers un stub HTTP local sous deux déclencheurs, arriéré
//     sans règle soldé ;
//   • purge, effacement d'app et DSAR ;
//   • la fenêtre de déploiement où le code précède migration-v73.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_V68_DATABASE_URL=<autre base jetable> pnpm test:sql
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchOnce } from "../../apps/ingest/dispatch-alerts.mjs";
import { importerNotesHistoriques } from "../../apps/ingest/lib/error-issue-workflow.mjs";
import { travaux } from "../../apps/ingest/jobs/planifie.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlFenetre = process.env.SQL_TEST_V68_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

const A = "p56-app-a";
const B = "p56-app-b";
const APPS = [A, B];
const ADMIN = "p56-admin@test.local";
const VIEWER_A = "p56-viewer-a@test.local";
const VIEWER_B = "p56-viewer-b@test.local";
const INACTIF = "p56-inactif@test.local";
const SANS_APP = "p56-sans-app@test.local";
const muet = { info() {}, warn() {}, error() {} };

type Row = Record<string, unknown>;

function migrations(maxVersion = Number.POSITIVE_INFINITY): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f) && version(f) <= maxVersion)
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(db: pg.Pool) {
  await db.query("delete from audit_log where action like 'error_issue_%' and detail like '%p56-app-%'");
  await db.query("delete from alert_event where message like '%p56-app-%'");
  for (const table of ["alert_rule", "notify_channel", "error_issue", "error_status", "rum_error", "rum_session", "deploy_marker", "error_grouping_config"]) {
    if ((await db.query("select to_regclass($1) is not null as present", [`public.${table}`])).rows[0].present) {
      await db.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
    }
  }
  await db.query("delete from console_user where email like 'p56-%@test.local'");
}

async function enregistrer(db: pg.Pool) {
  await db.query(
    `insert into app_registry (app_id, name, active) select a, a, true from unnest($1::text[]) a
     on conflict (app_id) do update set active = true, retention_days = null`,
    [APPS],
  );
  await db.query(
    `insert into console_user (email, password_hash, role, apps, active) values
       ($1, 'x', 'admin', null, true), ($2, 'x', 'viewer', array[$6], true), ($3, 'x', 'viewer', array[$7], true),
       ($4, 'x', 'viewer', null, false), ($5, 'x', 'viewer', '{}', true)`,
    [ADMIN, VIEWER_A, VIEWER_B, INACTIF, SANS_APP, A, B],
  );
}

async function userId(db: pg.Pool, email: string): Promise<string> {
  return (await db.query("select id::text as id from console_user where email = $1", [email])).rows[0].id;
}

/** Issue telle que P5.5 la crée à l'ingestion. */
async function creerIssue(
  db: pg.Pool | pg.PoolClient,
  app: string,
  { origin = "new", lastSeen = "now() - interval '1 hour'", lastRelease = "1.0" }: { origin?: string; lastSeen?: string; lastRelease?: string | null } = {},
): Promise<{ id: string; key: string }> {
  const key = randomBytes(16).toString("hex");
  const { rows } = await db.query(
    `insert into error_issue (app_id, grouping_version, grouping_key, grouping_basis, origin, first_seen, last_seen, first_release, last_release)
     values ($1, 2, $2, 'normalized_frame', $3, ${lastSeen} - interval '1 day', ${lastSeen}, $4, $4)
     returning id::text as id`,
    [app, key, origin, lastRelease],
  );
  return { id: rows[0].id, key };
}

let span = 0;
const spanId = () => (0x56a0000000000000n + BigInt(++span)).toString(16);

/** Occurrence rattachée à une issue, telle que l'écrivain l'insère (RETURNING = lignes réellement écrites). */
async function occurrence(
  db: pg.Pool | pg.PoolClient,
  app: string,
  issue: { id: string; key: string },
  { ts = "now() - interval '2 minutes'", release = "1.0", env = "prod", occurrences = 1, session = null as string | null, route = "/panier", span: sid = spanId() } = {},
): Promise<Row[]> {
  const { rows } = await db.query(
    `insert into rum_error (span_id, session_id, app_id, route, message, stack, ts, occurrences, release, env,
                            grouping_version, grouping_key, grouping_basis, issue_id, fingerprint)
     values ($1, $2, $3, $4, 'TypeError: jean@exemple.fr sans panier', 'at f (app.js:1:2)', ${ts}, $5, $6, $7,
             2, $8, 'normalized_frame', $9, 'p56fp')
     on conflict (span_id) do nothing
     returning app_id, issue_id::text as issue_id, ts, release, env`,
    [sid, session, app, route, occurrences, release, env, issue.key, issue.id],
  );
  return rows;
}

/** Appel de la primitive de régression avec les lignes RETURNING d'un lot. */
async function enregistrerOccurrences(db: pg.Pool | pg.PoolClient, app: string, issueId: string, lignes: Row[]) {
  const { rows } = await db.query(
    "select error_issue_record_occurrences($1, $2, $3::timestamptz[], $4::text[], $5::text[]) as decision",
    [app, issueId, lignes.map((l) => l.ts), lignes.map((l) => l.release), lignes.map((l) => l.env)],
  );
  return rows[0].decision as string | null;
}

async function resoudre(db: pg.Pool, app: string, issueId: string, release: string | null, env: string | null, depuis = "30 minutes") {
  await db.query(
    `update error_issue set status = 'resolved', status_source = 'user', resolved_at = now() - $5::interval,
            resolved_release = $3, resolved_env = $4, revision = revision + 1
      where app_id = $1 and id = $2`,
    [app, issueId, release, env, depuis],
  );
}

async function marqueur(db: pg.Pool, app: string, version: string, env: string, ilYa: string) {
  await db.query("insert into deploy_marker (app_id, version, env, ts) values ($1, $2, $3, now() - $4::interval)", [app, version, env, ilYa]);
}

const notifications = async (db: pg.Pool, issueId: string) =>
  (await db.query("select kind, event_key, state, payload from error_issue_notification where issue_id = $1 order by id", [issueId])).rows;
const activites = async (db: pg.Pool, issueId: string) =>
  (await db.query("select * from error_issue_activity where issue_id = $1 order by created_at, id", [issueId])).rows;

/** Modules console branchés sur `databaseUrl` (db.ts lit DATABASE_URL à l'import). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const workflow = await import("../../apps/console/lib/error-issue-workflow");
  const alertes = await import("../../apps/console/lib/queries-v2");
  const dsar = await import("../../apps/console/lib/queries-dsar");
  const { pool: consolePool } = await import("../../apps/console/lib/db");
  return { ...workflow, ...alertes, ...dsar, consolePool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

/** Écoute un gestionnaire HTTP sur un port libre de la boucle locale. */
async function stub(): Promise<{ serveur: Server; base: string; recus: Array<{ url: string; corps: Row }> }> {
  const recus: Array<{ url: string; corps: Row }> = [];
  const serveur = createServer((req, res) => {
    let corps = "";
    req.on("data", (c) => (corps += c));
    req.on("end", () => {
      recus.push({ url: req.url ?? "", corps: JSON.parse(corps) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  return { serveur, base: `http://127.0.0.1:${(serveur.address() as { port: number }).port}`, recus };
}

// ═════════════════════════════ Schéma courant ══════════════════════════════════

(url ? describe : describe.skip)("P5.6 workflow des issues — PostgreSQL (schéma courant)", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 8 } : {});
  let lib: Console;

  beforeAll(async () => {
    // Rejouées DEUX FOIS : un pre-deploy relancé après un échec partiel.
    for (let passe = 0; passe < 2; passe++) {
      for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    }
    await nettoyer(pool);
    await enregistrer(pool);
    lib = await consoleSur(url!);
  }, 300_000);

  afterAll(async () => {
    await nettoyer(pool);
    await pool.end();
    await lib?.consolePool.end();
  });

  beforeEach(async () => {
    await pool.query("delete from alert_event where message like '%p56-app-%'");
    for (const table of ["alert_rule", "notify_channel", "error_issue", "error_status", "rum_error", "rum_session", "deploy_marker", "error_grouping_config"]) {
      await pool.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
    }
  });

  it("migration-v73 : tables, contraintes, déclencheurs et fonctions posés", async () => {
    const tables = (await pool.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'error_issue_%' order by 1`,
    )).rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(["error_issue_activity", "error_issue_notification", "error_issue_ticket"]));
    const fonctions = (await pool.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('error_issue_record_occurrences', 'route_error_issue_notifications',
          'issue_metric_window', 'issue_metric_baseline', 'issue_metric_observable_since') order by 1`,
    )).rows.map((r) => r.proname);
    expect(fonctions).toHaveLength(5);

    const issue = await creerIssue(pool, A);
    const refus = (sql: string, params: unknown[]) =>
      expect(pool.query(sql, params)).rejects.toMatchObject({ code: expect.stringMatching(/^23(514|503|505)$/) });
    const activite = `insert into error_issue_activity (app_id, issue_id, kind, actor_kind, body, old_status, new_status, release, reference_release, env)
                      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
    await refus(activite, [A, issue.id, "comment", "user", "x".repeat(2001), null, null, null, null, null]);
    await refus(activite, [A, issue.id, "comment", "system", "note sans empreinte", null, null, null, null, null]);
    await refus(activite, [A, issue.id, "regression", "system", null, "resolved", "open", "2.0", "1.0", null]);
    await refus(activite, [A, issue.id, "status", "system", null, "open", "resolved", null, null, null]);
    await refus(activite, [A, issue.id, "status", "user", null, "open", "open", null, null, null]);
    await refus(activite, [A, issue.id, "assignee", "user", null, "open", null, null, null, null]);
    await refus(activite, [B, issue.id, "comment", "user", "autre app", null, null, null, null, null]);
    const ticket = "insert into error_issue_ticket (app_id, issue_id, url, label) values ($1, $2, $3, $4)";
    await refus(ticket, [A, issue.id, "http://jira.exemple.fr/MIP-1", "MIP-1"]);
    await refus(ticket, [A, issue.id, `https://jira.exemple.fr/${"a".repeat(2030)}`, "MIP-1"]);
    await refus(ticket, [A, issue.id, "https://jira.exemple.fr/é", "MIP-1"]);
    await refus(ticket, [A, issue.id, "https://jira.exemple.fr/MIP-1", "x".repeat(121)]);
    const notification = "insert into error_issue_notification (app_id, issue_id, kind, rule_id, event_key, payload) values ($1, $2, $3, $4, $5, $6)";
    await refus(notification, [A, issue.id, "spike", null, "spike:x", {}]);
    await refus(notification, [A, issue.id, "new", null, `new:${issue.id}`, { text: "doublon" }]);
    await refus(notification, [A, issue.id, "regression", null, "r:gros", { text: "x".repeat(5000) }]);
    await refus("insert into alert_rule (app_id, metric, threshold, env) values ($1, 'LCP', 1, 'prod')", [A]);
    await refus("insert into alert_rule (app_id, metric, threshold) values ($1, 'issue:pas-un-uuid', 1)", [A]);
  });

  it("RLS et droits : console_ro lit et écrit sa portée, jamais l'outbox ni la clé de regroupement", async () => {
    const issueA = await creerIssue(pool, A);
    const issueB = await creerIssue(pool, B);
    const priv = (await pool.query(
      `select has_table_privilege('console_ro', 'error_issue_activity', 'INSERT') as activite_insert,
              has_table_privilege('console_ro', 'error_issue_activity', 'UPDATE') as activite_update,
              has_table_privilege('console_ro', 'error_issue_activity', 'DELETE') as activite_delete,
              has_table_privilege('console_ro', 'error_issue_ticket', 'INSERT') as ticket_insert,
              has_table_privilege('console_ro', 'error_issue_notification', 'SELECT') as outbox_select,
              has_table_privilege('console_ro', 'error_issue_notification', 'INSERT') as outbox_insert,
              has_column_privilege('console_ro', 'error_issue', 'status', 'UPDATE') as triage,
              has_column_privilege('console_ro', 'error_issue', 'grouping_key', 'UPDATE') as cle,
              has_column_privilege('console_ro', 'error_issue', 'app_id', 'UPDATE') as app`,
    )).rows[0];
    expect(priv).toEqual({
      activite_insert: true, activite_update: false, activite_delete: false, ticket_insert: true,
      outbox_select: true, outbox_insert: false, triage: true, cle: false, app: false,
    });

    const admin = await userId(pool, ADMIN);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role console_ro");
      await client.query("select set_config('app.current_app_id', $1, true)", [A]);
      expect((await client.query("select id::text as id from error_issue_notification where app_id = any($1::text[])", [APPS])).rows)
        .toHaveLength(1);
      await client.query(
        "insert into error_issue_activity (app_id, issue_id, kind, actor_kind, actor_user_id, body) values ($1, $2, 'comment', 'user', $3, 'ok')",
        [A, issueA.id, admin],
      );
      await client.query("update error_issue set status = 'for_review', revision = revision + 1 where id = $1", [issueA.id]);
      // L'issue de B n'existe pas pour A : ni lue, ni modifiée.
      expect((await client.query("update error_issue set status = 'ignored' where id = $1", [issueB.id])).rowCount).toBe(0);
      await client.query("savepoint s");
      await expect(client.query(
        "insert into error_issue_activity (app_id, issue_id, kind, actor_kind, body) values ($1, $2, 'comment', 'user', 'intrusion')",
        [B, issueB.id],
      )).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback to savepoint s");
      await client.query("select set_config('app.current_app_id', '', true)");
      expect((await client.query("select count(*)::int as n from error_issue_activity")).rows[0].n).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("nouvelle issue : une notification dans sa transaction ; migration, conflit et rollback n'en créent pas", async () => {
    const nouvelle = await creerIssue(pool, A);
    const recues = await notifications(pool, nouvelle.id);
    expect(recues).toHaveLength(1);
    expect(recues[0]).toMatchObject({ kind: "new", event_key: `new:${nouvelle.id}`, state: "pending" });
    // Charge minimale : ni message, ni stack, ni identité.
    expect(Object.keys(recues[0].payload).sort()).toEqual(["app_id", "first_release", "issue_id", "kind", "severity", "source", "text"]);

    const migree = await creerIssue(pool, A, { origin: "migration" });
    expect(await notifications(pool, migree.id)).toEqual([]);

    // Deux lots créent la même clé au même instant : une issue, une notification.
    const cle = randomBytes(16).toString("hex");
    const inserer = `insert into error_issue (app_id, grouping_version, grouping_key, grouping_basis, origin, first_seen, last_seen)
                     values ($1, 2, $2, 'low_confidence', 'new', now(), now())
                     on conflict (app_id, grouping_version, grouping_key) do nothing returning id::text as id`;
    const [c1, c2] = [await pool.connect(), await pool.connect()];
    try {
      await c1.query("begin");
      await c2.query("begin");
      const premier = await c1.query(inserer, [A, cle]);
      const second = c2.query(inserer, [A, cle]);
      await c1.query("commit");
      expect((await second).rowCount).toBe(0);
      await c2.query("commit");
      expect(await notifications(pool, premier.rows[0].id)).toHaveLength(1);

      await c1.query("begin");
      const annulee = await creerIssue(c1, A);
      await c1.query("rollback");
      expect(await notifications(pool, annulee.id)).toEqual([]);
    } finally {
      c1.release();
      c2.release();
    }
  });

  it("check_new_errors : watermark conservé pour les groupes historiques, lignes d'issue exclues", async () => {
    await pool.query("select check_new_errors()");
    const issue = await creerIssue(pool, A);
    await pool.query(
      `insert into rum_error (span_id, app_id, message, fingerprint, ts, issue_id, grouping_version, grouping_key, grouping_basis)
       values ($1, $2, 'rattachée', 'p56-fp-issue', now(), $3, 2, $4, 'normalized_frame')`,
      [spanId(), A, issue.id, issue.key],
    );
    expect((await pool.query("select check_new_errors() as n")).rows[0].n).toBe(0);
    await pool.query("insert into rum_error (span_id, app_id, message, fingerprint, ts) values ($1, $2, 'historique', 'p56-fp-legacy', now())", [spanId(), A]);
    expect((await pool.query("select check_new_errors() as n")).rows[0].n).toBe(1);
  });

  describe("régression", () => {
    it("confirmée seulement pour une release déployée strictement après la référence, dans son env", async () => {
      const issue = await creerIssue(pool, A);
      await marqueur(pool, A, "0.9", "prod", "20 days");
      await marqueur(pool, A, "1.0", "prod", "10 days");
      await marqueur(pool, A, "1.1", "staging", "3 days");
      await marqueur(pool, A, "1.1", "prod", "20 minutes");
      await marqueur(pool, A, "1.0", "prod", "10 minutes"); // retour arrière : 1.0 reste antérieure à 1.1
      await resoudre(pool, A, issue.id, "1.0", "prod");
      const revision = (await pool.query("select revision::text as r from error_issue where id = $1", [issue.id])).rows[0].r;

      const cas: Array<[string, Parameters<typeof occurrence>[3]]> = [
        ["même release", { release: "1.0" }],
        ["release plus ancienne", { release: "0.9" }],
        ["release sans marqueur (ordre inconnu)", { release: "2.0-rc" }],
        ["release « supérieure » lexicalement mais non déployée", { release: "9.9" }],
        ["autre env", { release: "1.1", env: "staging" }],
        ["env inconnu", { release: "1.1", env: null as unknown as string }],
        ["release absente", { release: null as unknown as string }],
      ];
      for (const [nom, options] of cas) {
        expect(await enregistrerOccurrences(pool, A, issue.id, await occurrence(pool, A, issue, options)), nom).toBe("reappearance");
      }
      expect(await enregistrerOccurrences(pool, A, issue.id, await occurrence(pool, A, issue, { release: "1.1", ts: "now() - interval '2 hours'" })))
        .toBeNull();
      expect((await pool.query("select status, revision::text as r from error_issue where id = $1", [issue.id])).rows[0])
        .toEqual({ status: "resolved", r: revision });

      // Un lot mêlant anciens clients et nouvelle release : la release postérieure l'emporte.
      const lot = [...await occurrence(pool, A, issue, { release: "1.0" }), ...await occurrence(pool, A, issue, { release: "1.1" })];
      expect(await enregistrerOccurrences(pool, A, issue.id, lot)).toBe("regression");
      expect((await pool.query("select status, status_source, resolved_at, resolved_release, revision::bigint - $2::bigint as delta from error_issue where id = $1", [issue.id, revision])).rows[0])
        .toEqual({ status: "open", status_source: "system", resolved_at: null, resolved_release: null, delta: "1" });
      expect(await activites(pool, issue.id)).toEqual([
        expect.objectContaining({ kind: "regression", actor_kind: "system", old_status: "resolved", new_status: "open", release: "1.1", reference_release: "1.0", env: "prod" }),
      ]);
      const recues = (await notifications(pool, issue.id)).filter((n) => n.kind === "regression");
      expect(recues).toHaveLength(1);
      expect(recues[0].payload).toMatchObject({ kind: "regression", release: "1.1", reference_release: "1.0", env: "prod" });

      // Rejouer le lot : aucune ligne insérée, donc rien à décider.
      const rejeu = await pool.query("insert into rum_error (span_id, app_id, ts) select span_id, app_id, ts from rum_error where issue_id = $1 on conflict (span_id) do nothing returning ts", [issue.id]);
      expect(rejeu.rowCount).toBe(0);
      expect(await enregistrerOccurrences(pool, A, issue.id, await occurrence(pool, A, issue, { release: "1.1" }))).toBeNull();
      expect((await notifications(pool, issue.id)).filter((n) => n.kind === "regression")).toHaveLength(1);
    });

    it("ignorée reste ignorée ; ouverte ou à revoir ne bouge pas", async () => {
      await marqueur(pool, A, "1.0", "prod", "10 days");
      await marqueur(pool, A, "1.1", "prod", "1 day");
      for (const statut of ["ignored", "open", "for_review"]) {
        const issue = await creerIssue(pool, A);
        await pool.query("update error_issue set status = $2 where id = $1", [issue.id, statut]);
        expect(await enregistrerOccurrences(pool, A, issue.id, await occurrence(pool, A, issue, { release: "1.1" })), statut).toBeNull();
        expect((await pool.query("select status from error_issue where id = $1", [issue.id])).rows[0].status).toBe(statut);
      }
    });

    it("deux écrivains concurrents : une seule activité, une seule notification", async () => {
      const issue = await creerIssue(pool, A);
      await marqueur(pool, A, "1.0", "prod", "10 days");
      await marqueur(pool, A, "1.1", "prod", "1 day");
      await resoudre(pool, A, issue.id, "1.0", "prod");
      const [c1, c2] = [await pool.connect(), await pool.connect()];
      try {
        await c1.query("begin");
        await c2.query("begin");
        const lot1 = await occurrence(c1, A, issue, { release: "1.1" });
        const lot2 = await occurrence(c2, A, issue, { release: "1.1" });
        expect(await enregistrerOccurrences(c1, A, issue.id, lot1)).toBe("regression");
        // Le second écrivain attend le verrou de l'issue, puis relit l'état validé.
        const second = enregistrerOccurrences(c2, A, issue.id, lot2);
        await new Promise((r) => setTimeout(r, 100));
        await c1.query("commit");
        expect(await second).toBeNull();
        await c2.query("commit");
      } finally {
        c1.release();
        c2.release();
      }
      expect((await activites(pool, issue.id)).filter((a) => a.kind === "regression")).toHaveLength(1);
      expect((await notifications(pool, issue.id)).filter((n) => n.kind === "regression")).toHaveLength(1);
      expect(Number((await pool.query("select count(*) from rum_error where issue_id = $1", [issue.id])).rows[0].count)).toBe(2);
    });

    it("commit tardif : un écrivain commencé avant la résolution décide sur l'état validé, et sa notification part", async () => {
      const issue = await creerIssue(pool, A);
      await marqueur(pool, A, "1.0", "prod", "10 days");
      await marqueur(pool, A, "1.1", "prod", "1 day");
      const admin = await userId(pool, ADMIN);
      const lent = await pool.connect();
      try {
        await lent.query("begin");
        // Occurrence d'un client dont l'horloge avance : horodatée après la résolution à venir.
        const lot = await occurrence(lent, A, issue, { release: "1.1", ts: "clock_timestamp() + interval '5 seconds'" });
        await pool.query(
          `update error_issue set status = 'resolved', resolved_at = clock_timestamp(), resolved_by_user_id = $2,
                  resolved_release = '1.0', resolved_env = 'prod', revision = revision + 1 where id = $1`,
          [issue.id, admin],
        );
        // Une passe de routage entre-temps ne voit rien : aucun curseur n'avance au-delà.
        await pool.query("select route_error_issue_notifications()");
        expect(await enregistrerOccurrences(lent, A, issue.id, lot)).toBe("regression");
        await lent.query("commit");
      } finally {
        lent.release();
      }
      expect(await pool.query("select route_error_issue_notifications() as n").then((r) => r.rows[0].n)).toBeGreaterThanOrEqual(1);
      expect((await notifications(pool, issue.id)).map((n) => [n.kind, n.state])).toEqual([
        ["new", "delivered"],
        ["regression", "delivered"],
      ]);
    });
  });

  describe("triage, commentaires, liens", () => {
    const ctx = (issueId: string, apps: string[] | null = null, actorEmail = ADMIN) => ({ issueId, apps, actorEmail });
    const revisionDe = async (issueId: string) =>
      (await pool.query("select revision::text as r from error_issue where id = $1", [issueId])).rows[0].r as string;

    it("statut et assignation : 409 sur révision lue périmée, périmètre, assigné autorisé sur l'app, audit", async () => {
      const issue = await creerIssue(pool, A, { lastRelease: "1.4" });
      // La dernière vue d'une issue est l'horodatage de sa dernière occurrence, relu à la milliseconde.
      await occurrence(pool, A, issue, {
        ts: `(select last_seen + interval '400 microseconds' from error_issue where id = '${issue.id}')`,
        release: "1.4",
        env: "prod",
      });
      await occurrence(pool, A, issue, { ts: "now() - interval '2 hours'", release: "1.3", env: "staging" });
      const r1 = await revisionDe(issue.id);
      const viewerA = await userId(pool, VIEWER_A);

      expect(await lib.triageIssue(ctx(issue.id), { app: B, status: "resolved", expectedRevision: r1 })).toEqual({ kind: "not_found" });
      expect(await lib.triageIssue(ctx(issue.id, [B]), { app: A, status: "resolved", expectedRevision: r1 })).toEqual({ kind: "not_found" });
      expect(await lib.triageIssue(ctx(issue.id, []), { app: A, status: "resolved", expectedRevision: r1 })).toEqual({ kind: "not_found" });
      expect(await lib.triageIssue(ctx(issue.id, null, "inconnu@test.local"), { app: A, status: "resolved", expectedRevision: r1 }))
        .toMatchObject({ kind: "forbidden" });
      for (const email of [VIEWER_B, INACTIF, SANS_APP]) {
        expect(await lib.triageIssue(ctx(issue.id), { app: A, assigneeUserId: await userId(pool, email), expectedRevision: r1 }), email)
          .toMatchObject({ kind: "invalid" });
      }

      const resolu = await lib.triageIssue(ctx(issue.id, [A]), { app: A, status: "resolved", assigneeUserId: viewerA, expectedRevision: r1 });
      expect(resolu).toMatchObject({
        kind: "ok",
        value: { status: "resolved", status_source: "user", resolved_release: "1.4", resolved_env: "prod", assignee: { user_id: viewerA, email: VIEWER_A }, resolved_by: { email: ADMIN } },
      });
      const r2 = await revisionDe(issue.id);
      expect(BigInt(r2) - BigInt(r1)).toBe(1n);
      expect(await lib.triageIssue(ctx(issue.id), { app: A, status: "ignored", expectedRevision: r1 }))
        .toMatchObject({ kind: "conflict", revision: r2 });
      // Rien à changer : ni révision, ni activité.
      expect(await lib.triageIssue(ctx(issue.id), { app: A, status: "resolved", expectedRevision: r2 })).toMatchObject({ kind: "ok" });
      expect(await revisionDe(issue.id)).toBe(r2);

      const rouvert = await lib.triageIssue(ctx(issue.id), { app: A, status: "open", assigneeUserId: null, expectedRevision: r2 });
      expect(rouvert).toMatchObject({ kind: "ok", value: { status: "open", resolved_at: null, resolved_release: null, resolved_env: null, resolved_by: null, assignee: null } });
      expect((await activites(pool, issue.id)).map((a) => [a.kind, a.old_status, a.new_status, a.release, a.env, a.new_assignee_user_id])).toEqual([
        ["status", "open", "resolved", "1.4", "prod", null],
        ["assignee", null, null, null, null, viewerA],
        ["status", "resolved", "open", null, null, null],
        ["assignee", null, null, null, null, null],
      ]);
      const audits = (await pool.query("select user_email, detail from audit_log where action = 'error_issue_triage' and detail like $1 order by id", [`%${issue.id}%`])).rows;
      expect(audits.map((a) => [a.user_email, JSON.parse(a.detail).status?.to ?? null])).toEqual([[ADMIN, "resolved"], [ADMIN, "open"]]);
    });

    it("deux éditions concurrentes sur la même révision : une réussit, l'autre reçoit 409", async () => {
      const issue = await creerIssue(pool, A);
      const r = await revisionDe(issue.id);
      const resultats = await Promise.all([
        lib.triageIssue(ctx(issue.id), { app: A, status: "ignored", expectedRevision: r }),
        lib.commentIssue(ctx(issue.id), { app: A, body: "je regarde", expectedRevision: r }),
      ]);
      expect(resultats.map((x) => x.kind).sort()).toEqual(["conflict", "ok"]);
    });

    it("commentaires et liens : stockés tels que validés, doublon en conflit, historique paginé à la microseconde", async () => {
      const issue = await creerIssue(pool, A);
      const autre = await creerIssue(pool, B);
      let revision = await revisionDe(issue.id);
      const corps = lib.parseCommentRequest({ app: A, body: " Voir avec paul@exemple.fr ", expectedRevision: revision });
      expect(corps.ok).toBe(true);
      const commente = await lib.commentIssue(ctx(issue.id), corps.ok ? corps.value : (null as never));
      expect(commente).toMatchObject({ kind: "ok", value: { activity: { kind: "comment", body: "Voir avec [email]", actor: { kind: "user", user: { email: ADMIN } } } } });
      revision = commente.kind === "ok" ? commente.value.revision : "";

      const lien = { app: A, url: "https://jira.exemple.fr/browse/MIP-7", label: "MIP-7", expectedRevision: revision };
      const lie = await lib.linkIssue(ctx(issue.id), lien);
      expect(lie).toMatchObject({ kind: "ok", value: { link: { url: lien.url, label: "MIP-7", created_by: { email: ADMIN } } } });
      revision = lie.kind === "ok" ? lie.value.revision : "";
      expect(await lib.linkIssue(ctx(issue.id), { ...lien, expectedRevision: revision })).toMatchObject({ kind: "conflict", error: expect.stringMatching(/déjà attaché/) });
      expect(await lib.commentIssue(ctx(autre.id), { app: B, body: "B", expectedRevision: await revisionDe(autre.id) })).toMatchObject({ kind: "ok" });

      for (let i = 0; i < 3; i++) {
        const fait = await lib.commentIssue(ctx(issue.id), { app: A, body: `suite ${i}`, expectedRevision: revision });
        revision = fait.kind === "ok" ? fait.value.revision : "";
      }
      // Même instant à la milliseconde, microsecondes distinctes : la pagination n'en perd aucune.
      await pool.query("update error_issue_activity set created_at = date_trunc('milliseconds', now()) + (id % 1000) * interval '1 microsecond' where issue_id = $1", [issue.id]);
      const vues: string[] = [];
      let curseur: { ts: string; id: string } | null = null;
      for (let page = 0; page < 5; page++) {
        const lu = await lib.listIssueActivity(issue.id, [A], { limit: 2, cursor: curseur });
        expect(lu.kind).toBe("ok");
        if (lu.kind !== "ok") break;
        vues.push(...lu.value.activities.map((a) => a.id));
        if (!lu.value.next_cursor) break;
        const [ts, id] = JSON.parse(Buffer.from(lu.value.next_cursor, "base64url").toString("utf8"));
        curseur = { ts, id };
      }
      const toutes = (await activites(pool, issue.id)).map((a) => String(a.id));
      expect([...vues].sort()).toEqual([...toutes].sort());
      expect(new Set(vues).size).toBe(5);
      expect(await lib.listIssueActivity(issue.id, [B], { limit: 10, cursor: null })).toEqual({ kind: "not_found" });

      const vue = await lib.issueWorkflowView(issue.id, A);
      expect(vue?.links.map((l) => l.url)).toEqual([lien.url]);
      expect(vue?.assignable_users.map((u) => u.email)).toEqual([ADMIN, VIEWER_A]);
    });
  });

  it("note historique : importée une fois par issue, scrubbée et tronquée, même sous deux déclencheurs", async () => {
    const issue = await creerIssue(pool, A, { origin: "migration" });
    const seconde = await creerIssue(pool, A, { origin: "migration" });
    await pool.query(
      "insert into error_status (app_id, fingerprint, status, note, updated_at) values ($1, 'p56-note', 'resolved', $2, now() - interval '3 days')",
      [A, `Contacter lea@exemple.fr ${"x".repeat(2100)}`],
    );
    await pool.query(
      "insert into error_issue_alias (app_id, legacy_fingerprint, issue_id, legacy_status) values ($1, 'p56-note', $2, 'resolved'), ($1, 'p56-note', $3, 'resolved')",
      [A, issue.id, seconde.id],
    );
    const bilans = await Promise.all([importerNotesHistoriques(pool), importerNotesHistoriques(pool)]);
    expect(bilans.map((b) => ("importees" in b ? b.importees : -1)).reduce((s, n) => s + n, 0)).toBe(2);
    expect(await importerNotesHistoriques(pool)).toEqual({ importees: 0 });
    for (const id of [issue.id, seconde.id]) {
      const [note] = await activites(pool, id);
      expect(note).toMatchObject({ kind: "comment", actor_kind: "system", legacy_fingerprint: "p56-note", event_key: "legacy_note:p56-note" });
      expect(note.body.startsWith("Contacter [email] xxx")).toBe(true);
      expect([...note.body]).toHaveLength(2000);
    }
  });

  describe("pic issue:<uuid>", () => {
    async function suivie(app: string, depuis = "60 days") {
      await pool.query("select error_grouping_activate($1, 'p56@test')", [app]);
      await pool.query("update error_grouping_config set activated_at = now() - $2::interval where app_id = $1", [app, depuis]);
    }
    async function regle(app: string, metric: string, extra: Record<string, unknown> = {}) {
      const r = { comparator: ">", threshold: 5, window_minutes: 15, mode: "threshold", severity: "warning", sensitivity: 3, baseline_weeks: 4, env: null, route: null, ...extra };
      return (await pool.query(
        `insert into alert_rule (app_id, metric, route, comparator, threshold, window_minutes, mode, severity, sensitivity, baseline_weeks, env)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id::int as id`,
        [app, metric, r.route, r.comparator, r.threshold, r.window_minutes, r.mode, r.severity, r.sensitivity, r.baseline_weeks, r.env],
      )).rows[0].id as number;
    }
    const etat = async (id: number) =>
      (await pool.query("select last_state, last_value, last_reason from alert_rule where id = $1", [id])).rows[0];

    it("somme des occurrences observées : bots exclus, env et route de la règle, A jamais compté pour B", async () => {
      await suivie(A);
      await suivie(B);
      const issue = await creerIssue(pool, A);
      await pool.query(
        `insert into rum_session (session_id, app_id, device_type, is_bot, sample_rate, error_sample_rate) values
           ('p56-humain', $1, 'desktop', false, 0.5, 0.5), ('p56-robot', $1, 'desktop', true, 1, 1)`,
        [A],
      );
      await occurrence(pool, A, issue, { occurrences: 4, session: "p56-humain" });
      await occurrence(pool, A, issue, { occurrences: 3 });
      await occurrence(pool, A, issue, { occurrences: 100, session: "p56-robot" });
      await occurrence(pool, A, issue, { occurrences: 50, env: "staging" });
      await occurrence(pool, A, issue, { occurrences: 20, route: "/autre" });
      await occurrence(pool, A, issue, { occurrences: 30, ts: "now() - interval '40 minutes'" });

      const prod = await regle(A, `issue:${issue.id}`, { env: "prod", route: "/panier" });
      const tous = await regle(A, `issue:${issue.id}`, { threshold: 1000 });
      const etrangere = await regle(B, `issue:${issue.id}`);
      expect((await pool.query("select check_alerts() as n")).rows[0].n).toBe(1);
      expect(await etat(prod)).toEqual({ last_state: "breached", last_value: 7, last_reason: null });
      expect(await etat(tous)).toEqual({ last_state: "ok", last_value: 77, last_reason: null });
      expect(await etat(etrangere)).toMatchObject({ last_state: "no_data", last_value: null, last_reason: expect.stringMatching(/absente/) });

      const [pic] = await notifications(pool, issue.id).then((n) => n.filter((x) => x.kind === "spike"));
      expect(pic.payload).toMatchObject({ kind: "spike", value: 7, env: "prod", route: "/panier", severity: "warning" });
      expect(pic.payload.text).toMatch(/probabilité d'inclusion minimale 75\.0%\), sans extrapolation$/);
      expect(pic.event_key).toMatch(new RegExp(`^spike:${prod}:\\d+$`));

      // Délai de grâce : ni un second passage, ni après routage tant que l'alerte n'est pas acquittée.
      expect((await pool.query("select check_alerts() as n")).rows[0].n).toBe(0);
      expect((await pool.query("select route_error_issue_notifications() as n")).rows[0].n).toBeGreaterThanOrEqual(1);
      expect((await pool.query("select check_alerts() as n")).rows[0].n).toBe(0);
      const evenement = (await pool.query("select id, value, severity from alert_event where rule_id = $1", [prod])).rows;
      expect(evenement).toEqual([expect.objectContaining({ value: 7, severity: "warning" })]);
      // Acquittée dans la même fenêtre : la clé d'événement empêche une seconde notification.
      await pool.query("update alert_event set acknowledged = true where rule_id = $1", [prod]);
      expect((await pool.query("select check_alerts() as n")).rows[0].n).toBe(0);
    });

    it("no_data explicite : regroupement inactif, fenêtre incomplète, comparables insuffisants", async () => {
      const issue = await creerIssue(pool, A);
      await occurrence(pool, A, issue, { occurrences: 9 });
      const seuil = await regle(A, `issue:${issue.id}`);
      await pool.query("select check_alerts()");
      expect(await etat(seuil)).toMatchObject({ last_state: "no_data", last_reason: expect.stringMatching(/regroupement v2 inactif/) });

      await suivie(A, "5 minutes");
      await pool.query("select check_alerts()");
      expect(await etat(seuil)).toMatchObject({ last_state: "no_data", last_reason: expect.stringMatching(/fenêtre incomplète/) });

      await suivie(A, "15 days");
      const baseline = await regle(A, `issue:${issue.id}`, { mode: "baseline", threshold: 999999 });
      await pool.query("select check_alerts()");
      expect(await etat(seuil)).toMatchObject({ last_state: "breached", last_value: 9 });
      // Suivie depuis 15 jours : deux semaines comparables, jamais un zéro inventé.
      expect(await etat(baseline)).toEqual({ last_state: "no_data", last_value: 9, last_reason: "2 fenêtre(s) comparable(s), 4 requises" });
      await pool.query("update app_registry set retention_days = 10 where app_id = $1", [A]);
      await suivie(A, "60 days");
      await pool.query("select check_alerts()");
      expect(await etat(baseline)).toMatchObject({ last_state: "no_data", last_reason: "1 fenêtre(s) comparable(s), 4 requises" });
      await pool.query("update app_registry set retention_days = null where app_id = $1", [A]);
    });

    it("baseline exacte par fenêtre : MAD > 0 comme P4, MAD = 0 sensible au moindre écart", async () => {
      await suivie(A);
      const variable = await creerIssue(pool, A);
      // Même fenêtre de 15 min, les quatre semaines précédentes : 2, 4, 6, 8 → médiane 5, MAD 2.
      for (const [semaine, n] of [[1, 2], [2, 4], [3, 6], [4, 8]]) {
        await occurrence(pool, A, variable, { occurrences: n, ts: `now() - interval '${semaine} weeks' - interval '5 minutes'` });
        // Hors fenêtre de la règle, la même heure : jamais comptée dans la baseline.
        await occurrence(pool, A, variable, { occurrences: 500, ts: `now() - interval '${semaine} weeks' - interval '40 minutes'` });
      }
      await occurrence(pool, A, variable, { occurrences: 10 });
      const mad = await regle(A, `issue:${variable.id}`, { mode: "baseline", threshold: 999999, sensitivity: 2 });

      const stable = await creerIssue(pool, A);
      await occurrence(pool, A, stable, { occurrences: 1 });
      const zero = await regle(A, `issue:${stable.id}`, { mode: "baseline", threshold: 999999 });

      const baseline = (await pool.query(
        "select * from issue_metric_baseline($1, $2::uuid, null, null, 4, 15)",
        [A, variable.id],
      )).rows[0];
      expect(baseline).toEqual({ med: 5, mad: 2, n: 4 });
      expect((await pool.query("select check_alerts() as n")).rows[0].n).toBe(2);
      expect(await etat(mad)).toMatchObject({ last_state: "breached", last_value: 10 });
      const textes = (await pool.query("select payload->>'text' as t from error_issue_notification where kind = 'spike' and app_id = $1 order by id", [A])).rows.map((r) => r.t);
      expect(textes[0]).toMatch(/anormal \(normal≈5\.0, écart 2\.5σ_MAD/);
      expect(textes[1]).toMatch(/normal stable≈0\.0, MAD=0/);
      expect(await etat(zero)).toMatchObject({ last_state: "breached", last_value: 1 });
    });
  });

  describe("routage et livraison", () => {
    let recepteur: Awaited<ReturnType<typeof stub>>;
    beforeAll(async () => {
      recepteur = await stub();
    });
    afterAll(async () => {
      await new Promise((ok) => recepteur.serveur.close(ok));
    });

    it("deux déclencheurs simultanés : un alert_event et un POST par notification, vers le seul canal de l'app", async () => {
      recepteur.recus.length = 0;
      await pool.query(
        `insert into notify_channel (app_id, kind, target, severity_min) values
           ($1, 'webhook', $3, 'info'), ($2, 'webhook', $4, 'info'), ($1, 'email', 'ops@exemple.fr', 'info')`,
        [A, B, `${recepteur.base}/a`, `${recepteur.base}/b`],
      );
      const issue = await creerIssue(pool, A);
      const routes = await Promise.all([
        pool.query("select route_error_issue_notifications() as n"),
        pool.query("select route_error_issue_notifications() as n"),
      ]);
      expect(routes.map((r) => r.rows[0].n).reduce((s: number, n: number) => s + n, 0)).toBe(1);
      const [notification] = await notifications(pool, issue.id);
      expect(notification.state).toBe("delivered");
      const evenements = (await pool.query(
        "select e.id, e.message from alert_event e join error_issue_notification n on n.alert_event_id = e.id where n.issue_id = $1",
        [issue.id],
      )).rows;
      expect(evenements).toHaveLength(1);
      expect(evenements[0].message).toMatch(/^Nouvelle issue dans p56-app-a/);

      const passes = await Promise.all([dispatchOnce(pool), dispatchOnce(pool)]);
      const total = passes.reduce((s, p) => ({ sent: s.sent + p.sent, skipped: s.skipped + p.skipped }), { sent: 0, skipped: 0 });
      expect(recepteur.recus.filter((r) => r.url === "/a")).toHaveLength(1);
      expect(recepteur.recus.filter((r) => r.url === "/b")).toHaveLength(0);
      expect(recepteur.recus[0].corps).toMatchObject({ source: "mip-rum", kind: "new", app_id: A, issue_id: issue.id });
      expect(total.sent).toBeGreaterThanOrEqual(1);
      const livraisons = (await pool.query(
        "select target, status from alert_delivery where alert_event_id = $1 order by target",
        [evenements[0].id],
      )).rows;
      expect(livraisons).toEqual([
        { target: `${recepteur.base}/a`, status: "delivered" },
        { target: "ops@exemple.fr", status: "skipped" },
      ]);
    });

    it("l'arriéré sans règle d'avant v73 reste soldé ; une nouvelle erreur historique part désormais", async () => {
      recepteur.recus.length = 0;
      await pool.query("insert into notify_channel (app_id, kind, target, severity_min) values ($1, 'webhook', $2, 'info')", [A, `${recepteur.base}/historique`]);
      const ancien = (await pool.query(
        `insert into alert_event (rule_id, value, message, severity, fired_at)
         select null, 1, 'ancienne alerte p56-app-a', 'warning', rule_less_dispatch_since - interval '1 hour' from alert_config
         returning id`,
      )).rows[0].id;
      await pool.query("insert into alert_delivery (alert_event_id, target) values ($1, $2)", [ancien, `${recepteur.base}/historique`]);
      // Rejouer v73 solde l'arriéré sans toucher la date de première application.
      const avant = (await pool.query("select rule_less_dispatch_since as t from alert_config")).rows[0].t;
      await pool.query(readFileSync(join(SQL_DIR, "migration-v73.sql"), "utf8"));
      expect((await pool.query("select rule_less_dispatch_since as t from alert_config")).rows[0].t).toEqual(avant);
      expect((await pool.query("select status from alert_delivery where alert_event_id = $1", [ancien])).rows[0].status).toBe("skipped");

      await pool.query("insert into rum_error (span_id, app_id, message, fingerprint, ts) values ($1, $2, 'historique', $3, now())", [spanId(), A, `p56-hist-${span}`]);
      expect((await pool.query("select check_new_errors() as n")).rows[0].n).toBe(1);
      await dispatchOnce(pool);
      expect(recepteur.recus.map((r) => r.url)).toEqual(["/historique"]);
      expect(recepteur.recus[0].corps.text).toMatch(/^\[MIP RUM\] nouvelle erreur p56-hist-/);
    });

    it("le tick route les notifications d'issue avant la livraison du même passage", async () => {
      recepteur.recus.length = 0;
      await pool.query("insert into notify_channel (app_id, kind, target, severity_min) values ($1, 'webhook', $2, 'info')", [A, `${recepteur.base}/tick`]);
      await creerIssue(pool, A);
      const bilan = await travaux(pool, { log: muet, dispatch: dispatchOnce }).tick();
      expect(bilan.resultats.route_error_issue_notifications).toMatchObject({ ok: true, result: 1 });
      expect(recepteur.recus.map((r) => r.url)).toEqual(["/tick"]);
    });
  });

  it("purge, effacement d'app et DSAR : l'historique suit l'issue, B intact, aucune identité ni message dans le workflow", async () => {
    const vieille = await creerIssue(pool, A, { lastSeen: "now() - interval '40 days'" });
    const recente = await creerIssue(pool, A);
    const deB = await creerIssue(pool, B);
    await pool.query("select route_error_issue_notifications()");
    const admin = await userId(pool, ADMIN);
    for (const issue of [vieille, recente, deB]) {
      const app = issue === deB ? B : A;
      await pool.query("insert into error_issue_activity (app_id, issue_id, kind, actor_kind, actor_user_id, body) values ($1, $2, 'comment', 'user', $3, 'suivi')", [app, issue.id, admin]);
      await pool.query("insert into error_issue_ticket (app_id, issue_id, url, label) values ($1, $2, 'https://jira.exemple.fr/MIP-9', 'MIP-9')", [app, issue.id]);
    }
    const evenementVieille = (await pool.query("select alert_event_id from error_issue_notification where issue_id = $1", [vieille.id])).rows[0].alert_event_id;

    const purge = (await pool.query("select purge_rum_app($1, now() - interval '30 days') as r", [A])).rows[0].r;
    expect(purge.error_issue).toBe(1);
    for (const table of ["error_issue_activity", "error_issue_ticket", "error_issue_notification"]) {
      expect(Number((await pool.query(`select count(*) from ${table} where issue_id = $1`, [vieille.id])).rows[0].count), table).toBe(0);
      expect(Number((await pool.query(`select count(*) from ${table} where issue_id = $1`, [recente.id])).rows[0].count), table).toBeGreaterThan(0);
    }
    expect((await pool.query("select count(*)::int as n from alert_event where id = $1", [evenementVieille])).rows[0].n).toBe(0);

    // DSAR : effacer les occurrences d'une identité ne laisse rien d'identifiant dans le workflow.
    const hash = "d".repeat(64);
    await pool.query("insert into rum_session (session_id, app_id, user_id_hash) values ('p56-dsar', $1, $2)", [A, hash]);
    await occurrence(pool, A, recente, { session: "p56-dsar" });
    expect(await lib.dsarIdentityErase(A, "user", hash)).toContainEqual({ table: "rum_error", deleted: 1 });
    const colonnes = (await pool.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('error_issue_activity', 'error_issue_ticket', 'error_issue_notification')
          and column_name in ('session_id', 'visitor_id', 'user_id_hash', 'account_id_hash', 'user_hash', 'message', 'stack', 'context')`,
    )).rows;
    expect(colonnes).toEqual([]);
    const cles = (await pool.query("select distinct jsonb_object_keys(payload) as k from error_issue_notification order by 1")).rows.map((r) => r.k);
    expect(cles.every((k) => ["app_id", "env", "first_release", "issue_id", "kind", "metric", "reference_release", "release", "route", "severity", "source", "text", "value"].includes(k))).toBe(true);
    expect((await pool.query("select count(*)::int as n from error_issue_notification where payload::text like '%jean@%' or payload::text like '%TypeError%'")).rows[0].n).toBe(0);

    const effacement = (await pool.query("select erase_app_data($1) as r", [A])).rows[0].r;
    expect(effacement.error_issue).toBe(1);
    expect(Number((await pool.query("select count(*) from error_issue_activity where app_id = $1", [A])).rows[0].count)).toBe(0);
    expect(Number((await pool.query("select count(*) from error_issue_activity where app_id = $1", [B])).rows[0].count)).toBe(1);
    expect(Number((await pool.query("select count(*) from error_issue_ticket where app_id = $1", [B])).rows[0].count)).toBe(1);
  });
});

// ═══════════════════════════ Fenêtre de déploiement ═══════════════════════════

(urlFenetre ? describe : describe.skip)("P5.6 — code publié avant migration-v73", () => {
  const poolFenetre = new pg.Pool(urlFenetre ? { connectionString: urlFenetre, max: 4 } : {});
  let lib: Console;

  beforeAll(async () => {
    await poolFenetre.query("drop schema public cascade; create schema public;");
    for (const file of migrations(72)) await poolFenetre.query(readFileSync(file, "utf8"));
    await enregistrer(poolFenetre);
    lib = await consoleSur(urlFenetre!);
  }, 300_000);

  afterAll(async () => {
    await poolFenetre.end();
    await lib?.consolePool.end();
  });

  it("triage indisponible, dispatcher et tick inchangés ; v73 appliquée, l'arriéré sans règle est soldé et le triage ouvert", async () => {
    const recepteur = await stub();
    try {
      const issue = await creerIssue(poolFenetre, A);
      expect(await lib.issueWorkflowAvailable()).toBe(false);
      expect(await lib.triageIssue({ issueId: issue.id, apps: null, actorEmail: ADMIN }, { app: A, status: "resolved", expectedRevision: "1" }))
        .toEqual({ kind: "unavailable" });
      expect(await importerNotesHistoriques(poolFenetre)).toEqual({ absent: "migration-v73 non appliquée" });
      const bilan = await travaux(poolFenetre, { log: muet }).tick();
      expect(bilan.resultats.route_error_issue_notifications).toMatchObject({ ok: true, result: { absent: "migration-v73 non appliquée" } });

      const regle = (await poolFenetre.query(
        "insert into alert_rule (app_id, metric, threshold, webhook_url) values ($1, 'LCP', 1, $2) returning id",
        [A, `${recepteur.base}/regle`],
      )).rows[0].id;
      const surRegle = (await poolFenetre.query("insert into alert_event (rule_id, value, message) values ($1, 3, 'LCP') returning id", [regle])).rows[0].id;
      const sansRegle = (await poolFenetre.query("insert into alert_event (rule_id, value, message) values (null, 1, 'nouvelle erreur p56-app-a') returning id")).rows[0].id;
      await poolFenetre.query("insert into alert_delivery (alert_event_id, target) values ($1, $3), ($2, $4)", [surRegle, sansRegle, `${recepteur.base}/regle`, `${recepteur.base}/sans-regle`]);
      expect(await dispatchOnce(poolFenetre)).toMatchObject({ sent: 1 });
      expect(recepteur.recus.map((r) => r.url)).toEqual(["/regle"]);

      await poolFenetre.query(readFileSync(join(SQL_DIR, "migration-v73.sql"), "utf8"));
      expect((await poolFenetre.query("select status from alert_delivery where alert_event_id = $1", [sansRegle])).rows[0].status).toBe("skipped");
      expect(await dispatchOnce(poolFenetre)).toMatchObject({ sent: 0 });
      expect(await lib.triageIssue({ issueId: issue.id, apps: null, actorEmail: ADMIN }, { app: A, status: "resolved", expectedRevision: "1" }))
        .toMatchObject({ kind: "ok", value: { status: "resolved" } });
      // Une issue antérieure à v73 n'a pas de notification « new » rétroactive.
      expect(Number((await poolFenetre.query("select count(*) from error_issue_notification")).rows[0].count)).toBe(0);
    } finally {
      await new Promise((ok) => recepteur.serveur.close(ok));
    }
  });
});
