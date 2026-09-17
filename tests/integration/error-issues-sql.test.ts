// P5.5 — regroupement v2 et identité d'issue, sur un vrai PostgreSQL.
//
// La recette de la spec, prouvée de l'ingestion à la lecture console :
//   • même bug sur trois navigateurs et deux builds minifiés → UNE issue quand la
//     preuve source existe (positions symbolisées), plusieurs sans elle ; puis de
//     bout en bout avec le symbolicateur partagé de P5.4 et les vraies source maps
//     de deux builds esbuild exécutés ;
//   • 404 et 500 : deux issues, là où l'empreinte historique les confond ;
//   • clé déclarée identique dans A et B : jamais fusionnées, jamais stockée ;
//   • rejouer un lot, immédiat ou différé : ni occurrence, ni issue, ni alias, ni
//     révision ne bougent ;
//   • basculement : un groupe connu naît `migration` avec son statut, jamais
//     renotifié ; des statuts historiques divergents donnent `for_review` ;
//   • retour arrière : v2 désactivé sans perdre statuts ni URL, et la réactivation
//     retrouve les mêmes issues.
// Plus ce qui ne se lit que dans la base : contraintes, rétention, effacement, et
// la fenêtre de déploiement où le code précède migration-v72.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_V68_DATABASE_URL=<autre base jetable> pnpm test:sql
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildResourceSpans, msToHr, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";
import type { ErrorFilters } from "../../apps/console/lib/queries-errors";
// @ts-expect-error module JS partagé sans déclarations
import { deposerLot, drainerIngestRaw } from "../../apps/ingest/lib/ingest-differe.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { errorGrouping } from "../../apps/ingest/supabase/functions/_shared/error-normalize.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlFenetre = process.env.SQL_TEST_V68_DATABASE_URL;
const RACINE = join(__dirname, "..", "..");
const SQL_DIR = join(RACINE, "apps", "ingest", "sql");
// esbuild est déjà une dépendance du SDK : aucun paquet ajouté pour la recette.
const esbuild = createRequire(join(RACINE, "packages", "rum-sdk", "package.json"))("esbuild");
const pool = new pg.Pool(url ? { connectionString: url, max: 6 } : { max: 6 });
const poolFenetre = new pg.Pool(urlFenetre ? { connectionString: urlFenetre, max: 4 } : { max: 4 });

const APP = "p55-boutique";
const APP_B = "p55-boutique-b";
const APP_OMBRE = "p55-ombre";
const APP_BASCULE = "p55-bascule";
const APP_FENETRE = "p55-fenetre";
const APP_CARTES = "p55-cartes";
const APPS = [APP, APP_B, APP_OMBRE, APP_BASCULE, APP_CARTES];
const muet = { error() {} };

/** Tables écrites ici, enfants avant parents (clés étrangères). */
const TABLES_APP = [
  "ingest_raw", "rum_event_index", "rum_action", "error_issue", "rum_metric", "rum_error", "rum_resource",
  "rum_longtask", "rum_breadcrumb", "rum_event", "rum_span", "rum_pageview", "rum_session", "error_status",
  "error_grouping_config", "tenant_usage_daily", "sourcemap",
];

type Row = Record<string, unknown>;
type Navigateur = "chrome" | "firefox" | "safari";

function migrations(maxVersion = Number.POSITIVE_INFINITY): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f) && version(f) <= maxVersion)
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(db: pg.Pool, apps: string[]) {
  for (const table of TABLES_APP) {
    if ((await db.query("select to_regclass($1) as t", [`public.${table}`])).rows[0].t) {
      await db.query(`delete from ${table} where app_id = any($1::text[])`, [apps]);
    }
  }
}

async function enregistrer(db: pg.Pool, apps: string[]) {
  await db.query(
    `insert into app_registry (app_id, name, active, internal) select a, a, true, false from unnest($1::text[]) a
     on conflict (app_id) do update set active = true, internal = false`,
    [apps],
  );
}

// ───────────────────────────────── Corpus ─────────────────────────────────────

/** Deux builds minifiés du même code : empreinte de bundle, nom minifié et colonnes changent. */
const BUILDS = {
  A: { release: "1.0.0", hash: "D8LbuEa1", fn: "Ze", colonnes: { chrome: 2345, firefox: 2340, safari: 2338 } },
  B: { release: "1.1.0", hash: "XyZ12345", fn: "Qe", colonnes: { chrome: 5120, firefox: 5116, safari: 5112 } },
} as const;
type Build = keyof typeof BUILDS;

const MESSAGES: Record<Navigateur, string> = {
  chrome: "Cannot read properties of undefined (reading 'total')",
  firefox: "can't access property \"total\", t is undefined",
  safari: "undefined is not an object (evaluating 't.total')",
};

const bundle = (build: Build) => `https://boutique.test/assets/index-${BUILDS[build].hash}.js`;

/** Pile réaliste de chaque moteur. Firefox commence par une frame de React, Safari par du code natif. */
function pile(navigateur: Navigateur, build: Build, colonne?: number): string {
  const b = BUILDS[build];
  const col = colonne ?? b.colonnes[navigateur];
  if (navigateur === "chrome") {
    return `TypeError: ${MESSAGES.chrome}\n    at ${b.fn} (${bundle(build)}:1:${col})\n    at HTMLButtonElement.<anonymous> (${bundle(build)}:1:900)`;
  }
  if (navigateur === "firefox") return `dispatchEvent@${bundle(build)}:1:880\n${b.fn}@${bundle(build)}:1:${col}`;
  return `forEach@[native code]\n${b.fn}@${bundle(build)}:1:${col}\nglobal code@${bundle(build)}:1:870`;
}

