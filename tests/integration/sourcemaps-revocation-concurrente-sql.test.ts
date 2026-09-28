// P5.4 — un jeton de CI révoqué PENDANT un upload de source maps, sur un VRAI PostgreSQL.
//
// POURQUOI CE FICHIER (28/09/2026). L'E2E `tests/e2e/sourcemaps.spec.ts` a reçu 200
// au lieu de 401 pour un upload envoyé « après » la révocation d'un jeton. Le test
// était en cause : il envoyait l'upload PENDANT la révocation, et un upload qui
// prend la ligne du jeton avant elle passe — il la précède. Restait l'autre moitié
// de la preuve, celle qui dit que ce n'est pas une faille : dans ce créneau, aucun
// upload ne s'écrit une fois la révocation validée.
//
// Le port d'upload vérifie le jeton (`verifierJetonUpload`, lecture sans verrou),
// lit et valide le corps, puis écrit (`enregistrerMaps`) en REVÉRIFIANT le jeton
// dans sa transaction (`update … where revoked_at is null`). Une révocation qui
// tombe entre les deux est donc vue : validée avant l'écriture, ou en cours — et
// l'écriture attend alors la ligne du jeton, puis la relit révoquée.
//
// Aucune attente sur une durée : `pg_blocking_pids` dit quand l'écriture attend la
// révocation (la règle de `dsar-concurrency-sql.test.ts`).
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  enregistrerMaps,
  genererJetonUpload,
  lireRequeteUpload,
  verifierJetonUpload,
} from "../../packages/backend/lib/sourcemap-upload.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const APP = "p54-revocation-concurrente";
const CARTE = JSON.stringify({ version: 3, sources: ["webpack:///./src/panier.ts"], names: ["validerPanier"], mappings: "AAAAA" });
const DEMANDE = lireRequeteUpload(
  Buffer.from(JSON.stringify({ appId: APP, release: "9.0", maps: [{ filename: "main.js", content: CARTE }] })),
);
const REVOQUER = "update sourcemap_upload_token set revoked_at = now(), revoked_by = 'p54@test' where id = $1 and revoked_at is null";

async function nettoyer() {
  await pool.query("delete from sourcemap where app_id = $1", [APP]);
  await pool.query("delete from sourcemap_upload_token where app_id = $1", [APP]);
}

/** Un jeton actif, inséré tel que la console le crée. */
async function jetonActif() {
  const { id, jeton, empreinte } = genererJetonUpload();
  await pool.query(
    `insert into sourcemap_upload_token (id, app_id, name, secret_hash, created_by, expires_at)
     values ($1, $2, 'CI concurrente', $3, 'p54@test', now() + interval '1 day')`,
    [id, APP, empreinte],
  );
  return { id, authorization: `Bearer ${jeton}` };
}

/** L'écriture de l'upload, comme le port la lance une fois le jeton vérifié. */
const ecrire = (jetonId: string) => enregistrerMaps(pool, { ...DEMANDE, par: `jeton:${jetonId}`, jetonId });

const mapsEcrites = async () =>
  Number((await pool.query("select count(*)::int as n from sourcemap where app_id = $1", [APP])).rows[0].n);

/** Attente sur CONDITION : une connexion attend-elle la transaction de `pid` ? PostgreSQL le dit. */
async function attendreQuOnLAttende(pid: number, limiteMs = 15_000): Promise<void> {
  const fin = Date.now() + limiteMs;
  for (;;) {
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
      [pid],
    );
    if (rows[0].n > 0) return;
    if (Date.now() > fin) throw new Error(`aucune connexion n'attend la transaction de ${pid}`);
    await new Promise((ok) => setTimeout(ok, 5));
  }
}

/**
 * La révocation tient la ligne du jeton sans être validée ; l'écriture de l'upload
 * part et l'attend ; puis la révocation se conclut par `issue`.
 */
async function ecrirePendantLaRevocation(jetonId: string, issue: "commit" | "rollback") {
  const revocation = await pool.connect();
  try {
    await revocation.query("begin");
    const { rows } = await revocation.query<{ pid: number }>("select pg_backend_pid() as pid");
    expect((await revocation.query(REVOQUER, [jetonId])).rowCount).toBe(1);
    const ecriture = ecrire(jetonId);
    await attendreQuOnLAttende(rows[0].pid);
    await revocation.query(issue);
    return await ecriture;
  } finally {
    revocation.release();
  }
}

beforeAll(async () => {
  if (!url) return;
  const fichiers = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  await pool.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
  for (const f of fichiers) await pool.query(readFileSync(join(SQL_DIR, f), "utf8"));
  await pool.query(
    "insert into app_registry (app_id, name, active) values ($1, $1, true) on conflict (app_id) do update set active = true",
    [APP],
  );
}, 300_000);

beforeEach(async () => {
  if (url) await nettoyer();
});

afterAll(async () => {
  if (!url) return;
  await nettoyer();
  await pool.query("delete from app_registry where app_id = $1", [APP]);
  await pool.end();
});

suite("P5.4 — un jeton de CI révoqué pendant un upload", () => {
  it("révocation validée entre la vérification et l'écriture : 401, aucune map écrite", async () => {
    const jeton = await jetonActif();
    expect(await verifierJetonUpload(pool, jeton.authorization)).toEqual({ id: jeton.id, app_id: APP });
    await pool.query(REVOQUER, [jeton.id]);
    expect(await ecrire(jeton.id)).toMatchObject({ statut: 401 });
    expect(await mapsEcrites()).toBe(0);
    expect(await verifierJetonUpload(pool, jeton.authorization)).toBeNull();
  });

  it("révocation EN COURS : l'écriture attend la ligne du jeton, la relit révoquée au commit — 401, aucune map écrite", async () => {
    const jeton = await jetonActif();
    expect(await verifierJetonUpload(pool, jeton.authorization)).not.toBeNull();
    expect(await ecrirePendantLaRevocation(jeton.id, "commit")).toMatchObject({ statut: 401 });
    expect(await mapsEcrites()).toBe(0);
  }, 20_000);

  // Témoin : le même créneau avec une révocation ANNULÉE écrit. Le 401 ci-dessus
  // vient donc de la révocation validée, pas de l'attente du verrou.
  it("témoin — révocation annulée : l'écriture qui l'attendait passe", async () => {
    const jeton = await jetonActif();
    expect(await ecrirePendantLaRevocation(jeton.id, "rollback")).toMatchObject({ statut: 200, corps: { created: 1 } });
    expect(await mapsEcrites()).toBe(1);
  }, 20_000);
});
