import { Pool, type PoolClient } from "pg";
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
    max: 5,
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
  const { rows } = await pool.query(text, params);
  return rows as T[];
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
