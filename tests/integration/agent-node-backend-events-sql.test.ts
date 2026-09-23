// P7.4 — l'événement métier d'un émetteur BACKEND sur PostgreSQL réel.
//
// Ce que ce fichier prouve ne se voit pas dans un test de parseur : qu'une ligne
// `rum_event` sans session passe la clé étrangère `rum_event_session_id_fkey`
// (elle n'existe qu'avec une session), qu'aucune ligne de session n'est écrite
// depuis le backend, que la projection de lecture la reprend, et que la purge
// par app l'emporte comme les autres signaux.
//
// Le payload est construit par le VRAI package : ce sont les octets de l'agent
// qui traversent le parseur, l'écrivain et le schéma.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error — module .mjs sans déclaration de types
import { writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error — module .mjs sans déclaration de types
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";
import {
  buildConfig,
  buildHttpServerSpan,
  buildPayload,
  buildTrackSpan,
} from "../../packages/agent-node/src/core";

const url = process.env.SQL_TEST_DATABASE_URL;
const dir = join(__dirname, "..", "..", "packages", "db", "sql");
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const suite = url ? describe : describe.skip;
const APP = "p74-node-a";
const AUTRE = "p74-node-b";
const TRACE = "0af7651916cd43dd8448eb211c80319c";
const SPAN_REQUETE = "00aa11bb22cc33dd";

function migrations() {
  return ["schema.sql", ...readdirSync(dir)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))]
    .map((f) => join(dir, f));
}

/** Lot tel que l'agent Node l'expédie : requête HTTP + événement métier enfant. */
function lotAgent(app: string, spanId: string, nom: string, props: Record<string, unknown>) {
  const cfg = buildConfig({ MIP_RUM_ENDPOINT: "https://i/v1/traces", MIP_RUM_APP_ID: app, MIP_RUM_SERVICE: "api" });
  const debut = Date.now();
  return flattenOtlp(buildPayload(cfg, [
    buildHttpServerSpan({
      traceId: TRACE,
      spanId: SPAN_REQUETE,
      parentSpanId: null,
      method: "POST",
      route: "/api/commandes",
      url: null,
      status: 201,
      sessionId: null,
      startMs: debut,
      durationMs: 18,
      attributes: { canal: "batch" },
    }),
    buildTrackSpan({
      name: nom,
      props,
      traceId: TRACE,
      spanId,
      parentSpanId: SPAN_REQUETE,
      sessionId: null,
      route: "/api/commandes",
      attributes: { canal: "batch" },
      tsMs: debut + 5,
    }),
  ]));
}

async function nettoyer(app: string) {
  await pool.query("delete from rum_event_index where app_id = $1", [app]);
  await pool.query("delete from rum_event where app_id = $1", [app]);
  await pool.query("delete from rum_span where app_id = $1", [app]);
  await pool.query("delete from rum_session where app_id = $1", [app]);
}

beforeAll(async () => {
  if (!url) return;
  const client = await pool.connect();
  try {
    for (const fichier of migrations()) await client.query(readFileSync(fichier, "utf8"));
    for (const app of [APP, AUTRE]) {
      await client.query(
        `insert into app_registry (app_id, name, active) values ($1, $1, true)
         on conflict (app_id) do update set active = true`,
        [app],
      );
    }
  } finally {
    client.release();
  }
}, 180_000);

afterAll(async () => {
  if (url) await pool.end();
});

suite("P7.4 — événement métier backend (agent Node) en base", () => {
  it("s'écrit sans session, sans violer la clé étrangère, et sans inventer de session", async () => {
    await nettoyer(APP);
    try {
      const lot = lotAgent(APP, "aaaa1111bbbb2222", "commande_validee", { montant: 42.5, devise: "EUR" });
      // Aucune ligne de session dans le lot : c'est précisément ce qui ferait
      // échouer l'INSERT si l'événement en revendiquait une.
      expect(lot.sessions).toEqual([]);
      expect(lot.rejected).toBe(0);
      await writeRows(pool, lot);

      // `rum_event` ne porte pas `service` (il vit sur la projection de
      // lecture) : on lit ce que la table a réellement.
      const { rows } = await pool.query(
        `select session_id, name, props, route, env from rum_event where app_id = $1`,
        [APP],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        session_id: null, // inconnue, jamais devinée
        name: "commande_validee",
        route: "/api/commandes",
        env: "prod",
      });
      expect(rows[0].props).toEqual({ montant: 42.5, devise: "EUR" });
      // Le front reste seul maître de rum_session : rien n'a été créé ici.
      const sessions = await pool.query("select count(*)::int as n from rum_session where app_id = $1", [APP]);
      expect(sessions.rows[0].n).toBe(0);

      // Le span de la requête reste le parent : la corrélation passe par la trace.
      const spans = await pool.query(
        "select span_id, trace_id, tier from rum_span where app_id = $1",
        [APP],
      );
      expect(spans.rows).toEqual([{ span_id: SPAN_REQUETE, trace_id: TRACE, tier: "back" }]);
    } finally {
      await nettoyer(APP);
    }
  });

  it("entre une seule fois dans la projection de lecture, au rejeu comme au premier envoi", async () => {
    await nettoyer(APP);
    try {
      const lot = lotAgent(APP, "cccc3333dddd4444", "commande_validee", { montant: 1 });
      await writeRows(pool, lot);
      await writeRows(pool, lot); // rejeu du MÊME lot : idempotent
      const index = await pool.query(
        `select kind, source_name, session_id, service
           from rum_event_index where app_id = $1 and kind = 'event'`,
        [APP],
      );
      expect(index.rows).toEqual([
        { kind: "event", source_name: "track", session_id: null, service: "api" },
      ]);
      const events = await pool.query("select count(*)::int as n from rum_event where app_id = $1", [APP]);
      expect(events.rows[0].n).toBe(1);
    } finally {
      await nettoyer(APP);
    }
  });

  it("reste cloisonné par app, et la purge d'une app n'emporte que la sienne", async () => {
    await nettoyer(APP);
    await nettoyer(AUTRE);
    try {
      await writeRows(pool, lotAgent(APP, "eeee5555ffff6666", "commande_validee", {}));
      await writeRows(pool, lotAgent(AUTRE, "9999aaaa8888bbbb", "commande_validee", {}));
      await pool.query("delete from rum_event where app_id = $1", [APP]);
      const restant = await pool.query("select app_id from rum_event where name = 'commande_validee'");
      expect(restant.rows.map((r: { app_id: string }) => r.app_id)).toEqual([AUTRE]);
    } finally {
      await nettoyer(APP);
      await nettoyer(AUTRE);
    }
  });
});
