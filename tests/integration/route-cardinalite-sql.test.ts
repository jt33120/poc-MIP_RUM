// migration-v62 — la normalisation de route et le plafond de cardinalité, sur un
// vrai PostgreSQL.
//
// Rien de ce fichier ne peut être vérifié en lisant du SQL : ce sont des
// déclencheurs, des conditions de course et une réécriture d'historique. Ils
// s'exécutent ou ils ne prouvent rien.
//
//   SQL_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/route_test \
//     pnpm test:sql
//
// `--no-file-parallelism` (dans le script) n'est pas un confort : chaque fichier
// applique le schéma complet, et deux `create or replace function` simultanés sur
// la même base échouent avec « tuple concurrently updated ».
//
// Sans cette variable, la suite est SAUTÉE — et le dit.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_TEST = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

function fichiersSql(): string[] {
  const migrations = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return ["schema.sql", ...migrations].map((f) => join(SQL_DIR, f));
}

const c = new pg.Client(URL_TEST ? { connectionString: URL_TEST } : {});
const suite = URL_TEST ? describe : describe.skip;

if (!URL_TEST) {
  console.warn("[route-cardinalite-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");
}

/** Prépare une application isolée : chaque test a la sienne, sinon le plafond
 *  d'un test décide du résultat du suivant. */
async function app(id: string, limite: number) {
  await c.query("delete from rum_metric where app_id = $1", [id]);
  await c.query("delete from rum_pageview where app_id = $1", [id]);
  await c.query("delete from rum_session where app_id = $1", [id]);
  await c.query("delete from route_pattern where app_id = $1", [id]);
  await c.query("delete from route_registry where app_id = $1", [id]);
  await c.query("delete from route_cardinality where app_id = $1", [id]);
  await c.query(
    `insert into app_registry (app_id, name, active, route_limit) values ($1, $1, true, $2)
     on conflict (app_id) do update set route_limit = excluded.route_limit`,
    [id, limite],
  );
  await c.query(
    `insert into rum_session (session_id, app_id, device_type) values ($1, $2, 'desktop')
     on conflict do nothing`,
    [`s-${id}`, id],
  );
  return {
    async metrique(route: string | null, value = 1000) {
      await c.query(
        `insert into rum_metric (session_id, app_id, route, name, value, rating)
         values ($1, $2, $3, 'LCP', $4, 'good')`,
        [`s-${id}`, id, route, value],
      );
    },
    async routes(): Promise<Record<string, number>> {
      const { rows } = await c.query<{ route: string | null; n: string }>(
        "select route, count(*) as n from rum_metric where app_id = $1 group by 1",
        [id],
      );
      return Object.fromEntries(rows.map((r) => [String(r.route), Number(r.n)]));
    },
  };
}

beforeAll(async () => {
  if (!URL_TEST) return;
  await c.connect();
  for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
}, 180_000);
afterAll(async () => {
  if (URL_TEST) await c.end();
});

