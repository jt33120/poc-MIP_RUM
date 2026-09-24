// P5.4 — source maps automatisables et symbolication partagée, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve et qu'aucun test unitaire ne peut prouver :
//   • migration-v71 se rejoue, son déclencheur garde empreinte/taille/date justes
//     pour tout écrivain, ses contraintes, sa RLS et ses privilèges tiennent ;
//   • rétention et effacement emportent les jetons ;
//   • l'écriture est atomique : idempotence, 409 sans écriture partielle,
//     remplacement admin audité, concurrence, app A jamais écrite par B ;
//   • le backend direct POST /v1/sourcemaps n'accepte que le jeton dédié de l'app ;
//   • RECETTE CLI LOCALE : un bundle minifié réel (esbuild), exécuté pour produire
//     une vraie stack V8, uploadé par le CLI vers un vrai receveur ; l'erreur
//     ingérée avec la même release porte sa stack source ; mauvaise release et map
//     absente restent explicitement non résolues ; une map arrivée après l'erreur
//     améliore la console, l'API v1 et l'outil MCP sans changer l'empreinte.
// Seconde base, si fournie : la fenêtre de déploiement où le code P5.4 tourne sur
// un schéma antérieur à v71, puis la reprise dès v71 appliquée.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_PRE_V71_DATABASE_URL=<autre base jetable> pnpm test:sql
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildResourceSpans, msToHr } from "../../packages/rum-sdk/src/otlp-encode";
import { creerSymbolicateur } from "../../packages/backend/lib/error-symbolication.mjs";
import { _resetColonnesCache, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
import { creerReceveur } from "../../packages/backend/lib/receiver.mjs";
import {
  empreinteContenu,
  empreinteManifeste,
  enregistrerMaps,
  genererJetonUpload,
  lireRequeteUpload,
  verifierJetonUpload,
} from "../../packages/backend/lib/sourcemap-upload.mjs";
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";
import { effacerAudit } from "../fixtures/effacer-audit";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlPreV71 = process.env.SQL_TEST_PRE_V71_DATABASE_URL;
const RACINE = join(__dirname, "..", "..");
const SQL_DIR = join(RACINE, "packages", "db", "sql");
// esbuild est déjà une dépendance du SDK : aucun paquet ajouté pour la recette.
const esbuild = createRequire(join(RACINE, "packages", "rum-sdk", "package.json"))("esbuild");
const executerFichier = promisify(execFile);

const A = "p54-app-a";
const B = "p54-app-b";
const APPS = [A, B];
const RELEASE = "3.1.0";
const LECTURE = "p54-jeton-lecture";
const muet = { info() {}, warn() {}, error() {} };

const spanId = (n: number) => (0x54a1000000000000n + BigInt(n)).toString(16);

function migrations(maxVersion = Number.POSITIVE_INFINITY): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f) && version(f) <= maxVersion)
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(db: pg.Pool) {
  await effacerAudit(db, "action like 'sourcemap%' and detail like '%p54-app-%'");
  const tables = ["sourcemap_upload_token", "sourcemap", "rum_error", "rum_pageview", "rum_session"];
  for (const table of tables) {
    if ((await db.query("select to_regclass($1) is not null as present", [`public.${table}`])).rows[0].present) {
      await db.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
    }
  }
  await db.query("delete from app_registry where app_id = any($1::text[])", [APPS]);
}

async function enregistrerApps(db: pg.Pool) {
  await db.query(
    `insert into app_registry (app_id, name, active) select app, app, true from unnest($1::text[]) as app
     on conflict (app_id) do update set active = true`,
    [APPS],
  );
}

/** Jeton dédié inséré tel que la console le crée ; rend le secret en clair. */
async function jetonPour(db: pg.Pool, app: string, { expire = "30 days", cree = "0 days" } = {}) {
  const { id, jeton, empreinte } = genererJetonUpload();
  await db.query(
    `insert into sourcemap_upload_token (id, app_id, name, secret_hash, created_by, created_at, expires_at)
     values ($1, $2, 'CI recette', $3, 'p54@test', now() - $4::interval, now() - $4::interval + $5::interval)`,
    [id, app, empreinte, cree, expire],
  );
  return { id, jeton };
}

const carte = (source: string) =>
  JSON.stringify({ version: 3, sources: [`webpack:///./src/${source}`], names: ["f"], mappings: "AAAAA" });

// ───────────────────── Bundle réel, compilé et exécuté ─────────────────────

interface Recette {
  dossier: string;
  dist: string;
  bundle: string;
  map: string;
  stack: string;
}

let recette: Promise<Recette> | null = null;

/**
 * Compile une vraie app TypeScript avec esbuild (minifiée, map externe), exécute
 * le bundle sous l'URL qu'aurait un navigateur, et garde la stack V8 produite :
 * message et frames du bundle, comme les émettrait le SDK.
 */
