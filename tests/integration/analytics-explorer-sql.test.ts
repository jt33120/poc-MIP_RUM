// P6.4 — l'Explorer générique, exécuté sur PostgreSQL.
//
// Les tests unitaires verrouillent la FORME du SQL ; seul PostgreSQL dit qu'il
// compte les bonnes lignes. La recette de la spec est rejouée ici :
//
//   · deux dimensions dont les valeurs CONTIENNENT des séparateurs (`;`, `:`,
//     `·`) — une clé de groupe est un tuple, jamais une concaténation ;
//   · un top STABLE d'un seau à l'autre, et un total calculé indépendamment de
//     ce top ;
//   · un cast JSON qui n'a lieu qu'après contrôle de type — la chaîne « 42 »
//     n'est pas le nombre 42 —, et un champ legacy non objet qui ne fait pas
//     échouer la requête ;
//   · un curseur falsifié ou périmé par un changement de plage ;
//   · un zéro RÉEL (population vide) distingué d'un percentile null (aucun
//     échantillon) ;
//   · un budget de lecture dépassé, qui rend une erreur et jamais des zéros ;
//   · l'isolation A/B et l'exclusion des robots, au même endroit que le reste.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  encodeExplorerCursor,
  explorerFingerprint,
  parseExplorerQuery,
  type ExplorerRequest,
} from "../../apps/console/lib/analytics-schema";
import type { ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

const A = "p64-app-a";
const B = "p64-app-b";
const APPS = [A, B];
const ADMIN: ScopePrincipal = { role: "admin", apps: null };

// Fenêtre de recette : trois heures pleines, terminées, donc trois seaux d'une heure.
const TO = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);
const FROM = new Date(TO.getTime() - 3 * 3_600_000);
/** Un instant au cœur de chaque seau. */
const SEAU = [0, 1, 2].map((i) => new Date(FROM.getTime() + i * 3_600_000 + 60_000));
const AVANT = new Date(FROM.getTime() - 1);

// Des valeurs qui contiennent les séparateurs qu'une concaténation naïve
// utiliserait. Si une clé de groupe était une chaîne jointe, elles la casseraient.
const R1 = "v1;0";
const R2 = "v2:0";
const R3 = "v3·0";
const ROUTE_A = "/a:b";
const ROUTE_B = "/c;d";