const PANIER = { source: "src/panier/validerPanier.ts", line: 42 };
const TOTALISER = { source: "src/panier/totaliser.ts", line: 17 };
const REACT = { source: "node_modules/react-dom/cjs/react-dom.production.min.js", line: 7000 };

/** Source maps de chaque build : colonne minifiée de la ligne 1 → position source. */
const CARTES: Record<string, Record<number, { source: string; line: number }>> = {
  [`1.0.0|${BUILDS.A.hash}`]: { 2345: PANIER, 2340: PANIER, 2338: PANIER, 3100: TOTALISER, 900: REACT, 880: REACT, 870: REACT },
  [`1.1.0|${BUILDS.B.hash}`]: { 5120: PANIER, 5116: PANIER, 5112: PANIER, 900: REACT, 880: REACT, 870: REACT },
};

/**
 * Symbolicateur au contrat du module partagé de P5.4 : pour chaque erreur, les
 * positions source de ses lignes de pile, lues dans les cartes de SA release.
 */
const symbolicateur = {
  async symboliquerLot(_client: unknown, erreurs: Row[]) {
    return erreurs.map((e) => {
      const positions: Array<{ index: number; source: string; line: number }> = [];
      String(e.stack ?? "").split("\n").forEach((ligne, index) => {
        const m = /index-([A-Za-z0-9_-]{8})\.js:1:(\d+)/.exec(ligne);
        const cible = m ? CARTES[`${e.release}|${m[1]}`]?.[Number(m[2])] : undefined;
        if (cible) positions.push({ index, ...cible });
      });
      return positions.length ? { positions } : null;
    });
  },
};

interface BuildReel {
  bundle: string;
  map: string;
  /** Vraie pile V8 du bundle exécuté. */
  v8: string;
  /** La même pile écrite comme Firefox : `fn@url:ligne:colonne`, sans ligne de message. */
  gecko: string;
}

/**
 * Deux builds réels du même bug (esbuild, minifiés, maps externes). Le second
 * ajoute un module : empreinte de bundle, noms minifiés et colonnes changent.
 * Chaque bundle est exécuté sous l'URL qu'aurait un navigateur.
 */
async function buildsReels(dossier: string): Promise<[BuildReel, BuildReel]> {
  const panier = [
    "export function validerPanier(panier: { lignes?: number[] }): number {",
    "  if (!panier.lignes) {",
    '    throw new TypeError("panier sans lignes");',
    "  }",
    "  return panier.lignes.length;",
    "}",
  ];
  const variantes = [
    {
      nom: "a",
      fichiers: {
        "panier.ts": panier,
        "main.ts": ['import { validerPanier } from "./panier";', "export function payer(): number {", "  return validerPanier({});", "}"],
      },
    },
    {
      nom: "b",
      fichiers: {
        "panier.ts": panier,
        "remise.ts": ["export function remise(total: number): number {", "  return Math.round(total * 90) / 100;", "}"],
        "main.ts": [
          'import { remise } from "./remise";',
          'import { validerPanier } from "./panier";',
          "export function payer(): number {",
          "  return remise(validerPanier({}));",
          "}",
        ],
      },
    },
  ];
  const builds: BuildReel[] = [];
  for (const { nom, fichiers } of variantes) {
    const racine = join(dossier, nom);
    mkdirSync(join(racine, "src"), { recursive: true });
    for (const [fichier, lignes] of Object.entries(fichiers)) {
      const exporte = fichier === "main.ts" ? ["(globalThis as { payerP55?: () => number }).payerP55 = payer;"] : [];
      writeFileSync(join(racine, "src", fichier), [...lignes, ...exporte].join("\n"));
    }
    await esbuild.build({
      absWorkingDir: racine,
      entryPoints: ["src/main.ts"],
      bundle: true,
      minify: true,
      sourcemap: true,
      format: "iife",
      target: "es2020",
      outdir: "dist/assets",
      entryNames: "[name]-[hash]",
      logLevel: "silent",
    });
    const assets = join(racine, "dist", "assets");
    const bundle = readdirSync(assets).find((f) => f.endsWith(".js"))!;
    const adresse = `https://boutique.test/assets/${bundle}`;
    vm.runInThisContext(readFileSync(join(assets, bundle), "utf8"), { filename: adresse });
    let brute = "";
    try {
      (globalThis as { payerP55?: () => number }).payerP55!();
    } catch (err) {
      brute = (err as Error).stack ?? "";
    }
    const lignes = brute.split("\n").filter((ligne, i) => i === 0 || ligne.includes(adresse));
    const gecko = lignes.slice(1).map((ligne) => {
      const m = /^\s*at (?:(.+?) \()?(.+):(\d+):(\d+)\)?$/.exec(ligne)!;
      return `${m[1] ?? ""}@${m[2]}:${m[3]}:${m[4]}`;
    });
    builds.push({ bundle, map: readFileSync(join(assets, `${bundle}.map`), "utf8"), v8: lignes.join("\n"), gecko: gecko.join("\n") });
  }
  return builds as [BuildReel, BuildReel];
}

let compteur = 0;
const spanId = () => (0x5500000000000000n + BigInt(++compteur)).toString(16);
const traceId = () => `55${(++compteur).toString(16).padStart(30, "0")}`;

interface ErreurNavigateur {
  navigateur?: Navigateur;
  build?: Build;
  colonne?: number;
  type?: string;
  message?: string;
  stack?: string;
  cle?: string;
  session?: string;
  avantMs?: number;
}

