// Compte administrateur DÉDIÉ à un fichier de test.
//
// Six specs réinitialisaient le compte admin local par `scripts/seed-admin.mjs`, qui
// tire un mot de passe ALÉATOIRE à chaque appel. Deux workers en parallèle : le
// `beforeAll` de l'un changeait le mot de passe que l'autre venait de lire, et sa
// connexion suivante tombait sur `/login?error=1` (navigation-filtres, en CI, dès
// qu'un lot ajoutait des specs et décalait l'ordre). Un compte par fichier, au mot
// de passe fixe et local, supprime la course — et plus aucun test ne touche au
// compte d'un humain.
import { execFileSync } from "node:child_process";
import type pg from "pg";

function bcryptHash(motDePasse: string): string {
  return execFileSync(
    "node",
    [
      "-e",
      `const { createRequire } = require("node:module");
       const req = createRequire(process.cwd() + "/apps/console/package.json");
       const m = req("bcryptjs");
       const bcrypt = m.hashSync ? m : m.default;
       process.stdout.write(bcrypt.hashSync(process.argv[1], 4));`,
      motDePasse,
    ],
    { encoding: "utf8" },
  );
}

/** Crée (ou réactive) l'admin `email` et rend son mot de passe, fixe et local. */
export async function compteDedie(pool: pg.Pool, email: string): Promise<string> {
  const motDePasse = `mdp-local-${email.split("@")[0]}`;
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update
       set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [email, bcryptHash(motDePasse)],
  );
  return motDePasse;
}