const hex = (prefixe: string, i: number, taille: number) => (prefixe + i.toString(16).padStart(2, "0")).padEnd(taille, "0");

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
  for (const table of ["rum_error", "rum_event_index", "rum_event", "rum_metric", "rum_pageview", "rum_session", "app_registry"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

/** Erreurs : (release, route, occurrences, seau). La somme ≠ le nombre de lignes. */
const ERREURS: [string, string, number, number][] = [
  [R1, ROUTE_A, 2, 0],
  [R1, ROUTE_A, 2, 1],
  [R1, ROUTE_A, 2, 2],
  [R2, ROUTE_B, 1, 0],
  [R2, ROUTE_B, 1, 1],
  [R2, ROUTE_B, 1, 2],
  [R3, ROUTE_A, 1, 1],
];

async function semer(c: pg.Client): Promise<void> {
  await c.query(
    `insert into app_registry (app_id, name, active, internal)
     values ($1, 'A', true, false), ($2, 'B', true, false)
     on conflict (app_id) do update set active = true, internal = excluded.internal`,
    [A, B],
  );
  const sessions: [string, string, boolean, string | null][] = [
    ["p64-a-1", A, false, "p64-visiteur-1"],
    ["p64-a-2", A, false, "p64-visiteur-2"],
    // Robot : exclu par défaut, présent pour le prouver.
    ["p64-a-robot", A, true, "p64-visiteur-3"],
    // Session sans identifiant aléatoire : elle ne compte pas comme visiteur.
    ["p64-a-sans-id", A, false, null],
    ["p64-b-1", B, false, "p64-visiteur-b"],
  ];
  for (const [id, app, bot, visiteur] of sessions) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, geo_country, visitor_id, collection_source, started_at, last_seen_at, sample_rate, error_sample_rate)
       values ($1, $2, 'desktop', $3, 'FR', $4, 'sdk', $5, $6, 1, 1)
       on conflict (session_id) do update set last_seen_at = excluded.last_seen_at`,
      [id, app, bot, visiteur, SEAU[0], SEAU[2]],
    );
  }

  for (const [i, [release, route, occurrences, seau]] of ERREURS.entries()) {
    await c.query(
      `insert into rum_error (app_id, session_id, fingerprint, error_type, message, kind, route, release, occurrences, ts)
       values ($1, $2, 'p64fp', 'TypeError', 'boom', 'error', $3, $4, $5, $6)`,
      [A, i % 2 === 0 ? "p64-a-1" : "p64-a-2", route, release, occurrences, SEAU[seau]],
    );
  }
  // Bruit qui ne doit JAMAIS entrer : une autre app, un robot, un instant hors fenêtre.
  await c.query(
    `insert into rum_error (app_id, session_id, fingerprint, error_type, message, kind, route, release, occurrences, ts)
     values ($1, 'p64-b-1', 'p64fp', 'TypeError', 'boom', 'error', $2, $3, 99, $4),
            ($5, 'p64-a-robot', 'p64fp', 'TypeError', 'boom', 'error', $2, $3, 99, $4),
            ($5, 'p64-a-1', 'p64fp', 'TypeError', 'boom', 'error', $2, $3, 99, $6)`,
    [B, ROUTE_A, R1, SEAU[0], A, AVANT],
  );

  // Web Vitals : quatre valeurs pour un p75 interpolé exact, et aucune INP —
  // un percentile sans échantillon doit valoir null, pas zéro.
  for (const [i, valeur] of [100, 200, 300, 400].entries()) {
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       values ($1, 'p64-a-1', $2, $3, 'LCP', $4, 'good', $5)`,
      [hex("cc", i, 16), A, ROUTE_A, valeur, SEAU[i % 3]],
    );
  }

  // Pages vues : de quoi éprouver un résultat RÉELLEMENT vide sur une autre route.
  for (const i of [0, 1, 2]) {
    await c.query(`insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, 'p64-a-1', $2, $3, $4)`, [
      hex("bb", i, 16),
      A,
      ROUTE_A,
      SEAU[i],
    ]);
  }

  // Événements custom et leurs propriétés : un nombre, une CHAÎNE « 42 », une
  // propriété absente — et une ligne legacy dont `props` n'est pas un objet.
  const proprietes = ['{"amount": 10}', '{"amount": "42"}', '{"amount": 5}', "{}"];
  for (const [i, props] of proprietes.entries()) {
    await c.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, event_type, props, context, ts)
       values ($1, 'p64-a-1', $2, $3, 'checkout', 'custom', $4::jsonb, '{}'::jsonb, $5)`,
      [hex("ee", i, 16), A, ROUTE_A, props, SEAU[i % 3]],
    );
  }
  // La contrainte `rum_event_payload_v68` est NOT VALID : elle laisse passer les
  // lignes ÉCRITES AVANT elle, mais refuse les nouvelles. Pour recréer une telle
  // ligne, on la retire le temps de l'insertion puis on la remet à l'identique.
  const [{ definition }] = (
    await c.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'rum_event_payload_v68'`,
    )
  ).rows;
  await c.query("alter table rum_event drop constraint rum_event_payload_v68");
  await c.query(
    `insert into rum_event (span_id, session_id, app_id, route, name, event_type, props, context, ts)
     values ($1, 'p64-a-1', $2, $3, 'checkout', 'custom', '"texte-legacy"'::jsonb, '{}'::jsonb, $4)`,
    [hex("ee", 9, 16), A, ROUTE_A, SEAU[0]],
  );
  await c.query(`alter table rum_event add constraint rum_event_payload_v68 ${definition}`);
}

