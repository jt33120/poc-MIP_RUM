import { Pool } from "pg";
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
