// Migration-v111 — sécurité et hygiène des données, sur un VRAI PostgreSQL.
//
// Ce que ce fichier prouve, point par point du lot A (audit du 07/10/2026) :
//
//   1. un lot de logs rejoué n'écrit rien de plus, par les DEUX chemins
//      d'écriture (historique et un aller-retour), qui laissent les mêmes lignes ;
//      sans `mip_ingerer_lot_v2`, le collector retombe sur v1 sans erreur ;
//   2. `refresh_rum_rollups` n'agrège plus les robots et joint la session dans SA
//      application : il rend ce que les écrans calculent sur le brut (robots
//      exclus, jointure `sessionJoin`) ; les heures agrégées avant v111 sont
//      marquées une seule fois, puis recalculées ;
//   3. la purge ne lit plus `pageview_id`, et purge comme avant ;
//   4. `alert_config` est sous RLS : un rôle qui a le droit de lire mais aucune
//      policy n'en voit rien ; le propriétaire (scheduler, notifier) la lit.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm vitest run tests/integration/securite-v111-sql.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import { _resetColonnesCache, writeLogs } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS sans déclarations
import { _resetUnAR } from "../../packages/backend/lib/ingest-un-ar.mjs";
// @ts-expect-error module JS sans déclarations
import { _resetPresenceBarrieres } from "../../packages/backend/lib/privacy-barriere.mjs";
// @ts-expect-error module JS sans déclarations
import { flattenOtlpLogs } from "../../packages/backend/shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const lire = (f: string) => readFileSync(join(SQL_DIR, f), "utf8");

const APP = "v111-a";
const AUTRE = "v111-b";
const APPS = [APP, AUTRE];
const NOW = Date.UTC(2026, 9, 8, 10, 0, 0);

type Chemin = "historique" | "un_ar";

function attributs(valeurs: Record<string, string | number>) {
  return Object.entries(valeurs).map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { doubleValue: value } : { stringValue: String(value) },
  }));
}

/** Trois logs, dont deux IDENTIQUES émis à la même nanoseconde, et une exception. */
function lotLogs(app: string, session: string) {
  const ns = (BigInt(NOW - 30_000) * 1_000_000n).toString();
  const meme = { timeUnixNano: ns, severityNumber: 9, body: { stringValue: "tentative" }, attributes: attributs({ "mip.session_id": session }) };
  return flattenOtlpLogs({
    resourceLogs: [{
      resource: { attributes: attributs({ "mip.app_id": app, "service.name": "api-v111" }) },
      scopeLogs: [{ logRecords: [
        meme,
        meme,
        { timeUnixNano: ns, severityNumber: 17, traceId: "e".repeat(32), spanId: "f".repeat(16), body: { stringValue: "échec du paiement" },
          attributes: attributs({ "mip.session_id": session, "exception.type": "PaymentError", "exception.message": "refusé",
            "exception.stacktrace": "PaymentError: refusé\n  at pay (pay.py:12)" }) },
        // Sans horodatage : `ts` vaut l'heure de réception, la clé n'en dépend pas.
        { severityNumber: 13, body: { stringValue: "sans horloge" } },
      ] }],
    }],
  }, { now: NOW });
}

async function nettoyer() {
  for (const t of ["rum_log", "rum_error", "rum_pageview", "rum_metric", "rum_rollup_hourly", "analytics_rollup_invalidation", "rum_session"]) {
    await pool.query(`delete from ${t} where app_id = any($1::text[])`, [APPS]);
  }
  _resetPresenceBarrieres();
  _resetColonnesCache();
  _resetUnAR(pool);
}

async function logsEnBase() {
  const { rows } = await pool.query(
    `select app_id, ts, severity_num, severity_text, body, source, trace_id, span_id, session_id, route, attributes, log_uid
       from rum_log where app_id = any($1::text[])`,
    [APPS],
  );
  // `ts` d'un log sans horodatage vaut l'heure de réception : il n'entre pas dans
  // la comparaison entre chemins, seulement sa présence.
  return rows.map((r) => JSON.stringify({ ...r, ts: r.body === "sans horloge" ? "<reception>" : r.ts })).sort();
}