/** Modules console branchés sur la base jetable (cf. query-contract-sql). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const explorer = await import("../../apps/console/lib/queries-explorer");
  const schema = await import("../../apps/console/lib/query-schema");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...explorer, ...schema, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

(url ? describe : describe.skip)("Explorer générique P6.4 sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;

  /** Requête validée : la fenêtre de recette, sauf mention contraire. */
  function requete(ast: Record<string, unknown>, principal: ScopePrincipal = ADMIN): ExplorerRequest {
    const parsed = parseExplorerQuery(
      { version: 1, app: A, range: { from: FROM.toISOString(), to: TO.toISOString() }, ...ast },
      { principal, nowMs: Date.now() },
    );
    if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
    return parsed.value;
  }

  const erreurs = (ast: Record<string, unknown> = {}, principal: ScopePrincipal = ADMIN) =>
    requete({ dataset: "errors", measure: { aggregation: "sum", field: "occurrences" }, ...ast }, principal);

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

  it("le total porte sur toute la population, indépendamment du top-N des groupes", async () => {
    const total = await lib.exploreAnalytics(erreurs());
    // 3×2 + 3×1 + 1 = 10 occurrences : ni l'app B, ni le robot, ni la ligne
    // antérieure à la fenêtre — dont les 99 occurrences se verraient.
    expect(total.data.total).toBe(10);
    expect(total.data.samples).toBe(7);

    const classement = await lib.exploreAnalytics(erreurs({ visualization: "toplist", groupBy: ["release"], limit: 2 }));
    expect(classement.data.total).toBe(10);
    expect(classement.data.groups).toEqual([
      { key: [R1], value: 6, samples: 3 },
      { key: [R2], value: 3, samples: 3 },
    ]);
    // La somme des groupes affichés ne fait PAS le total : le troisième existe.
    expect(classement.meta.truncated_groups).toBe(true);
  });

  it("deux dimensions dont les valeurs portent des séparateurs restent un TUPLE", async () => {
    const result = await lib.exploreAnalytics(
      erreurs({ visualization: "toplist", groupBy: ["release", "route"], limit: 10 }),
    );
    expect(result.data.groups).toEqual([
      { key: [R1, ROUTE_A], value: 6, samples: 3 },
      { key: [R2, ROUTE_B], value: 3, samples: 3 },
      { key: [R3, ROUTE_A], value: 1, samples: 1 },
    ]);
    expect(result.meta.truncated_groups).toBe(false);
  });

  it("le top d'une série est choisi une fois et tenu dans TOUS les seaux", async () => {
    const result = await lib.exploreAnalytics(
      erreurs({ visualization: "timeseries", groupBy: ["release"], limit: 2 }),
    );
    expect(result.meta.range.bucket_seconds).toBe(3600);
    // 3 seaux × 2 groupes, et les mêmes deux groupes partout — R3 n'apparaît dans
    // AUCUN seau, bien qu'il soit seul de son seau à exister au seau du milieu.
    const parSeau = new Map<string, string[]>();
    for (const point of result.data.series) {
      parSeau.set(point.start, [...(parSeau.get(point.start) ?? []), String(point.key[0])]);
    }
    expect(parSeau.size).toBe(3);
    for (const [, cles] of parSeau) expect(cles.sort()).toEqual([R1, R2]);
    // Chaque seau porte la valeur de SON seau, pas une valeur recopiée.
    expect(result.data.series.filter((p) => p.key[0] === R1).map((p) => p.value)).toEqual([2, 2, 2]);
    expect(result.data.series.filter((p) => p.key[0] === R2).map((p) => p.value)).toEqual([1, 1, 1]);
    // Et le total reste celui de la population entière.
    expect(result.data.total).toBe(10);
  });

  it("un seau sans ligne vaut zéro pour une somme, et null pour un percentile", async () => {
    // La release R3 n'existe qu'au seau du milieu : sa série comble les deux autres.
    const somme = await lib.exploreAnalytics(
      erreurs({ visualization: "timeseries", groupBy: ["release"], limit: 3, filters: [{ field: "release", operator: "eq", value: R3 }] }),
    );
    expect(somme.data.series.map((p) => p.value)).toEqual([0, 1, 0]);

    const percentile = await lib.exploreAnalytics(
      requete({
        dataset: "vitals",
        variant: "LCP",
        measure: { aggregation: "p75", field: "value" },
        visualization: "timeseries",
        limit: 1,
      }),
    );
    // Quatre mesures réparties sur trois seaux : le seau à deux mesures a un p75,
    // les autres aussi ; aucun n'est comblé à zéro par construction.
    expect(percentile.data.series.every((p) => p.value !== 0)).toBe(true);
    expect(percentile.data.total).toBe(325);
  });

  it("un percentile sans échantillon vaut null — un zéro dirait « mesuré et nul »", async () => {
    const result = await lib.exploreAnalytics(
      requete({ dataset: "vitals", variant: "INP", measure: { aggregation: "p95", field: "value" } }),
    );
    expect(result.data.total).toBeNull();
    expect(result.data.samples).toBe(0);
  });

  it("un résultat RÉELLEMENT vide vaut zéro, et le dit", async () => {
    const result = await lib.exploreAnalytics(
      requete({
        dataset: "views",
        measure: { aggregation: "count", field: "rows" },
        filters: [{ field: "route", operator: "eq", type: "string", value: "/route-qui-n-existe-pas" }],
      }),
    );
    expect(result.data.total).toBe(0);
    expect(result.data.samples).toBe(0);
    expect(result.meta.coverage.status).toBe("complete");
  });

  it("un attribut JSON n'est casté qu'après contrôle de type, et le legacy ne casse rien", async () => {
    const result = await lib.exploreAnalytics(
      requete({
        dataset: "custom_events",
        variant: "custom",
        measure: { aggregation: "sum", field: "prop", property: "amount" },
      }),
    );
    // 10 + 5 : la CHAÎNE « 42 » n'est pas le nombre 42, la propriété absente ne
    // vaut pas zéro, et la ligne dont `props` n'est pas un objet ne fait pas
    // échouer la requête — elle ne mesure simplement rien.
    expect(result.data.total).toBe(15);
    // Cinq événements dans la population, deux seulement mesurés.
    expect(result.data.samples).toBe(5);
  });

  it("les occurrences sont sommées, les sessions et visiteurs comptés séparément", async () => {
    const occurrences = await lib.exploreAnalytics(erreurs());
    const sessions = await lib.exploreAnalytics(erreurs({ measure: { aggregation: "distinct", field: "sessions" } }));
    const visiteurs = await lib.exploreAnalytics(erreurs({ measure: { aggregation: "distinct", field: "visitors" } }));
    expect(occurrences.data.total).toBe(10);
    expect(sessions.data.total).toBe(2);
    expect(visiteurs.data.total).toBe(2);
    // Trois populations, trois nombres : rien ne les additionne.
    expect(occurrences.meta.unit).toBe("occurrences");
    expect(sessions.meta.unit).toBe("sessions");
    expect(visiteurs.meta.unit).toBe("visiteurs");
  });

  it("un distinct n'est PAS la somme de ses distincts horaires", async () => {
    const fenetre = await lib.exploreAnalytics(erreurs({ measure: { aggregation: "distinct", field: "sessions" } }));
    const parSeau = await lib.exploreAnalytics(
      erreurs({ measure: { aggregation: "distinct", field: "sessions" }, visualization: "timeseries", limit: 1 }),
    );
    const somme = parSeau.data.series.reduce((total, point) => total + (point.value ?? 0), 0);
    expect(fenetre.data.total).toBe(2);
    expect(somme).toBeGreaterThan(fenetre.data.total!);
    // C'est pourquoi la mesure est annoncée non additive : rien ne doit la sommer.
    expect(fenetre.meta.additive).toBe(false);
  });

  it("le périmètre et les robots s'appliquent, et « toutes les apps » reste borné au principal", async () => {
    expect((await lib.exploreAnalytics(erreurs({ app: B }))).data.total).toBe(99);
    expect((await lib.exploreAnalytics(erreurs({ includeBots: true }))).data.total).toBe(10 + 99);
    const viewer = await lib.exploreAnalytics(erreurs({ app: null }, { role: "viewer", apps: [A] }));
    expect(viewer.data.total).toBe(10);
    expect(viewer.meta.effective_apps).toEqual([A]);
  });

  it("le journal pagine sans trou ni doublon, et n'alimente aucun graphe", async () => {
    const page1 = await lib.exploreAnalytics(erreurs({ visualization: "table", limit: 4 }));
    expect(page1.data.rows).toHaveLength(4);
    expect(page1.data.next_cursor).toBeTruthy();
    // Le total du journal est celui de TOUTE la population, pas de la page.
    expect(page1.data.total).toBe(10);
    expect(page1.data.groups).toEqual([]);
    expect(page1.data.series).toEqual([]);
    // La projection est fermée : les identifiants publics, et rien d'autre.
    expect(Object.keys(page1.data.rows[0]).sort()).toEqual(
      ["date", "fingerprint", "occurrences", "origin", "route", "session", "type"].sort(),
    );

    const page2 = await lib.exploreAnalytics(erreurs({ visualization: "table", limit: 4, cursor: page1.data.next_cursor }));
    expect(page2.data.rows).toHaveLength(3);
    expect(page2.data.next_cursor).toBeNull();
    expect(page2.data.total).toBe(10);
  });

  it("un curseur falsifié ou périmé par un changement de plage est refusé", async () => {
    const page1 = await lib.exploreAnalytics(erreurs({ visualization: "table", limit: 4 }));
    const cursor = page1.data.next_cursor!;
    // Même curseur, autre plage : la requête n'est plus celle qui l'a produit.
    const autrePlage = () =>
      parseExplorerQuery(
        {
          version: 1,
          app: A,
          range: { preset: "24h" },
          dataset: "errors",
          measure: { aggregation: "sum", field: "occurrences" },
          visualization: "table",
          limit: 4,
          cursor,
        },
        { principal: ADMIN, nowMs: Date.now() },
      );
    const refus = autrePlage();
    expect(refus.ok).toBe(false);
    if (refus.ok) return;
    expect(refus.error.code).toBe("stale_cursor");

    // Curseur bricolé à la main : l'empreinte ne correspond à aucune requête.
    const { query, plan } = erreurs({ visualization: "table", limit: 4 });
    const falsifie = encodeExplorerCursor({ fingerprint: "00000000", ts: new Date().toISOString(), key: "1" });
    expect(falsifie).not.toBe(cursor);
    expect(explorerFingerprint(query, plan)).not.toBe("00000000");
  });

  it("un budget de lecture dépassé rend une erreur, JAMAIS une série de zéros", async () => {
    // Un verrou exclusif rend l'attente certaine : la lecture ne peut pas
    // aboutir, et `statement_timeout` l'interrompt. Sans cela le test dépendrait
    // de la vitesse de la machine.
    const bloqueur = new pg.Client({ connectionString: url });
    await bloqueur.connect();
    await bloqueur.query("begin");
    await bloqueur.query("lock table rum_error in access exclusive mode");
    try {
      // Comparaison par nom et par code, pas par identité de classe : la couche
      // I/O est importée dynamiquement sur la base jetable, donc depuis un autre
      // registre de modules que ce fichier.
      await expect(lib.exploreAnalytics(erreurs(), { timeoutMs: 250 })).rejects.toMatchObject({
        name: "ExplorerBudgetError",
        code: "query_budget_exceeded",
      });
    } finally {
      await bloqueur.query("rollback");
      await bloqueur.end();
    }
    // Et la lecture suivante, verrou levé, redevient exacte.
    expect((await lib.exploreAnalytics(erreurs())).data.total).toBe(10);
  });

  it("sessions commencées et sessions actives sont deux mesures, pas deux façons de dire la même", async () => {
    // Les sessions de recette commencent au premier seau et vivent jusqu'au
    // dernier : une fenêtre qui ne couvre QUE le dernier seau n'en voit aucune
    // commencer, mais toutes les voit actives.
    const dernierSeau = {
      range: { from: new Date(TO.getTime() - 3_600_000).toISOString(), to: TO.toISOString() },
      dataset: "sessions",
    };
    const commencees = await lib.exploreAnalytics(
      requete({ ...dernierSeau, measure: { aggregation: "count", field: "started" } }),
    );
    const actives = await lib.exploreAnalytics(
      requete({ ...dernierSeau, measure: { aggregation: "count", field: "active" } }),
    );
    expect(commencees.data.total).toBe(0);
    // Trois sessions humaines de l'app A ; le robot reste exclu.
    expect(actives.data.total).toBe(3);
  });

  it("une dimension que le jeu ne porte pas est refusée, jamais appliquée à moitié", async () => {
    await expect(
      lib.exploreAnalytics(requete({ dataset: "views", measure: { aggregation: "count", field: "rows" }, groupBy: ["service"] })),
    ).rejects.toThrow(/Service/);
  });

  it("les avertissements de collecte restent même quand le stockage est complet", async () => {
    const result = await lib.exploreAnalytics(erreurs());
    expect(result.meta.coverage.status).toBe("complete");
    expect(result.meta.warnings.join(" ")).toMatch(/échantillonnage des erreurs est biaisé/);
    expect(result.meta.source).toBe("raw");
    expect(result.meta.counting).toBe("occurrences reçues");
  });

  it("l'AST canonique de la réponse se rejoue et redonne le même chiffre", async () => {
    const depart = await lib.exploreAnalytics(erreurs({ visualization: "toplist", groupBy: ["release"], limit: 3 }));
    const rejeu = parseExplorerQuery(depart.meta.query, { principal: ADMIN, nowMs: Date.now() });
    expect(rejeu.ok).toBe(true);
    if (!rejeu.ok) return;
    const resultat = await lib.exploreAnalytics(rejeu.value);
    expect(resultat.data.total).toBe(depart.data.total);
    expect(resultat.data.groups).toEqual(depart.data.groups);
  });
});