/** Lot du SDK web réel : une exception par entrée, chacune avec sa release. */
function lot(app: string, erreurs: ErreurNavigateur[]) {
  const parRelease = new Map<string, EmitSpan[]>();
  for (const e of erreurs) {
    const build = e.build ?? "A";
    const navigateur = e.navigateur ?? "chrome";
    const t = msToHr(Date.now() - (e.avantMs ?? 5_000));
    const span: EmitSpan = {
      name: "exception",
      traceId: traceId(),
      spanId: spanId(),
      startTime: t,
      endTime: t,
      attributes: {
        "mip.session_id": e.session ?? `p55-session-${app}`,
        "mip.route": "/panier",
        "mip.device_type": "desktop",
        "mip.error_kind": "error",
        "exception.type": e.type ?? "TypeError",
        "exception.message": e.message ?? MESSAGES[navigateur],
        "exception.stacktrace": e.stack ?? pile(navigateur, build, e.colonne),
        ...(e.cle !== undefined ? { "mip.error_fingerprint": e.cle } : {}),
      },
    };
    const release = BUILDS[build].release;
    parRelease.set(release, [...(parRelease.get(release) ?? []), span]);
  }
  const resourceSpans = [...parRelease].flatMap(([release, spans]) =>
    (buildResourceSpans({ "service.name": "mip-rum-web", "mip.app_id": app, "mip.release": release }, spans) as {
      resourceSpans: unknown[];
    }).resourceSpans);
  return flattenOtlp({ resourceSpans });
}

async function erreurs(db: pg.Pool, app: string): Promise<Row[]> {
  return (await db.query(
    `select span_id, fingerprint, grouping_version, grouping_key, grouping_basis, fingerprint_override_hash,
            grouping_diagnostic, issue_id, release, occurrences, error_type, message
       from rum_error where app_id = $1 order by ts, id`,
    [app],
  )).rows;
}

async function issues(db: pg.Pool, app: string): Promise<Row[]> {
  return (await db.query("select * from error_issue where app_id = $1 order by created_at, id", [app])).rows;
}

async function alias(db: pg.Pool, app: string): Promise<Row[]> {
  return (await db.query(
    "select legacy_fingerprint, issue_id, legacy_status from error_issue_alias where app_id = $1 order by legacy_fingerprint, issue_id",
    [app],
  )).rows;
}

const activer = (db: pg.Pool, app: string) => db.query("select error_grouping_activate($1, 'recette@p55.test')", [app]);
const desactiver = (db: pg.Pool, app: string) => db.query("select error_grouping_deactivate($1, 'recette@p55.test')", [app]);