suite("la normalisation par motifs s'applique à l'écriture", () => {
  it("remplace la route au moment de l'INSERT, sans que l'applicatif y participe", async () => {
    // C'est le point de tout le dispositif : deux chemins d'ingestion écrivent
    // ces tables, et un troisième ajouté demain passerait à côté d'une
    // normalisation posée dans l'applicatif.
    const a = await app("rt-base", 5000);
    await c.query(
      `insert into route_pattern (app_id, motif, remplacement, priorite)
       values ('rt-base', '^/produit/[^/]+$', '/produit/:slug', 10)`,
    );
    await a.metrique("/produit/chaise-bleue");
    await a.metrique("/produit/table-ronde");
    await a.metrique("/panier");
    expect(await a.routes()).toEqual({ "/produit/:slug": 2, "/panier": 1 });
  });

  it("garde les groupes de capture — `\\1` fonctionne", async () => {
    // Un langage de motifs maison aurait fallu documenter ; POSIX est déjà connu.
    const a = await app("rt-capture", 5000);
    await c.query(
      `insert into route_pattern (app_id, motif, remplacement, priorite)
       values ('rt-capture', '^/(\\w+)/[0-9a-f]{8,}$', '/\\1/:hash', 10)`,
    );
    await a.metrique("/facture/deadbeef1234");
    expect(Object.keys(await a.routes())).toEqual(["/facture/:hash"]);
  });

  it("la PRIORITÉ décide quand deux motifs correspondent tous les deux", async () => {
    // Le cas qui distingue réellement l'ordre : `/a/42` correspond aux deux
    // règles. Sans tri par priorité, le gagnant dépendrait de l'ordre
    // d'insertion — donc changerait au prochain rattrapage d'historique.
    const a = await app("rt-ordre", 5000);
    await c.query(
      `insert into route_pattern (app_id, motif, remplacement, priorite) values
         ('rt-ordre', '^/a/[0-9]+$', '/a/:id',   10),
         ('rt-ordre', '^/a/.*$',     '/a/:tout', 20)`,
    );
    await a.metrique("/a/42");
    expect(Object.keys(await a.routes())).toEqual(["/a/:id"]);
  });

  it("ne fait pas repasser le résultat dans les motifs suivants", async () => {
    // Enchaîner rendrait le résultat dépendant du nombre de règles, et une règle
    // ajoutée plus tard réécrirait des routes déjà normalisées.
    const a = await app("rt-chaine", 5000);
    await c.query(
      `insert into route_pattern (app_id, motif, remplacement, priorite) values
         ('rt-chaine', '^/b/[0-9]+$', '/b/:id',    10),
         ('rt-chaine', '^/b/:id$',    '/JAMAIS',   20)`,
    );
    await a.metrique("/b/7");
    expect(Object.keys(await a.routes())).toEqual(["/b/:id"]);
  });

  it("ne franchit pas la frontière entre applications", async () => {
    const a = await app("rt-app-a", 5000);
    const b = await app("rt-app-b", 5000);
    await c.query(
      `insert into route_pattern (app_id, motif, remplacement, priorite)
       values ('rt-app-a', '^/x/.*$', '/x/:id', 10)`,
    );
    await a.metrique("/x/1");
    await b.metrique("/x/1");
    expect(Object.keys(await a.routes())).toEqual(["/x/:id"]);
    expect(Object.keys(await b.routes())).toEqual(["/x/1"]);
  });

  it("laisse `alert_rule.route` intact — c'est un filtre, pas de la télémétrie", async () => {
    // Réécrire la route d'une RÈGLE changerait ce que le client surveille. Le
    // déclencheur n'est posé que sur les tables de données.
    await c.query("delete from route_pattern where app_id = 'rt-regle'");
    await c.query(
      `insert into app_registry (app_id, name, active) values ('rt-regle', 'rt-regle', true)
       on conflict do nothing`,
    );
    await c.query(
      `insert into route_pattern (app_id, motif, remplacement, priorite)
       values ('rt-regle', '^/checkout/.*$', '/checkout/:etape', 10)`,
    );
    await c.query("delete from alert_rule where app_id = 'rt-regle'");
    await c.query(
      `insert into alert_rule (app_id, metric, threshold, route)
       values ('rt-regle', 'LCP', 2500, '/checkout/paiement')`,
    );
    const { rows } = await c.query("select route from alert_rule where app_id = 'rt-regle'");
    expect(rows[0].route).toBe("/checkout/paiement");
  });
});