beforeAll(async () => {
  if (!url) return;
  const fichiers = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  await pool.query(lire("schema.sql"));
  for (const f of fichiers) await pool.query(lire(f));
  for (const app of APPS) {
    await pool.query(
      `insert into app_registry (app_id, name, active, privacy_barrier_mode) values ($1, $1, true, 'off')
       on conflict (app_id) do update set active = true, privacy_barrier_mode = 'off'`,
      [app],
    );
  }
}, 300_000);

afterAll(async () => {
  if (!url) return;
  await nettoyer();
  await pool.query("delete from app_registry where app_id = any($1::text[])", [APPS]);
  await pool.end();
});

suite("v111 — 1. les logs sont idempotents, par les deux chemins", () => {
  async function jouer(chemin: Chemin) {
    await nettoyer();
    const lot = lotLogs(APP, "s-v111-log");
    const premier = await writeLogs(pool, lot.logs, lot.errors, { chemin });
    // Le MÊME lot, aplati de nouveau : c'est ce que font la reprise du SDK et le
    // drain de la file différée, qui relisent la charge brute.
    const rejoue = lotLogs(APP, "s-v111-log");
    const second = await writeLogs(pool, rejoue.logs, rejoue.errors, { chemin });
    return { premier, second, lignes: await logsEnBase() };
  }

  it("la clé naturelle est stable d'un aplatissement à l'autre, distincte par position", () => {
    const a = lotLogs(APP, "s").logs.map((l: { log_uid: string }) => l.log_uid);
    const b = lotLogs(APP, "s").logs.map((l: { log_uid: string }) => l.log_uid);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    for (const u of a) expect(u).toMatch(/^[0-9a-f]{32}$/);
    // Une autre application, même contenu : une autre clé.
    expect(lotLogs(AUTRE, "s").logs[0].log_uid).not.toBe(a[0]);
  });

  it("rejouer un lot n'écrit aucun log de plus, et les deux chemins laissent les mêmes lignes", async () => {
    const historique = await jouer("historique");
    const unAR = await jouer("un_ar");
    for (const r of [historique, unAR]) {
      // Quatre logs (les deux identiques restent deux), écrits une seule fois.
      expect(r.lignes).toHaveLength(4);
      expect(r.lignes.every((l) => JSON.parse(l).log_uid)).toBe(true);
      expect(r.premier.erreurs.inserees).toBe(1);
      expect(r.second.erreurs.inserees).toBe(0);
    }
    expect(unAR.lignes).toEqual(historique.lignes);
    expect(unAR.premier).toEqual(historique.premier);
    expect(unAR.second).toEqual(historique.second);
  });

  it("un lot d'un parser antérieur (sans clé) s'écrit comme avant, par les deux chemins", async () => {
    for (const chemin of ["historique", "un_ar"] as Chemin[]) {
      await nettoyer();
      const lot = lotLogs(APP, "s-v111-ancien");
      const sansCle = lot.logs.map(({ log_uid: _, ...l }: { log_uid: string }) => l);
      await writeLogs(pool, sansCle, [], { chemin });
      await writeLogs(pool, sansCle, [], { chemin });
      const lignes = await logsEnBase();
      expect(lignes, chemin).toHaveLength(8);
      expect(lignes.every((l) => JSON.parse(l).log_uid === null), chemin).toBe(true);
    }
  });

  it("sans `mip_ingerer_lot_v2` (code déployé avant la migration), le chemin en un aller-retour passe par v1", async () => {
    await nettoyer();
    const client = await pool.connect();
    try {
      await client.query("alter function mip_ingerer_lot_v2(text[], jsonb, jsonb) rename to mip_ingerer_lot_v2_absente");
      const lot = lotLogs(APP, "s-v111-repli");
      const bilan = await writeLogs(pool, lot.logs, lot.errors, { chemin: "un_ar" });
      expect(bilan.logs).toBe(4);
      // v1 ignore la clé : c'est la preuve que v1, et non le chemin historique
      // (qui l'écrit), a pris le lot.
      const lignes = await logsEnBase();
      expect(lignes).toHaveLength(4);
      expect(lignes.every((l) => JSON.parse(l).log_uid === null)).toBe(true);
    } finally {
      await client.query("alter function mip_ingerer_lot_v2_absente(text[], jsonb, jsonb) rename to mip_ingerer_lot_v2");
      client.release();
      _resetUnAR(pool);
    }
  });
});

