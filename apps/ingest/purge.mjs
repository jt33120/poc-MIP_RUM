// Purge de rétention — pendant LOCAL de pg_cron (revue R8). Appelle la fonction
// SQL purge_rum(retention_days) et journalise le détail des suppressions. Même
// patron que dispatch-alerts.mjs (logs structurés, --loop, arrêt propre).
// Usage : node apps/ingest/purge.mjs [--once|--loop]
//   RETENTION_DAYS (défaut 30) · PURGE_POLL_MS (défaut 24 h en --loop)
import pg from "pg";
import { createLogger } from "./supabase/functions/_shared/log.mjs";

const log = createLogger("purge");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const POLL_MS = Number(process.env.PURGE_POLL_MS || 24 * 60 * 60 * 1000);

/** Exécute une passe de purge. Retourne le détail {table: lignes supprimées}. */
export async function purgeOnce(pool, retentionDays = RETENTION_DAYS) {
  const { rows } = await pool.query("select purge_rum($1) as r", [retentionDays]);
  return rows[0].r;
}

// Exécution CLI uniquement (le module reste importable par les tests)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const loop = process.argv.includes("--loop");
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  let running = true;
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      log.info("stopping", { signal: sig });
      running = false;
    });
  }
  do {
    try {
      const detail = await purgeOnce(pool);
      log.info("purged", { retention_days: RETENTION_DAYS, detail });
    } catch (err) {
      log.error("purge failed", { err });
    }
    if (loop && running) await new Promise((r) => setTimeout(r, POLL_MS));
  } while (loop && running);
  await pool.end();
}
