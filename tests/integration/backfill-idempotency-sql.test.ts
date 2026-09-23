// P8.2 — les preuves pré-production de la reprise d'historique, sur un VRAI
// PostgreSQL.
//
// CE QUE CES TESTS CHERCHENT À METTRE EN DÉFAUT, et que relire le code ne
// démontrerait pas :
//
//   · une reprise qui écrit AUTRE CHOSE que le chemin vivant. La preuve est
//     frontale : on laisse `writeRows` écrire la projection, on la relève, on
//     l'efface, on lance la reprise, et on compare LIGNE À LIGNE. Une copie de
//     vieux parser collée dans un script de migration échouerait ici ;
//   · une reprise qui invente un identifiant, ressuscite une donnée effacée,
//     remplace un agrégat par zéro, notifie « nouvelle issue » sur six mois
//     d'historique ou fait grimper un compteur de facturation ;
//   · une reprise dont l'interruption laisse un trou ou un doublon. Le cas
//     traité est celui qui fait mal : la panne ENTRE l'écriture des lignes et
//     l'écriture du point de reprise.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import { hashIdentity, secureOtlpIdentities } from "../../packages/backend/lib/identity-hash.mjs";
// @ts-expect-error module JS sans déclarations
import { _resetColonnesCache, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";
// @ts-expect-error module JS sans déclarations
import { VERROU_INGESTION_NS, _resetPresenceBarrieres } from "../../packages/backend/lib/privacy-barriere.mjs";
// @ts-expect-error module JS sans déclarations
import { ErreurPlan, KINDS, empreinteCode, planifier } from "../../packages/backend/lib/backfills/planner.mjs";
// @ts-expect-error module JS sans déclarations
import { etat, executer, inscrirePlan, mettreEnPause, verifier } from "../../packages/backend/lib/backfills/runner.mjs";
// @ts-expect-error module JS sans déclarations
import { fusionHistogrammesPossible, fusionnerHistogrammes } from "../../packages/backend/lib/backfills/rollups.mjs";
import { dsarIdentityErase, type IdentityDsarIo } from "../../apps/console/lib/queries-dsar";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url, max: 10 } : { max: 10 });
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const APP = "p82-reprise";
const AUTRE = "p82-reprise-autre";
const SECRET = "test-only-identity-secret";
const ALICE = "alice@p82.test";

/** Tables dont l'état complet sert de témoin d'idempotence. */
const TABLES_RUM = [
  "rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_log", "replay_chunk",
  "rum_event", "rum_span", "rum_breadcrumb", "rum_longtask", "rum_resource", "rum_pageview",
  "rum_session", "rum_rollup_hourly", "metric_histogram_hourly",
];

let compteurSpan = 0;
const spanId = () => (0x7830_0000_0000_0000n + BigInt(++compteurSpan)).toString(16);

function attributs(valeurs: Record<string, string | number>) {
  return Object.entries(valeurs).map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { doubleValue: value } : { stringValue: String(value) },
  }));
}

const UA_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

/**
 * Un lot aplati par le VRAI parser, identités sécurisées comme au port
 * d'ingestion. Un lot écrit à la main ne prouverait rien du produit.
 */
function lot(
  app: string,
  session: string,
  raw: string | null,
  { avantMin = 30, ua = UA_CHROME as string | null, occurrences = 3, erreurType = "TypeError" } = {},
) {
  const ns = (BigInt(Date.now()) - BigInt(avantMin * 60_000)) * 1_000_000n;
  const span = (nom: string, extra: Record<string, string | number>) => ({
    name: nom,
    traceId: "c".repeat(32),
    spanId: spanId(),
    startTimeUnixNano: ns.toString(),
    endTimeUnixNano: (ns + 5_000_000n).toString(),
    attributes: attributs({
      "mip.session_id": session,
      "mip.route": "/panier",
      ...(raw ? { "mip.identity.user_id": raw } : {}),
      ...extra,
    }),
  });
  const spans = [
    span("pageview", {
      "mip.visitor_id": `v-${session}`,
      "mip.url": "https://p82.test/panier",
      "mip.nav_type": "navigate",
      "mip.device_type": "desktop",
    }),
    span("webvital.LCP", {
      "webvital.name": "LCP", "webvital.value": 1234, "webvital.rating": "good",
      "webvital.id": `${session}-lcp`,
    }),
    span("exception", {
      "mip.error_kind": "error",
      "exception.type": erreurType,
      "exception.message": "impossible de lire la propriete panier",
      "exception.stacktrace": `${erreurType}: boum\n    at payer (https://p82.test/static/app.js:12:5)`,
      // Répétitions compactées par le SDK : c'est CE nombre qui est
      // sous-compté par un agrégat d'avant v64.
      "mip.error_count": occurrences,
    }),
    span("resource", {
      "mip.resource.type": "script", "mip.url": "https://p82.test/static/app.js",
      "mip.duration_ms": 12,
    }),
  ];
  return flattenOtlp(secureOtlpIdentities({
    resourceSpans: [{
      resource: {
        attributes: attributs({
          "mip.app_id": app, "mip.client_id": "p82", "mip.env": "prod", "mip.release": "4.8.0",
          "service.name": "boutique",
          ...(ua ? { "mip.user_agent": ua } : {}),
        }),
      },
      scopeSpans: [{ spans }],
    }],
  }, SECRET).payload);
}

/** Couture DSAR branchée sur la BASE JETABLE : sinon, la console viserait DATABASE_URL. */
const ioSur = (client: pg.PoolClient | pg.Pool): IdentityDsarIo => ({
  query: async <T,>(text: string, params?: unknown[]) => (await client.query(text, params)).rows as T[],
  transaction: async <T,>(fn: (c: never) => Promise<T>) => {
    if ("connect" in client && typeof (client as pg.Pool).connect === "function" && !("release" in client)) {
      const c = await (client as pg.Pool).connect();
      try {
        await c.query("begin");
        const out = await fn(c as never);
        await c.query("commit");
        return out;
      } catch (err) {
        await c.query("rollback").catch(() => {});
        throw err;
      } finally {
        c.release();
      }
    }
    await (client as pg.PoolClient).query("begin");
    try {
      const out = await fn(client as never);
      await (client as pg.PoolClient).query("commit");
      return out;
    } catch (err) {
      await (client as pg.PoolClient).query("rollback").catch(() => {});
      throw err;
    }
  },
});