suite("v111 — 2. les agrégats horaires : sans robots, dans leur application", () => {
  /** Une heure pleine, deux heures avant l'heure en cours. */
  const HEURE = "date_trunc('hour', now()) - interval '2 hours'";

  async function semer() {
    await nettoyer();
    // Le MÊME identifiant de session dans deux applications : humain mobile chez
    // A, robot sur tablette chez B. Plus un robot chez A.
    await pool.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot) values
         ('s-v111-humain', $1, 'mobile', false), ('s-v111-robot', $1, 'desktop', true)`,
      [APP],
    );
    // `rum_session.session_id` est la clé primaire : la collision d'identifiant
    // vit dans les lignes filles, qui ne la contraignent pas.
    for (const [app, session, n] of [[APP, "s-v111-humain", 3], [APP, "s-v111-robot", 5], [AUTRE, "s-v111-humain", 7]] as const) {
      await pool.query(
        `insert into rum_pageview (app_id, session_id, route, started_at)
         select $1, $2, '/', ${HEURE} + interval '5 minutes' from generate_series(1, $3)`,
        [app, session, n],
      );
      await pool.query(
        `insert into rum_metric (app_id, session_id, name, value, rating, ts)
         select $1, $2, 'LCP', 1800, 'good', ${HEURE} + interval '6 minutes' from generate_series(1, $3)`,
        [app, session, n],
      );
      await pool.query(
        `insert into rum_error (app_id, session_id, route, kind, message, occurrences, ts)
         values ($1, $2, '/', 'error', 'boum', $3, ${HEURE} + interval '7 minutes')`,
        [app, session, n],
      );
    }
  }

  /** Le brut, comme les écrans le lisent sans agrégat : `sessionJoin` et robots exclus. */
  async function brut(app: string) {
    const { rows } = await pool.query(
      `select coalesce(s.device_type, '') as device_type, count(*)::int as pageviews
         from rum_pageview p left join rum_session s on s.app_id = p.app_id and s.session_id = p.session_id
        where p.app_id = $1 and not coalesce(s.is_bot, false)
        group by 1 order by 1`,
      [app],
    );
    return rows;
  }

  it("le rafraîchissement exclut les robots et joint la session dans son application", async () => {
    await semer();
    await pool.query("select refresh_rum_rollups(6)");
    const { rows } = await pool.query(
      `select app_id, device_type, pageviews::int, errors::int, good_w, total_w from rum_rollup_hourly
        where app_id = any($1::text[]) order by app_id, device_type`,
      [APPS],
    );
    expect(rows).toEqual([
      // A : seul l'humain compte, sous SA classe d'appareil ; le robot est exclu.
      { app_id: APP, device_type: "mobile", pageviews: 3, errors: 3, good_w: 6, total_w: 6 },
      // B : aucune session à lui sous cet identifiant — classe inconnue, jamais
      // la classe « mobile » de la session homonyme de A.
      { app_id: AUTRE, device_type: "", pageviews: 7, errors: 7, good_w: 14, total_w: 14 },
    ]);
    // Ce que les écrans calculent sur le brut, robots exclus : la même chose.
    expect((await brut(APP)).map((r) => [r.device_type, r.pageviews])).toEqual([["mobile", 3]]);
    expect((await brut(AUTRE)).map((r) => [r.device_type, r.pageviews])).toEqual([["", 7]]);
  });

  it("les heures agrégées avant v111 sont marquées une seule fois, puis recalculées et démarquées", async () => {
    await semer();
    // L'ancienne définition (v102), et une heure agrégée par elle, robots compris.
    const v102 = lire("migration-v102.sql");
    await pool.query(v102.slice(v102.indexOf("create or replace function refresh_rum_rollups"), v102.indexOf("comment on function refresh_rum_rollups")));
    await pool.query("delete from agregat_filigrane where source = 'rum_rollup_hourly'");
    await pool.query("select refresh_rum_rollups(6)");
    const { rows: avant } = await pool.query(
      "select coalesce(sum(pageviews), 0)::int as n from rum_rollup_hourly where app_id = $1", [APP],
    );
    expect(avant[0].n).toBe(8);

    const marques = async () => (await pool.query(
      "select count(*)::int as n from analytics_rollup_invalidation where source = 'rum_rollup_hourly' and app_id = any($1::text[])",
      [APPS],
    )).rows[0].n;
    await pool.query(lire("migration-v111.sql"));
    const posees = await marques();
    expect(posees).toBeGreaterThan(0);
    // Rejouer le fichier ne remarque rien : la fonction en service est déjà v111.
    await pool.query("delete from analytics_rollup_invalidation where app_id = any($1::text[])", [APPS]);
    await pool.query(lire("migration-v111.sql"));
    expect(await marques()).toBe(0);

    await pool.query(
      `insert into analytics_rollup_invalidation (source, app_id, hour, reason)
       select distinct 'rum_rollup_hourly', app_id, hour, 'v111_population' from rum_rollup_hourly where app_id = any($1::text[])`,
      [APPS],
    );
    await pool.query("select refresh_rum_rollups(6)");
    expect(await marques()).toBe(0);
    const { rows: apres } = await pool.query(
      "select coalesce(sum(pageviews), 0)::int as n from rum_rollup_hourly where app_id = $1", [APP],
    );
    expect(apres[0].n).toBe(3);
    await pool.query("delete from agregat_filigrane where source = 'rum_rollup_hourly'");
  });
});

suite("v111 — 3. la purge ne lit plus `pageview_id`", () => {
  it("la garde morte est retirée, la purge supprime les pages vues anciennes comme avant", async () => {
    const { rows } = await pool.query(
      "select prosrc from pg_proc where proname = 'purge_rum_app' and pronargs = 2",
    );
    expect(rows[0].prosrc).not.toContain("pageview_id");
    // Le reste de la définition est intact : v97 (sondes) et la rétention des logs.
    expect(rows[0].prosrc).toContain("from uptime_result");
    expect(rows[0].prosrc).toContain("delete from rum_log");

    await nettoyer();
    await pool.query(
      `insert into rum_pageview (app_id, session_id, route, started_at) values
         ($1, null, '/', now() - interval '40 days'), ($1, null, '/', now() - interval '1 day')`,
      [APP],
    );
    const bilan = (await pool.query("select purge_rum_app($1, now() - interval '30 days') as r", [APP])).rows[0].r;
    expect(bilan.rum_pageview).toBe(1);
    const { rows: restantes } = await pool.query("select count(*)::int as n from rum_pageview where app_id = $1", [APP]);
    expect(restantes[0].n).toBe(1);
  });

  it("aucun chemin d'écriture ne renseigne `pageview_id` : la colonne reste vide après un lot", async () => {
    const { rows } = await pool.query(
      "select (select count(*) from rum_metric where pageview_id is not null) + (select count(*) from rum_error where pageview_id is not null) as n",
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});

suite("v111 — 4. `alert_config` sous RLS", () => {
  it("RLS active ; un rôle avec le droit de lire mais sans policy n'y voit rien ; le propriétaire la lit", async () => {
    const { rows } = await pool.query("select relrowsecurity from pg_class where oid = 'public.alert_config'::regclass");
    expect(rows[0].relrowsecurity).toBe(true);

    const role = "v111_lecteur_sans_policy";
    const client = await pool.connect();
    try {
      await client.query(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if;
      end $$`);
      await client.query(`grant select on alert_config to ${role}`);
      await client.query("begin");
      await client.query(`set local role ${role}`);
      const vu = await client.query("select count(*)::int as n from alert_config");
      expect(vu.rows[0].n).toBe(0);
      await client.query("rollback");
      // Le propriétaire (scheduler, notifier, `route_alert`) n'est pas visé.
      const proprio = await client.query("select count(*)::int as n from alert_config where singleton");
      expect(proprio.rows[0].n).toBe(1);
    } finally {
      await client.query("rollback").catch(() => {});
      await client.query(`revoke all on alert_config from ${role}`);
      await client.query(`drop role if exists ${role}`);
      client.release();
    }
  });

  it("`console_ro`, s'il existe, garde sa lecture par une policy `using (true)`", async () => {
    const { rows } = await pool.query("select 1 from pg_roles where rolname = 'console_ro'");
    const { rows: policies } = await pool.query(
      "select polname from pg_policy where polrelid = 'public.alert_config'::regclass",
    );
    if (rows.length) expect(policies.map((p) => p.polname)).toContain("console_ro_lecture");
    else expect(policies).toEqual([]);
  });
});
