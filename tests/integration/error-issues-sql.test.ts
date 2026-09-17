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
//     renotifié ; des statuts historiques divergents donnent `for_review` ; au-delà
//     de la borne d'historique d'un lot, l'issue naît `migration` et l'empreinte
//     est rattachée, avec son historique, par le lot suivant ;
//   • retour arrière : v2 désactivé sans perdre statuts ni URL, et la réactivation
//     retrouve les mêmes issues.
// Plus ce qui ne se lit que dans la base : contraintes, rétention, effacement, et
// la fenêtre de déploiement où le code précède migration-v72.
//
// P5.6 — workflow, régression et alerte par issue (migration-v73), plus bas :
//   • nouvelle issue notifiée une fois, dans sa transaction ; check_new_errors
//     garde son watermark pour l'historique et ignore les issues ;
//   • régression CONFIRMÉE seulement sur release postérieure vérifiée par marqueur,
//     « à vérifier » sinon ; apps A/B, double ingestion, écrivains concurrents,
//     commit tardif — par la primitive SQL et par l'écrivain réel ;
//   • triage (409, assigné dans le périmètre, référence de résolution), commentaires
//     et liens, historique paginé, note historique importée une fois ;
//   • pic issue:<uuid> : somme observée, bots/env/route, no_data, baseline exacte ;
//   • routage et livraison vers un stub HTTP local sous deux déclencheurs ;
//   • purge, effacement d'app, DSAR, et le code publié avant migration-v73.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_V68_DATABASE_URL=<autre base jetable> pnpm test:sql
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildResourceSpans, msToHr, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";
import type { ErrorFilters } from "../../apps/console/lib/queries-errors";
// @ts-expect-error module JS partagé sans déclarations
import { dispatchOnce } from "../../apps/ingest/dispatch-alerts.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { travaux } from "../../apps/ingest/jobs/planifie.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { importerNotesHistoriques } from "../../apps/ingest/lib/error-issue-workflow.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { deposerLot, drainerIngestRaw } from "../../apps/ingest/lib/ingest-differe.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { MAX_GROUPES_HISTORIQUES_PAR_LOT } from "../../apps/ingest/lib/error-grouping.mjs";
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
const APP_BORNE = "p55-borne";
const APPS = [APP, APP_B, APP_OMBRE, APP_BASCULE, APP_CARTES, APP_BORNE];
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
          where tablename in ('error_issue', 'error_issue_alias', 'error_grouping_config') order by tablename, policyname`,
      )).rows).toEqual([
        { tablename: "error_grouping_config", policyname: "tenant_scope", cmd: "SELECT", roles: "{console_ro}" },
        { tablename: "error_issue", policyname: "tenant_scope", cmd: "SELECT", roles: "{console_ro}" },
        // migration-v73 : les colonnes de triage s'écrivent dans la portée tenant.
        { tablename: "error_issue", policyname: "tenant_triage", cmd: "UPDATE", roles: "{console_ro}" },
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

    it("au-delà de la borne d'historique d'un lot : issue ambiguë `migration`, empreinte rattachée au lot suivant", async () => {
      await nettoyer(pool, [APP_BORNE]);
      const stack = "BorneError\n    at borne (https://boutique.test/src/borne.ts:1:1)";
      // Les chiffres d'un message sont normalisés par l'empreinte historique : des lettres la font varier.
      const erreur = (i: number, avantMs = 5_000): ErreurNavigateur => ({
        type: "BorneError", message: `échec ${String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26))}`, stack, cle: "lot.borne", avantMs,
      });
      const n = MAX_GROUPES_HISTORIQUES_PAR_LOT + 6;
      const tardiveIndex = MAX_GROUPES_HISTORIQUES_PAR_LOT + 2;
      await writeRows(pool, lot(APP_BORNE, [erreur(tardiveIndex, 3 * 86_400_000)]));
      const [{ fingerprint: tardive }] = await erreurs(pool, APP_BORNE);
      await pool.query(
        "insert into error_status (app_id, fingerprint, status, resolved_at) values ($1, $2, 'resolved', now() - interval '2 days')",
        [APP_BORNE, tardive],
      );
      await activer(pool, APP_BORNE);

      // Une clé déclarée, n empreintes historiques : les dernières dépassent la borne.
      await writeRows(pool, lot(APP_BORNE, Array.from({ length: n }, (_, i) => erreur(i))));
      const [issue] = await issues(pool, APP_BORNE);
      expect(await issues(pool, APP_BORNE)).toHaveLength(1);
      // Historique non lu pour six empreintes : jamais présentée comme un nouveau bug.
      expect(issue).toMatchObject({ origin: "migration", status: "open", status_source: "system", revision: "1" });
      const rattachees = (await alias(pool, APP_BORNE)).map((a) => a.legacy_fingerprint);
      expect(rattachees).toHaveLength(MAX_GROUPES_HISTORIQUES_PAR_LOT);
      expect(rattachees).not.toContain(tardive);
      expect((await erreurs(pool, APP_BORNE)).filter((r) => r.issue_id === issue.id)).toHaveLength(n);

      // Le lot suivant qui la porte la rattache : statut historique divergent et première vue.
      await writeRows(pool, lot(APP_BORNE, [erreur(tardiveIndex)]));
      const [apres] = await issues(pool, APP_BORNE);
      expect(apres).toMatchObject({ id: issue.id, status: "for_review", status_source: "migration", revision: "2" });
      const premiere = (await pool.query(
        "select min(ts) as ts from rum_error where app_id = $1 and fingerprint = $2", [APP_BORNE, tardive],
      )).rows[0].ts;
      expect(apres.first_seen).toEqual(premiere);
      expect((await alias(pool, APP_BORNE)).find((a) => a.legacy_fingerprint === tardive)).toMatchObject({ legacy_status: "resolved" });

      // Une occurrence de plus de la même empreinte : ni second alias, ni nouvelle révision.
      await writeRows(pool, lot(APP_BORNE, [erreur(tardiveIndex)]));
      expect(await alias(pool, APP_BORNE)).toHaveLength(MAX_GROUPES_HISTORIQUES_PAR_LOT + 1);
      expect(await issues(pool, APP_BORNE)).toEqual([expect.objectContaining({ id: issue.id, status: "for_review", revision: "2" })]);
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

// ═══════════════ P5.6 — workflow, régression et alerte par issue ═══════════════
// Un bloc : ses helpers et ses apps (p56-*) ne rencontrent pas ceux de P5.5, et
// ses suites ouvrent leurs propres pools — celles de P5.5 ferment les leurs.
{
  const A = "p56-app-a";
  const B = "p56-app-b";
  const APPS = [A, B];
  const ADMIN = "p56-admin@test.local";
  const VIEWER_A = "p56-viewer-a@test.local";
  const VIEWER_B = "p56-viewer-b@test.local";
  const INACTIF = "p56-inactif@test.local";
  const SANS_APP = "p56-sans-app@test.local";
  const muet = { info() {}, warn() {}, error() {} };

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

    it("v74 : une release démesurée ne fait plus échouer la création de l'issue ; la notification part sans elle", async () => {
      // Recopiée deux fois, 2 100 caractères dépassaient les 4 096 octets de la charge : tout le lot échouait.
      const longue = await creerIssue(pool, A, { lastRelease: "r".repeat(2100) });
      const [recue] = await notifications(pool, longue.id);
      expect(recue.payload.first_release).toBeNull();
      expect(recue.payload.text).not.toContain("release");
      // Court en caractères, long en octets : 60 × 4 octets.
      const emojis = await creerIssue(pool, A, { lastRelease: "\u{1F680}".repeat(60) });
      expect((await notifications(pool, emojis.id))[0].payload.first_release).toBeNull();
      const courte = await creerIssue(pool, A, { lastRelease: "2026.09.17-abc" });
      expect((await notifications(pool, courte.id))[0].payload).toMatchObject({ first_release: "2026.09.17-abc" });
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

    it("v74 : la ligne d'une issue sans notification `new`, née avant v73, suit le watermark historique", async () => {
      await pool.query("select check_new_errors()");
      const avantV73 = await creerIssue(pool, A);
      await pool.query("delete from error_issue_notification where issue_id = $1", [avantV73.id]);
      await pool.query(
        `insert into rum_error (span_id, app_id, message, fingerprint, ts, issue_id, grouping_version, grouping_key, grouping_basis)
         values ($1, $2, 'née avant v73', $3, now(), $4, 2, $5, 'normalized_frame')`,
        [spanId(), A, `p56-fp-avant-v73-${span}`, avantV73.id, avantV73.key],
      );
      // Ingérée entre le dernier passage horaire et la migration : personne d'autre ne la notifierait.
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

      it("v74 : une release ou une référence démesurée ne confirme rien et n'annule jamais le lot de l'écrivain", async () => {
        const longue = "9".repeat(250);
        await marqueur(pool, A, "1.0", "prod", "10 days");
        await marqueur(pool, A, longue, "prod", "1 day");
        await marqueur(pool, A, "2.0", "prod", "1 minute");
        const issue = await creerIssue(pool, A);
        await resoudre(pool, A, issue.id, "1.0", "prod");
        expect(await enregistrerOccurrences(pool, A, issue.id, await occurrence(pool, A, issue, { release: longue }))).toBe("reappearance");
        // Référence écrite avant v74, trop longue pour une activité : rien à comparer.
        const ancienne = await creerIssue(pool, A);
        await resoudre(pool, A, ancienne.id, longue, "prod");
        expect(await enregistrerOccurrences(pool, A, ancienne.id, await occurrence(pool, A, ancienne, { release: "2.0" }))).toBe("reappearance");
        expect((await pool.query("select status from error_issue where id = any($1::uuid[])", [[issue.id, ancienne.id]])).rows.map((r) => r.status))
          .toEqual(["resolved", "resolved"]);
        expect([...await activites(pool, issue.id), ...await activites(pool, ancienne.id)]).toEqual([]);
      });

      it("v74 : un alias posé sur l'issue par un lot n'interbloque plus la régression décidée par un autre", async () => {
        await marqueur(pool, A, "1.0", "prod", "10 days");
        await marqueur(pool, A, "1.1", "prod", "1 day");
        const x = await creerIssue(pool, A);
        const w = await creerIssue(pool, A);
        await resoudre(pool, A, x.id, "1.0", "prod");
        const [c1, c2] = [await pool.connect(), await pool.connect()];
        try {
          await c1.query("begin");
          await c2.query("begin");
          // Une attente de verrou échoue vite au lieu de bloquer la suite.
          await c2.query("set local lock_timeout = '2s'");
          // Lot 1 : alias sur X (verrou KEY SHARE de clé étrangère), puis mise à jour de W.
          await c1.query("insert into error_issue_alias (app_id, legacy_fingerprint, issue_id) values ($1, $2, $3)", [A, `p56-alias-${span}`, x.id]);
          // Lot 2 : W d'abord, puis la décision sur X — sans attendre le lot 1.
          await c2.query("update error_issue set last_seen = now() where id = $1", [w.id]);
          expect(await enregistrerOccurrences(c2, A, x.id, await occurrence(c2, A, x, { release: "1.1" }))).toBe("regression");
          const croise = c1.query("update error_issue set last_seen = now() where id = $1", [w.id]);
          await new Promise((r) => setTimeout(r, 100));
          await c2.query("commit");
          await croise;
          await c1.query("commit");
        } finally {
          await Promise.all([c1, c2].map((c) => c.query("rollback").catch(() => undefined)));
          c1.release();
          c2.release();
        }
        expect((await activites(pool, x.id)).map((a) => a.kind)).toEqual(["regression"]);
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

    it("par l'écrivain réel : nouvelle issue notifiée une fois, régression décidée dans le lot, rejeu et lots concurrents inertes", async () => {
      await pool.query("select error_grouping_activate($1, 'p56@test')", [A]);
      await marqueur(pool, A, "1.0.0", "prod", "10 days");
      await marqueur(pool, A, "1.1.0", "prod", "1 hour");
      // Lot du SDK web : même bug, release et env déclarés par l'émetteur.
      const lotEcrit = (release: string) => flattenOtlp(buildResourceSpans(
        { "service.name": "mip-rum-web", "mip.app_id": A, "mip.release": release, "deployment.environment.name": "prod" },
        [{
          name: "exception", traceId: randomBytes(16).toString("hex"), spanId: spanId(),
          startTime: msToHr(Date.now()), endTime: msToHr(Date.now()),
          attributes: {
            "mip.session_id": "p56-ecrivain", "mip.route": "/panier", "mip.error_kind": "error",
            "exception.type": "TypeError", "exception.message": "panier vide",
            "exception.stacktrace": "TypeError: panier vide\n    at payer (https://boutique.test/src/panier.ts:12:3)",
          },
        }],
      ));

      await pool.query("select check_new_errors()");
      await writeRows(pool, lotEcrit("1.0.0"));
      const [issue] = (await pool.query("select id::text as id, revision::text as revision from error_issue where app_id = $1", [A])).rows;
      expect((await notifications(pool, issue.id)).map((n) => n.kind)).toEqual(["new"]);
      // La ligne appartient à une issue : le watermark historique ne la notifie pas une seconde fois.
      await pool.query("select check_new_errors()");
      expect((await pool.query("select count(*)::int as n from alert_event where message like $1", [`%/ app ${A}%`])).rows[0].n).toBe(0);

      const resolu = await lib.triageIssue(
        { issueId: issue.id, apps: null, actorEmail: ADMIN },
        { app: A, status: "resolved", expectedRevision: issue.revision },
      );
      expect(resolu).toMatchObject({ kind: "ok", value: { resolved_release: "1.0.0", resolved_env: "prod" } });

      // Anciens clients encore en 1.0.0 : réapparition, pas régression ; le rejeu du lot n'écrit rien.
      const ancien = lotEcrit("1.0.0");
      expect((await writeRows(pool, ancien)).erreurs.inserees).toBe(1);
      expect((await writeRows(pool, ancien)).erreurs.inserees).toBe(0);
      expect((await pool.query("select status from error_issue where id = $1", [issue.id])).rows[0].status).toBe("resolved");

      // Deux lots de la release 1.1.0 en même temps : une activité, une notification.
      _resetColonnesCache();
      await Promise.all([writeRows(pool, lotEcrit("1.1.0")), writeRows(pool, lotEcrit("1.1.0"))]);
      expect((await pool.query("select status, status_source from error_issue where id = $1", [issue.id])).rows[0])
        .toEqual({ status: "open", status_source: "system" });
      expect((await activites(pool, issue.id)).map((a) => [a.kind, a.release, a.reference_release, a.env]))
        .toEqual([["status", "1.0.0", null, "prod"], ["regression", "1.1.0", "1.0.0", "prod"]]);
      expect((await notifications(pool, issue.id)).map((n) => n.kind)).toEqual(["new", "regression"]);
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

      it("résoudre malgré une release démesurée : référence sans release, jamais une erreur", async () => {
        const longue = "x".repeat(300);
        const issue = await creerIssue(pool, A, { lastRelease: longue });
        await occurrence(pool, A, issue, {
          ts: `(select last_seen from error_issue where id = '${issue.id}')`,
          release: longue,
          env: "prod",
        });
        const resolu = await lib.triageIssue(ctx(issue.id), { app: A, status: "resolved", expectedRevision: await revisionDe(issue.id) });
        expect(resolu).toMatchObject({ kind: "ok", value: { status: "resolved", resolved_release: null, resolved_env: "prod" } });
        expect((await activites(pool, issue.id)).map((a) => [a.kind, a.release, a.env])).toEqual([["status", null, "prod"]]);
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

      it("commentaires et liens : stockés tels que validés, doublon refusé sans conflit, historique paginé à la microseconde", async () => {
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
        expect(await lib.linkIssue(ctx(issue.id), { ...lien, expectedRevision: revision })).toEqual({ kind: "duplicate", error: "ce lien est déjà attaché à l'issue" });
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
          const lu = await lib.listIssueActivity(issue.id, [A], { limit: 2, cursor: curseur }, { emails: true });
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
        expect(await lib.listIssueActivity(issue.id, [B], { limit: 10, cursor: null }, { emails: true })).toEqual({ kind: "not_found" });

        const vue = await lib.issueWorkflowView(issue.id, A, { emails: true });
        expect(vue?.links.map((l) => l.url)).toEqual([lien.url]);
        expect(vue?.assignable_users.map((u) => u.email)).toEqual([ADMIN, VIEWER_A]);

        // Viewer, démo, jeton : mêmes lignes, sans aucune adresse de compte, ni liste d'assignables.
        const masquee = await lib.issueWorkflowView(issue.id, A, { emails: false });
        expect(masquee?.links.map((l) => l.created_by)).toEqual([{ user_id: expect.any(String), email: null }]);
        expect(masquee?.assignable_users).toEqual([]);
        const lue = await lib.listIssueActivity(issue.id, [A], { limit: 50, cursor: null }, { emails: false });
        expect(JSON.stringify(lue)).not.toContain(ADMIN);
        expect(lue).toMatchObject({ kind: "ok", value: { activities: expect.arrayContaining([expect.objectContaining({ kind: "link", actor: { kind: "user", user: { user_id: expect.any(String), email: null } } })]) } });
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
        // v74 — non suivie : aucune fenêtre comparable, jamais des zéros prêtés par la seule rétention.
        expect((await pool.query("select * from issue_metric_baseline($1, $2::uuid, null, null, 4, 15)", [A, issue.id])).rows[0])
          .toEqual({ med: null, mad: null, n: 0 });

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

      it("passe interrompue : une livraison déjà postée reste acquise, seule celle en cours repart", async () => {
        recepteur.recus.length = 0;
        const regle = (await pool.query(
          "insert into alert_rule (app_id, metric, threshold, webhook_url) values ($1, 'LCP', 1, $2) returning id",
          [A, `${recepteur.base}/regle`],
        )).rows[0].id;
        const evenement = (await pool.query("insert into alert_event (rule_id, value, message) values ($1, 3, 'LCP p56-app-a') returning id", [regle])).rows[0].id;
        const ids = (await pool.query(
          "insert into alert_delivery (alert_event_id, target) select $1, $2 || n from generate_series(1, 3) n returning id::text as id",
          [evenement, `${recepteur.base}/interrompue-`],
        )).rows.map((r) => r.id as string);
        // Panne au marquage de la deuxième livraison, après son POST : la passe s'arrête là.
        const panne = {
          query: pool.query.bind(pool),
          connect: async () => {
            const client = await pool.connect();
            return {
              query: (sql: string, params?: unknown[]) =>
                sql.startsWith("update alert_delivery") && params?.some((p) => String(p) === ids[1])
                  ? Promise.reject(new Error("connexion perdue"))
                  : client.query(sql, params),
              release: () => client.release(),
            };
          },
        };
        await expect(dispatchOnce(panne as unknown as pg.Pool)).rejects.toThrow(/connexion perdue/);
        await dispatchOnce(pool);
        const recus = recepteur.recus.map((r) => r.url).filter((u) => u.startsWith("/interrompue-"));
        // La première n'est jamais repostée ; la deuxième, en cours pendant la panne, l'est une fois.
        expect(recus).toEqual(["/interrompue-1", "/interrompue-2", "/interrompue-2", "/interrompue-3"]);
        expect((await pool.query("select status from alert_delivery where id = any($1::bigint[]) order by id", [ids])).rows.map((r) => r.status))
          .toEqual(["delivered", "delivered", "delivered"]);
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
        // Écrivain P5.5 d'une app activée, avant v73 : l'issue naît, sans outbox ni décision de régression.
        await poolFenetre.query("select error_grouping_activate($1, 'p56@test')", [A]);
        _resetColonnesCache();
        const lotEcrit = flattenOtlp(buildResourceSpans(
          { "service.name": "mip-rum-web", "mip.app_id": A, "mip.release": "1.0.0" },
          [{
            name: "exception", traceId: randomBytes(16).toString("hex"), spanId: spanId(),
            startTime: msToHr(Date.now()), endTime: msToHr(Date.now()),
            attributes: { "mip.session_id": "p56-fenetre", "exception.type": "TypeError", "exception.message": "avant v73" },
          }],
        ));
        expect((await writeRows(poolFenetre, lotEcrit)).erreurs.inserees).toBe(1);
        const [{ id: ecrite }] = (await poolFenetre.query("select id::text as id from error_issue where app_id = $1", [A])).rows;
        expect(ecrite).toMatch(/^[0-9a-f-]{36}$/);

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
}