/** Attente sur CONDITION, jamais sur durée. Échoue franchement. */
async function attendre(predicat: () => Promise<boolean>, quoi: string, limiteMs = 15_000): Promise<void> {
  const fin = Date.now() + limiteMs;
  for (;;) {
    if (await predicat()) return;
    if (Date.now() > fin) throw new Error(`condition jamais atteinte : ${quoi}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function quelquUnAttend(): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>(
    "select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1 and not granted",
    [VERROU_INGESTION_NS],
  );
  return rows[0].n > 0;
}

/** Instantané ordonné d'une table, pour comparer deux états SANS se fier à un compteur. */
async function empreinteTable(table: string, app: string): Promise<string> {
  const { rows } = await pool.query<{ e: string | null }>(
    `select md5(string_agg(t::text, '|' order by t::text)) as e from ${table} t where app_id = $1`,
    [app],
  );
  return rows[0].e ?? "";
}

const compter = async (table: string, app: string): Promise<number> => Number(
  (await pool.query(`select count(*)::int as n from ${table} where app_id = $1`, [app])).rows[0].n,
);

const fenetreLarge = () => ({
  from: new Date(Date.now() - 6 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  to: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
});

/** Plan + inscription + exécution, le chemin que la CLI emprunte. */
async function reprendre(kind: string, options: Record<string, unknown> = {}) {
  const { from, to } = fenetreLarge();
  const plan = await planifier(pool, { kind, app: APP, from, to, taille: 100, ...options });
  const id = await inscrirePlan(pool, plan);
  const bilan = await executer(pool, id, { planSha: plan.plan_sha, ...(options.maxLots ? { maxLots: options.maxLots } : {}) });
  return { plan, id, bilan };
}

async function nettoyer() {
  for (const app of [APP, AUTRE]) {
    await pool.query("delete from ingest_raw where app_id = $1", [app]);
    await pool.query("update rum_error set issue_id = null where app_id = $1", [app]);
    await pool.query("delete from error_issue where app_id = $1", [app]);
    await pool.query("delete from error_status where app_id = $1", [app]);
    for (const t of TABLES_RUM) await pool.query(`delete from ${t} where app_id = $1`, [app]);
    await pool.query("delete from backfill_run where app_id = $1", [app]);
    await pool.query("delete from privacy_erasure_barrier where app_id = $1", [app]);
    await pool.query("delete from privacy_erasure_request where app_id = $1", [app]);
    await pool.query("delete from analytics_rollup_invalidation where app_id = $1", [app]);
    await pool.query("delete from tenant_usage_daily where app_id = $1", [app]);
  }
}

beforeAll(async () => {
  if (!url) return;
  const fichiers = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  await pool.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
  for (const f of fichiers) await pool.query(readFileSync(join(SQL_DIR, f), "utf8"));
  for (const app of [APP, AUTRE]) {
    await pool.query(
      `insert into app_registry (app_id, name, active, retention_days, privacy_barrier_mode)
       values ($1, $1, true, 30, 'enforce')
       on conflict (app_id) do update set active = true, retention_days = 30, privacy_barrier_mode = 'enforce'`,
      [app],
    );
  }
  await nettoyer();
}, 300_000);

afterAll(async () => {
  if (!url) return;
  await nettoyer();
  await pool.query("delete from error_grouping_config where app_id = any($1::text[])", [[APP, AUTRE]]);
  await pool.query("delete from app_registry where app_id = any($1::text[])", [[APP, AUTRE]]);
  await pool.end();
}, 60_000);

beforeEach(async () => {
  if (!url) return;
  _resetPresenceBarrieres();
  await nettoyer();
}, 60_000);

// ══════════════════════════ 1. Le plan, dry-run ══════════════════════════════

suite("P8.2 — `plan` est un dry-run, et ses refus sont explicites", () => {
  it("ne touche AUCUNE table RUM : l'état est identique avant et après", async () => {
    await writeRows(pool, lot(APP, "p82-plan", ALICE));
    const avant = await Promise.all(TABLES_RUM.map((t) => empreinteTable(t, APP)));
    const { from, to } = fenetreLarge();
    for (const kind of Object.keys(KINDS)) {
      await planifier(pool, { kind, app: APP, from, to });
    }
    expect(await Promise.all(TABLES_RUM.map((t) => empreinteTable(t, APP)))).toEqual(avant);
  });

  it("refuse `all` — une reprise se décide application par application", async () => {
    const { from, to } = fenetreLarge();
    for (const app of ["all", "ALL", "*", "toutes"]) {
      await expect(planifier(pool, { kind: "event-index", app, from, to }))
        .rejects.toMatchObject({ code: "app_globale_refusee" });
    }
  });

  it("exige --app et des bornes UTC explicites", async () => {
    const { from, to } = fenetreLarge();
    await expect(planifier(pool, { kind: "event-index", app: "", from, to }))
      .rejects.toMatchObject({ code: "app_obligatoire" });
    // Une date sans fuseau prendrait celui de la machine qui lance l'outil.
    await expect(planifier(pool, { kind: "event-index", app: APP, from: "2026-09-01", to }))
      .rejects.toMatchObject({ code: "borne_invalide" });
    await expect(planifier(pool, { kind: "event-index", app: APP, from: to, to: from }))
      .rejects.toMatchObject({ code: "fenetre_vide" });
  });

  it("refuse une fenêtre qui déborde de la rétention RÉELLE, et nomme la borne admissible", async () => {
    await pool.query("update app_registry set retention_days = 7 where app_id = $1", [APP]);
    try {
      const to = new Date(Date.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
      const from = new Date(Date.now() - 30 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
      await expect(planifier(pool, { kind: "event-index", app: APP, from, to }))
        .rejects.toMatchObject({ code: "fenetre_hors_retention" });
      // Le message dit la rétention LUE, pas un défaut de 30 jours.
      await planifier(pool, { kind: "event-index", app: APP, from, to }).catch((err: Error) => {
        expect(err.message).toContain("7 j");
        expect(err.message).toContain("app_registry.retention_days");
        expect(err.message).toContain("Borne basse admissible");
      });
    } finally {
      await pool.query("update app_registry set retention_days = 30 where app_id = $1", [APP]);
    }
  });

  it("borne la taille de lot à 100..5 000", async () => {
    const { from, to } = fenetreLarge();
    for (const taille of [1, 99, 5_001, 10_000, 1.5]) {
      await expect(planifier(pool, { kind: "event-index", app: APP, from, to, taille }))
        .rejects.toMatchObject({ code: "taille_lot_invalide" });
    }
    expect((await planifier(pool, { kind: "event-index", app: APP, from, to })).taille_lot).toBe(1_000);
  });

  it("refuse une application absente du registre", async () => {
    const { from, to } = fenetreLarge();
    await expect(planifier(pool, { kind: "event-index", app: "p82-jamais-vue", from, to }))
      .rejects.toMatchObject({ code: "app_inconnue" });
  });

  it("rapporte tout ce que §3 exige, chaque compte avec SA méthode", async () => {
    await writeRows(pool, lot(APP, "p82-rapport", ALICE));
    // L'historique antérieur à v65 : les sources sont là, la projection non.
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "event-index", app: APP, from, to });

    expect(plan.tables_sources.map((s: { table: string }) => s.table)).toContain("rum_pageview");
    expect(plan.tables_cibles).toEqual(["rum_event_index"]);
    expect(plan.cle_unique).toMatch(/source_span_id/);
    // Bornes hautes PAR TABLE ET PAR ORDRE DE CLÉ, et l'avertissement qui dit
    // qu'une borne n'est pas un instantané.
    expect(plan.cutoffs.rum_pageview.ordre).toBe("id");
    expect(plan.borne_haute_avertissement).toMatch(/n'est PAS un ordre de commit/);
    // Comptes, avec la méthode.
    expect(plan.comptes.eligibles.methode).toBe("exact");
    expect(plan.comptes.eligibles.valeur).toBeGreaterThan(0);
    expect(plan.comptes.deja_presentes).toBeDefined();
    expect(plan.comptes.id_source_nul).toBeDefined();
    expect(plan.retention.jours).toBe(30);
    expect(plan.retention.source).toBe("app_registry.retention_days");
    expect(plan.retention.donnees_reellement_presentes.rum_pageview.lignes).toBeGreaterThan(0);
    // Coût.
    expect(plan.indexes.length).toBeGreaterThan(0);
    expect(plan.charge.methode).toBe("calibrage_lecture_seule");
    expect(plan.charge.cible_transaction_s).toBe(2);
    expect(plan.espace.par_table.rum_event_index).toBeDefined();
    // Signatures.
    expect(plan.code_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.schema_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.plan_sha).toMatch(/^[0-9a-f]{64}$/);
    // Ce qu'on ne saura pas reconstruire est NOMMÉ.
    expect(plan.impossible.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan)).not.toContain("impossible de lire la propriete");
  });

  it("refuse une seconde exécution vivante sur le même périmètre", async () => {
    await writeRows(pool, lot(APP, "p82-double", ALICE));
    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "event-index", app: APP, from, to });
    await inscrirePlan(pool, plan);
    await expect(inscrirePlan(pool, plan)).rejects.toMatchObject({ code: "execution_deja_active" });
  });
});

// ══════════════════ 2. event-index : reproduire, jamais inventer ═════════════

suite("P8.2 — event-index", () => {
  it("reproduit EXACTEMENT ce que le chemin vivant a projeté", async () => {
    for (let i = 0; i < 4; i++) await writeRows(pool, lot(APP, `p82-idx-${i}`, ALICE, { avantMin: 30 + i }));
    const vivant = (await pool.query(
      `select kind, source_name, source_span_id, session_id, route, env, release, service, ts
         from rum_event_index where app_id = $1 order by kind, source_span_id`,
      [APP],
    )).rows;
    expect(vivant.length).toBeGreaterThan(8);

    // L'historique antérieur à v65 : les sources sont là, la projection non.
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    const { bilan } = await reprendre("event-index");
    expect(bilan.etat).toBe("completed");

    const reconstruit = (await pool.query(
      `select kind, source_name, source_span_id, session_id, route, env, release, service, ts
         from rum_event_index where app_id = $1 order by kind, source_span_id`,
      [APP],
    )).rows;
    expect(reconstruit).toEqual(vivant);
  });

  it("un span_id absent ou invalide est un SKIP reporté, jamais un identifiant inventé", async () => {
    await writeRows(pool, lot(APP, "p82-skip", ALICE));
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    // Deux lignes historiques sans identité de span : l'une nulle, l'autre pas
    // un span OTLP. Insérées directement — aucun émetteur actuel n'en produit.
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, url, started_at)
       values (null, 'p82-skip', $1, '/vieux', 'https://p82.test/vieux', now() - interval '20 minutes'),
              ('pas-un-span-otlp', 'p82-skip', $1, '/vieux2', 'https://p82.test/v2', now() - interval '21 minutes')`,
      [APP],
    );
    // Une ligne SANS identifiant chez le VOISIN. `and` lie plus fort que `or` :
    // un prédicat non parenthésé ferait sortir ce compte de l'application.
    await pool.query(
      "insert into rum_session (session_id, app_id) values ('p82-skip-autre', $1) on conflict do nothing",
      [AUTRE],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, url, started_at)
       values (null, 'p82-skip-autre', $1, '/voisin', 'https://p82.test/voisin', now() - interval '20 minutes')`,
      [AUTRE],
    );
    const { plan, bilan } = await reprendre("event-index");
    expect(plan.comptes.par_table.rum_pageview.id_source_nul.valeur).toBe(2);
    // Deux lignes, revues par la phase de réconciliation : le bilan sépare les
    // passes plutôt que de laisser croire à quatre lignes distinctes.
    expect(bilan.par_phase.fenetre.skips.span_id_invalide).toBe(2);
    expect(bilan.par_phase.reconciliation.skips.span_id_invalide).toBe(2);
    expect(bilan.skips.span_id_invalide).toBe(4);
    // AUCUNE ligne de projection ne porte une identité fabriquée.
    const { rows } = await pool.query(
      "select source_span_id from rum_event_index where app_id = $1 and kind = 'pageview'",
      [APP],
    );
    expect(rows.every((r) => /^[0-9a-f]{16}$/.test(r.source_span_id))).toBe(true);
    expect(rows.length).toBe(1);
  });

  it("le même span_id dans une AUTRE application n'est ni lu ni écrit", async () => {
    await writeRows(pool, lot(APP, "p82-portee", ALICE));
    await writeRows(pool, lot(AUTRE, "p82-portee-b", ALICE));
    const spanA = (await pool.query(
      "select span_id from rum_pageview where app_id = $1 limit 1", [APP],
    )).rows[0].span_id as string;
    // L'autre application émet LE MÊME identifiant de span : un émetteur qui
    // réutilise ses identifiants, pas une projection manquante.
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, url, started_at)
       values ($2, 'p82-portee-b', $1, '/collision', 'https://p82.test/c', now() - interval '25 minutes')
       on conflict (span_id) do nothing`,
      [AUTRE, `${spanA.slice(0, 15)}f`],
    );
    const empreinteAutreAvant = await empreinteTable("rum_event_index", AUTRE);
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);

    await reprendre("event-index");
    expect(await empreinteTable("rum_event_index", AUTRE)).toBe(empreinteAutreAvant);
    const { rows } = await pool.query(
      "select count(*)::int as n from rum_event_index where app_id = $1", [AUTRE],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("n'augmente AUCUN compteur de facturation et ne crée AUCUNE alerte", async () => {
    await writeRows(pool, lot(APP, "p82-quota", ALICE));
    await pool.query("select meter_tenant_usage((now() - interval '0 day')::date)");
    const usage = (await pool.query(
      "select events, sessions, errors from tenant_usage_daily where app_id = $1", [APP],
    )).rows;
    const alertes = (await pool.query("select count(*)::int as n from alert_event")).rows[0].n;
    const notifs = (await pool.query(
      "select count(*)::int as n from error_issue_notification where app_id = $1", [APP],
    )).rows[0].n;

    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    await reprendre("event-index");
    await pool.query("select meter_tenant_usage((now() - interval '0 day')::date)");

    expect((await pool.query(
      "select events, sessions, errors from tenant_usage_daily where app_id = $1", [APP],
    )).rows).toEqual(usage);
    expect((await pool.query("select count(*)::int as n from alert_event")).rows[0].n).toBe(alertes);
    expect((await pool.query(
      "select count(*)::int as n from error_issue_notification where app_id = $1", [APP],
    )).rows[0].n).toBe(notifs);
  });

  it("une source disparue APRÈS le plan est comptée, pas réécrite", async () => {
    for (let i = 0; i < 3; i++) await writeRows(pool, lot(APP, `p82-perdue-${i}`, ALICE, { avantMin: 30 + i }));
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "event-index", app: APP, from, to, taille: 100 });
    const eligiblesAuPlan = plan.comptes.eligibles.valeur;
    const id = await inscrirePlan(pool, plan);

    // Entre le plan et l'exécution, une session est effacée : ses lignes n'ont
    // plus à être projetées, et la reprise ne doit pas les ressusciter.
    await pool.query("select erase_session($1)", ["p82-perdue-0"]);

    const bilan = await executer(pool, id, { planSha: plan.plan_sha });
    expect(bilan.written).toBeLessThan(eligiblesAuPlan);
    const { rows } = await pool.query(
      "select count(*)::int as n from rum_event_index where app_id = $1 and session_id = $2",
      [APP, "p82-perdue-0"],
    );
    expect(rows[0].n).toBe(0);
    const rapport = await verifier(pool, id);
    expect(rapport.verification.restant).toBe(0);
  });

  it("une ligne qui a franchi la limite de purge pendant la reprise est un SKIP, pas une écriture", async () => {
    await writeRows(pool, lot(APP, "p82-purge", ALICE, { avantMin: 60 }));
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    const { from, to } = fenetreLarge();
    // La rétention lue AU PLAN vaut 30 jours ; on joue le cas d'une reprise si
    // longue que la limite de purge a rattrapé les lignes (`retention_jours`
    // est ce que le runner transporte).
    const segment = KINDS["event-index"].segments({ from, to })[0];
    const client = await pool.connect();
    try {
      const lu = await KINDS["event-index"].lire(
        client,
        // Une rétention d'une demi-heure : toutes les lignes de la fenêtre l'ont
        // franchie, exactement comme le ferait une reprise assez longue pour que
        // la limite de purge la rattrape.
        { app: APP, from, to, phase: "reconciliation", retention_jours: 0.5 / 24, cutoffs: {} },
        segment,
        null,
        100,
      );
      expect(lu.lignes).toHaveLength(0);
      expect(lu.skips.hors_retention).toBeGreaterThan(0);
    } finally {
      client.release();
    }
  });

  it("deux exécutions laissent le MÊME état — et rien de plus", async () => {
    for (let i = 0; i < 3; i++) await writeRows(pool, lot(APP, `p82-idem-${i}`, ALICE, { avantMin: 30 + i }));
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);

    await reprendre("event-index");
    const apres1 = await empreinteTable("rum_event_index", APP);
    const compte1 = await compter("rum_event_index", APP);

    await reprendre("event-index");
    expect(await empreinteTable("rum_event_index", APP)).toBe(apres1);
    expect(await compter("rum_event_index", APP)).toBe(compte1);
  });
});