function compilerRecette(): Promise<Recette> {
  recette ??= (async () => {
    const dossier = mkdtempSync(join(tmpdir(), "p54-recette-"));
    mkdirSync(join(dossier, "src"));
    writeFileSync(
      join(dossier, "src", "panier.ts"),
      [
        "export function validerPanier(panier: { lignes?: string[] }): number {",
        "  if (!panier.lignes) {",
        '    throw new TypeError("panier sans lignes");',
        "  }",
        "  return panier.lignes.length;",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      join(dossier, "src", "main.ts"),
      [
        'import { validerPanier } from "./panier";',
        "export function payer(): number {",
        "  return validerPanier({});",
        "}",
        "(globalThis as { payerP54?: () => number }).payerP54 = payer;",
      ].join("\n"),
    );
    await esbuild.build({
      absWorkingDir: dossier,
      entryPoints: ["src/main.ts"],
      bundle: true,
      minify: true,
      sourcemap: true,
      sourcesContent: true,
      format: "iife",
      target: "es2020",
      outdir: "dist/assets",
      entryNames: "[name]-[hash]",
      logLevel: "silent",
    });
    const assets = join(dossier, "dist", "assets");
    const bundle = readdirSync(assets).find((f) => f.endsWith(".js"))!;
    const code = readFileSync(join(assets, bundle), "utf8");
    const urlBundle = `https://app.exemple.fr/assets/${bundle}`;
    vm.runInThisContext(code, { filename: urlBundle });
    let brute = "";
    try {
      (globalThis as { payerP54?: () => number }).payerP54!();
    } catch (err) {
      brute = (err as Error).stack ?? "";
    }
    const stack = brute.split("\n").filter((ligne, i) => i === 0 || ligne.includes(urlBundle)).join("\n");
    return { dossier, dist: join(dossier, "dist"), bundle, map: readFileSync(join(assets, `${bundle}.map`), "utf8"), stack };
  })();
  return recette;
}

/** Lot OTLP réel du SDK web portant une exception, aplati comme aux deux ports. */
function lotErreur(app: string, release: string, stack: string, n: number) {
  const maintenant = msToHr(Date.now() - 1_000);
  return flattenOtlp(
    buildResourceSpans({ "service.name": "mip-rum-web", "mip.app_id": app, "mip.release": release }, [
      {
        name: "exception",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: spanId(n),
        startTime: maintenant,
        endTime: maintenant,
        attributes: {
          "mip.session_id": `p54-session-${n}`,
          "mip.error_kind": "error",
          "exception.type": "TypeError",
          "exception.message": "panier sans lignes",
          "exception.stacktrace": stack,
        },
      },
    ]),
  );
}

async function erreurEcrite(db: pg.Pool, n: number) {
  const { rows } = await db.query(
    `select id::float8 as id, app_id, release, stack, fingerprint, symbolication_status, stack_symbolicated
       from rum_error where span_id = $1`,
    [spanId(n)],
  );
  return rows[0];
}

/** Modules console branchés sur `databaseUrl` (pool, symbolicateur et registre de modules oubliés). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  delete (globalThis as { mipSymbolicateurLecture?: unknown }).mipSymbolicateurLecture;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const symbolication = await import("../../apps/console/lib/error-symbolication");
  const sourcemaps = await import("../../apps/console/lib/queries-sourcemap");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...symbolication, ...sourcemaps, pool };
}

/** Écoute un gestionnaire HTTP sur un port libre de la boucle locale. */
async function ecouter(handler: Parameters<typeof createServer>[1]): Promise<{ serveur: Server; base: string }> {
  const serveur = createServer(handler);
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  return { serveur, base: `http://127.0.0.1:${(serveur.address() as { port: number }).port}` };
}

async function poster(base: string, corps: unknown, entetes: Record<string, string> = {}) {
  const res = await fetch(`${base}/v1/sourcemaps`, {
    method: "POST",
    headers: { "content-type": "application/json", ...entetes },
    body: JSON.stringify(corps),
  });
  return { statut: res.status, corps: await res.json().catch(() => null) };
}

const compter = async (db: pg.Pool, app: string, release: string) =>
  Number((await db.query("select count(*)::int as n from sourcemap where app_id = $1 and release = $2", [app, release])).rows[0].n);

// ═════════════════════════════ Schéma courant ══════════════════════════════════

(url ? describe : describe.skip)("P5.4 source maps — PostgreSQL (schéma courant)", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 6 } : {});
  let lib: Awaited<ReturnType<typeof consoleSur>>;

  beforeAll(async () => {
    // Rejouées DEUX FOIS : un pre-deploy relancé après un échec partiel.
    for (let passe = 0; passe < 2; passe++) {
      for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    }
    await nettoyer(pool);
    await enregistrerApps(pool);
    _resetColonnesCache();
    process.env.CONSOLE_API_TOKENS = LECTURE;
    lib = await consoleSur(url!);
  }, 300_000);

  afterAll(async () => {
    await nettoyer(pool);
    await pool.end();
    await lib.pool.end();
    const r = await recette;
    if (r) rmSync(r.dossier, { recursive: true, force: true });
    delete process.env.CONSOLE_API_TOKENS;
  });

  it("migration-v71 : colonnes, déclencheur d'empreinte pour tout écrivain, contraintes", async () => {
    const colonnes = (await pool.query(
      `select table_name, column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and (table_name, column_name) in
          (('sourcemap','checksum'), ('sourcemap','uploaded_at'), ('sourcemap','uploaded_by'),
           ('rum_error','symbolication_status'), ('rum_error','stack_symbolicated'))
        order by 1, 2`,
    )).rows;
    expect(colonnes).toEqual([
      { table_name: "rum_error", column_name: "stack_symbolicated", is_nullable: "YES" },
      { table_name: "rum_error", column_name: "symbolication_status", is_nullable: "YES" },
      { table_name: "sourcemap", column_name: "checksum", is_nullable: "NO" },
      { table_name: "sourcemap", column_name: "uploaded_at", is_nullable: "NO" },
      { table_name: "sourcemap", column_name: "uploaded_by", is_nullable: "YES" },
    ]);
    expect((await pool.query(
      "select convalidated from pg_constraint where conname = 'rum_error_symbolication_v71'",
    )).rows).toEqual([{ convalidated: false }]);

    // L'ancien upsert de la console (avant P5.4) : ni empreinte ni date fournies.
    const contenu = JSON.stringify({ version: 3, sources: ["src/é.ts"], names: [], mappings: "AAAA" });
    const upsert = `insert into sourcemap (app_id, release, filename, content, size_bytes) values ($1, 'legacy', 'x.js', $2, 0)
      on conflict (app_id, release, filename) do update set content = excluded.content, size_bytes = excluded.size_bytes, created_at = now()`;
    await pool.query(upsert, [A, contenu]);
    const ligne = async () => (await pool.query(
      "select checksum, size_bytes, uploaded_at from sourcemap where app_id = $1 and release = 'legacy'",
      [A],
    )).rows[0];
    const initiale = await ligne();
    expect(initiale).toMatchObject({ checksum: empreinteContenu(contenu), size_bytes: Buffer.byteLength(contenu) });
    // Une mise à jour qui ne change pas le contenu ne peut pas désaccorder l'empreinte.
    await pool.query(
      "update sourcemap set checksum = repeat('0', 64), size_bytes = 1, uploaded_at = '2000-01-01' where app_id = $1 and release = 'legacy'",
      [A],
    );
    expect(await ligne()).toEqual(initiale);
    const autre = contenu.replace("é", "è");
    await pool.query(upsert, [A, autre]);
    expect((await ligne()).checksum).toBe(empreinteContenu(autre));

    const refus = async (sql: string, params: unknown[]) =>
      expect(pool.query(sql, params)).rejects.toMatchObject({ code: expect.stringMatching(/^23(514|503)$/) });
    await refus("insert into rum_error (app_id, span_id, symbolication_status) values ($1, $2, 'bogus')", [A, spanId(900)]);
    await refus(
      "insert into rum_error (app_id, span_id, symbolication_status, stack_symbolicated) values ($1, $2, 'unavailable', 'x')",
      [A, spanId(901)],
    );
    await refus(
      "insert into rum_error (app_id, span_id, symbolication_status, stack_symbolicated) values ($1, $2, 'resolved', repeat('x', 8001))",
      [A, spanId(902)],
    );
    const { empreinte } = genererJetonUpload();
    const jeton = `insert into sourcemap_upload_token (id, app_id, name, secret_hash, created_by, expires_at, scope, revoked_at)
      values (gen_random_uuid(), $1, $2, $3, 'p54@test', now() + $4::interval, $5, $6)`;
    await refus(jeton, [A, "CI", empreinte, "91 days", "sourcemaps:write", null]);
    await refus(jeton, [A, "CI", empreinte, "1 day", "errors:read", null]);
    await refus(jeton, [A, "CI", empreinte, "1 day", "sourcemaps:write", new Date()]);
    await refus(jeton, [A, `CI${String.fromCharCode(10)}`, empreinte, "1 day", "sourcemaps:write", null]);
    await refus(jeton, [A, "CI", "pas-un-hash", "1 day", "sourcemaps:write", null]);
    await refus(jeton, ["p54-app-inconnue", "CI", empreinte, "1 day", "sourcemaps:write", null]);
    await pool.query("delete from sourcemap where app_id = $1", [A]);
  });

  it("RLS et privilèges : console_ro lit sa portée, crée et révoque, ne supprime ni ne réécrit un hash", async () => {
    const a = await jetonPour(pool, A);
    const b = await jetonPour(pool, B);
    const priv = (await pool.query(
      `select has_table_privilege('console_ro', 'sourcemap_upload_token', 'SELECT') as lire,
              has_table_privilege('console_ro', 'sourcemap_upload_token', 'INSERT') as creer,
              has_table_privilege('console_ro', 'sourcemap_upload_token', 'DELETE') as supprimer,
              has_column_privilege('console_ro', 'sourcemap_upload_token', 'revoked_at', 'UPDATE') as revoquer,
              has_column_privilege('console_ro', 'sourcemap_upload_token', 'secret_hash', 'UPDATE') as rehacher,
              has_column_privilege('console_ro', 'sourcemap_upload_token', 'app_id', 'UPDATE') as deplacer`,
    )).rows[0];
    expect(priv).toEqual({ lire: true, creer: true, supprimer: false, revoquer: true, rehacher: false, deplacer: false });

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role console_ro");
      await client.query("select set_config('app.current_app_id', $1, true)", [A]);
      const vus = (await client.query("select id::text as id from sourcemap_upload_token where app_id = any($1::text[])", [APPS])).rows;
      expect(vus).toEqual([{ id: a.id }]);
      await client.query("select set_config('app.current_app_id', '', true)");
      expect((await client.query("select count(*)::int as n from sourcemap_upload_token")).rows[0].n).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect(b.id).not.toBe(a.id);
    await pool.query("delete from sourcemap_upload_token where app_id = any($1::text[])", [APPS]);
  });

  it("rétention : un jeton mort avant la coupure est purgé, un actif ou récemment révoqué reste ; effacement : l'app seule", async () => {
    const actif = await jetonPour(pool, A);
    const expire = await jetonPour(pool, A, { cree: "60 days", expire: "50 days" });
    const revoque = await jetonPour(pool, A, { cree: "5 days" });
    await pool.query("update sourcemap_upload_token set revoked_at = now() - interval '4 days', revoked_by = 'p54@test' where id = $1", [revoque.id]);
    const deB = await jetonPour(pool, B);
    await pool.query("insert into sourcemap (app_id, release, filename, content) values ($1, '1', 'a.js', $2), ($3, '1', 'a.js', $2)", [A, carte("a.ts"), B]);

    const purge = (await pool.query("select purge_rum_app($1, now() - interval '7 days') as r", [A])).rows[0].r;
    expect(purge.sourcemap_upload_token).toBe(1);
    const restants = (await pool.query("select id::text as id from sourcemap_upload_token where app_id = $1 order by created_at", [A])).rows;
    expect(restants.map((r) => r.id).sort()).toEqual([actif.id, revoque.id].sort());
    expect(restants.map((r) => r.id)).not.toContain(expire.id);

    const effacement = (await pool.query("select erase_app_data($1) as r", [A])).rows[0].r;
    expect(effacement).toMatchObject({ sourcemap: 1, sourcemap_upload_token: 2 });
    expect(await compter(pool, B, "1")).toBe(1);
    expect((await pool.query("select id::text as id from sourcemap_upload_token where app_id = $1", [B])).rows).toEqual([{ id: deB.id }]);
    await enregistrerApps(pool);
    await pool.query("delete from sourcemap where app_id = any($1::text[])", [APPS]);
    await pool.query("delete from sourcemap_upload_token where app_id = any($1::text[])", [APPS]);
  });

  it("écriture atomique : idempotente, 409 sans écriture partielle, remplacement admin audité, A ne touche jamais B", async () => {
    const demande = (maps: Array<[string, string]>, extra: Record<string, unknown> = {}) =>
      lireRequeteUpload(Buffer.from(JSON.stringify({ appId: A, release: "1.0", maps: maps.map(([filename, content]) => ({ filename, content })), ...extra })));

    const premiere = await enregistrerMaps(pool, { ...demande([["m1.js", carte("un.ts")], ["m2.js", carte("deux.ts")]]), par: "admin@p54" });
    expect(premiere.statut).toBe(200);
    expect(premiere.corps).toMatchObject({ uploaded: 2, created: 2, unchanged: 0, replaced: 0 });
    const lignes = (await pool.query("select filename, checksum, uploaded_at from sourcemap where app_id = $1 and release = '1.0' order by filename", [A])).rows;
    expect(lignes.map((l) => l.checksum)).toEqual([empreinteContenu(carte("un.ts")), empreinteContenu(carte("deux.ts"))]);
    expect((premiere.corps.release as { fingerprint: string }).fingerprint).toBe(empreinteManifeste(lignes));

    const rejeu = await enregistrerMaps(pool, { ...demande([["m1.js", carte("un.ts")], ["m2.js", carte("deux.ts")]]), par: "admin@p54" });
    expect(rejeu.corps).toMatchObject({ created: 0, unchanged: 2 });
    const apres = (await pool.query("select uploaded_at from sourcemap where app_id = $1 and release = '1.0' order by filename", [A])).rows;
    expect(apres).toEqual(lignes.map((l) => ({ uploaded_at: l.uploaded_at })));
    expect(await compter(pool, B, "1.0")).toBe(0);

    // Une nouvelle map + une map existante modifiée : RIEN n'est écrit.
    const conflit = await enregistrerMaps(pool, { ...demande([["m3.js", carte("trois.ts")], ["m1.js", carte("autre.ts")]]), par: "admin@p54" });
    expect(conflit.statut).toBe(409);
    expect(conflit.corps.conflicts).toEqual([
      { filename: "m1.js", existing_checksum: empreinteContenu(carte("un.ts")), received_checksum: empreinteContenu(carte("autre.ts")) },
    ]);
    expect(await compter(pool, A, "1.0")).toBe(2);

    const remplacement = await enregistrerMaps(pool, {
      ...demande([["m3.js", carte("trois.ts")], ["m1.js", carte("autre.ts")]], { replace: true }),
      par: "admin@p54",
    });
    expect(remplacement.corps).toMatchObject({ created: 1, replaced: 1 });
    const audit = (await pool.query("select user_email, detail from audit_log where action = 'sourcemap_replace' and detail like $1", [`%${A}%`])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].user_email).toBe("admin@p54");
    expect(JSON.parse(audit[0].detail)).toEqual({
      app_id: A, release: "1.0", filename: "m1.js", avant: empreinteContenu(carte("un.ts")), apres: empreinteContenu(carte("autre.ts")),
    });

    expect((await enregistrerMaps(pool, { ...demande([["x.js", carte("x.ts")]]), appId: "p54-app-inconnue", par: "admin@p54" })).statut).toBe(404);

    // Deux uploads concurrents d'un même nouveau fichier, contenus différents : un seul gagne.
    const statuts = await Promise.all(
      ["gauche.ts", "droite.ts"].map((s) => enregistrerMaps(pool, { ...demande([["course.js", carte(s)]]), par: "admin@p54" })),
    );
    expect(statuts.map((s) => s.statut).sort()).toEqual([200, 409]);
    await pool.query("delete from sourcemap where app_id = $1", [A]);
  });

  it("console : jeton créé et révoqué avec audit, secret vérifiable une fois, manifeste d'une release", async () => {
    const tokens = await import("../../apps/console/lib/queries-sourcemap-tokens");
    expect(await tokens.createSourcemapToken({ appId: "p54-app-inconnue", name: "CI", expiresInDays: 30 }, "admin@p54")).toBeNull();

    const cree = await tokens.createSourcemapToken({ appId: A, name: "CI recette", expiresInDays: 90 }, "admin@p54");
    expect(cree?.secret).toMatch(/^msu_[0-9a-f]{32}_[0-9a-f]{64}$/);
    expect(cree?.token).toMatchObject({ name: "CI recette", appId: A, revokedAt: null, lastUsedAt: null });
    const duree = cree!.token.expiresAt.getTime() - cree!.token.createdAt.getTime();
    expect(duree).toBe(90 * 24 * 3600 * 1000);
    expect(await verifierJetonUpload(pool, `Bearer ${cree!.secret}`)).toEqual({ id: cree!.token.id, app_id: A });
    // La base ne garde que le hash : le secret n'apparaît nulle part.
    const stocke = (await pool.query("select to_jsonb(t)::text as ligne from sourcemap_upload_token t where id = $1", [cree!.token.id])).rows[0].ligne;
    expect(stocke).not.toContain(cree!.secret.slice(-64));

    const liste = await tokens.listSourcemapTokens(A);
    expect(liste.map((t) => t.id)).toEqual([cree!.token.id]);
    expect(Object.keys(liste[0]).sort()).toEqual(["appId", "createdAt", "expiresAt", "id", "lastUsedAt", "name", "revokedAt"]);

    const revoque = await tokens.revokeSourcemapToken(cree!.token.id, "admin@p54");
    expect(revoque?.revokedAt).toBeInstanceOf(Date);
    expect((await tokens.revokeSourcemapToken(cree!.token.id, "admin@p54"))?.revokedAt).toEqual(revoque?.revokedAt);
    expect(await tokens.revokeSourcemapToken("11111111-1111-1111-1111-111111111111", "admin@p54")).toBeNull();
    expect(await tokens.revokeSourcemapToken("pas-un-uuid", "admin@p54")).toBeNull();
    expect(await verifierJetonUpload(pool, `Bearer ${cree!.secret}`)).toBeNull();
    const audit = (await pool.query(
      "select action from audit_log where action like 'sourcemap_token_%' and detail like $1 order by id",
      [`%${cree!.token.id}%`],
    )).rows;
    expect(audit).toEqual([{ action: "sourcemap_token_create" }, { action: "sourcemap_token_revoke" }]);

    const demande = lireRequeteUpload(Buffer.from(JSON.stringify({
      appId: A, release: "7.0", maps: [{ filename: "b.js", content: carte("b.ts") }, { filename: "a.js", content: carte("a.ts") }],
    })));
    await enregistrerMaps(pool, { ...demande, par: "admin@p54" });
    await pool.query("insert into sourcemap (app_id, release, filename, content) values ($1, '6.0', 'ancienne.js', $2)", [A, carte("x.ts")]);
    const releases = await lib.listSourcemapReleases(A);
    expect(releases.map((r) => [r.release, r.files])).toEqual([["6.0", 1], ["7.0", 2]]);
    const manifeste = await lib.releaseManifest(A, "7.0");
    expect(manifeste.files.map((f) => [f.filename, f.status, f.uploaded_by])).toEqual([
      ["a.js", "ok", "admin@p54"],
      ["b.js", "ok", "admin@p54"],
    ]);
    expect(manifeste.fingerprint).toBe(empreinteManifeste(demande.maps));
    expect(manifeste.size_bytes).toBe(demande.maps.reduce((n, m) => n + m.octets, 0));
    expect((await lib.releaseManifest(A, "6.0")).files[0].status).toBe("legacy");
    await pool.query("delete from sourcemap where app_id = $1", [A]);
    await pool.query("delete from sourcemap_upload_token where app_id = $1", [A]);
  });

  it("backend direct POST /v1/sourcemaps : jeton dédié de l'app seulement, liste atomique, bornes", async () => {
    const { serveur, base } = await ecouter(creerReceveur(pool, { log: muet }).handler);
    try {
      const actif = await jetonPour(pool, A);
      const expire = await jetonPour(pool, A, { cree: "2 days", expire: "1 day" });
      const corps = { appId: A, release: "2.0", maps: [{ filename: "a.js", content: carte("a.ts") }] };
      const bearer = (j: string) => ({ authorization: `Bearer ${j}` });

      expect((await poster(base, corps)).statut).toBe(401);
      expect((await poster(base, corps, bearer(LECTURE))).statut).toBe(401);
      expect((await poster(base, corps, bearer(expire.jeton))).statut).toBe(401);
      expect((await poster(base, { ...corps, appId: B }, bearer(actif.jeton))).statut).toBe(403);
      expect((await poster(base, { ...corps, replace: true }, bearer(actif.jeton))).statut).toBe(403);

      const casse = await poster(
        base,
        { ...corps, maps: [...corps.maps, { filename: "b.js", content: carte("b.ts") }, { filename: "c.js", content: "{" }] },
        bearer(actif.jeton),
      );
      expect(casse).toMatchObject({ statut: 400, corps: { error: "source map invalide (c.js) : JSON illisible" } });
      expect(await compter(pool, A, "2.0")).toBe(0);

      // Taille annoncée au-delà de 20 Mio : refus avant toute lecture du corps.
      const annonce = await new Promise<number>((ok, ko) => {
        const req = request(`${base}/v1/sourcemaps`, {
          method: "POST",
          headers: { ...bearer(actif.jeton), "content-type": "application/json", "content-length": String(21 * 1024 * 1024) },
        });
        req.on("response", (res) => {
          ok(res.statusCode ?? 0);
          req.destroy();
        });
        req.on("error", ko);
        req.flushHeaders();
      });
      expect(annonce).toBe(413);

      const ok = await poster(base, corps, bearer(actif.jeton));
      expect(ok).toMatchObject({ statut: 200, corps: { created: 1 } });
      expect((await pool.query("select uploaded_by from sourcemap where app_id = $1 and release = '2.0'", [A])).rows).toEqual([
        { uploaded_by: `jeton:${actif.id}` },
      ]);
      expect((await pool.query("select last_used_at is not null as utilise from sourcemap_upload_token where id = $1", [actif.id])).rows[0].utilise).toBe(true);

      await pool.query("update sourcemap_upload_token set revoked_at = now(), revoked_by = 'p54@test' where id = $1", [actif.id]);
      expect(await verifierJetonUpload(pool, `Bearer ${actif.jeton}`)).toBeNull();
      expect((await poster(base, corps, bearer(actif.jeton))).statut).toBe(401);
    } finally {
      await new Promise((ok) => serveur.close(ok));
      await pool.query("delete from sourcemap where app_id = any($1::text[])", [APPS]);
      await pool.query("delete from sourcemap_upload_token where app_id = any($1::text[])", [APPS]);
    }
  });

  it("recette CLI : bundle minifié réel → stack source ; mauvaise release et map absente non résolues ; A ≠ B", async () => {
    const r = await compilerRecette();
    expect(r.stack).toContain(`https://app.exemple.fr/assets/${r.bundle}:1:`);
    const { serveur, base } = await ecouter(creerReceveur(pool, { log: muet }).handler);
    const { jeton } = await jetonPour(pool, A);
    try {
      const { stdout } = await executerFichier(
        process.execPath,
        [join(RACINE, "scripts", "upload-sourcemaps.mjs"), "--app", A, "--release", RELEASE, "--dir", r.dist, "--url", `${base}/v1/sourcemaps`],
        { env: { PATH: process.env.PATH ?? "", MIP_SOURCEMAP_TOKEN: jeton } },
      );
      expect(stdout).toContain("upload complet");
      expect(stdout).toContain(`empreinte du manifeste : ${empreinteManifeste([{ filename: r.bundle, checksum: empreinteContenu(r.map) }])}`);
      expect(stdout).not.toContain(jeton);
    } finally {
      await new Promise((ok) => serveur.close(ok));
    }
    expect((await pool.query("select filename, checksum from sourcemap where app_id = $1 and release = $2", [A, RELEASE])).rows).toEqual([
      { filename: r.bundle, checksum: empreinteContenu(r.map) },
    ]);
    expect((await pool.query("select count(*)::int as n from sourcemap where app_id = $1", [B])).rows[0].n).toBe(0);

    const symbolicateur = creerSymbolicateur();
    const lot = lotErreur(A, RELEASE, r.stack, 1);
    await writeRows(pool, lot, { symbolicateur });
    const resolue = await erreurEcrite(pool, 1);
    expect(resolue.symbolication_status).toBe("resolved");
    expect(resolue.stack_symbolicated).toMatch(/\(src\/panier\.ts:3:\d+\)/);
    expect(resolue.stack_symbolicated).toMatch(/\(src\/main\.ts:3:\d+\)/);
    expect(resolue.stack_symbolicated).not.toContain(r.bundle);
    // La stack brute et l'empreinte restent celles de l'émission.
    expect(resolue.stack).toContain(r.bundle);
    expect(resolue.fingerprint).toBe(lot.errors[0].fingerprint);

    await writeRows(pool, lotErreur(A, "3.0.9", r.stack, 2), { symbolicateur });
    await writeRows(pool, lotErreur(A, RELEASE, r.stack.replaceAll(r.bundle, "vendor-4f2a9c1d.js"), 3), { symbolicateur });
    await writeRows(pool, lotErreur(B, RELEASE, r.stack, 4), { symbolicateur });
    for (const n of [2, 3, 4]) {
      expect(await erreurEcrite(pool, n)).toMatchObject({ symbolication_status: "unavailable", stack_symbolicated: null });
    }
    const [mauvaiseRelease] = await symbolicateur.symboliquerLot(pool, [{ app_id: A, release: "3.0.9", stack: r.stack }]);
    expect(mauvaiseRelease?.raison).toBe("aucune source map pour la release 3.0.9");
  });

  it("map mise en ligne après l'erreur : console, API v1 et MCP affichent la stack source, empreinte inchangée", async () => {
    const r = await compilerRecette();
    const RETARD = "3.2.0";
    await writeRows(pool, lotErreur(A, RETARD, r.stack, 5), { symbolicateur: creerSymbolicateur() });
    const avant = await erreurEcrite(pool, 5);
    expect(avant.symbolication_status).toBe("unavailable");

    const upload = lireRequeteUpload(Buffer.from(JSON.stringify({ appId: A, release: RETARD, maps: [{ filename: r.bundle, content: r.map }] })));
    expect((await enregistrerMaps(pool, { ...upload, par: "admin@p54" })).statut).toBe(200);

    const lecture = await lib.exemplarSymbolication(A, avant, { positions: true });
    expect(lecture).toMatchObject({ symbolication_status: "resolved", origin: "lecture" });
    expect(lecture?.stack_symbolicated).toMatch(/src\/panier\.ts:3:/);
    const contexte = await lib.adminCodeContext(A, RETARD, lecture!.positions[0]);
    expect(contexte?.lines.join("\n")).toContain('throw new TypeError("panier sans lignes")');

    // L'écriture historique n'est pas réécrite : seule la lecture s'améliore.
    expect(await erreurEcrite(pool, 5)).toMatchObject({ symbolication_status: "unavailable", fingerprint: avant.fingerprint });
    expect(avant.fingerprint).toBe((await erreurEcrite(pool, 1)).fingerprint);

    const { GET } = await import("../../apps/console/app/api/v1/errors/[fingerprint]/route");
    const appelApi = async (adresse: string, init?: { headers?: HeadersInit }) => {
      const cible = new URL(adresse);
      const brute = new Request(cible, { headers: init?.headers });
      const requete = Object.assign(brute, { nextUrl: cible, cookies: { get: () => undefined } });
      const fingerprint = decodeURIComponent(cible.pathname.split("/").pop()!);
      return GET(requete as never, { params: Promise.resolve({ fingerprint }) });
    };
    const reponse = await appelApi(
      `https://console.test/api/v1/errors/${encodeURIComponent(avant.fingerprint)}?app=${A}&period=24h`,
      { headers: { authorization: `Bearer ${LECTURE}` } },
    );
    expect(reponse.status).toBe(200);
    const { data } = await reponse.json();
    expect(data.group.fingerprint).toBe(avant.fingerprint);
    expect(data.last).toMatchObject({ release: RETARD, symbolication_status: "resolved" });
    expect(data.last.stack_symbolicated).toMatch(/src\/panier\.ts:3:/);
    expect(data.last.stack).toContain(r.bundle);
    expect(JSON.stringify(data)).not.toContain("throw new TypeError"); // aucun code source dans l'API

    const { executer } = await import("../../packages/mcp-tools/serveur.mjs");
    const { creerClient } = await import("../../packages/mcp-tools/lib/client.mjs");
    const { outilParNom } = await import("../../packages/mcp-tools/lib/catalogue.mjs");
    const client = creerClient({
      base: "https://console.test",
      jeton: LECTURE,
      fetchImpl: (adresse: string, init: { headers: Record<string, string> }) => appelApi(adresse, init),
    });
    const outil = await executer(outilParNom("mip_rum_get_error_group"), { app: A, fingerprint: avant.fingerprint, period: "24h" }, client);
    expect(outil.structure.data.last.stack_symbolicated).toMatch(/src\/panier\.ts:3:/);
    expect(outil.structure.data.last.symbolication_status).toBe("resolved");
  });
});

