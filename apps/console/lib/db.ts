import { Pool, type PoolClient } from "pg";
import { recordDbSpan } from "./server-trace-core";

// pool unique survivant au hot-reload de next dev
const globalForPg = globalThis as unknown as { pgPool?: Pool };

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5433/mip_rum";

// local Postgres (docker-compose) n'a pas de TLS ; toute base distante (Neon,
// et avant elle Supabase) en exige un vérifié contre le magasin CA système —
// le certificat Neon chaîne à une autorité publique, plus besoin d'épingler
// de CA propriétaire comme avec le pooler Supabase.
const isLocal = /:\/\/[^/]*(localhost|127\.0\.0\.1)([:/]|$)/.test(connectionString);

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString,
    // Pool par instance (serverless). Réglable via PGPOOL_MAX ; défaut 10 (un
    // /rum/summary prend jusqu'à 4 connexions en parallèle — 5 saturait sous
    // multi-onglets / auto-refresh). Sûr de monter ce plafond derrière un pooler
    // en mode transaction (Neon comme Supabase).
    max: Number(process.env.PGPOOL_MAX ?? 10),
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
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
 * Exécute `fn` avec la portée tenant posée en base, de sorte que les policies
 * RLS `tenant_scope` (migration-v47) filtrent les lignes même si une requête
 * oublie son `WHERE app_id = …`.
 *
 * Pourquoi une transaction. La GUC est posée avec `set_local`, dont la portée est
 * la transaction courante. C'est une exigence de correction, pas un détail : le
 * pool `pg` réutilise les connexions entre requêtes HTTP concurrentes, donc un
 * `set` non-local fuirait la portée d'un tenant vers la requête suivante — le
 * défaut d'isolation exact que ce mécanisme est censé fermer.
 *
 * Passer par `client.query` et non par `q()` : le client doit être celui de la
 * transaction qui porte la GUC.
 *
 * Sans effet tant que la console se connecte avec un rôle `BYPASSRLS` : la GUC
 * est posée, mais les policies ne s'appliquent pas. Cf. l'en-tête de v47.
 */
export async function withTenant<T>(
  appIds: string | string[],
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const scope = (Array.isArray(appIds) ? appIds : [appIds]).filter(Boolean);
  if (scope.length === 0) {
    // Une portée vide rendrait toute la session aveugle : c'est presque toujours
    // un bug d'appelant, et le dire tôt vaut mieux qu'un écran vide inexpliqué.
    throw new Error("withTenant: portée tenant vide");
  }
  // La virgule sépare les app_id côté SQL (string_to_array) : un app_id qui en
  // contiendrait une casserait le découpage et élargirait la portée.
  const bad = scope.find((id) => id.includes(","));
  if (bad) throw new Error(`withTenant: app_id invalide (virgule) : ${bad}`);

  return tx(async (client) => {
    await client.query("select set_config('app.current_app_id', $1, true)", [
      scope.join(","),
    ]);
    return fn(client);
  });
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