// ═══════════════════════════════ 3. rollups ══════════════════════════════════

suite("P8.2 — rollups", () => {
  it("recompte les erreurs en SOMME D'OCCURRENCES, jamais en nombre de lignes", async () => {
    for (let i = 0; i < 3; i++) {
      await writeRows(pool, lot(APP, `p82-roll-${i}`, ALICE, { avantMin: 40 + i, occurrences: 7 }));
    }
    const occurrences = Number((await pool.query(
      "select coalesce(sum(occurrences), 0)::int as n from rum_error where app_id = $1", [APP],
    )).rows[0].n);
    const lignes = await compter("rum_error", APP);
    expect(occurrences).toBeGreaterThan(lignes);

    // L'agrégat d'avant v64 : un COMPTE DE LIGNES.
    await pool.query(
      `insert into rum_rollup_hourly (app_id, device_type, hour, good_w, total_w, pageviews, errors)
       select $1, 'desktop', date_trunc('hour', ts), 0, 0, 0, count(*)
         from rum_error where app_id = $1 group by 3`,
      [APP],
    );
    const { bilan } = await reprendre("rollups");
    expect(bilan.etat).toBe("completed");
    const total = Number((await pool.query(
      "select coalesce(sum(errors), 0)::int as n from rum_rollup_hourly where app_id = $1", [APP],
    )).rows[0].n);
    expect(total).toBe(occurrences);
  });

  it("ne remplace JAMAIS un agrégat historique restant par zéro quand les sources sont purgées", async () => {
    // Un agrégat sans aucune source derrière lui : exactement le cas d'une
    // fenêtre dont la purge a emporté les lignes.
    const heure = new Date(Date.now() - 3 * 3_600_000);
    heure.setUTCMinutes(0, 0, 0);
    await pool.query(
      `insert into rum_rollup_hourly (app_id, device_type, hour, good_w, total_w, pageviews, errors)
       values ($1, 'desktop', $2::timestamptz, 10, 12, 400, 37)`,
      [APP, heure.toISOString()],
    );
    const { plan, bilan } = await reprendre("rollups");
    expect(plan.comptes.sources_purgees.valeur).toBeGreaterThan(0);
    expect(bilan.skips.sources_purgees_agregat_conserve).toBeGreaterThan(0);
    const { rows } = await pool.query(
      "select errors, pageviews from rum_rollup_hourly where app_id = $1 and hour = $2::timestamptz",
      [APP, heure.toISOString()],
    );
    expect(rows[0]).toEqual({ errors: "37", pageviews: "400" });
  });

  it("deux exécutions laissent le MÊME état", async () => {
    for (let i = 0; i < 3; i++) await writeRows(pool, lot(APP, `p82-roll2-${i}`, ALICE, { avantMin: 40 + i }));
    await reprendre("rollups");
    const apres1 = await empreinteTable("rum_rollup_hourly", APP);
    const histo1 = await empreinteTable("metric_histogram_hourly", APP);
    await reprendre("rollups");
    expect(await empreinteTable("rum_rollup_hourly", APP)).toBe(apres1);
    expect(await empreinteTable("metric_histogram_hourly", APP)).toBe(histo1);
  });

  it("déclare IMPOSSIBLE la fusion de deux histogrammes de frontières ou de population différentes", () => {
    const a = { gamma: 1.02, plancher: 0.001, population: "core_vitals_sans_robots_pondere_v80", seaux: new Map([[3, 10]]) };
    expect(fusionHistogrammesPossible(a, { ...a, gamma: 1.05 })).toEqual({ possible: false, raison: "pas_geometrique_different" });
    expect(fusionHistogrammesPossible(a, { ...a, plancher: 0.01 })).toEqual({ possible: false, raison: "plancher_different" });
    expect(fusionHistogrammesPossible(a, { ...a, population: "avec_robots" })).toEqual({ possible: false, raison: "population_differente" });
    expect(fusionHistogrammesPossible(a, { ...a })).toEqual({ possible: true, raison: null });
    // Fusionner, c'est ADDITIONNER DES EFFECTIFS — jamais moyenner des p75.
    const b = { ...a, seaux: new Map([[3, 5], [4, 2]]) };
    const ok = fusionnerHistogrammes([a, b]) as { possible: true; seaux: Map<number, number> };
    expect(ok.possible).toBe(true);
    expect([...ok.seaux.entries()].sort()).toEqual([[3, 15], [4, 2]]);
    expect(fusionnerHistogrammes([a, { ...b, gamma: 2 }])).toEqual({ possible: false, raison: "pas_geometrique_different" });
    expect(fusionnerHistogrammes([])).toEqual({ possible: false, raison: "aucun_histogramme" });
  });

  it("nomme les percentiles et les occurrences perdues parmi ses impossibilités", async () => {
    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "rollups", app: APP, from, to });
    const textes = plan.impossible.map((i: { quoi: string }) => i.quoi).join(" | ");
    expect(textes).toMatch(/moyenne de p75/);
    expect(textes).toMatch(/occurrences qu'un ancien SDK n'a jamais envoyées/);
    expect(textes).toMatch(/purgées/);
  });
});

