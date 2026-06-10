// Teste la connexion pooler Supabase avec le rôle console_ro (TLS vérifié).
// Le secret reste dans apps/console/.env.production — jamais en argv.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(new URL("../apps/console/.env.production", import.meta.url), "utf8");
const url = new URL(env.match(/^DATABASE_URL=(.+)$/m)[1]);

const HOSTS = ["aws-0-eu-west-3.pooler.supabase.com", "aws-1-eu-west-3.pooler.supabase.com"];
const PORTS = [6543, 5432];

for (const host of HOSTS) {
  for (const port of PORTS) {
    const client = new pg.Client({
      host,
      port,
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      // vérification TLS complète contre la CA Supabase (certificat public épinglé)
      ssl: {
        ca: readFileSync(new URL("../apps/console/certs/supabase-ca.crt", import.meta.url), "utf8"),
      },
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      const r = await client.query("select count(*)::int n from rum_metric");
      console.log(`OK   ${host}:${port}  rum_metric=${r.rows[0].n}`);
      await client.end();
    } catch (err) {
      console.log(`FAIL ${host}:${port}  ${err.message}`);
      await client.end().catch(() => {});
    }
  }
}
