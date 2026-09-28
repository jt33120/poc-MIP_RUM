// Registre des routes saturé par un scanner (28/09/2026) — sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le parseur : que le registre de
// migration-v62 (déclencheur BEFORE INSERT, plafond `route_limit`) ne gagne
// qu'UNE entrée pour une rafale de 404 de l'ancien middleware FastAPI, qu'une
// route réelle apparue ensuite est enregistrée sous son nom et non sous
// `(other)`, et que la requête de nettoyage remise à l'exploitant ne retire du
// registre que les routes de scanner — rien d'une route servie, rien d'une
// autre application.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp, ROUTE_NON_TROUVEE } from "../../packages/backend/shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const suite = url ? describe : describe.skip;
if (!url) console.warn("[route-non-trouvee-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");

const APP = "scan-404";
const VOISINE = "scan-404-voisine";
const APPS = [APP, VOISINE];
const TABLES = ["rum_event_index", "rum_error", "rum_span", "rum_metric", "rum_pageview", "rum_session",
  "route_registry", "route_cardinality", "tenant_usage_daily"];

const SCANNER = [
  "/wp-admin/admin-ajax.php", "/manager/html", "/jmx-console/", "/.env", "/cgi-bin/luci",
  "/phpmyadmin/index.php", "/actuator/env", "/solr/admin/info/system", "/owa/auth/logon.aspx", "/boaform/admin/formLogin",
];

function migrations(): string[] {
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))]
    .map((f) => join(SQL_DIR, f));
}

const kv = (key: string, value: string | number) => ({
  key,
  value: typeof value === "number" ? { intValue: String(value) } : { stringValue: value },
});

let sequence = 0;
/** Span `http.server` tel que l'ANCIEN middleware FastAPI l'émet (chemin brut en route). */
function requete(app: string, route: string, statut: number) {
  const n = ++sequence;
  const spanId = (0x4040000000000000n + BigInt(n)).toString(16);
  const traceId = `40${n.toString(16).padStart(30, "0")}`;
  const debut = Date.now() - 60_000 + n;
  return {
    resourceSpans: [{
      resource: { attributes: [kv("mip.app_id", app), kv("service.name", "api")] },
      scopeSpans: [{
        scope: { name: "mip-rum-fastapi" },
        spans: [{
          traceId, spanId, name: "http.server", kind: 2,
          startTimeUnixNano: `${debut}000000`, endTimeUnixNano: `${debut + 3}000000`,
          attributes: [
            kv("mip.trace_id", traceId), kv("mip.span_id", spanId), kv("mip.route", route),
            kv("http.url", route), kv("http.method", "GET"), kv("http.status_code", statut), kv("http.duration_ms", 3),
          ],
        }],
      }],
    }],
  };
}

async function ecrire(app: string, route: string, statut: number) {
  await writeRows(pool, flattenOtlp(requete(app, route, statut)));
}

async function registre(app: string): Promise<string[]> {
  // Tri en JavaScript : l'ordre de `order by` dépend de la collation du serveur.
  return (await pool.query("select route from route_registry where app_id = $1", [app])).rows.map((r) => r.route).sort();
}

async function preparer(app: string, limite: number) {
  for (const t of TABLES) await pool.query(`delete from ${t} where app_id = $1`, [app]);
  await pool.query(
    `insert into app_registry (app_id, name, active, route_limit) values ($1, $1, true, $2)
     on conflict (app_id) do update set route_limit = excluded.route_limit, active = true`,
    [app, limite],
  );
}

/**
 * LA requête remise à l'exploitant (description de la PR), paramétrée par
 * l'application. Une route du registre est « de scanner » quand elle n'a été
 * vue QUE sur des spans serveur en 404/405 et nulle part ailleurs — aucune
 * autre réponse, aucune page, aucune mesure, aucune erreur.
 */
const ROUTES_DE_SCANNER = `
  select r.route
    from route_registry r
   where r.app_id = $1
     and exists (select 1 from rum_span s
                  where s.app_id = r.app_id and s.route = r.route
                    and s.tier = 'back' and s.status_code in (404, 405))
     and not exists (select 1 from rum_span s
                      where s.app_id = r.app_id and s.route = r.route
                        and (s.tier <> 'back' or s.status_code is null or s.status_code not in (404, 405)))
     and not exists (select 1 from rum_pageview x where x.app_id = r.app_id and x.route = r.route)
     and not exists (select 1 from rum_metric   x where x.app_id = r.app_id and x.route = r.route)
     and not exists (select 1 from rum_error    x where x.app_id = r.app_id and x.route = r.route)
     and not exists (select 1 from rum_log      x where x.app_id = r.app_id and x.route = r.route)
     and not exists (select 1 from rum_event    x where x.app_id = r.app_id and x.route = r.route)`;

async function nettoyerRegistre(app: string) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const { rowCount } = await c.query(
      `delete from route_registry where app_id = $1 and route in (${ROUTES_DE_SCANNER})`, [app]);
    await c.query(
      `insert into route_cardinality (app_id, n)
       select $1, count(*)::int from route_registry where app_id = $1
       on conflict (app_id) do update set n = excluded.n`, [app]);
    await c.query("commit");
    return rowCount;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