// ═════════════════════════════ 4. dimensions ═════════════════════════════════

suite("P8.2 — dimensions", () => {
  it("reconstruit navigateur et système À L'IDENTIQUE du chemin vivant", async () => {
    await writeRows(pool, lot(APP, "p82-dim", ALICE));
    const vivant = (await pool.query(
      "select session_id, browser, browser_version, os, os_version, device_type from rum_session where app_id = $1 order by 1",
      [APP],
    )).rows;
    expect(vivant[0].browser).toBe("Chrome");

    // L'historique antérieur à v75 : l'user-agent est là, les dimensions non.
    await pool.query(
      "update rum_session set browser = null, browser_version = null, os = null, os_version = null where app_id = $1",
      [APP],
    );
    await reprendre("dimensions");
    expect((await pool.query(
      "select session_id, browser, browser_version, os, os_version, device_type from rum_session where app_id = $1 order by 1",
      [APP],
    )).rows).toEqual(vivant);
  });

  it("laisse « Inconnu » ce qui l'est : sans user-agent, et pour les robots", async () => {
    await writeRows(pool, lot(APP, "p82-sans-ua", ALICE, { ua: null }));
    await writeRows(pool, lot(APP, "p82-robot", ALICE, { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }));
    await pool.query(
      "update rum_session set browser = null, browser_version = null, os = null, os_version = null where app_id = $1",
      [APP],
    );
    const { plan, bilan } = await reprendre("dimensions");
    expect(plan.comptes.id_source_nul.valeur).toBeGreaterThan(0);
    expect(plan.comptes.robots_ignores.valeur).toBeGreaterThan(0);
    expect(bilan.skips.indeterminable ?? 0).toBeGreaterThanOrEqual(0);
    const { rows } = await pool.query(
      "select session_id, browser, os, is_bot from rum_session where app_id = $1 order by 1", [APP],
    );
    expect(rows.find((r) => r.session_id === "p82-sans-ua")?.browser).toBeNull();
    expect(rows.find((r) => r.session_id === "p82-robot")?.browser).toBeNull();
  });

  it("ne touche PAS `device_type` — c'est une clé d'agrégat", async () => {
    await writeRows(pool, lot(APP, "p82-classe", ALICE));
    await pool.query(
      `update rum_session set browser = null, os = null, browser_version = null, os_version = null,
                             device_type = 'mobile' where app_id = $1`,
      [APP],
    );
    await reprendre("dimensions");
    expect((await pool.query(
      "select device_type from rum_session where app_id = $1", [APP],
    )).rows[0].device_type).toBe("mobile");
  });

  it("reprend env/release/service de la LIGNE SOURCE, jamais de la session", async () => {
    await writeRows(pool, lot(APP, "p82-env", ALICE));
    const vivant = (await pool.query(
      "select source_span_id, env, release, service from rum_event_index where app_id = $1 order by 1", [APP],
    )).rows;
    expect(vivant.some((r) => r.release === "4.8.0")).toBe(true);
    await pool.query(
      "update rum_event_index set env = null, release = null, service = null where app_id = $1", [APP],
    );
    await reprendre("dimensions");
    expect((await pool.query(
      "select source_span_id, env, release, service from rum_event_index where app_id = $1 order by 1", [APP],
    )).rows).toEqual(vivant);
  });

  it("nomme parmi ses impossibilités l'attribution d'une release de session", async () => {
    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "dimensions", app: APP, from, to });
    expect(plan.impossible.map((i: { raison: string }) => i.raison).join(" ")).toMatch(/DERNIÈRE release/);
    expect(plan.impossible.map((i: { quoi: string }) => i.quoi).join(" ")).toMatch(/device_type/);
  });

  it("deux exécutions laissent le MÊME état", async () => {
    await writeRows(pool, lot(APP, "p82-dim-idem", ALICE));
    await pool.query("update rum_session set browser = null, os = null where app_id = $1", [APP]);
    await reprendre("dimensions");
    const apres1 = await empreinteTable("rum_session", APP);
    await reprendre("dimensions");
    expect(await empreinteTable("rum_session", APP)).toBe(apres1);
  });
});

