// Provisionner une clé d'ingestion pour chaque application qui n'en a pas (R8a).
//
// POURQUOI CE SCRIPT. `REQUIRE_API_KEY=true` fait prendre 403 à toute app sans
// clé — et le relevé du 23/09 en a compté SIX sur sept, dont celle du client.
// Poser le drapeau avant d'avoir provisionné couperait la collecte de la
// production, et le repli du relais (P3) ne se déclenche pas sur un 403. Ce
// script fait l'étape qui manque, sans rien changer à la sémantique du drapeau.
//
// CE QU'IL FAIT :
//   - par défaut (`--dry-run`) : LISTE les apps actives sans `api_key_hash`, et
//     les inactives à part ; n'écrit rien ;
//   - avec `--appliquer` : génère une clé par app active sans clé, stocke son
//     empreinte, journalise l'opération dans `audit_log`, et imprime les clés
//     UNE fois, sur la sortie standard. Elles ne sont écrites nulle part
//     ailleurs : ni en base (seule l'empreinte y va), ni au journal.
//   - `--app <id>` (répétable) restreint à ces apps : on peut provisionner le
//     client d'abord, les autres ensuite.
//
// LE FORMAT ET L'EMPREINTE SONT CEUX DE LA CONSOLE, à l'identique :
// `mip_` + 32 hex (16 octets aléatoires), stockée en sha256 hex — exactement ce
// que `createPgAuth.checkApiKey` compare (`packages/backend/lib/pg-ingest.mjs`)
// et ce que produit la rotation de `/admin/customers` (`formatApiKey`). Une clé
// provisionnée ici est donc rotable depuis la console comme les autres.
//
// SÛR À REJOUER, ET SÛR EN CONCURRENCE. L'écriture est conditionnelle
// (`where api_key_hash is null`) : une app qui a reçu une clé entre la lecture
// et l'écriture — par la console, ou par un second lancement — n'est PAS
// écrasée ; sa clé fraîchement générée est jetée et le script le dit. Tout se
// fait dans une transaction : un échec n'en laisse aucune à moitié posée.
//
// ORDRE D'EXPLOITATION (README du collector) : provisionner → poser les clés
// dans les snippets et intégrations → vérifier les 200 → alors seulement
// `REQUIRE_API_KEY=true`. Tant que le drapeau vaut `false`, une clé posée
// n'est même pas vérifiée : provisionner ne peut rien casser.
//
// Usage :
//   DATABASE_URL=… node scripts/ops/provisionner-cles.mjs                 # liste
//   DATABASE_URL=… node scripts/ops/provisionner-cles.mjs --appliquer     # écrit
//   DATABASE_URL=… node scripts/ops/provisionner-cles.mjs --appliquer --app gip-plateforme
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createPool, describeTarget } from "../../packages/service-kit/pg.mjs";

/** Même format que `formatApiKey` (apps/console/lib/onboarding.ts). */
export function genererCle() {
  return `mip_${randomBytes(16).toString("hex")}`;
}

/** Même empreinte que `checkApiKey` et que la console : sha256 hex. */
export function empreinteCle(cle) {
  return createHash("sha256").update(cle).digest("hex");
}

/** Lecture des arguments ; rend `{ appliquer, apps }` ou lève sur un argument inconnu. */
export function lireArguments(argv) {
  let appliquer = false;
  const apps = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--appliquer") appliquer = true;
    else if (a === "--dry-run") appliquer = false;
    else if (a === "--app" && argv[i + 1]) apps.push(argv[++i]);
    else throw new Error(`argument inconnu : ${a} (attendu : --dry-run, --appliquer, --app <id>)`);
  }
  return { appliquer, apps };
}

/**
 * Le cœur, testable sur n'importe quel `pg.Pool`. Rend le bilan ; n'imprime rien.
 * @param {import("pg").Pool} pool
 * @param {{ appliquer?: boolean, apps?: string[], par?: string }} options
 */
export async function provisionner(pool, { appliquer = false, apps = [], par = "ops:provisionner-cles" } = {}) {
  const filtre = apps.length ? apps : null;
  const { rows } = await pool.query(
    `select app_id, active from app_registry
      where api_key_hash is null and ($1::text[] is null or app_id = any($1))
      order by app_id`,
    [filtre],
  );
  const cibles = rows.filter((r) => r.active).map((r) => r.app_id);
  const inactives = rows.filter((r) => !r.active).map((r) => r.app_id);
  const bilan = { cibles, inactives, cles: [], deja: [] };
  if (!appliquer || cibles.length === 0) return bilan;

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const appId of cibles) {
      const cle = genererCle();
      const { rowCount } = await client.query(
        "update app_registry set api_key_hash = $2 where app_id = $1 and api_key_hash is null",
        [appId, empreinteCle(cle)],
      );
      if (rowCount === 0) {
        bilan.deja.push(appId); // provisionnée entre-temps : on n'écrase jamais
        continue;
      }
      await client.query("insert into audit_log (user_email, action, detail) values ($1, $2, $3)", [
        par,
        "app_provision_key",
        appId,
      ]);
      bilan.cles.push({ app_id: appId, cle });
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    bilan.cles = [];
    throw err;
  } finally {
    client.release();
  }
  return bilan;
}

async function main() {
  let args;
  try {
    args = lireArguments(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message));
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    // Pas de repli sur un Postgres local : c'est ce repli qui fait écrire « avec
    // succès » dans une base qui n'est pas celle qu'on croit.
    console.error("DATABASE_URL absent — le script refuse de deviner une base.");
    process.exit(2);
  }
  const pool = createPool(pg, {
    connectionString: process.env.DATABASE_URL,
    applicationName: "mip-ops-provision",
    max: 2,
  });
  try {
    const cible = describeTarget(process.env.DATABASE_URL);
    console.error(`base : ${cible.host}/${cible.database} — mode ${args.appliquer ? "APPLIQUER" : "dry-run (rien n'est écrit)"}`);
    const bilan = await provisionner(pool, args);
    console.error(`apps actives sans clé : ${bilan.cibles.length}${bilan.cibles.length ? ` (${bilan.cibles.join(", ")})` : ""}`);
    if (bilan.inactives.length) console.error(`apps inactives sans clé, ignorées : ${bilan.inactives.join(", ")}`);
    if (!args.appliquer) {
      if (bilan.cibles.length) console.error("relancer avec --appliquer pour générer et stocker les clés.");
      return;
    }
    if (bilan.deja.length) console.error(`déjà provisionnées entre-temps, non écrasées : ${bilan.deja.join(", ")}`);
    if (bilan.cles.length) {
      console.error(`${bilan.cles.length} clé(s) générée(s). Elles ne s'afficheront plus : les ranger maintenant.`);
      // Sortie standard : les clés SEULES, une par ligne, séparées de l'app par
      // une tabulation — rien d'autre, pour qu'une redirection ne capture
      // qu'elles.
      for (const { app_id, cle } of bilan.cles) process.stdout.write(`${app_id}\t${cle}\n`);
    }
  } finally {
    await pool.end();
  }
}

// Exécuté seulement en ligne de commande : les tests importent les fonctions.
// `pathToFileURL` et non une concaténation : un chemin avec espace ou accent
// serait encodé dans `import.meta.url`, et le script ne ferait silencieusement rien.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`échec : ${err?.message ?? err} — rien n'a été écrit (transaction annulée)`);
    process.exit(1);
  });
}
