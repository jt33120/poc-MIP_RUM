// Applique les migrations SQL en attente, une fois, dans l'ordre.
//
// POURQUOI CE FICHIER EXISTE. Jusqu'ici le schéma était appliqué À LA MAIN :
// `psql -f` file par file, depuis un poste. Le déploiement du code, lui, est
// automatique. Les deux dérivaient donc en permanence, et une colonne absente
// faisait rejeter tout un lot d'ingestion (constaté). Ici, la migration devient
// une étape du déploiement : le schéma ne peut plus être en retard sur le code.
//
// CE QU'IL NE FAIT PAS. Pas de rollback : une migration descendante qui se
// trompe fait plus de dégâts qu'elle n'en répare, et aucune des 52 migrations
// de ce dépôt n'en a jamais eu. On avance, on ne recule pas.
//
// REGISTRE. La table `schema_migration` retient ce qui a été appliqué. Elle
// n'existait pas : les bases déjà en service (Neon, à v51) doivent donc être
// ÉTALONNÉES — cf. --baseline — sinon le premier passage rejouerait 50 fichiers
// sur une base qui les a déjà. Les migrations sont écrites pour être rejouables
// (`if not exists` partout, c'est ce que la CI vérifie sur une base vierge),
// mais s'y fier pour 50 fichiers d'affilée serait un pari, pas une méthode.
//
// TRANSACTION PAR FICHIER. Chaque fichier est envoyé en une seule requête,
// encadrée de BEGIN/COMMIT : il passe en entier ou pas du tout, et l'entrée du
// registre est écrite DANS la même transaction — impossible d'avoir un fichier
// à moitié appliqué et marqué comme fait. Aucune migration du dépôt n'utilise
// CREATE INDEX CONCURRENTLY (vérifié), seule construction qui interdirait ça.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { createLogger } from "./supabase/functions/_shared/log.mjs";

const log = createLogger("migrate");

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const DOSSIER_SQL = path.join(ICI, "sql");

const REGISTRE = `
create table if not exists schema_migration (
  filename    text primary key,
  checksum    text not null,
  applied_at  timestamptz not null default now(),
  applied_by  text
)`;