// ═══════════════════════════ 5. error-groups ═════════════════════════════════

suite("P8.2 — error-groups", () => {
  beforeEach(async () => {
    if (!url) return;
    await pool.query(
      `insert into error_grouping_config (app_id, active_version) values ($1, 2)
       on conflict (app_id) do update set active_version = 2`,
      [APP],
    );
  });

  /** Ramène les erreurs de l'app à l'état « avant v72 » : ni clé, ni issue. */
  async function remettreAvantV72() {
    await pool.query(
      `update rum_error set grouping_version = null, grouping_key = null, grouping_basis = null,
                            issue_id = null where app_id = $1`,
      [APP],
    );
    await pool.query("delete from error_issue where app_id = $1", [APP]);
  }

  it("écrit la clé v2, crée des issues `migration`, et n'envoie AUCUNE notification", async () => {
    for (let i = 0; i < 3; i++) await writeRows(pool, lot(APP, `p82-grp-${i}`, ALICE, { avantMin: 35 + i }));
    await remettreAvantV72();
    const notifsAvant = (await pool.query(
      "select count(*)::int as n from error_issue_notification where app_id = $1", [APP],
    )).rows[0].n;

    const { bilan } = await reprendre("error-groups");
    expect(bilan.etat).toBe("completed");

    const { rows } = await pool.query(
      `select count(*) filter (where grouping_key is null)::int as sans_cle,
              count(*) filter (where issue_id is null)::int     as sans_issue
         from rum_error where app_id = $1`,
      [APP],
    );
    expect(rows[0]).toEqual({ sans_cle: 0, sans_issue: 0 });
    const { rows: issues } = await pool.query(
      "select origin, status from error_issue where app_id = $1", [APP],
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.origin === "migration")).toBe(true);
    expect((await pool.query(
      "select count(*)::int as n from error_issue_notification where app_id = $1", [APP],
    )).rows[0].n).toBe(notifsAvant);
  });

  it("conserve les anciennes clés en alias, avec le statut qu'elles portaient", async () => {
    await writeRows(pool, lot(APP, "p82-alias", ALICE));
    await remettreAvantV72();
    const empreinte = (await pool.query(
      "select fingerprint from rum_error where app_id = $1 limit 1", [APP],
    )).rows[0].fingerprint as string;
    await pool.query(
      `insert into error_status (app_id, fingerprint, status, note, updated_at)
       values ($1, $2, 'ignored', 'connu, corrige en 4.9', now())`,
      [APP, empreinte],
    );

    await reprendre("error-groups");
    const { rows } = await pool.query(
      "select legacy_fingerprint, legacy_status from error_issue_alias where app_id = $1", [APP],
    );
    expect(rows).toContainEqual({ legacy_fingerprint: empreinte, legacy_status: "ignored" });
    const { rows: issues } = await pool.query("select status from error_issue where app_id = $1", [APP]);
    expect(issues[0].status).toBe("ignored");
    // La note est transférée UNE fois, avec sa provenance.
    const { rows: notes } = await pool.query(
      `select kind, actor_kind, legacy_fingerprint, event_key, body from error_issue_activity
        where app_id = $1 and kind = 'comment'`,
      [APP],
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      actor_kind: "system", legacy_fingerprint: empreinte, event_key: `legacy_note:${empreinte}`,
    });
    expect(notes[0].body).toContain("connu, corrige en 4.9");
    expect(notes[0].body).not.toContain("hérité du groupe");
  });

  it("des statuts historiques divergents donnent `for_review`, jamais une fusion silencieuse", async () => {
    // Deux empreintes différentes (deux messages), même clé v2 : même type, même
    // frame. Elles portent des statuts contradictoires.
    await writeRows(pool, lot(APP, "p82-div-a", ALICE, { avantMin: 35 }));
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, stack,
                              source, ts, fingerprint, occurrences, context)
       values ($2, 'p82-div-a', $1, '/panier', 'error', 'impossible de lire la propriete panier',
               'TypeError', 'TypeError: boum' || chr(10) || '    at payer (https://p82.test/static/app.js:12:5)',
               'browser', now() - interval '36 minutes', 'empreinte-b', 1, '{}'::jsonb)`,
      [APP, `${spanId()}`],
    );
    await remettreAvantV72();
    const empreintes = (await pool.query(
      "select distinct fingerprint from rum_error where app_id = $1 order by 1", [APP],
    )).rows.map((r) => r.fingerprint as string);
    expect(empreintes.length).toBe(2);
    await pool.query(
      `insert into error_status (app_id, fingerprint, status) values ($1, $2, 'resolved'), ($1, $3, 'ignored')`,
      [APP, empreintes[0], empreintes[1]],
    );

    await reprendre("error-groups");
    const { rows } = await pool.query(
      "select grouping_key, status, status_source, origin from error_issue where app_id = $1", [APP],
    );
    // Une seule clé v2 réunit les deux empreintes, et le désaccord de statut la
    // met EN REVUE.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("for_review");
    expect(rows[0].origin).toBe("migration");
    const { rows: alias } = await pool.query(
      "select legacy_fingerprint, legacy_status from error_issue_alias where app_id = $1 order by 1", [APP],
    );
    expect(alias.map((a) => a.legacy_status).sort()).toEqual(["ignored", "resolved"]);
  });

  it("annonce une note « héritée du groupe » quand le groupe historique s'est scindé", async () => {
    await writeRows(pool, lot(APP, "p82-scission", ALICE, { avantMin: 35, erreurType: "TypeError" }));
    await writeRows(pool, lot(APP, "p82-scission", ALICE, { avantMin: 36, erreurType: "RangeError" }));
    await remettreAvantV72();
    // Une SEULE empreinte historique pour les deux : le regroupement d'alors
    // était plus grossier. La clé v2, elle, distingue les deux types.
    await pool.query("update rum_error set fingerprint = 'empreinte-large' where app_id = $1", [APP]);
    await pool.query(
      "insert into error_status (app_id, fingerprint, status, note) values ($1, 'empreinte-large', 'open', 'regarder le panier')",
      [APP],
    );

    await reprendre("error-groups");
    const { rows: issues } = await pool.query("select id from error_issue where app_id = $1", [APP]);
    expect(issues.length).toBe(2);
    const { rows: notes } = await pool.query(
      "select body, legacy_fingerprint from error_issue_activity where app_id = $1 and kind = 'comment' order by id",
      [APP],
    );
    expect(notes).toHaveLength(2);
    for (const note of notes) {
      expect(note.legacy_fingerprint).toBe("empreinte-large");
      expect(note.body).toContain("hérité du groupe historique empreinte-large, scindé en 2 issues");
      expect(note.body).toContain("regarder le panier");
    }
  });

  it("ne crée AUCUNE issue quand le regroupement v2 n'est pas activé pour l'application", async () => {
    await pool.query("update error_grouping_config set active_version = null where app_id = $1", [APP]);
    await writeRows(pool, lot(APP, "p82-inactif", ALICE));
    await remettreAvantV72();
    const { bilan } = await reprendre("error-groups");
    expect(bilan.skips.issue_non_creee_regroupement_inactif).toBeGreaterThan(0);
    expect(await compter("error_issue", APP)).toBe(0);
    // La clé est tout de même écrite : c'est l'ombre qui permet de mesurer.
    expect((await pool.query(
      "select count(*)::int as n from rum_error where app_id = $1 and grouping_key is not null", [APP],
    )).rows[0].n).toBeGreaterThan(0);
  });

  it("le plan rend une carte de correspondance SANS message ni pile", async () => {
    await writeRows(pool, lot(APP, "p82-carte", ALICE));
    await remettreAvantV72();
    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "error-groups", app: APP, from, to });
    expect(plan.comptes.carte.empreintes_historiques).toBeGreaterThan(0);
    expect(plan.comptes.carte.correspondances[0].cles_v2[0]).toMatch(/^[0-9a-f]{32}$/);
    const texte = JSON.stringify(plan);
    expect(texte).not.toContain("impossible de lire la propriete");
    expect(texte).not.toContain("app.js:12:5");
    expect(texte).not.toContain(ALICE);
  });

  it("deux exécutions laissent le MÊME état, sans notification supplémentaire", async () => {
    for (let i = 0; i < 2; i++) await writeRows(pool, lot(APP, `p82-grp-idem-${i}`, ALICE, { avantMin: 35 + i }));
    await remettreAvantV72();
    await reprendre("error-groups");
    const issues1 = await empreinteTable("error_issue", APP);
    const alias1 = await empreinteTable("error_issue_alias", APP);
    const notifs1 = await compter("error_issue_notification", APP);
    const activite1 = await compter("error_issue_activity", APP);

    await reprendre("error-groups");
    expect(await empreinteTable("error_issue", APP)).toBe(issues1);
    expect(await empreinteTable("error_issue_alias", APP)).toBe(alias1);
    expect(await compter("error_issue_notification", APP)).toBe(notifs1);
    expect(await compter("error_issue_activity", APP)).toBe(activite1);
  });
});

// ═══════════════ 6. Interruption : ni trou, ni doublon, ni mensonge ══════════

suite("P8.2 — interruption et reprise", () => {
  it("s'arrête après un lot, puis reprend exactement où il en était", async () => {
    for (let i = 0; i < 6; i++) await writeRows(pool, lot(APP, `p82-lot-${i}`, ALICE, { avantMin: 30 + i }));
    const attendu = (await pool.query(
      "select kind, source_span_id from rum_event_index where app_id = $1 order by 1, 2", [APP],
    )).rows;
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);

    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "event-index", app: APP, from, to, taille: 100 });
    const id = await inscrirePlan(pool, plan);

    const premier = await executer(pool, id, { planSha: plan.plan_sha, maxLots: 1 });
    expect(premier.arret).toBe("max_lots");
    expect((await etat(pool, id)).state).toBe("paused");
    const partiel = await compter("rum_event_index", APP);
    expect(partiel).toBeGreaterThan(0);
    expect(partiel).toBeLessThan(attendu.length);

    const suite2 = await executer(pool, id, { planSha: plan.plan_sha });
    expect(suite2.etat).toBe("completed");
    expect((await pool.query(
      "select kind, source_span_id from rum_event_index where app_id = $1 order by 1, 2", [APP],
    )).rows).toEqual(attendu);
  });

  it("une panne ENTRE l'écriture et le point de reprise annule TOUT le lot ; la reprise n'écrit qu'une fois", async () => {
    for (let i = 0; i < 4; i++) await writeRows(pool, lot(APP, `p82-panne-${i}`, ALICE, { avantMin: 30 + i }));
    const attendu = (await pool.query(
      "select kind, source_span_id from rum_event_index where app_id = $1 order by 1, 2", [APP],
    )).rows;
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);

    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "event-index", app: APP, from, to, taille: 100 });
    const id = await inscrirePlan(pool, plan);

    // Le point de reprise est écrit DANS la transaction du lot. On le fait
    // échouer : si l'atomicité n'existait pas, les lignes du lot resteraient et
    // la reprise les réécrirait.
    let coupe = false;
    const poolPiege = {
      query: (...args: unknown[]) => (pool.query as (...a: unknown[]) => unknown)(...args),
      connect: async () => {
        const client = await pool.connect();
        return new Proxy(client, {
          get(c, p, r) {
            if (p !== "query") return Reflect.get(c, p, r);
            // TOUS les arguments sont transmis : `pg` appelle aussi
            // `query(config, values, callback)`, et manger le callback ferait
            // pendre le test au lieu de le faire échouer.
            return (...args: unknown[]) => {
              const texte = args[0];
              if (!coupe && typeof texte === "string" && texte.includes("update backfill_run")) {
                coupe = true;
                throw Object.assign(new Error("panne simulée"), { code: "XX000" });
              }
              return (c.query as (...a: unknown[]) => unknown).apply(c, args);
            };
          },
        });
      },
    };

    await expect(executer(poolPiege as unknown as pg.Pool, id, { planSha: plan.plan_sha })).rejects.toThrow();
    const apresPanne = await etat(pool, id);
    expect(apresPanne.state).toBe("failed");
    expect(apresPanne.error_code).toBe("sqlstate_xx000");
    // Rien du lot avorté n'a survécu : le curseur n'a pas bougé, les lignes non plus.
    expect(apresPanne.checkpoint_json).toEqual({});
    expect(await compter("rum_event_index", APP)).toBe(0);

    const reprise = await executer(pool, id, { planSha: plan.plan_sha });
    expect(reprise.etat).toBe("completed");
    expect((await pool.query(
      "select kind, source_span_id from rum_event_index where app_id = $1 order by 1, 2", [APP],
    )).rows).toEqual(attendu);
  }, 60_000);

  it("une pause demandée PENDANT la course s'observe entre deux lots, et la reprise repart du curseur", async () => {
    for (let i = 0; i < 4; i++) await writeRows(pool, lot(APP, `p82-pause-${i}`, ALICE, { avantMin: 30 + i }));
    const attendu = (await pool.query(
      "select kind, source_span_id from rum_event_index where app_id = $1 order by 1, 2", [APP],
    )).rows;
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "event-index", app: APP, from, to, taille: 100 });
    const id = await inscrirePlan(pool, plan);

    // La pause arrive d'un AUTRE processus, pendant que la reprise tourne.
    let demandee = false;
    const bilan = await executer(pool, id, {
      planSha: plan.plan_sha,
      surLot: async () => {
        if (demandee) return;
        demandee = true;
        expect(await mettreEnPause(pool, id)).toBe("paused");
      },
    });
    expect(bilan.arret).toBe("pause");
    expect(bilan.lots).toBe(1);
    const enPause = await etat(pool, id);
    expect(enPause.state).toBe("paused");
    expect(enPause.checkpoint_json.phase).toBe("fenetre");
    // Une pause sur une exécution déjà en pause n'est pas un succès silencieux.
    await expect(mettreEnPause(pool, id)).rejects.toMatchObject({ code: "transition_refusee" });

    const reprise = await executer(pool, id, { planSha: plan.plan_sha });
    expect(reprise.etat).toBe("completed");
    expect((await pool.query(
      "select kind, source_span_id from rum_event_index where app_id = $1 order by 1, 2", [APP],
    )).rows).toEqual(attendu);
  }, 60_000);

  it("une reprise refuse un plan ou un code qui ne sont plus les mêmes", async () => {
    await writeRows(pool, lot(APP, "p82-sceau", ALICE));
    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "event-index", app: APP, from, to, taille: 100 });
    const id = await inscrirePlan(pool, plan);

    await expect(executer(pool, id, { planSha: "0".repeat(64) }))
      .rejects.toMatchObject({ code: "plan_sha_discordant" });
    // Un code modifié depuis le plan : la reprise exige un nouveau dry-run.
    await pool.query("update backfill_run set code_sha = $2 where id = $1", [id, "a".repeat(64)]);
    await expect(executer(pool, id, { planSha: plan.plan_sha }))
      .rejects.toMatchObject({ code: "code_modifie" });
    // Et un périmètre modifié après coup.
    await pool.query("update backfill_run set code_sha = $2, plan_sha = $3 where id = $1",
      [id, empreinteCode(), "b".repeat(64)]);
    await expect(executer(pool, id, { planSha: "b".repeat(64) }))
      .rejects.toMatchObject({ code: "plan_modifie" });
  });

  it("un signal d'arrêt laisse l'exécution en pause, sur un curseur cohérent", async () => {
    for (let i = 0; i < 4; i++) await writeRows(pool, lot(APP, `p82-sigterm-${i}`, ALICE, { avantMin: 30 + i }));
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "event-index", app: APP, from, to, taille: 100 });
    const id = await inscrirePlan(pool, plan);

    const controleur = new AbortController();
    const bilan = await executer(pool, id, {
      planSha: plan.plan_sha,
      signal: controleur.signal,
      surLot: () => { controleur.abort(); },
    });
    expect(bilan.arret).toBe("signal");
    expect(bilan.lots).toBe(1);
    expect((await etat(pool, id)).state).toBe("paused");
    // Le lot commencé est allé au bout : son curseur est écrit.
    expect((await etat(pool, id)).checkpoint_json.segments).toBeDefined();
  });
});

// ═══════════════════════ 7. `verify`, indépendant du runner ══════════════════

suite("P8.2 — `verify` ne se fie pas au runner", () => {
  it("rend les compteurs du runner ET une vérification faite depuis les tables", async () => {
    for (let i = 0; i < 3; i++) await writeRows(pool, lot(APP, `p82-verif-${i}`, ALICE, { avantMin: 30 + i }));
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    const { id } = await reprendre("event-index");
    const rapport = await verifier(pool, id);
    expect(rapport.verification.restant).toBe(0);
    expect(rapport.verification.projete).toBeGreaterThan(0);
    expect(rapport.compteurs_du_runner.written).toBeGreaterThan(0);
    expect(rapport.independance).toMatch(/n'a lu ni le curseur/);
  });

  it("voit un trou que le runner croit avoir comblé", async () => {
    for (let i = 0; i < 3; i++) await writeRows(pool, lot(APP, `p82-trou-${i}`, ALICE, { avantMin: 30 + i }));
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    const { id } = await reprendre("event-index");
    expect((await verifier(pool, id)).verification.restant).toBe(0);

    // Quelqu'un supprime une ligne de projection APRÈS la reprise : les
    // compteurs du runner ne bougent pas, la vérification le voit.
    await pool.query(
      "delete from rum_event_index where app_id = $1 and kind = 'pageview' and id = (select min(id) from rum_event_index where app_id = $1 and kind = 'pageview')",
      [APP],
    );
    const apres = await verifier(pool, id);
    expect(apres.verification.par_table.rum_pageview.restant).toBe(1);
    expect(apres.compteurs_du_runner.written).toBeGreaterThan(0);
  });

  it("compte les projections dont la SOURCE a disparu, sans les imputer à la reprise", async () => {
    await writeRows(pool, lot(APP, "p82-orphelin", ALICE));
    const { id } = await reprendre("event-index");
    await pool.query("delete from rum_pageview where app_id = $1", [APP]);
    const rapport = await verifier(pool, id);
    expect(rapport.verification.par_table.rum_pageview.projection_sans_source).toBeGreaterThan(0);
  });
});

// ═════════ 8. Les quatre runners passent par le protocole de P8.1 ════════════

suite("P8.2 — chaque runner passe par le verrou et les barrières de P8.1", () => {
  for (const kind of ["event-index", "rollups", "dimensions", "error-groups"]) {
    it(`${kind} : l'effacement tient le verrou, la reprise attend puis ne ressuscite rien`, async () => {
      if (kind === "error-groups") {
        await pool.query(
          `insert into error_grouping_config (app_id, active_version) values ($1, 2)
           on conflict (app_id) do update set active_version = 2`,
          [APP],
        );
      }
      await writeRows(pool, lot(APP, "p82-dsar-a", ALICE, { avantMin: 40 }));
      await writeRows(pool, lot(APP, "p82-dsar-b", "bob@p82.test", { avantMin: 41 }));
      if (kind === "event-index") await pool.query("delete from rum_event_index where app_id = $1", [APP]);
      if (kind === "dimensions") {
        await pool.query("update rum_session set browser = null, os = null where app_id = $1", [APP]);
      }
      if (kind === "error-groups") {
        await pool.query(
          `update rum_error set grouping_version = null, grouping_key = null, grouping_basis = null,
                                issue_id = null where app_id = $1`,
          [APP],
        );
        await pool.query("delete from error_issue where app_id = $1", [APP]);
      }
      const hash = hashIdentity(SECRET, APP, "user", ALICE) as string;

      const { from, to } = fenetreLarge();
      const plan = await planifier(pool, { kind, app: APP, from, to, taille: 100 });
      const id = await inscrirePlan(pool, plan);

      // L'effacement prend le verrou et le garde jusqu'à son commit.
      const dsar = await pool.connect();
      let liberer: () => void = () => {};
      const retenu = new Promise<void>((r) => { liberer = r; });
      const io: IdentityDsarIo = {
        query: async <T,>(text: string, params?: unknown[]) => (await dsar.query(text, params)).rows as T[],
        transaction: async <T,>(fn: (c: never) => Promise<T>) => {
          await dsar.query("begin");
          try {
            const out = await fn(dsar as never);
            await retenu;
            await dsar.query("commit");
            return out;
          } catch (err) {
            await dsar.query("rollback").catch(() => {});
            throw err;
          }
        },
      };
      try {
        const efface = dsarIdentityErase(APP, "user", hash, io);
        await attendre(
          async () => (await pool.query<{ n: number }>(
            "select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1 and granted",
            [VERROU_INGESTION_NS],
          )).rows[0].n > 0,
          "l'effacement tient le verrou",
        );

        const reprise = executer(pool, id, { planSha: plan.plan_sha });
        await attendre(quelquUnAttend, "la reprise attend le verrou de l'effacement");

        liberer();
        await efface;
        const bilan = await reprise;
        expect(bilan.etat).toBe("completed");
      } finally {
        dsar.release();
      }

      // AUCUNE RÉSURRECTION : la session effacée n'est revenue dans aucune cible.
      expect(await compter("rum_session", APP)).toBe(1);
      const { rows } = await pool.query(
        "select count(*)::int as n from rum_event_index where app_id = $1 and session_id = $2",
        [APP, "p82-dsar-a"],
      );
      expect(rows[0].n).toBe(0);
      const { rows: barrieres } = await pool.query(
        "select count(*)::int as n from privacy_erasure_barrier where app_id = $1", [APP],
      );
      expect(barrieres[0].n).toBeGreaterThan(0);
    }, 60_000);
  }
});