/** Modules console branchés sur `databaseUrl` (db.ts lit DATABASE_URL à l'import). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const erreursLib = await import("../../apps/console/lib/queries-errors");
  const issuesLib = await import("../../apps/console/lib/error-issues");
  const { pool: consolePool } = await import("../../apps/console/lib/db");
  return { ...erreursLib, ...issuesLib, consolePool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const filtres = (app: string, over: Partial<ErrorFilters> = {}): ErrorFilters => ({
  app, period: "7d", device: null, segment: [], includeBots: false, includeInternal: false, ...over,
});
const SANS_FILTRE = { status: null, release: null, source: null };
const somme = (valeurs: number[]) => valeurs.reduce((s, v) => s + v, 0);

// ═══════════════════════════════ Schéma courant ═══════════════════════════════

(url ? describe : describe.skip)("P5.5 — regroupement v2 et issues — PostgreSQL", () => {
  let lib: Console;

  beforeAll(async () => {
    // Rejouées DEUX FOIS : v72 doit être inerte au second passage.
    for (let passe = 0; passe < 2; passe++) {
      for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    }
    await enregistrer(pool, APPS);
    await nettoyer(pool, APPS);
    _resetColonnesCache();
    lib = await consoleSur(url!);
  }, 300_000);

  afterAll(async () => {
    await nettoyer(pool, APPS);
    await pool.query("delete from app_registry where app_id = any($1::text[])", [APPS]);
    await pool.end();
    await lib?.consolePool.end();
  });

  describe("migration-v72", () => {
    it("pose colonnes, tables, index et politiques, contraintes NOT VALID sur la table chaude", async () => {
      const colonnes = (await pool.query(
        `select column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'rum_error'
            and column_name in ('grouping_version', 'grouping_key', 'grouping_basis', 'fingerprint_override_hash', 'grouping_diagnostic', 'issue_id')
          order by column_name`,
      )).rows;
      expect(colonnes).toEqual([
        { column_name: "fingerprint_override_hash", data_type: "text" },
        { column_name: "grouping_basis", data_type: "text" },
        { column_name: "grouping_diagnostic", data_type: "text" },
        { column_name: "grouping_key", data_type: "text" },
        { column_name: "grouping_version", data_type: "smallint" },
        { column_name: "issue_id", data_type: "uuid" },
      ]);
      expect((await pool.query(
        "select convalidated from pg_constraint where conrelid = 'public.rum_error'::regclass and conname = 'rum_error_grouping_v72'",
      )).rows).toEqual([{ convalidated: false }]);
      expect((await pool.query(
        `select i.indisvalid, i.indisready from pg_index i join pg_class c on c.oid = i.indexrelid
          where c.relname = 'idx_rum_error_fingerprint_ts_v72'`,
      )).rows).toEqual([{ indisvalid: true, indisready: true }]);
      expect((await pool.query(
        `select tablename, policyname, cmd, roles::text from pg_policies
          where tablename in ('error_issue', 'error_issue_alias', 'error_grouping_config') order by tablename`,
      )).rows).toEqual([
        { tablename: "error_grouping_config", policyname: "tenant_scope", cmd: "SELECT", roles: "{console_ro}" },
        { tablename: "error_issue", policyname: "tenant_scope", cmd: "SELECT", roles: "{console_ro}" },
        { tablename: "error_issue_alias", policyname: "tenant_scope", cmd: "SELECT", roles: "{console_ro}" },
      ]);
    });

    it("refuse toute valeur hors contrat", async () => {
      await nettoyer(pool, [APP_OMBRE]);
      const refus = async (sql: string, params: unknown[], contrainte: string) =>
        expect(pool.query(sql, params), sql).rejects.toMatchObject({ code: "23514", constraint: contrainte });
      await refus("insert into rum_error (app_id, span_id, grouping_version, grouping_key, grouping_basis) values ($1, $2, 2, $3, 'autre')",
        [APP_OMBRE, spanId(), "a".repeat(32)], "rum_error_grouping_v72");
      await refus("insert into rum_error (app_id, span_id, grouping_version, grouping_key, grouping_basis) values ($1, $2, 3, $3, 'override')",
        [APP_OMBRE, spanId(), "a".repeat(32)], "rum_error_grouping_v72");
      await refus("insert into rum_error (app_id, span_id, fingerprint_override_hash) values ($1, $2, 'paiement.refus')",
        [APP_OMBRE, spanId()], "rum_error_grouping_v72");
      await refus("insert into rum_error (app_id, span_id, issue_id) values ($1, $2, gen_random_uuid())",
        [APP_OMBRE, spanId()], "rum_error_grouping_v72");
      await refus(
        `insert into error_issue (app_id, grouping_version, grouping_key, grouping_basis, origin, status, first_seen, last_seen)
         values ($1, 2, $2, 'override', 'new', 'reopened', now(), now())`,
        [APP_OMBRE, "b".repeat(32)], "error_issue_v72");
      await refus(
        "insert into error_grouping_config (app_id, vendor_paths) values ($1, $2)",
        [APP_OMBRE, Array.from({ length: 33 }, (_, i) => `vendor-${i}/`)], "error_grouping_config_v72");
      await refus("insert into error_grouping_config (app_id, vendor_paths) values ($1, $2)",
        [APP_OMBRE, ["node_modules/\u0001"]], "error_grouping_config_v72");
      await expect(pool.query("select error_grouping_activate($1, '')", [APP_OMBRE])).rejects.toThrow(/acteur requis/);
    });
  });

  it("ombre : chaque erreur porte sa clé v2, aucune issue n'est créée hors activation", async () => {
    await nettoyer(pool, [APP_OMBRE]);
    const navigateurs: Navigateur[] = ["chrome", "firefox", "safari"];
    expect((await writeRows(pool, lot(APP_OMBRE, navigateurs.map((navigateur) => ({ navigateur })))) ).erreurs)
      .toEqual({ recues: 3, inserees: 3, ignorees: 0 });
    const rows = await erreurs(pool, APP_OMBRE);
    for (const row of rows) {
      expect(row).toMatchObject({ grouping_version: 2, grouping_basis: "normalized_frame", issue_id: null });
      expect(row.grouping_key).toMatch(/^[0-9a-f]{32}$/);
    }
    // Sans preuve source, trois messages de moteur restent trois clés.
    expect(new Set(rows.map((r) => r.grouping_key)).size).toBe(3);
    expect(await issues(pool, APP_OMBRE)).toEqual([]);
    expect(await alias(pool, APP_OMBRE)).toEqual([]);

    const { rows: [{ stats }] } = await pool.query(
      "select error_grouping_shadow_stats($1, now() - interval '1 day') as stats", [APP_OMBRE],
    );
    expect(stats).toMatchObject({
      app_id: APP_OMBRE, rows: 3, legacy_groups: 3, v2_keys: 3, legacy_groups_split: 0, v2_keys_merging: 0,
      occurrences_by_basis: { normalized_frame: 3 },
    });
  });

  describe("recette de regroupement", () => {
    beforeAll(async () => {
      await nettoyer(pool, [APP, APP_B]);
      await activer(pool, APP);
      await activer(pool, APP_B);
    });

    it("même bug, trois navigateurs, deux builds minifiés : une issue avec la preuve source", async () => {
      // Le build A tourne avant le build B.
      const corpus: ErreurNavigateur[] = (["A", "B"] as Build[]).flatMap((build) =>
        (["chrome", "firefox", "safari"] as Navigateur[]).map((navigateur) => ({
          build, navigateur, avantMs: build === "A" ? 60_000 : 5_000,
        })));
      expect((await writeRows(pool, lot(APP, corpus), { symbolicateur })).erreurs).toEqual({ recues: 6, inserees: 6, ignorees: 0 });

      const rows = await erreurs(pool, APP);
      // L'empreinte historique en voyait cinq : message du moteur × première frame,
      // minifiée pour Chrome et Firefox, et `forEach@[native code]` commune aux deux
      // builds pour Safari.
      expect(new Set(rows.map((r) => r.fingerprint)).size).toBe(5);
      expect(new Set(rows.map((r) => r.grouping_key)).size).toBe(1);
      expect(new Set(rows.map((r) => r.grouping_basis))).toEqual(new Set(["symbolicated_frame"]));
      const [issue] = await issues(pool, APP);
      expect(await issues(pool, APP)).toHaveLength(1);
      expect(rows.every((r) => r.issue_id === issue.id)).toBe(true);
      expect(issue).toMatchObject({
        grouping_version: 2, grouping_key: rows[0].grouping_key, grouping_basis: "symbolicated_frame",
        origin: "new", status: "open", status_source: "system", revision: "1",
      });
      // Cinq empreintes historiques rattachées, aucune n'ayant d'occurrence antérieure.
      expect((await alias(pool, APP)).map((a) => [a.issue_id, a.legacy_status])).toEqual(
        Array.from({ length: 5 }, () => [issue.id, null]),
      );
      // Première et dernière release : celles des occurrences extrêmes.
      expect([issue.first_release, issue.last_release]).toEqual(["1.0.0", "1.1.0"]);

      // Le même corpus sans source map ne fusionne pas les navigateurs.
      expect((await writeRows(pool, lot(APP_B, corpus))).erreurs.inserees).toBe(6);
      expect(new Set((await erreurs(pool, APP_B)).map((r) => r.grouping_key)).size).toBeGreaterThanOrEqual(3);
    });

    it("de bout en bout avec le symbolicateur partagé de P5.4 : vraies maps de deux builds, une issue", async () => {
      const dossier = mkdtempSync(join(tmpdir(), "p55-builds-"));
      try {
        const [a, b] = await buildsReels(dossier);
        expect(a.bundle).not.toBe(b.bundle);
        await nettoyer(pool, [APP_CARTES]);
        await activer(pool, APP_CARTES);
        await pool.query(
          "insert into sourcemap (app_id, release, filename, content) values ($1, $2, $3, $4), ($1, $5, $6, $7)",
          [APP_CARTES, BUILDS.A.release, a.bundle, a.map, BUILDS.B.release, b.bundle, b.map],
        );
        const message = "panier sans lignes";
        // Aucun symbolicateur passé : celui de l'ingestion, qui lit la table sourcemap.
        const lotReel = lot(APP_CARTES, [
          { build: "A", message, stack: a.v8 },
          { build: "A", navigateur: "firefox", message, stack: a.gecko },
          { build: "B", message, stack: b.v8 },
          { build: "B", navigateur: "firefox", message, stack: b.gecko },
        ]);
        expect((await writeRows(pool, lotReel)).erreurs.inserees).toBe(4);

        const rows = (await pool.query(
          "select grouping_key, grouping_basis, symbolication_status, stack_symbolicated, issue_id from rum_error where app_id = $1",
          [APP_CARTES],
        )).rows;
        expect(rows.map((r) => [r.symbolication_status, r.grouping_basis])).toEqual(
          Array.from({ length: 4 }, () => ["resolved", "symbolicated_frame"]),
        );
        expect(rows[0].stack_symbolicated).toMatch(/src\/panier\.ts:3:\d+/);
        expect(new Set(rows.map((r) => r.grouping_key)).size).toBe(1);
        const liste = await issues(pool, APP_CARTES);
        expect(liste).toHaveLength(1);
        expect(rows.every((r) => r.issue_id === liste[0].id)).toBe(true);

        // La preuve vient des maps : sans positions, la clé serait celle de la frame minifiée.
        const sansCarte = [a.v8, b.v8].map((stack) => errorGrouping({ appId: APP_CARTES, errorType: "TypeError", message, stack }));
        expect(sansCarte.map((c) => c.basis)).toEqual(["normalized_frame", "normalized_frame"]);
        expect(sansCarte.map((c) => c.key)).not.toContain(rows[0].grouping_key);
      } finally {
        rmSync(dossier, { recursive: true, force: true });
      }
    }, 60_000);

    it("404 et 500 : deux issues, que l'empreinte historique confondait", async () => {
      const stack = `AxiosError: Request failed\n    at chargerPanier (https://boutique.test/src/api/panier.ts:12:5)`;
      await writeRows(pool, lot(APP, [
        { type: "AxiosError", message: "Request failed with status code 404", stack },
        { type: "AxiosError", message: "Request failed with status code 500", stack },
      ]));
      const rows = (await erreurs(pool, APP)).filter((r) => r.error_type === "AxiosError");
      expect(rows).toHaveLength(2);
      expect(rows[0].fingerprint).toBe(rows[1].fingerprint);
      expect(rows[0].grouping_key).not.toBe(rows[1].grouping_key);
      expect(new Set(rows.map((r) => r.issue_id)).size).toBe(2);
    });

    it("clé déclarée : identique dans A et B sans fusion, hachée, ignorée si elle ne contient qu'une donnée personnelle", async () => {
      const cle = "paiement.refus";
      await writeRows(pool, lot(APP, [
        { type: "PaymentError", message: "refus banque", stack: "PaymentError\n    at payer (https://boutique.test/src/paiement.ts:3:1)", cle },
        { type: "PaymentError", message: "refus 3DS", stack: "PaymentError\n    at confirmer (https://boutique.test/src/3ds.ts:9:1)", cle: `  ${cle}  ` },
        { type: "ProfileError", message: "profil", stack: "ProfileError\n    at profil (https://boutique.test/src/profil.ts:1:1)", cle: "alice@example.test" },
      ]));
      await writeRows(pool, lot(APP_B, [
        { type: "PaymentError", message: "refus banque", stack: "PaymentError\n    at payer (https://boutique.test/src/paiement.ts:3:1)", cle },
      ]));
      const a = (await erreurs(pool, APP)).filter((r) => r.error_type === "PaymentError");
      const b = (await erreurs(pool, APP_B)).filter((r) => r.error_type === "PaymentError");
      expect(a.map((r) => r.grouping_basis)).toEqual(["override", "override"]);
      expect(new Set(a.map((r) => r.issue_id)).size).toBe(1);
      expect(a[0].fingerprint_override_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(b[0].fingerprint_override_hash).not.toBe(a[0].fingerprint_override_hash);
      expect(b[0].grouping_key).not.toBe(a[0].grouping_key);
      expect(b[0].issue_id).not.toBe(a[0].issue_id);

      const [profil] = (await erreurs(pool, APP)).filter((r) => r.error_type === "ProfileError");
      expect(profil).toMatchObject({ fingerprint_override_hash: null, grouping_diagnostic: "override_vide_apres_scrub", grouping_basis: "normalized_frame" });
      // Ni la clé ni la donnée personnelle ne sont écrites, où que ce soit.
      const brut = JSON.stringify((await pool.query(
        "select row_to_json(e)::text as ligne from rum_error e where app_id = any($1::text[])", [[APP, APP_B]],
      )).rows);
      expect(brut).not.toContain("paiement.refus");
      expect(brut).not.toContain("alice@example.test");
    });

    it("rejouer un lot, immédiat ou différé, ne change ni occurrence, ni issue, ni alias, ni révision", async () => {
      const rejouable = lot(APP, [{ navigateur: "chrome", build: "A" }, { navigateur: "safari", build: "B" }]);
      await writeRows(pool, rejouable, { symbolicateur });
      const photo = async () => ({
        lignes: (await pool.query("select count(*)::int as n, sum(occurrences)::int as occ from rum_error where app_id = $1", [APP])).rows[0],
        issues: await issues(pool, APP),
        alias: await alias(pool, APP),
      });
      const avant = await photo();
      expect((await writeRows(pool, rejouable, { symbolicateur })).erreurs).toEqual({ recues: 2, inserees: 0, ignorees: 0 });
      await deposerLot(pool, APP, rejouable);
      expect(await drainerIngestRaw(pool, { log: muet })).toEqual({ drains: 1, echecs: 0 });
      expect(await photo()).toEqual(avant);
    });

    it("deux lots simultanés d'une même clé nouvelle : une seule issue", async () => {
      const cle = "course.simultanee";
      const stack = "RaceError\n    at courir (https://boutique.test/src/course.ts:1:1)";
      await Promise.all([
        writeRows(pool, lot(APP, [{ type: "RaceError", message: "a", stack, cle }])),
        writeRows(pool, lot(APP, [{ type: "RaceError", message: "b", stack, cle }])),
        writeRows(pool, lot(APP, [{ type: "RaceError", message: "c", stack, cle }])),
      ]);
      const rows = (await erreurs(pool, APP)).filter((r) => r.error_type === "RaceError");
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.issue_id)).size).toBe(1);
      expect((await issues(pool, APP)).filter((i) => i.id === rows[0].issue_id)).toHaveLength(1);
    });

    it("anciennes URL : un alias unique désigne une issue, une empreinte répartie en désigne plusieurs", async () => {
      // Même message, même frame minifiée, autre ligne source : même empreinte historique, autre issue.
      await writeRows(pool, lot(APP, [{ navigateur: "chrome", build: "A", colonne: 3100 }]), { symbolicateur });
      const chrome = (await erreurs(pool, APP)).filter((r) => r.message === MESSAGES.chrome && r.release === "1.0.0");
      const empreinte = chrome[0].fingerprint as string;
      expect(new Set(chrome.map((r) => r.fingerprint))).toEqual(new Set([empreinte]));
      expect(new Set(chrome.map((r) => r.issue_id)).size).toBe(2);

      const repartie = await lib.legacyIssueTargets({ app_id: APP, fingerprint: empreinte });
      expect(repartie?.map((t) => t.id).sort()).toEqual([...new Set(chrome.map((r) => r.issue_id as string))].sort());
      const firefox = (await erreurs(pool, APP)).find((r) => r.message === MESSAGES.firefox)!;
      expect(await lib.legacyIssueTargets({ app_id: APP, fingerprint: firefox.fingerprint as string }))
        .toEqual([expect.objectContaining({ id: firefox.issue_id, status: "open" })]);
      // App non activée : l'ancienne URL garde son détail historique.
      expect(await lib.legacyIssueTargets({ app_id: APP_OMBRE, fingerprint: (await erreurs(pool, APP_OMBRE))[0].fingerprint as string }))
        .toBeNull();
    });
  });

  describe("basculement d'une app qui a un historique", () => {
    const chrome = { navigateur: "chrome" as const, build: "A" as const };
    const firefox = { navigateur: "firefox" as const, build: "A" as const };
    const vieux = { type: "LegacyError", message: "vieux bug", stack: "LegacyError\n    at ancien (https://boutique.test/src/ancien.ts:1:1)" };
    let empreinteChrome = "";
    let empreinteFirefox = "";
    let empreinteVieux = "";

    beforeAll(async () => {
      await nettoyer(pool, [APP_BASCULE]);
      // Le watermark de check_new_errors est global : on le fait avancer au-delà
      // de tout ce que les autres fichiers ont écrit.
      await pool.query("select check_new_errors()");
      await writeRows(pool, lot(APP_BASCULE, [
        { ...chrome, avantMs: 3 * 86_400_000 },
        { ...chrome, avantMs: 2 * 86_400_000 },
        { ...firefox, avantMs: 2 * 86_400_000 },
        { ...vieux, avantMs: 86_400_000 },
      ]), { symbolicateur });
      const rows = await erreurs(pool, APP_BASCULE);
      empreinteChrome = rows[0].fingerprint as string;
      empreinteFirefox = rows.find((r) => r.message === MESSAGES.firefox)!.fingerprint as string;
      empreinteVieux = rows.find((r) => r.error_type === "LegacyError")!.fingerprint as string;
      await pool.query(
        `insert into error_status (app_id, fingerprint, status, resolved_at, resolved_by, note)
         values ($1, $2, 'resolved', now() - interval '1 day', 'ops@p55.test', 'corrigé par le correctif 1.0.1'),
                ($1, $3, 'ignored', null, null, 'bruit Firefox connu')`,
        [APP_BASCULE, empreinteChrome, empreinteFirefox],
      );
      // Ces trois groupes sont nouveaux pour le chemin historique, et notifiés une fois.
      await pool.query("select check_new_errors()");
      await activer(pool, APP_BASCULE);
    });

    it("un groupe connu naît `migration` avec son statut et sa première vue, sans renotification", async () => {
      const notifs = () => pool.query("delete from alert_event where message like $1 returning id", [`%/ app ${APP_BASCULE}%`]);
      expect((await notifs()).rowCount).toBe(3);

      await writeRows(pool, lot(APP_BASCULE, [chrome]), { symbolicateur });
      const [issue] = await issues(pool, APP_BASCULE);
      const premiere = (await pool.query(
        "select min(ts) as ts from rum_error where app_id = $1 and fingerprint = $2", [APP_BASCULE, empreinteChrome],
      )).rows[0].ts;
      expect(issue).toMatchObject({
        origin: "migration", status: "resolved", status_source: "migration", grouping_basis: "symbolicated_frame", revision: "1",
      });
      expect(issue.first_seen).toEqual(premiere);
      expect(await alias(pool, APP_BASCULE)).toEqual([{ legacy_fingerprint: empreinteChrome, issue_id: issue.id, legacy_status: "resolved" }]);

      // Le chemin historique ne la voit pas comme nouvelle : aucune alerte recréée.
      await pool.query("select check_new_errors()");
      expect((await notifs()).rowCount).toBe(0);
    });

    it("un groupe historique au statut divergent passe l'issue en `for_review`, notes intactes", async () => {
      await writeRows(pool, lot(APP_BASCULE, [firefox]), { symbolicateur });
      const [issue] = await issues(pool, APP_BASCULE);
      expect(await issues(pool, APP_BASCULE)).toHaveLength(1);
      expect(issue).toMatchObject({ status: "for_review", status_source: "migration", revision: "2" });
      expect((await alias(pool, APP_BASCULE)).map((a) => [a.legacy_fingerprint, a.legacy_status]).sort()).toEqual(
        [[empreinteChrome, "resolved"], [empreinteFirefox, "ignored"]].sort(),
      );
      expect((await pool.query("select fingerprint, status, note from error_status where app_id = $1 order by status", [APP_BASCULE])).rows)
        .toEqual([
          { fingerprint: empreinteFirefox, status: "ignored", note: "bruit Firefox connu" },
          { fingerprint: empreinteChrome, status: "resolved", note: "corrigé par le correctif 1.0.1" },
        ]);
      // Un bug jamais vu naît `new`.
      await writeRows(pool, lot(APP_BASCULE, [{ type: "FreshError", message: "tout neuf", stack: "FreshError\n    at neuf (https://boutique.test/src/neuf.ts:1:1)" }]));
      expect((await issues(pool, APP_BASCULE)).map((i) => [i.origin, i.status])).toEqual([["migration", "for_review"], ["new", "open"]]);
    });

    it("lecture : chaque occurrence comptée une fois, dans son issue ou dans son groupe historique", async () => {
      const f = filtres(APP_BASCULE);
      const liste = await lib.listIssues(f, SANS_FILTRE, { limit: 50, cursor: null }, { overview: true });
      const historique = await lib.listErrorGroups(f, { limit: 100, offset: 0 });
      // Même population : même total d'occurrences, quelle que soit la découpe.
      expect(somme(liste.issues.map((e) => e.occurrences))).toBe(historique.totals.occurrences);
      expect(liste.totals?.occurrences).toBe(historique.totals.occurrences);

      const [aRevoir, neuve, vieuxGroupe] = liste.issues;
      // Les occurrences antérieures des deux empreintes reprises sont comptées dans l'issue.
      expect(aRevoir).toMatchObject({ kind: "issue", status: "for_review", origin: "migration", occurrences: 5 });
      expect(neuve).toMatchObject({ kind: "issue", status: "open", origin: "new", occurrences: 1 });
      expect(vieuxGroupe).toMatchObject({ kind: "legacy", fingerprint: empreinteVieux, status: "open", occurrences: 1 });
      expect(liste.total).toBe(3);
      expect(liste.coverage).toMatchObject({
        grouping_version: 2, available: true, active_apps: [APP_BASCULE], issues: 2, legacy_groups: 1,
        occurrences_in_issues: 6, occurrences_legacy: 1, occurrences_low_confidence: 0,
      });
      expect(liste.coverage.issue_share).toBeCloseTo(6 / 7, 12);
      expect(somme(liste.trend!.map((p) => p.occurrences))).toBe(7);
      expect(aRevoir.series && somme(aRevoir.series)).toBe(5);

      // Filtres d'entrée et de population.
      expect((await lib.listIssues(f, { ...SANS_FILTRE, status: "for_review" }, { limit: 50, cursor: null })).issues.map((e) => e.kind))
        .toEqual(["issue"]);
      expect((await lib.listIssues(f, { ...SANS_FILTRE, release: "1.1.0" }, { limit: 50, cursor: null })).total).toBe(0);
      expect((await lib.listIssues(f, { ...SANS_FILTRE, source: "browser_js" }, { limit: 50, cursor: null })).total).toBe(3);
      expect((await lib.listIssues(f, { ...SANS_FILTRE, source: "python" }, { limit: 50, cursor: null })).total).toBe(0);

      // Curseur : trois pages d'une entrée, dans l'ordre, sans perte ni doublon.
      const vus: string[] = [];
      let curseur: string | null = null;
      do {
        const page = await lib.listIssues(f, SANS_FILTRE, { limit: 1, cursor: lib.parseIssueCursor(curseur) ?? null });
        vus.push(...page.issues.map((e) => (e.kind === "issue" ? e.id : e.fingerprint)));
        curseur = page.next_cursor;
      } while (curseur);
      expect(vus).toEqual(liste.issues.map((e) => (e.kind === "issue" ? e.id : e.fingerprint)));

      // Détail : mêmes nombres, groupes historiques et notes relus.
      const issue = await lib.resolveIssue((aRevoir as { id: string }).id, null);
      expect(await lib.resolveIssue((aRevoir as { id: string }).id, [APP])).toBeNull();
      const detail = await lib.issueDetail(issue!, f, { limit: 2, cursor: null });
      expect(detail.impact.occurrences).toBe(5);
      expect(somme(detail.trend.map((p) => p.occurrences))).toBe(5);
      expect(detail.occurrences).toHaveLength(2);
      expect(detail.next_cursor).not.toBeNull();
      expect(detail.last_sample?.message).toBe(MESSAGES.firefox);
      expect(detail.grouping_active).toBe(true);
      expect(detail.legacy_groups.map((g) => [g.fingerprint, g.legacy_status, g.current_status, g.note, g.issues]).sort()).toEqual([
        [empreinteChrome, "resolved", "resolved", "corrigé par le correctif 1.0.1", 1],
        [empreinteFirefox, "ignored", "ignored", "bruit Firefox connu", 1],
      ].sort());
      const suite = await lib.issueDetail(issue!, f, { limit: 2, cursor: lib.parseErrorCursor(detail.next_cursor)! });
      expect(suite.occurrences.map((o) => o.id)).not.toContain(detail.occurrences[0].id);
    });

    it("retour arrière : v2 désactivé sans perdre statut, alias ni URL ; la réactivation retrouve les mêmes issues", async () => {
      const avant = await issues(pool, APP_BASCULE);
      await desactiver(pool, APP_BASCULE);
      expect((await lib.groupingState(null)).active_apps).not.toContain(APP_BASCULE);
      expect(await lib.legacyIssueTargets({ app_id: APP_BASCULE, fingerprint: empreinteChrome })).toBeNull();

      await writeRows(pool, lot(APP_BASCULE, [chrome]), { symbolicateur });
      const derniere = (await erreurs(pool, APP_BASCULE)).at(-1)!;
      expect(derniere).toMatchObject({ grouping_basis: "symbolicated_frame", issue_id: null });
      expect(await issues(pool, APP_BASCULE)).toEqual(avant);
      const issue = await lib.resolveIssue(avant[0].id as string, null);
      expect(issue).toMatchObject({ status: "for_review", revision: "2" });
      expect((await lib.issueDetail(issue!, filtres(APP_BASCULE), { limit: 10, cursor: null })).grouping_active).toBe(false);

      await activer(pool, APP_BASCULE);
      await writeRows(pool, lot(APP_BASCULE, [chrome]), { symbolicateur });
      expect((await erreurs(pool, APP_BASCULE)).at(-1)).toMatchObject({ issue_id: avant[0].id });
      expect((await issues(pool, APP_BASCULE)).map((i) => [i.id, i.status, i.revision])).toEqual(
        avant.map((i) => [i.id, i.status, i.revision]),
      );
    });

    it("rétention et effacement : issues et alias suivent leurs occurrences, l'effacement emporte aussi la configuration", async () => {
      await pool.query("select purge_rum_app($1, now() - interval '30 days')", [APP_BASCULE]);
      expect(await issues(pool, APP_BASCULE)).toHaveLength(2);
      const { rows: [{ bilan }] } = await pool.query("select purge_rum_app($1, now() + interval '1 minute') as bilan", [APP_BASCULE]);
      expect(bilan).toMatchObject({ error_issue: 2 });
      expect(await issues(pool, APP_BASCULE)).toEqual([]);
      expect(await alias(pool, APP_BASCULE)).toEqual([]);

      await writeRows(pool, lot(APP_BASCULE, [chrome]), { symbolicateur });
      expect(await issues(pool, APP_BASCULE)).toHaveLength(1);
      await pool.query("select erase_app_data($1)", [APP_BASCULE]);
      expect(await issues(pool, APP_BASCULE)).toEqual([]);
      expect((await pool.query("select count(*)::int as n from error_grouping_config where app_id = $1", [APP_BASCULE])).rows[0].n).toBe(0);
    });
  });
});

// ═════════════════════ Fenêtre de déploiement : avant v72 ═════════════════════

(urlFenetre ? describe : describe.skip)("P5.5 — code publié avant migration-v72", () => {
  let lib: Console;

  beforeAll(async () => {
    // Repartir d'un schéma vide : un passage précédent a pu y appliquer v72.
    await poolFenetre.query("drop schema public cascade; create schema public;");
    for (const file of migrations(71)) await poolFenetre.query(readFileSync(file, "utf8"));
    await enregistrer(poolFenetre, [APP_FENETRE]);
    _resetColonnesCache();
    lib = await consoleSur(urlFenetre!);
  }, 300_000);

  afterAll(async () => {
    await poolFenetre.end();
    await lib?.consolePool.end();
  });

  it("écrit et lit sans clé v2 avant v72, puis calcule la clé en ombre dès v72 appliquée", async () => {
    expect((await writeRows(poolFenetre, lot(APP_FENETRE, [{ navigateur: "chrome" }]))).erreurs.inserees).toBe(1);
    expect(await lib.groupingState(null)).toEqual({ available: false, active_apps: [] });
    const avant = await lib.listIssues(filtres(APP_FENETRE), SANS_FILTRE, { limit: 50, cursor: null });
    expect(avant.issues.map((e) => [e.kind, e.occurrences])).toEqual([["legacy", 1]]);
    expect(avant.coverage).toMatchObject({ available: false, issues: 0, legacy_groups: 1, occurrences_legacy: 1 });
    expect(await lib.resolveIssue("00000000-0000-4000-8000-000000000000", null)).toBeNull();

    await poolFenetre.query(readFileSync(join(SQL_DIR, "migration-v72.sql"), "utf8"));
    _resetColonnesCache();
    expect((await writeRows(poolFenetre, lot(APP_FENETRE, [{ navigateur: "firefox" }]))).erreurs.inserees).toBe(1);
    const rows = (await poolFenetre.query(
      "select grouping_key, issue_id from rum_error where app_id = $1 order by id", [APP_FENETRE],
    )).rows;
    expect(rows[0]).toEqual({ grouping_key: null, issue_id: null });
    expect(rows[1].grouping_key).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[1].issue_id).toBeNull();
    expect(await lib.groupingState(null)).toEqual({ available: true, active_apps: [] });
  });
});
