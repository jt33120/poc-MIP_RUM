// Seed admin console v0.3 (B3) : crée/replace 'julian@mip-rum.local' (role admin,
// toutes apps) avec un mot de passe aléatoire AFFICHÉ une seule fois en sortie.
// Idempotent : upsert, le mot de passe est régénéré à chaque exécution.
// bcryptjs est résolu depuis le workspace console (dépendance épinglée 3.0.3).
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";

const requireConsole = createRequire(new URL("../apps/console/package.json", import.meta.url));
const bcryptMod = requireConsole("bcryptjs");
const bcrypt = bcryptMod.hashSync ? bcryptMod : bcryptMod.default;

const EMAIL = "julian@mip-rum.local";
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

const password = randomBytes(16).toString("base64url").slice(0, 18);
const hash = bcrypt.hashSync(password, 10);

await pool.query(
  `insert into console_user (email, password_hash, role, apps, active)
   values ($1, $2, 'admin', null, true)
   on conflict (email) do update
     set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
  [EMAIL, hash],
);
await pool.query(
  `insert into audit_log (user_email, action, detail) values ($1, 'seed_admin', 'mot de passe régénéré')`,
  [EMAIL],
);
await pool.end();

console.log(`admin seedé : ${EMAIL} (role admin, toutes apps)`);
console.log(`mot de passe (affiché une seule fois) : ${password}`);