suite("le plafond de cardinalité arrête la dimension, et le dit", () => {
  it("regroupe les routes inédites sous (other) au-delà du plafond", async () => {
    const a = await app("rt-plafond", 3);
    for (const r of ["/a", "/b", "/c", "/d", "/e"]) await a.metrique(r);
    const routes = await a.routes();
    expect(routes["/a"]).toBe(1);
    expect(routes["/c"]).toBe(1);
    expect(routes["(other)"]).toBe(2);
    expect(Object.keys(routes)).toHaveLength(4);
  });

  it("laisse passer les routes DÉJÀ connues une fois le plafond atteint", async () => {
    // Le plafond arrête la CROISSANCE de la dimension, il ne casse pas les séries
    // en cours. Sans cette propriété, atteindre le plafond ferait disparaître
    // toutes les routes existantes d'un coup.
    const a = await app("rt-connu", 2);
    await a.metrique("/x");
    await a.metrique("/y");
    await a.metrique("/z"); // inédite : (other)
    await a.metrique("/x"); // connue : passe
    const routes = await a.routes();
    expect(routes["/x"]).toBe(2);
    expect(routes["(other)"]).toBe(1);
  });

  it("compte les routes APRÈS normalisation, pas avant", async () => {
    // Sinon un motif qui ramène mille URL à une seule route consommerait quand
    // même mille places, et le plafond punirait le client qui range.
    const a = await app("rt-compte", 2);
    await c.query(
      `insert into route_pattern (app_id, motif, remplacement, priorite)
       values ('rt-compte', '^/p/[^/]+$', '/p/:slug', 10)`,
    );
    for (let i = 0; i < 20; i++) await a.metrique(`/p/article-${i}`);
    const { rows } = await c.query<{ n: number }>(
      "select n from route_cardinality where app_id = 'rt-compte'",
    );
    expect(Number(rows[0].n)).toBe(1);
    expect(Object.keys(await a.routes())).toEqual(["/p/:slug"]);
  });

  it("remonte dans la santé interne, plutôt que de perdre le détail en silence", async () => {
    await app("rt-sante", 1);
    await c.query(
      `insert into rum_metric (session_id, app_id, route, name, value, rating)
       values ('s-rt-sante', 'rt-sante', '/seule', 'LCP', 1000, 'good')`,
    );
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from route_cardinality rc
         join app_registry ar on ar.app_id = rc.app_id
        where rc.n >= coalesce(ar.route_limit, 2000) and rc.app_id = 'rt-sante'`,
    );
    expect(Number(rows[0].n)).toBe(1);
  });
});

suite("le rattrapage d'historique garde les séries continues", () => {
  it("réécrit le passé avec les mêmes motifs, dans toutes les tables", async () => {
    // LA raison pour laquelle ce chantier avait été différé : sans rattrapage, la
    // série d'une route se coupe en deux à l'instant où le motif est créé, et les
    // deux moitiés ont l'air de deux routes différentes.
    const a = await app("rt-histo", 5000);
    await a.metrique("/cmd/ABC123");
    await a.metrique("/cmd/XYZ999");
    await c.query(
      `insert into rum_pageview (session_id, app_id, route) values ('s-rt-histo', 'rt-histo', '/cmd/ABC123')`,
    );
    await c.query(
      `insert into route_pattern (app_id, motif, remplacement, priorite)
       values ('rt-histo', '^/cmd/[A-Z0-9]+$', '/cmd/:ref', 10)`,
    );

    // L'aperçu D'ABORD : la réécriture est définitive, la route d'origine n'est
    // conservée nulle part.
    const apercu = await c.query<{ route_avant: string; route_apres: string; lignes: string }>(
      "select * from mip_apercu_backfill('rt-histo')",
    );
    expect(apercu.rows.map((r) => r.route_apres)).toEqual(["/cmd/:ref", "/cmd/:ref"]);
    // Rien n'a bougé : un aperçu qui écrit n'est pas un aperçu.
    expect(Object.keys(await a.routes()).sort()).toEqual(["/cmd/ABC123", "/cmd/XYZ999"]);

    const { rows } = await c.query<{ backfill_route_patterns: Record<string, number> }>(
      "select backfill_route_patterns('rt-histo')",
    );
    const bilan = rows[0].backfill_route_patterns;
    expect(bilan.rum_metric).toBe(2);
    expect(bilan.rum_pageview).toBe(1);
    expect(bilan.routes_distinctes).toBe(1);
    expect(Object.keys(await a.routes())).toEqual(["/cmd/:ref"]);
  });

  it("ne touche PAS les autres applications", async () => {
    const b = await app("rt-histo-voisin", 5000);
    await b.metrique("/cmd/ABC123");
    await c.query("select backfill_route_patterns('rt-histo')");
    expect(Object.keys(await b.routes())).toEqual(["/cmd/ABC123"]);
  });

  it("remet le registre à plat, sinon le plafond se déclencherait à tort", async () => {
    // Les routes d'AVANT normalisation n'existent plus. Les laisser dans le
    // registre gonflerait le compteur de routes fantômes, et une application
    // rangée se retrouverait au plafond pour des routes qu'elle n'a plus.
    const a = await app("rt-registre", 5000);
    for (let i = 0; i < 30; i++) await a.metrique(`/f/${i}`);
    expect(Number((await c.query("select n from route_cardinality where app_id='rt-registre'")).rows[0].n)).toBe(30);
    await c.query(
      `insert into route_pattern (app_id, motif, remplacement, priorite)
       values ('rt-registre', '^/f/[0-9]+$', '/f/:n', 10)`,
    );
    await c.query("select backfill_route_patterns('rt-registre')");
    expect(Number((await c.query("select n from route_cardinality where app_id='rt-registre'")).rows[0].n)).toBe(1);
  });

  it("est IDEMPOTENT : un second passage ne change plus rien", async () => {
    const { rows } = await c.query<{ backfill_route_patterns: Record<string, number> }>(
      "select backfill_route_patterns('rt-registre')",
    );
    expect(rows[0].backfill_route_patterns.rum_metric).toBe(0);
  });
});

suite("l'effacement d'un client emporte aussi sa configuration de routes", () => {
  it("supprime motifs, registre et compteur", async () => {
    // Une table applicative oubliée dans erase_app_data() produit des données qui
    // survivent à un effacement RGPD.
    const a = await app("rt-erase", 5000);
    await c.query(
      `insert into route_pattern (app_id, motif, remplacement) values ('rt-erase', '^/z/.*$', '/z/:id')`,
    );
    await a.metrique("/z/1");
    await c.query("select erase_app_data('rt-erase')");
    for (const t of ["route_pattern", "route_registry", "route_cardinality"]) {
      const { rows } = await c.query<{ n: string }>(
        `select count(*) as n from ${t} where app_id = 'rt-erase'`,
      );
      expect({ [t]: Number(rows[0].n) }).toEqual({ [t]: 0 });
    }
  });
});
