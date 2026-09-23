// Récit de session (P*.9) sur un vrai PostgreSQL : ce que le test unitaire ne
// peut pas prouver.
//
//   1. `sessionTimeline` renvoie `occurrences` dans `value` pour une erreur
//      (B32, partie occurrences) : sans lui, le récit ne pourrait pas écrire
//      « 3 occurrences » sans compter des lignes (V1).
//   2. `sessionARejeu` ne voit que les segments de l'app de la session : un
//      segment d'une autre app qui cite le même identifiant ne fait pas croire
//      à un rejeu.
//
// Base JETABLE : le fichier applique le schéma complet (voir histogramme-sql).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url } : {});
const APP = "ps9-recit";
const AUTRE = "ps9-recit-autre";
const SID = "ps9-recit-session";
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

if (!url) console.warn("[recit-session-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable) pour l'exécuter.");

async function nettoyer() {
  await pool.query("delete from replay_chunk where session_id = $1", [SID]);
  for (const t of ["rum_error", "rum_pageview", "rum_event"]) await pool.query(`delete from ${t} where session_id = $1`, [SID]);
  await pool.query("delete from rum_session where session_id = $1", [SID]);
}

beforeAll(async () => {
  if (!url) return;
  await pool.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
  const files = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  for (const f of files) await pool.query(readFileSync(join(SQL_DIR, f), "utf8"));
  for (const app of [APP, AUTRE]) {
    await pool.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [app],
    );
  }
  await nettoyer();
  await pool.query(
    `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count)
     values ($1, $2, 'desktop', now() - interval '2 hours', now() - interval '2 hours' + interval '5 seconds', 1)`,
    [SID, APP],
  );
  await pool.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
     values ('ps9pv0000000001', $1, $2, '/paiement', now() - interval '2 hours')`,
    [SID, APP],
  );
  await pool.query(
    `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, ts)
     values ('ps9er0000000001', $1, $2, 'error', 'x is undefined', 'TypeError', 'ps9-fp', 3,
             now() - interval '2 hours' + interval '2 seconds')`,
    [SID, APP],
  );
}, 180_000);

afterAll(async () => {
  if (!url) return;
  await nettoyer();
  await pool.query("delete from app_registry where app_id = any($1::text[])", [[APP, AUTRE]]);
  await pool.end();
  const { pool: consolePool } = await import("../../apps/console/lib/db");
  await consolePool.end();
});

suite("P*.9 récit de session — PostgreSQL", () => {
  it("une erreur occurrences = 3 → value 3, et le récit écrit « 3 occurrences »", async () => {
    process.env.DATABASE_URL = url;
    const { sessionMeta, sessionTimeline } = await import("../../apps/console/lib/queries");
    const { composerRecit } = await import("../../apps/console/lib/recit-session");
    const meta = await sessionMeta(SID);
    const timeline = await sessionTimeline(SID, APP);
    expect(timeline.find((it) => it.kind === "error")).toMatchObject({ title: "TypeError", value: 3 });
    const r = composerRecit({ timeline, debut: meta!.started_at, fin: meta!.last_seen_at, nowMs: Date.now() });
    if (!r.ok) throw new Error(r.raison);
    expect(r.phrases.map((p) => p.texte)).toContain("3 occurrences de TypeError sur /paiement.");
  });

  it("deux apps, même session_id : la chronologie de l'une ne contient rien de l'autre", async () => {
    process.env.DATABASE_URL = url;
    // Lignes forgées par une autre app qui cite le même identifiant de session.
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
       values ('ps9pvautre00001', $1, $2, '/autre-app', now() - interval '2 hours')`,
      [SID, AUTRE],
    );
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, ts)
       values ('ps9erautre00001', $1, $2, 'error', 'forgée', 'ForgedError', 'ps9-autre', 50, now() - interval '2 hours')`,
      [SID, AUTRE],
    );
    await pool.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       values ('ps9evautre00001', $1, $2, '/autre-app', 'frustration.rage', '{}'::jsonb, now() - interval '2 hours')`,
      [SID, AUTRE],
    );
    const { sessionTimeline } = await import("../../apps/console/lib/queries");
    const timeline = await sessionTimeline(SID, APP);
    expect(timeline.map((it) => it.title)).toEqual(["/paiement", "TypeError"]);
    const autre = await sessionTimeline(SID, AUTRE);
    expect(autre.map((it) => it.title).sort()).toEqual(["/autre-app", "ForgedError", "frustration.rage"]);
    for (const t of ["rum_pageview", "rum_error", "rum_event"])
      await pool.query(`delete from ${t} where session_id = $1 and app_id = $2`, [SID, AUTRE]);
  });

  it("rejeu : absent, puis toujours absent pour un segment d'une autre app, puis présent", async () => {
    process.env.DATABASE_URL = url;
    const { sessionARejeu } = await import("../../apps/console/lib/session-rejeu");
    await expect(sessionARejeu(SID, APP)).resolves.toBe(false);
    await pool.query(
      "insert into replay_chunk (session_id, app_id, seq, body) values ($1, $2, 0, '\\x00'::bytea)",
      [SID, AUTRE],
    );
    await expect(sessionARejeu(SID, APP)).resolves.toBe(false);
    await pool.query("delete from replay_chunk where session_id = $1", [SID]);
    await pool.query(
      "insert into replay_chunk (session_id, app_id, seq, body) values ($1, $2, 0, '\\x00'::bytea)",
      [SID, APP],
    );
    await expect(sessionARejeu(SID, APP)).resolves.toBe(true);
  });
});