/** sha256 du contenu, pour repérer un fichier modifié APRÈS avoir été appliqué. */
export function empreinte(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

/**
 * Les fichiers de migration, dans l'ordre d'application.
 *
 * L'ordre est le tri lexical des noms — c'est déjà le contrat du dépôt : la CI
 * (`for f in apps/ingest/sql/migration-v*.sql`) et l'init du conteneur
 * (`ls | sort`) s'appuient dessus. Les numéros sont zéro-paddés, donc lexical
 * et numérique coïncident. La suite a des TROUS (ni v06 ni v44) : ne jamais
 * dériver le nom suivant d'un compteur.
 *
 * `sql/pending/` est délibérément ignoré : c'est le purgatoire des migrations
 * écrites mais non validées (aujourd'hui migration-v44-drop-deprecated-ai.sql,
 * qui SUPPRIME des tables). Un déploiement ne doit pas la déclencher par
 * inadvertance.
 */
export async function fichiersMigration(dossier = DOSSIER_SQL) {
  const noms = await readdir(dossier);
  return noms
    .filter((n) => /^migration-v\d+\.sql$/.test(n))
    .sort();
}

/**
 * Ce qu'il reste à appliquer, et ce qui a changé depuis son application.
 *
 * Pur : prend l'état du registre et la liste des fichiers, ne touche à rien.
 */
export function aFaire(fichiers, dejaApplique) {
  const connu = new Map(dejaApplique.map((r) => [r.filename, r.checksum]));
  const enAttente = [];
  const modifies = [];
  for (const f of fichiers) {
    const anterieur = connu.get(f.nom);
    if (anterieur === undefined) enAttente.push(f);
    else if (anterieur !== f.checksum) modifies.push(f.nom);
  }
  return { enAttente, modifies };
}

/**
 * Étalonnage : marquer comme appliqués, SANS les exécuter, tous les fichiers
 * jusqu'à `jusqua` inclus. C'est l'opération d'adoption d'une base existante.
 * Sans elle, brancher ce runner sur la base de production rejouerait tout.
 */
export function jusquaInclus(fichiers, jusqua) {
  const i = fichiers.findIndex((f) => f.nom === jusqua);
  if (i === -1) return null;
  return fichiers.slice(0, i + 1);
}

async function charger(dossier) {
  const noms = await fichiersMigration(dossier);
  return Promise.all(
    noms.map(async (nom) => {
      const sql = await readFile(path.join(dossier, nom), "utf8");
      return { nom, sql, checksum: empreinte(sql) };
    }),
  );
}

/**
 * Applique ce qui manque. Renvoie le compte-rendu ; ne quitte jamais le
 * process lui-même — c'est l'appelant qui décide du code de sortie.
 */
export async function migrer(pool, { dossier = DOSSIER_SQL, baseline = null, par = "migrate" } = {}) {
  const fichiers = await charger(dossier);
  const client = await pool.connect();
  try {
    await client.query(REGISTRE);
    const { rows } = await client.query("select filename, checksum from schema_migration");

    // Étalonnage : on écrit le registre sans exécuter une seule ligne de SQL.
    if (baseline) {
      const jusque = jusquaInclus(fichiers, baseline);
      if (!jusque) throw new Error(`baseline introuvable dans ${dossier} : ${baseline}`);
      let marques = 0;
      for (const f of jusque) {
        const r = await client.query(
          `insert into schema_migration (filename, checksum, applied_by)
           values ($1, $2, $3) on conflict (filename) do nothing`,
          [f.nom, f.checksum, `${par} (étalonnage)`],
        );
        marques += r.rowCount;
      }
      log.info("étalonnage", { jusqua: baseline, marques, deja: jusque.length - marques });
      rows.push(...jusque.map((f) => ({ filename: f.nom, checksum: f.checksum })));
    }

    const { enAttente, modifies } = aFaire(fichiers, rows);

    // Un fichier modifié après coup n'est PAS rejoué : la base ne correspond
    // plus au fichier, et le rejouer serait pire. On le crie, on continue.
    for (const nom of modifies) {
      log.warn("migration modifiée après application — la base ne correspond plus au fichier", { nom });
    }

    const appliquees = [];
    for (const f of enAttente) {
      const debut = Date.now();
      try {
        await client.query("begin");
        await client.query(f.sql);
        await client.query(
          `insert into schema_migration (filename, checksum, applied_by) values ($1, $2, $3)`,
          [f.nom, f.checksum, par],
        );
        await client.query("commit");
      } catch (err) {
        await client.query("rollback").catch(() => {});
        log.error("migration échouée — rien de ce fichier n'a été appliqué", {
          nom: f.nom,
          err: String(err?.message ?? err),
        });
        throw err;
      }
      appliquees.push(f.nom);
      log.info("migration appliquée", { nom: f.nom, ms: Date.now() - debut });
    }

    log.info("migrations à jour", {
      total: fichiers.length,
      appliquees: appliquees.length,
      modifiees: modifies.length,
    });
    return { appliquees, modifies, total: fichiers.length };
  } finally {
    client.release();
  }
}

// --- Exécution directe : node <chemin>/migrate.mjs [--baseline <fichier>] ---
// La comparaison passe par pathToFileURL plutôt que par une concaténation
// `file://` + argv[1] : dans l'image du backend le script est lancé par un
// chemin relatif, et l'encodage d'un espace ou d'un accent dans le chemin
// suffirait à faire échouer la comparaison naïve — le script ne ferait alors
// RIEN, sans erreur, et le déploiement partirait avec un schéma en retard.
if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2);
  const iBase = args.indexOf("--baseline");
  const baseline = iBase !== -1 ? args[iBase + 1] : null;
  const url = process.env.DATABASE_URL;
  if (!url) {
    log.error("DATABASE_URL absent");
    process.exit(2);
  }
  // Une seule connexion suffit et le process est éphémère : pas de pool large,
  // surtout sur Neon où les connexions sont une ressource comptée.
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const bilan = await migrer(pool, { baseline, par: process.env.RAILWAY_SERVICE_NAME ?? "migrate" });
    if (bilan.modifies.length) process.exitCode = 0; // avertissement, pas échec
  } catch {
    process.exitCode = 1; // le détail est déjà journalisé
  } finally {
    await pool.end().catch(() => {});
  }
}