suite("registre des routes et rafale de 404 — PostgreSQL", () => {
  beforeAll(async () => {
    for (const f of migrations()) await pool.query(readFileSync(f, "utf8"));
    _resetColonnesCache();
  }, 300_000);

  afterAll(async () => {
    for (const app of APPS) {
      for (const t of TABLES) await pool.query(`delete from ${t} where app_id = $1`, [app]);
    }
    await pool.query("delete from app_registry where app_id = any($1::text[])", [APPS]);
    await pool.end();
  });

  it("une rafale de scanner n'ajoute qu'UNE entrée, et la route réelle suivante garde son nom", async () => {
    await preparer(APP, 5);
    await ecrire(APP, "/commandes/{commande_id}", 200);
    for (const chemin of SCANNER) await ecrire(APP, chemin, 404);
    await ecrire(APP, "/xmlrpc.php", 405);
    // Plafond à 5 : sans la correction, la rafale l'aurait atteint dès le
    // quatrième chemin, et la route réelle ci-dessous serait devenue (other).
    await ecrire(APP, "/factures/{facture_id}", 200);

    expect(await registre(APP)).toEqual([ROUTE_NON_TROUVEE, "/commandes/{commande_id}", "/factures/{facture_id}"].sort());
    const { rows } = await pool.query(
      "select route, count(*)::int n from rum_span where app_id = $1 group by 1", [APP]);
    expect(rows.sort((a, b) => a.route.localeCompare(b.route))).toEqual([
      { route: ROUTE_NON_TROUVEE, n: SCANNER.length + 1 },
      { route: "/commandes/{commande_id}", n: 1 },
      { route: "/factures/{facture_id}", n: 1 },
    ].sort((a, b) => a.route.localeCompare(b.route)));
    // Le chemin reste lisible dans l'URL du span.
    expect((await pool.query(
      "select count(*)::int n from rum_span where app_id = $1 and url = '/manager/html'", [APP])).rows[0].n).toBe(1);
  });

  it("la requête de nettoyage ne retire que les routes de scanner déjà au registre", async () => {
    await preparer(APP, 2000);
    await preparer(VOISINE, 2000);
    // L'état de la production : des lignes écrites AVANT la correction, chemin brut en route.
    // Le déclencheur est BEFORE INSERT : on les écrit directement, comme alors.
    const avant = async (app: string, route: string, statut: number, n: number) => pool.query(
      `insert into rum_span (span_id, trace_id, tier, app_id, route, url, method, status_code, duration_ms, name, kind, ts)
       values ($1, $2, 'back', $3, $4, $4, 'GET', $5, 3, 'GET ' || $4, 'server', now() - interval '1 day')`,
      [(0x4141000000000000n + BigInt(n)).toString(16), `41${n.toString(16).padStart(30, "0")}`, app, route, statut]);
    let n = 0;
    for (const chemin of SCANNER) await avant(APP, chemin, 404, ++n);
    // Une route réelle qui a AUSSI connu des 404 (ressource absente) reste.
    await avant(APP, "/commandes/:id", 404, ++n);
    await avant(APP, "/commandes/:id", 200, ++n);
    // Même chemin chez une autre application : hors de portée.
    await avant(VOISINE, "/manager/html", 404, ++n);
    // Un 404 écrit après la saturation : `(other)`, que le registre ne retient
    // jamais (mip_router_ou_autre le rend sans l'inscrire). Écrit ici en direct, le
    // déclencheur l'inscrit : on le retire pour retrouver l'état réel.
    await avant(APP, "(other)", 404, ++n);
    await pool.query("delete from route_registry where app_id = $1 and route = '(other)'", [APP]);

    expect((await pool.query(ROUTES_DE_SCANNER, [APP])).rows.map((r) => r.route).sort()).toEqual([...SCANNER].sort());
    expect(await nettoyerRegistre(APP)).toBe(SCANNER.length);
    expect(await registre(APP)).toEqual(["/commandes/:id"]);
    expect(await registre(VOISINE)).toEqual(["/manager/html"]);
    expect((await pool.query("select n from route_cardinality where app_id = $1", [APP])).rows[0].n).toBe(1);
    // Rejouable : un second passage ne trouve plus rien.
    expect(await nettoyerRegistre(APP)).toBe(0);

    // Étape 3, facultative : l'historique. Les 404/405 dont la route n'est plus au
    // registre (scanner, `(other)`) prennent la route fixe ; rien d'autre ne bouge.
    const { rowCount } = await pool.query(
      `update rum_span set route = '(non trouvée)'
        where app_id = $1 and tier = 'back' and status_code in (404, 405)
          and route not in (select route from route_registry where app_id = $1)`, [APP]);
    expect(rowCount).toBe(SCANNER.length + 1);
    const { rows } = await pool.query(
      "select route, status_code, count(*)::int n from rum_span where app_id = $1 group by 1, 2", [APP]);
    expect(rows.sort((a, b) => `${a.route}${a.status_code}`.localeCompare(`${b.route}${b.status_code}`))).toEqual([
      { route: ROUTE_NON_TROUVEE, status_code: 404, n: SCANNER.length + 1 },
      { route: "/commandes/:id", status_code: 200, n: 1 },
      { route: "/commandes/:id", status_code: 404, n: 1 },
    ].sort((a, b) => `${a.route}${a.status_code}`.localeCompare(`${b.route}${b.status_code}`)));
    expect(await registre(VOISINE)).toEqual(["/manager/html"]);
  });
});