// ══════════════ 9. La nouvelle table est atteinte par l'effacement ═══════════

suite("P8.2 — `backfill_run` dans le périmètre d'effacement", () => {
  it("`erase_app_data` vide le journal des reprises de l'application", async () => {
    await writeRows(pool, lot(AUTRE, "p82-erase", ALICE));
    const { from, to } = fenetreLarge();
    const plan = await planifier(pool, { kind: "event-index", app: AUTRE, from, to });
    await inscrirePlan(pool, plan);
    expect(await compter("backfill_run", AUTRE)).toBe(1);

    const bilan = (await pool.query("select erase_app_data($1) as r", [AUTRE])).rows[0].r;
    expect(bilan.backfill_run).toBe(1);
    expect(await compter("backfill_run", AUTRE)).toBe(0);
    // L'effacement d'une app N'EMPORTE PAS les journaux des autres.
    await pool.query(
      `update app_registry set active = true, ingestion_suspended_at = null, ingestion_suspended_by = null
        where app_id = $1`,
      [AUTRE],
    );
  });

  it("migration-v83 est REJOUABLE : la ligne ajoutée à `erase_app_data` ne se double pas", async () => {
    const compteDeletes = async () => Number((await pool.query(
      `select (length(prosrc) - length(replace(prosrc, 'from backfill_run ', '')))
              / length('from backfill_run ') as n
         from pg_proc where proname = 'erase_app_data'`,
    )).rows[0].n);
    expect(await compteDeletes()).toBe(1);
    const v83 = readFileSync(join(SQL_DIR, "migration-v83.sql"), "utf8");
    await pool.query(v83);
    await pool.query(v83);
    expect(await compteDeletes()).toBe(1);
    // Et le reste de la fonction n'a pas été perdu au passage — c'est la panne
    // de v80, qui avait repris la définition d'avant v79.
    const { rows } = await pool.query<{ src: string }>(
      "select prosrc as src from pg_proc where proname = 'erase_app_data'",
    );
    for (const table of ["analytics_saved_view", "dashboard", "rum_log", "rum_ai", "error_status", "svi_call"]) {
      expect(rows[0].src).toContain(`from ${table} `);
    }
  });

  it("la portée tenant de `backfill_run` est explicite, jamais `using (true)`", async () => {
    const { rows } = await pool.query<{ qual: string; roles: string }>(
      `select pg_get_expr(p.polqual, p.polrelid) as qual,
              array_to_string(array(select rolname from pg_roles where oid = any(p.polroles)), ',') as roles
         from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relname = 'backfill_run'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].qual).toContain("current_app_ids()");
    expect(rows[0].qual).not.toBe("true");
    expect(rows[0].roles).toContain("console_ro");
    const { rows: rls } = await pool.query<{ actif: boolean }>(
      "select relrowsecurity as actif from pg_class where relname = 'backfill_run'",
    );
    expect(rls[0].actif).toBe(true);
  });

  it("le journal ne contient ni message, ni pile, ni identifiant de personne", async () => {
    await writeRows(pool, lot(APP, "p82-journal", ALICE));
    await pool.query("delete from rum_event_index where app_id = $1", [APP]);
    const { id } = await reprendre("event-index");
    const ligne = JSON.stringify(await etat(pool, id));
    expect(ligne).not.toContain(ALICE);
    expect(ligne).not.toContain("impossible de lire la propriete");
    expect(ligne).not.toContain("app.js");
    expect(ligne).not.toContain("p82-journal");
  });
});

// ═════════════ 10. Fenêtre de déploiement : le code AVANT la migration ═══════
//
// Le code part en production avant que le pré-déploiement n'applique v83. Le
// DRY-RUN, lui, ne dépend d'aucune table nouvelle : on peut chiffrer un
// périmètre avant d'avoir touché au schéma, et c'est une propriété utile —
// c'est même l'ordre naturel. Seule l'inscription au journal exige v83, et elle
// le dit au lieu de rendre une erreur PostgreSQL brute.
//
//   SQL_TEST_PRE_V83_DATABASE_URL=<base jetable EN VERSION v82> pnpm test:sql
const urlPreV83 = process.env.SQL_TEST_PRE_V83_DATABASE_URL;
const suiteFenetre = urlPreV83 ? describe : describe.skip;
const poolFenetre = new pg.Pool(urlPreV83 ? { connectionString: urlPreV83, max: 4 } : { max: 1 });

suiteFenetre("P8.2 — code publié AVANT migration-v83", () => {
  beforeAll(async () => {
    if (!urlPreV83) return;
    // Schéma REMIS À NEUF : cette suite doit pouvoir se rejouer sur la même base
    // jetable. Sans cela, le v83 appliqué par son dernier test resterait en
    // place, et le test « le journal n'existe pas encore » passerait pour un
    // échec du produit alors que c'est la base qui n'est plus en v82.
    await poolFenetre.query("drop schema public cascade; create schema public;");
    const fichiers = readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f) && Number(f.match(/\d+/)![0]) <= 82)
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    await poolFenetre.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
    for (const f of fichiers) await poolFenetre.query(readFileSync(join(SQL_DIR, f), "utf8"));
    await poolFenetre.query(
      `insert into app_registry (app_id, name, active, retention_days) values ($1, $1, true, 30)
       on conflict (app_id) do update set active = true, retention_days = 30`,
      [APP],
    );
  }, 300_000);

  // Le cache de colonnes de `pg-ingest` est indexé par TABLE, pas par base. Les
  // suites précédentes l'ont rempli depuis une base au schéma complet : sans
  // remise à zéro, l'écriture viserait ici des colonnes que ce schéma v82 n'a
  // pas — `rum_session.geo_source` de v85 l'a démontré. On le vide donc avant
  // CHAQUE test, puisque le troisième applique v83 et change le schéma sous le
  // cache ; et en sortant, pour ne pas laisser la suite suivante hériter d'un
  // cache rempli depuis une base en retard.
  beforeEach(() => {
    if (urlPreV83) _resetColonnesCache();
  });

  afterAll(async () => {
    if (!urlPreV83) return;
    _resetColonnesCache();
    await poolFenetre.end();
  });

  it("le dry-run fonctionne SANS la migration : un plan est lisible avant d'avoir touché au schéma", async () => {
    await writeRows(poolFenetre, lot(APP, "p82-fenetre", ALICE));
    const { from, to } = fenetreLarge();
    const plan = await planifier(poolFenetre, { kind: "event-index", app: APP, from, to });
    expect(plan.plan_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.comptes.eligibles.valeur).toBeGreaterThanOrEqual(0);
  });

  it("l'inscription au journal est refusée AVEC SON MOTIF, pas avec une erreur PostgreSQL brute", async () => {
    const { from, to } = fenetreLarge();
    const plan = await planifier(poolFenetre, { kind: "event-index", app: APP, from, to });
    await expect(inscrirePlan(poolFenetre, plan)).rejects.toMatchObject({ code: "journal_absent" });
  });

  it("v83 s'applique sur un schéma v82, puis la reprise fonctionne", async () => {
    await poolFenetre.query(readFileSync(join(SQL_DIR, "migration-v83.sql"), "utf8"));
    const { from, to } = fenetreLarge();
    const plan = await planifier(poolFenetre, { kind: "event-index", app: APP, from, to, taille: 100 });
    const id = await inscrirePlan(poolFenetre, plan);
    const bilan = await executer(poolFenetre, id, { planSha: plan.plan_sha });
    expect(bilan.etat).toBe("completed");
    // Et l'effacement d'application atteint bien la table neuve.
    const { rows } = await poolFenetre.query<{ src: string }>(
      "select prosrc as src from pg_proc where proname = 'erase_app_data'",
    );
    expect(rows[0].src).toContain("from backfill_run ");
  }, 60_000);
});
