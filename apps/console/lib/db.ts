import { Pool, type PoolClient } from "pg";
import { recordDbSpan } from "./server-trace-core";
import { SUPABASE_CA } from "./supabase-ca";

// pool unique survivant au hot-reload de next dev
const globalForPg = globalThis as unknown as { pgPool?: Pool };

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5433/mip_rum";

const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString,
    // Pool par instance (serverless). Réglable via PGPOOL_MAX ; défaut 10 (un
    // /rum/summary prend jusqu'à 4 connexions en parallèle — 5 saturait sous
    // multi-onglets / auto-refresh). Derrière le pooler Supabase (mode
    // transaction), monter ce plafond est sûr.
    max: Number(process.env.PGPOOL_MAX ?? 10),
    // base cloud : TLS vérifié contre la CA Supabase épinglée
    ssl: connectionString.includes("supabase.com")
      ? { ca: SUPABASE_CA }
      : undefined,
  });
globalForPg.pgPool = pool;

export async function q<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  // dogfood : si une trace serveur est active (route enveloppée par
  // withServerTrace), on chronomètre la requête -> span DB. No-op sinon.
  const start = Date.now();
  try {
    const { rows } = await pool.query(text, params);
    return rows as T[];
  } finally {
    recordDbSpan(text, start, Date.now() - start);
  }
}

/**
 * Transaction atomique : begin → fn(client) → commit ; rollback sur erreur.
 * Le client est toujours rendu au pool. Utile pour les opérations multi-tables
 * qui doivent être tout-ou-rien (ex. effacement DSAR ordonné par les FK).
 */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
