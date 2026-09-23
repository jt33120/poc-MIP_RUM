import { Pool, type PoolClient } from "pg";
import { optionsSsl } from "ingest/lib/serveur.mjs";
import { recordDbSpan } from "./server-trace-core";

// pool unique survivant au hot-reload de next dev
const globalForPg = globalThis as unknown as { pgPool?: Pool };

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5433/mip_rum";

// La décision TLS vient du noyau (`ingest/lib/serveur.mjs`), partagée avec les
// services backend. Elle vivait ici en double, et les deux copies avaient déjà
// divergé sur un cas réel : un hôte de docker-compose (`db`, sans point) n'est
// pas `localhost` mais n'a pas de TLS non plus — la copie du noyau exigeait
// alors un chiffrement que le serveur ne sait pas faire.

/**
 * Cible de connexion, SANS le mot de passe — pour les logs.
 *
 * Pourquoi ça existe : une erreur TLS du pilote pg (« self-signed certificate
 * in certificate chain ») ne dit pas VERS QUEL HÔTE la connexion a échoué. Pendant
 * la bascule Supabase → Neon, ce message seul ne permettait pas de distinguer
 * « DATABASE_URL pointe encore l'ancien pooler » de « le certificat de la
 * nouvelle base n'est pas approuvé » — deux causes, deux corrections opposées.
 * Le host résout l'ambiguïté immédiatement.
 */
function describeTarget(cs: string): Record<string, string> {
  try {
    const u = new URL(cs);
    return {
      host: u.host, // hostname:port — jamais de mot de passe
      database: u.pathname.replace(/^\//, "") || "(défaut)",
      user: u.username || "(défaut)",
    };
  } catch {
    // chaîne non parsable : on ne bloque pas le démarrage pour un log, et on ne
    // renvoie SURTOUT pas la chaîne brute (elle contient le mot de passe).
    return { host: "(chaîne de connexion non parsable)" };
  }
}

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString,
    // Pool par instance (serverless). Réglable via PGPOOL_MAX ; défaut 10 (un
    // /rum/summary prend jusqu'à 4 connexions en parallèle — 5 saturait sous
    // multi-onglets / auto-refresh). Sûr de monter ce plafond derrière un pooler
    // en mode transaction (Neon comme Supabase).
    max: Number(process.env.PGPOOL_MAX ?? 10),
    ssl: optionsSsl(connectionString),
    // QUI EST CONNECTÉ, LISIBLE DANS `pg_stat_activity`. La console, le scheduler
    // et un poste de dev se connectent tous en `neondb_owner` : sans nom
    // d'application, leurs connexions sont indiscernables. Un rôle de login dédié
    // aurait réglé la question, mais il est impossible à droits égaux sur Neon
    // (PG 17 interdit au propriétaire d'accorder son propre rôle ; un rôle créé
    // par l'API n'exécute aucune des 21 fonctions réservées, dont `rate_check`
    // et `slo_status`) — répété le 23/09/2026 sur une branche Neon. Le nom
    // traverse le pooler : vérifié par `current_setting('application_name')`.
    application_name: "mip-console-vercel",
  });

if (!globalForPg.pgPool) {
  // Une seule ligne par instance (le pool est mémoïsé) : de quoi lire dans les
  // logs SUR QUOI la console est réellement branchée, sans avoir à deviner.
  console.log(
    JSON.stringify({
      level: "info",
      service: "db",
      msg: "pool configuré",
      ...describeTarget(connectionString),
      tls: optionsSsl(connectionString) ? "vérifié (magasin CA système)" : "non imposé (hôte privé ou sslmode explicite)",
    }),
  );
  // Une erreur de connexion survenant hors requête (client inactif coupé par le
  // pooler, bascule réseau) est autrement silencieuse et fait tomber le process.
  pool.on("error", (err) => {
    console.error(
      JSON.stringify({
        level: "error",
        service: "db",
        msg: "erreur de pool (client inactif)",
        ...describeTarget(connectionString),
        err: String(err),
      }),
    );
  });
}
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
