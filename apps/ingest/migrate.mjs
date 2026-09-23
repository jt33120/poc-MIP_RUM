// Applique les migrations SQL en attente, une fois, dans l'ordre.
//
// POURQUOI CE FICHIER EXISTE. Jusqu'ici le schéma était appliqué À LA MAIN :
// `psql -f` file par file, depuis un poste. Le déploiement du code, lui, est
// automatique. Les deux dérivaient donc en permanence, et une colonne absente
// faisait rejeter tout un lot d'ingestion (constaté). Ici, la migration devient
// une étape du déploiement : le schéma ne peut plus être en retard sur le code.
//
// QUI L'APPELLE EN PRODUCTION. Le service Railway `scheduler`, en commande de
// PRÉ-DÉPLOIEMENT (`node services/scheduler/migrate.mjs`, un fichier de câblage
// qui appelle `main()` ci-dessous). C'est délibérément le
// service dont la disparition se verrait tout de suite : il porte la boucle
// d'alertes, de SLO et de notifications. Confier les migrations à un service
// qu'on peut oublier, c'est accepter qu'elles cessent un jour de s'appliquer sans
// que personne ne le remarque — ce qui a failli arriver quand elles vivaient dans
// le pré-déploiement d'un receveur que plus rien n'atteignait.
//
// ATTENTION AU `redeploy`. Un redéploiement Railway rejoue l'instantané d'un
// déploiement existant et N'EXÉCUTE PAS la commande de pré-déploiement — vérifié
// le 18/09/2026 en y plaçant volontairement une commande qui échoue : le
// déploiement est quand même passé au vert. Seul un vrai déploiement, déclenché
// par un commit touchant les chemins surveillés du service, applique les
// migrations. Un `redeploy` ne prouve donc RIEN sur cette étape.
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
// VERROUS ET POOLER — la leçon la plus chère de ce fichier. La première version
// prenait un `pg_advisory_lock` de SESSION autour de toute la migration. Ça ne
// marche PAS : la chaîne de connexion de production passe par l'endpoint
// « pooler » de Neon, un PgBouncer en mode TRANSACTION. Chaque transaction peut
// atterrir sur un backend différent, donc un verrou de session est pris sur une
// connexion et perdu sur la suivante. Deux migrateurs se croyaient seuls, ont lu
// un registre encore vide et ont voulu appliquer le même fichier : le second a
// échoué sur « duplicate key value violates unique constraint
// schema_migration_pkey » et a fait tomber le déploiement.
// D'où deux changements : un verrou de TRANSACTION (`pg_advisory_xact_lock`),
// qui lui survit au pooler puisqu'une transaction reste sur un seul backend ; et
// une écriture de registre tolérante, pour qu'une course non couverte reste un
// non-événement au lieu d'un échec.
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

/** Clé du verrou consultatif tenu pendant toute la migration. Arbitraire, stable. */
const VERROU_MIGRATION = 811_100;

/**
 * La base est-elle vierge ? `rum_session` est la table la plus ancienne du
 * schéma (schema.sql, avant toute migration) : si elle manque, rien n'a jamais
 * été appliqué ici.
 */