// ═══════════════════ Fenêtre de déploiement : schéma sans v71 ═══════════════════

(urlPreV71 ? describe : describe.skip)("P5.4 source maps — code publié avant migration-v71", () => {
  const pool = new pg.Pool(urlPreV71 ? { connectionString: urlPreV71, max: 4 } : {});
  const v71 = join(SQL_DIR, "migration-v71.sql");

  beforeAll(async () => {
    if ((await pool.query("select to_regclass('public.sourcemap_upload_token') is not null as v71")).rows[0].v71) {
      throw new Error("SQL_TEST_PRE_V71_DATABASE_URL porte déjà migration-v71 : fournir une base jetable neuve");
    }
    for (const file of migrations(70)) await pool.query(readFileSync(file, "utf8"));
    await nettoyer(pool);
    await enregistrerApps(pool);
    _resetColonnesCache();
  }, 300_000);

  let lib: Awaited<ReturnType<typeof consoleSur>> | undefined;

  afterAll(async () => {
    await nettoyer(pool);
    await pool.end();
    await lib?.pool.end();
    const r = await recette;
    if (r) rmSync(r.dossier, { recursive: true, force: true });
  });

  it("ingestion et lecture console continuent, l'upload répond 503", async () => {
    const r = await compilerRecette();
    // Map écrite par l'ancienne console, avant la migration.
    await pool.query("insert into sourcemap (app_id, release, filename, content, size_bytes) values ($1, $2, $3, $4, 0)", [
      A, RELEASE, r.bundle, r.map,
    ]);
    const symbolicateur = creerSymbolicateur();
    const lot = lotErreur(A, RELEASE, r.stack, 11);
    await writeRows(pool, lot, { symbolicateur });
    const ecrite = (await pool.query("select id::float8 as id, stack, release, fingerprint from rum_error where span_id = $1", [spanId(11)])).rows[0];
    expect(ecrite.fingerprint).toBe(lot.errors[0].fingerprint);
    expect(symbolicateur.etat()).toMatchObject({ entrees: 0, negatifs: 0 });

    const console_ = await consoleSur(urlPreV71!);
    lib = console_;
    expect(await console_.exemplarSymbolication(A, ecrite)).toMatchObject({ symbolication_status: "resolved", origin: "lecture" });
    await expect(console_.listSourcemapReleases(A)).rejects.toSatisfy((err: unknown) => console_.schemaSourcemapAbsent(err));

    const upload = lireRequeteUpload(Buffer.from(JSON.stringify({ appId: A, release: "4.0", maps: [{ filename: "a.js", content: carte("a.ts") }] })));
    await expect(enregistrerMaps(pool, { ...upload, par: "admin@p54" })).rejects.toMatchObject({ statut: 503 });
    await expect(verifierJetonUpload(pool, `Bearer ${genererJetonUpload().jeton}`)).rejects.toMatchObject({ statut: 503 });
  });

  it("dès v71 appliquée : empreinte de la map existante rattrapée, symbolication à l'écriture sans redémarrage", async () => {
    const r = await compilerRecette();
    await pool.query(readFileSync(v71, "utf8"));
    _resetColonnesCache();
    expect((await pool.query("select checksum, uploaded_at = created_at as date_reprise from sourcemap where app_id = $1", [A])).rows).toEqual([
      { checksum: empreinteContenu(r.map), date_reprise: true },
    ]);
    await writeRows(pool, lotErreur(A, RELEASE, r.stack, 12), { symbolicateur: creerSymbolicateur() });
    expect((await pool.query("select symbolication_status from rum_error where span_id = $1", [spanId(12)])).rows).toEqual([
      { symbolication_status: "resolved" },
    ]);
  });
});