async function baseVierge(client) {
  const { rows } = await client.query("select to_regclass('public.rum_session') as t");
  return rows[0].t == null;
}

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
  const migrations = noms.filter((n) => /^migration-v\d+\.sql$/.test(n)).sort();
  // `schema.sql` EN PREMIER, toujours : c'est le socle que les migrations
  // supposent déjà là (migration-v02 ajoute des colonnes à `rum_session`). En
  // l'incluant, le runner sait construire une base à partir de RIEN — ce qui
  // est la condition pour que ce backend soit réellement déployable ailleurs.
  // Sur une base existante, l'étalonnage le marque comme appliqué avec le
  // reste : il n'est jamais rejoué.
  return noms.includes("schema.sql") ? ["schema.sql", ...migrations] : migrations;
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
    if (baseline && (await baseVierge(client))) {
      // GARDE-FOU. Un étalonnage sur une base VIERGE marquerait 48 fichiers
      // comme appliqués sans les exécuter : le schéma serait absent et le
      // registre affirmerait le contraire. Ça arrive pour de vrai — une base
      // recréée, un environnement de test — alors que la variable
      // MIGRATE_BASELINE, elle, reste posée sur le service.
      log.warn("étalonnage ignoré : la base est vierge, les migrations vont s'appliquer normalement", {
        baseline,
      });
      baseline = null;
    }
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
        // Verrou de TRANSACTION, et non de session : voir l'en-tête du fichier.
        // Il sérialise deux migrateurs simultanés sur ce fichier précis.
        await client.query("select pg_advisory_xact_lock($1)", [VERROU_MIGRATION]);
        // Relecture SOUS verrou : pendant qu'on attendait, l'autre migrateur a
        // pu appliquer ce fichier. La décision prise avant le verrou est
        // périmée ; rejouer le SQL serait au mieux inutile.
        const { rowCount: deja } = await client.query(
          "select 1 from schema_migration where filename = $1",
          [f.nom],
        );
        if (deja) {
          await client.query("commit");
          log.info("migration déjà appliquée par un autre migrateur", { nom: f.nom });
          continue;
        }
        await client.query(f.sql);
        // `on conflict do nothing` : ceinture ET bretelles. Sans lui, une course
        // que le verrou n'aurait pas couverte transforme un cas bénin — le
        // fichier est appliqué, simplement pas par nous — en échec dur du
        // déploiement. C'est exactement ce qui s'est produit le 08/09/2026 :
        // « duplicate key value violates unique constraint schema_migration_pkey ».
        await client.query(
          `insert into schema_migration (filename, checksum, applied_by) values ($1, $2, $3)
           on conflict (filename) do nothing`,
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

/**
 * Le programme du migrateur : lit la ligne de commande et l'environnement,
 * applique ce qui manque, et RENVOIE le code de sortie — sans jamais quitter
 * le process lui-même.
 *
 * POURQUOI UNE FONCTION EXPORTÉE. La garde d'exécution directe, plus bas, ne
 * s'active que si CE fichier est le point d'entrée du process. Importé par un
 * autre (le fichier de câblage `services/scheduler/migrate.mjs`, que le
 * pré-déploiement Railway lance), il ne faisait RIEN — sans erreur, et le
 * déploiement serait parti avec un schéma en retard. `main()` est ce que ce
 * câblage appelle : le même programme, quel que soit le chemin de lancement.
 *
 *   node <chemin>/migrate.mjs [--baseline <fichier>]
 *
 * @param {{ argv?: string[], env?: Record<string, string | undefined> }} [options]
 * @returns {Promise<number>} 0 = à jour, 1 = une migration a échoué, 2 = pas de base
 */
export async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const iBase = argv.indexOf("--baseline");
  const baseline = iBase !== -1 ? argv[iBase + 1] : (env.MIGRATE_BASELINE || null);
  const url = env.DATABASE_URL;
  if (!url) {
    log.error("DATABASE_URL absent");
    return 2;
  }
  // Une seule connexion suffit et le process est éphémère : pas de pool large,
  // surtout sur Neon où les connexions sont une ressource comptée.
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrer(pool, { baseline, par: env.RAILWAY_SERVICE_NAME ?? "migrate" });
    // Un fichier modifié après application est un AVERTISSEMENT (déjà journalisé
    // par `migrer`), pas un échec : on rend 0 dans les deux cas.
    return 0;
  } catch {
    return 1; // le détail est déjà journalisé
  } finally {
    await pool.end().catch(() => {});
  }
}

// --- Exécution directe : node <chemin>/migrate.mjs [--baseline <fichier>] ---
// La comparaison passe par pathToFileURL plutôt que par une concaténation
// `file://` + argv[1] : dans l'image du backend le script est lancé par un
// chemin relatif, et l'encodage d'un espace ou d'un accent dans le chemin
// suffirait à faire échouer la comparaison naïve — le script ne ferait alors
// RIEN, sans erreur, et le déploiement partirait avec un schéma en retard.
//
// `process.exitCode` et non `process.exit()` : le pool est déjà fermé quand
// `main()` rend la main, le process s'arrête de lui-même avec ce code, sans
// couper un journal encore en cours d'écriture.
if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  process.exitCode = await main();
}
