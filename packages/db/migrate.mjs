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
// Un fichier déjà appliqué ne doit plus changer : `scripts/ci/migrations-
// figees.mjs` le refuse en CI, avant la fusion.
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
// CREATE INDEX CONCURRENTLY (vérifié, et un test unitaire le tient), seule
// construction qui interdirait ça.
//
// ATTENTE DE VERROU BORNÉE, AVEC REPRISES. Un `alter table` sur une table
// chaude attend son ACCESS EXCLUSIVE derrière la moindre lecture longue — et
// pendant qu'il attend, TOUTES les écritures d'ingestion font la queue derrière
// lui. Chaque transaction de migration pose donc `lock_timeout` (3 s par
// défaut ; un fichier qui pose le sien, comme les `set local lock_timeout =
// '5s'` de v69 à v86, garde le dernier mot). S'il expire, le fichier entier est
// annulé puis REJOUÉ, un nombre borné de fois, chaque reprise journalisée :
// mieux vaut cinq tentatives brèves qu'une seule qui fige l'ingestion.
//
// PRÉ-DÉPLOIEMENT (`predeploy-vNN-*.sql`). Un index sur une table volumineuse
// ne peut pas se construire dans la transaction du migrateur sans bloquer
// l'écriture pendant toute sa construction : il se construit CONCURRENTLY, hors
// transaction. Ces scripts s'appliquaient À LA MAIN (`psql -f`), et chaque
// migration concernée refuse de partir s'ils manquent sur une grosse table.
// Désormais le migrateur les passe lui-même, JUSTE AVANT leur `migration-vNN`,
// et seulement si celle-ci est en attente :
//   · sur `MIGRATION_DATABASE_URL` si elle est posée (connexion DIRECTE, hors
//     pooler), sinon sur `DATABASE_URL` ;
//   · sous un verrou consultatif de SESSION — possible ici, et seulement ici,
//     parce que la connexion est directe (cf. VERROUS ET POOLER). Le verrou est
//     vérifié dans `pg_locks` une fois pris : un pooler démasqué fait SAUTER le
//     pré-déploiement au lieu de le laisser tourner sans protection, et la
//     migration garde alors son propre garde-fou de taille ;
//   · avec vérification de `pg_index.indisvalid` / `indisready` : un CREATE
//     INDEX CONCURRENTLY interrompu laisse un index INVALIDE que `if not exists`
//     prend pour fait. Il est supprimé puis reconstruit.
// Une base À JOUR n'ouvre aucune connexion de plus et ne lit aucun de ces
// scripts : son comportement est exactement celui d'avant.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { createLogger } from "@mip/backend/shared/log.mjs";

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

/**
 * Clé du verrou consultatif des migrations. Arbitraire, stable.
 *
 * LA MÊME CLÉ pour le verrou de transaction d'un fichier et pour le verrou de
 * session du pré-déploiement : c'est ce qui empêche un second migrateur
 * d'appliquer `migration-vNN` pendant que le premier construit encore son index
 * CONCURRENTLY. Un index en construction est INVALIDE ; la garde de la
 * migration (`to_regclass(...) is null`) le verrait pourtant exister, et
 * `create index if not exists` ne ferait rien : le registre dirait vNN
 * appliquée au-dessus d'un index inutilisable.
 */
const VERROU_MIGRATION = 811_100;

/**
 * Délais et reprises. `migrer()` accepte une surcharge partielle (`delais`),
 * pour les tests ; la ligne de commande non : en production, ces valeurs sont
 * un contrat (contrat de service, règle 6), pas un réglage.
 */
export const DELAIS = Object.freeze({
  /** `lock_timeout` d'une transaction de migration et d'une instruction de pré-déploiement ordinaire. */
  lockTimeoutMs: 3_000,
  /**
   * `lock_timeout` d'un CREATE / DROP INDEX CONCURRENTLY. Plus long, et c'est
   * voulu : ces instructions ne prennent qu'un SHARE UPDATE EXCLUSIVE, qui ne
   * met AUCUNE écriture en attente derrière lui ; ce qu'elles attendent, ce sont
   * les transactions déjà ouvertes sur la table. Trois secondes les feraient
   * échouer derrière n'importe quelle lecture analytique, sans rien protéger.
   * Borné quand même : une transaction oubliée ouverte ne doit pas suspendre le
   * déploiement indéfiniment.
   */
  indexLockTimeoutMs: 120_000,
  /** Tentatives au plus, première comprise, après une attente de verrou expirée ou un interblocage. */
  tentatives: 5,
  /** Pause avant la 2e tentative, doublée ensuite (1 s, 2 s, 4 s, 8 s). */
  attenteMs: 1_000,
  /** Essais de prise du verrou de session du pré-déploiement, et pause entre deux (60 s en tout). */
  verrouEssais: 20,
  verrouPauseMs: 3_000,
});

/** Codes SQLSTATE qui justifient une reprise : rien n'a été appliqué, réessayer a un sens. */
const REPRENABLES = new Set([
  "55P03", // lock_not_available — `lock_timeout` expiré
  "40P01", // deadlock_detected — PostgreSQL a choisi cette transaction comme victime
]);

/** L'échec vient-il d'une attente de verrou (expirée ou interbloquée) ? */
export function estAttenteDeVerrou(err) {
  return REPRENABLES.has(err?.code);
}

const RE_MIGRATION = /^migration-v(\d+)\.sql$/;
const RE_PREDEPLOIEMENT = /^predeploy-v(\d+)(?:-[a-z0-9_-]+)?\.sql$/;

/**
 * Numéro d'une migration ou d'un script de pré-déploiement, `null` sinon.
 * `migration-v100.sql` → 100 ; `predeploy-v68-indexes.sql` → 68.
 */
export function numeroMigration(nom) {
  const m = RE_MIGRATION.exec(nom) ?? RE_PREDEPLOIEMENT.exec(nom);
  return m ? Number(m[1]) : null;
}

/**
 * Trie des noms `migration-vNN.sql` par NUMÉRO, et refuse deux fichiers qui
 * portent le même (`migration-v7.sql` et `migration-v07.sql`) : lequel passerait
 * en premier serait un accident de nommage, et les deux seraient appliqués.
 */
export function trierMigrations(noms) {
  const vus = new Map();
  for (const nom of noms) {
    const n = RE_MIGRATION.test(nom) ? numeroMigration(nom) : null;
    if (n == null) throw new Error(`nom de migration invalide : ${nom}`);
    if (vus.has(n)) throw new Error(`deux migrations portent le numéro ${n} : ${vus.get(n)} et ${nom}`);
    vus.set(n, nom);
  }
  return [...noms].sort((a, b) => numeroMigration(a) - numeroMigration(b));
}

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
 * L'ordre est NUMÉRIQUE : `migration-v100.sql` passe après `migration-v99.sql`.
 * Le tri lexical, lui, rangerait v100 entre v10 et v11 — il a tenu tant que
 * les numéros avaient deux chiffres ; il casserait au centième fichier, et sur
 * une base VIERGE seulement : la production, qui reçoit les fichiers un par un
 * au fil des déploiements, ne verrait rien. La suite a des TROUS (ni v06 ni
 * v44, ni v76 à v78) : ne jamais dériver le nom suivant d'un compteur.
 *
 * Ne sont retenus que `schema.sql` et les `migration-vNN.sql` du dossier
 * lui-même. En particulier :
 *   · `sql/pending/` est ignoré : c'est le purgatoire des migrations écrites
 *     mais non validées (aujourd'hui migration-v44-drop-deprecated-ai.sql, qui
 *     SUPPRIME des tables). Un déploiement ne doit pas la déclencher par
 *     inadvertance ;
 *   · les `predeploy-vNN-*.sql` ne sont PAS des migrations : ils ne vont pas au
 *     registre et passent hors transaction (cf. `fichiersPredeploiement`).
 */
export async function fichiersMigration(dossier = DOSSIER_SQL) {
  const noms = await readdir(dossier);
  const migrations = trierMigrations(noms.filter((n) => RE_MIGRATION.test(n)));
  // `schema.sql` EN PREMIER, toujours : c'est le socle que les migrations
  // supposent déjà là (migration-v02 ajoute des colonnes à `rum_session`). En
  // l'incluant, le runner sait construire une base à partir de RIEN — ce qui
  // est la condition pour que ce backend soit réellement déployable ailleurs.
  // Sur une base existante, l'étalonnage le marque comme appliqué avec le
  // reste : il n'est jamais rejoué.
  return noms.includes("schema.sql") ? ["schema.sql", ...migrations] : migrations;
}

/**
 * Les scripts de pré-déploiement, par numéro de migration : `predeploy-v68-
 * indexes.sql` précède `migration-v68.sql`. Plusieurs scripts pour un même
 * numéro passent dans l'ordre de leur nom.
 * @returns {Promise<Map<number, string[]>>}
 */
export async function fichiersPredeploiement(dossier = DOSSIER_SQL) {
  const parNumero = new Map();
  for (const nom of (await readdir(dossier)).filter((n) => RE_PREDEPLOIEMENT.test(n)).sort()) {
    const n = numeroMigration(nom);
    parNumero.set(n, [...(parNumero.get(n) ?? []), nom]);
  }
  return parNumero;
}

/**
 * Découpe un script SQL en instructions, commentaires retirés.
 *
 * POURQUOI. CREATE INDEX CONCURRENTLY refuse de tourner dans un bloc de
 * transaction, et une requête qui contient plusieurs instructions EN EST UN,
 * implicite : `psql -f` envoie les instructions une à une, le pilote `pg` non.
 * Le découpage suit les règles lexicales de PostgreSQL qui peuvent cacher un
 * `;` : commentaires `--` et `/* … *\/` (imbriqués), chaînes '…' (avec ''),
 * chaînes E'…' (avec \'), identifiants "…", corps $tag$ … $tag$.
 * @returns {string[]}
 */
export function decouperSql(sql) {
  const instructions = [];
  const n = sql.length;
  const dansUnMot = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);
  let courant = "";
  let i = 0;
  const pousser = () => {
    const t = courant.trim();
    if (t) instructions.push(t);
    courant = "";
  };
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      courant += " ";
    } else if (c === "/" && sql[i + 1] === "*") {
      let profondeur = 0;
      do {
        if (sql[i] === "/" && sql[i + 1] === "*") (profondeur++, (i += 2));
        else if (sql[i] === "*" && sql[i + 1] === "/") (profondeur--, (i += 2));
        else i++;
      } while (i < n && profondeur > 0);
      courant += " ";
    } else if (c === "'") {
      // E'…' : la barre oblique inverse y échappe, y compris une apostrophe. Le
      // E doit former un mot à lui seul — `type'…'` n'est pas une chaîne E.
      const echappee = /[eE]/.test(sql[i - 1] ?? "") && !dansUnMot(sql[i - 2]);
      let j = i + 1;
      while (j < n) {
        if (echappee && sql[j] === "\\") j += 2;
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      courant += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && !(sql[j] === '"' && sql[j + 1] !== '"')) j += sql[j] === '"' ? 2 : 1;
      courant += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === "$" && !dansUnMot(sql[i - 1]) && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i, i + 65))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 65))[0];
      const fin = sql.indexOf(tag, i + tag.length);
      const j = fin === -1 ? n : fin + tag.length;
      courant += sql.slice(i, j);
      i = j;
    } else if (c === ";") {
      pousser();
      i++;
    } else {
      courant += c;
      i++;
    }
  }
  pousser();
  return instructions;
}

const RE_INDEX_CONCURRENT = /^create\s+(?:unique\s+)?index\s+concurrently\b/i;
const RE_INDEX_CONCURRENT_NOMME =
  /^create\s+(?:unique\s+)?index\s+concurrently\s+(?:if\s+not\s+exists\s+)?("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)\s+on\s/i;

/**
 * L'instruction est-elle un CREATE INDEX CONCURRENTLY ? Si oui, rend le nom de
 * l'index et sa forme citée (pour `to_regclass` et `drop index`).
 *
 * Un index CONCURRENTLY SANS NOM est refusé : on ne peut ni vérifier sa
 * validité ni le reconstruire, et PostgreSQL en inventerait un nouveau à chaque
 * reprise — un doublon par tentative.
 * @returns {{ nom: string, cite: string } | null}
 */
export function indexConcurrent(instruction) {
  if (!RE_INDEX_CONCURRENT.test(instruction)) return null;
  const m = RE_INDEX_CONCURRENT_NOMME.exec(instruction);
  if (!m || /^on$/i.test(m[1])) {
    throw new Error(`pré-déploiement : un index CONCURRENTLY doit être nommé — ${instruction.slice(0, 120)}`);
  }
  // Un nom sans guillemets est replié en minuscules par PostgreSQL ; cité, il
  // est pris tel quel. `cite` est donc toujours la forme exacte du catalogue.
  const nom = m[1].startsWith('"') ? m[1].slice(1, -1).replace(/""/g, '"') : m[1].toLowerCase();
  return { nom, cite: `"${nom.replace(/"/g, '""')}"` };
}

/**
 * La chaîne de connexion passe-t-elle par un pooler en mode transaction ?
 * Reconnaît la convention de Neon (`ep-…-pooler.<région>…`) et le drapeau
 * `pgbouncer=true`. Un pooler que ces deux signes ne trahissent pas est démasqué
 * plus tard, par la vérification du verrou de session dans `pg_locks`.
 */
export function estPooler(url) {
  try {
    const u = new URL(url);
    return /-pooler(\.|$)/i.test(u.hostname) || u.searchParams.get("pgbouncer") === "true";
  } catch {
    return false;
  }
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
 * Les scripts de pré-déploiement de chaque migration EN ATTENTE, lus et
 * découpés d'avance : une erreur de forme (index CONCURRENTLY sans nom) doit
 * arrêter le déploiement AVANT la première écriture, pas au milieu.
 * @returns {Promise<Map<string, Array<{ nom: string, instructions: string[], index: Array<{nom: string, cite: string}> }>>>}
 */
async function chargerPredeploiements(dossier, enAttente) {
  const numeros = new Set(enAttente.map((f) => numeroMigration(f.nom)).filter((n) => n != null));
  if (numeros.size === 0) return new Map();
  const parNumero = await fichiersPredeploiement(dossier);
  const parMigration = new Map();
  for (const f of enAttente) {
    const noms = parNumero.get(numeroMigration(f.nom)) ?? [];
    if (!RE_MIGRATION.test(f.nom) || noms.length === 0) continue;
    const scripts = [];
    for (const nom of noms) {
      const instructions = decouperSql(await readFile(path.join(dossier, nom), "utf8"));
      const index = instructions.map(indexConcurrent).filter(Boolean);
      scripts.push({ nom, instructions, index });
    }
    parMigration.set(f.nom, scripts);
  }
  return parMigration;
}

/**
 * Une tentative, puis des reprises tant que l'échec est une attente de verrou
 * et qu'il en reste. Chaque reprise est JOURNALISÉE : une migration qui a dû
 * s'y prendre à quatre fois est un signal (une lecture longue, une table plus
 * chaude que prévu), même quand elle finit par passer.
 */
async function avecReprises(contexte, essayer, { journal, delais, attendre }) {
  for (let essai = 1; ; essai++) {
    try {
      return await essayer(essai);
    } catch (err) {
      if (!estAttenteDeVerrou(err) || essai >= delais.tentatives) throw err;
      const attente_ms = delais.attenteMs * 2 ** (essai - 1);
      journal.warn("verrou non obtenu à temps — nouvel essai", {
        ...contexte,
        essai,
        tentatives: delais.tentatives,
        attente_ms,
        code: err.code,
      });
      await attendre(attente_ms);
    }
  }
}

/** Exécute `sql` avec un `lock_timeout` de session posé pour lui seul. */
async function sousDelai(c, ms, sql) {
  await c.query("select set_config('lock_timeout', $1, false)", [`${Math.trunc(ms)}ms`]);
  try {
    return await c.query(sql);
  } finally {
    await c.query("reset lock_timeout").catch(() => {});
  }
}

/** État d'un index dans le catalogue ; `null` s'il n'existe pas. */
async function etatIndex(c, cite) {
  const { rows } = await c.query(
    `select i.indisvalid as valide, i.indisready as pret
       from pg_index i
      where i.indexrelid = to_regclass($1)`,
    [cite],
  );
  return rows[0] ?? null;
}

/**
 * Construit un index CONCURRENTLY jusqu'à ce qu'il soit VALIDE, ou échoue.
 *
 * Un CREATE INDEX CONCURRENTLY qui échoue — attente de verrou expirée,
 * interblocage, doublon sur un index unique — laisse derrière lui un index
 * INVALIDE : présent dans le catalogue, entretenu à chaque écriture, jamais lu
 * par le planificateur. `if not exists` le prend pour fait. D'où l'ordre :
 * lire l'état, supprimer l'invalide, reconstruire, relire l'état.
 *
 * « Invalide » veut aussi dire « en cours de construction » : c'est le verrou
 * de session, tenu par l'appelant, qui garantit qu'aucun AUTRE MIGRATEUR n'est
 * en train de le construire. Il ne protège pas d'un `psql -f predeploy-…` lancé
 * à la main au même moment : ne plus le faire pendant un déploiement.
 */
async function construireIndex(c, index, instruction, ctx) {
  const { journal, delais, attendre } = ctx;
  for (let essai = 1; essai <= delais.tentatives; essai++) {
    const avant = await etatIndex(c, index.cite);
    if (avant?.valide && avant.pret) {
      journal.info("pré-déploiement : index déjà valide", { index: index.nom });
      return;
    }
    const debut = Date.now();
    try {
      if (avant) {
        journal.warn("pré-déploiement : index INVALIDE — suppression puis reconstruction", {
          index: index.nom,
          essai,
          pret: avant.pret,
        });
        await sousDelai(c, delais.indexLockTimeoutMs, `drop index concurrently if exists ${index.cite}`);
      }
      await sousDelai(c, delais.indexLockTimeoutMs, instruction);
    } catch (err) {
      if (!estAttenteDeVerrou(err) || essai >= delais.tentatives) {
        await supprimerSiInvalide(c, index, ctx);
        throw err;
      }
      const attente_ms = delais.attenteMs * 2 ** (essai - 1);
      journal.warn("pré-déploiement : verrou non obtenu à temps — nouvel essai", {
        index: index.nom,
        essai,
        tentatives: delais.tentatives,
        attente_ms,
        code: err.code,
      });
      await attendre(attente_ms);
      continue;
    }
    const apres = await etatIndex(c, index.cite);
    if (apres?.valide && apres.pret) {
      journal.info("pré-déploiement : index construit", { index: index.nom, ms: Date.now() - debut });
      return;
    }
    journal.warn("pré-déploiement : index encore invalide après construction", { index: index.nom, essai });
  }
  await supprimerSiInvalide(c, index, ctx);
  throw new Error(`pré-déploiement : ${index.nom} reste invalide après ${delais.tentatives} tentatives`);
}

/**
 * En sortie d'échec, ne pas laisser d'index invalide : il coûte à chaque
 * écriture, et la garde de la migration (`to_regclass(...) is null`) le
 * prendrait pour un index prêt. Au mieux : si la suppression échoue aussi,
 * `exigerIndexValides` bloquera la migration.
 */
async function supprimerSiInvalide(c, index, { journal, delais }) {
  try {
    const etat = await etatIndex(c, index.cite);
    if (etat && !(etat.valide && etat.pret)) {
      await sousDelai(c, delais.indexLockTimeoutMs, `drop index concurrently if exists ${index.cite}`);
      journal.warn("pré-déploiement : index invalide supprimé après échec", { index: index.nom });
    }
  } catch (err) {
    journal.error("pré-déploiement : index invalide NON supprimé", {
      index: index.nom,
      err: String(err?.message ?? err),
    });
  }
}

/**
 * Une instruction de pré-déploiement ordinaire (ex. `alter table … add column
 * if not exists`, qui doit précéder l'index qui la couvre). Elle passe dans sa
 * propre transaction, `lock_timeout` court, avec reprises : un ACCESS EXCLUSIVE
 * qui attend met toute l'ingestion en file derrière lui.
 */
async function executerInstruction(c, instruction, contexte, ctx) {
  await avecReprises(
    contexte,
    async () => {
      try {
        await c.query("begin");
        await c.query("select set_config('lock_timeout', $1, true)", [`${ctx.delais.lockTimeoutMs}ms`]);
        await c.query(instruction);
        await c.query("commit");
      } catch (err) {
        await c.query("rollback").catch(() => {});
        throw err;
      }
    },
    ctx,
  );
}

/**
 * Empreinte du registre, pour vérifier que deux connexions voient la MÊME base.
 * Une base sans registre rend « absent » : c'est une différence comme une autre,
 * pas une erreur SQL qui masquerait la vraie cause.
 */
async function empreinteRegistre(c) {
  const { rows: existe } = await c.query("select to_regclass('public.schema_migration') is not null as ok");
  if (!existe[0].ok) return "absent";
  const { rows } = await c.query(
    `select count(*)::int as n,
            coalesce(md5(string_agg(filename || ':' || checksum, ',' order by filename)), '') as h
       from schema_migration`,
  );
  return `${rows[0].n}:${rows[0].h}`;
}

/**
 * Passe les scripts de pré-déploiement d'une migration, sous verrou de session.
 * @returns {Promise<"fait" | "deja" | "saute">}
 */
async function preDeployer(directe, principal, migration, scripts, ctx) {
  const { journal, delais, attendre } = ctx;
  const c = directe.client;

  // 1. Le verrou de SESSION, par essais bornés : `pg_try_advisory_lock` ne
  //    touche pas au `lock_timeout` de la session, et un autre migrateur qui
  //    construit un index peut le garder plusieurs minutes.
  let tenu = false;
  for (let essai = 1; essai <= delais.verrouEssais; essai++) {
    const { rows } = await c.query("select pg_try_advisory_lock($1) as ok", [VERROU_MIGRATION]);
    if (rows[0].ok) {
      tenu = true;
      break;
    }
    journal.info("pré-déploiement : verrou des migrations tenu ailleurs — nouvel essai", {
      migration,
      essai,
      essais: delais.verrouEssais,
      attente_ms: delais.verrouPauseMs,
    });
    if (essai < delais.verrouEssais) await attendre(delais.verrouPauseMs);
  }
  if (!tenu) {
    throw new Error(`pré-déploiement de ${migration} : verrou des migrations toujours tenu après ${delais.verrouEssais} essais`);
  }

  try {
    // 2. Ce verrou est-il VRAIMENT à nous ? Derrière un pooler en mode
    //    transaction, la requête suivante tombe sur un autre backend, qui ne le
    //    tient pas. Un bigint est rangé en (classid = 32 bits hauts, objid = 32
    //    bits bas, objsubid = 1).
    const { rows: preuve } = await c.query(
      `select exists (
         select 1 from pg_locks
          where locktype = 'advisory' and pid = pg_backend_pid() and granted
            and classid = 0 and objid = $1 and objsubid = 1
       ) as ok`,
      [VERROU_MIGRATION],
    );
    if (!preuve[0].ok) {
      journal.warn(
        "pré-déploiement sauté : le verrou de session n'est pas tenu par cette connexion (pooler en mode transaction ?) — poser MIGRATION_DATABASE_URL sur une connexion directe",
        { migration },
      );
      return "saute";
    }

    // 3. La connexion directe voit-elle la même base que le migrateur ? Une
    //    MIGRATION_DATABASE_URL restée sur une autre base (la production depuis
    //    la recette, par exemple) construirait des index au mauvais endroit.
    //    Comparée SOUS le verrou : aucun autre migrateur ne peut écrire le
    //    registre pendant ce temps.
    if (directe.client !== principal) {
      const [a, b] = await Promise.all([empreinteRegistre(principal), empreinteRegistre(c)]);
      if (a !== b) {
        throw new Error(
          "MIGRATION_DATABASE_URL ne désigne pas la même base que DATABASE_URL (registres de migrations différents)",
        );
      }
    }

    // 4. Relecture sous verrou, comme pour un fichier : pendant l'attente, un
    //    autre migrateur a pu passer la migration elle-même.
    const { rowCount: deja } = await c.query("select 1 from schema_migration where filename = $1", [migration]);
    if (deja) {
      journal.info("pré-déploiement inutile : migration déjà appliquée par un autre migrateur", { migration });
      return "deja";
    }

    for (const script of scripts) {
      journal.info("pré-déploiement", { script: script.nom, migration, instructions: script.instructions.length });
      for (const instruction of script.instructions) {
        const index = indexConcurrent(instruction);
        if (index) await construireIndex(c, index, instruction, ctx);
        else await executerInstruction(c, instruction, { script: script.nom, migration }, ctx);
      }
    }
    return "fait";
  } finally {
    await c.query("select pg_advisory_unlock($1)", [VERROU_MIGRATION]).catch((err) => {
      journal.warn("pré-déploiement : verrou de session non rendu", { err: String(err?.message ?? err) });
    });
  }
}

/**
 * Dernière garde avant `migration-vNN` : aucun des index que ses scripts de
 * pré-déploiement nomment ne doit exister INVALIDE. La garde écrite dans la
 * migration elle-même ne regarde que l'existence ; un index invalide la
 * passerait, et le registre la dirait appliquée au-dessus d'un index mort.
 * Lecture du catalogue seulement : elle passe aussi par le pooler.
 */
async function exigerIndexValides(client, migration, scripts, journal) {
  const cites = scripts.flatMap((s) => s.index.map((i) => i.cite));
  if (cites.length === 0) return;
  const { rows } = await client.query(
    `select c.relname as nom
       from unnest($1::text[]) as x(cite)
       join pg_index i on i.indexrelid = to_regclass(x.cite)
       join pg_class c on c.oid = i.indexrelid
      where not (i.indisvalid and i.indisready)`,
    [cites],
  );
  if (rows.length) {
    const noms = rows.map((r) => r.nom);
    journal.error("index INVALIDE avant la migration — elle ne partira pas", { migration, index: noms });
    throw new Error(
      `${migration} : index invalide ${noms.join(", ")} — relancer le pré-déploiement sur une connexion directe (MIGRATION_DATABASE_URL)`,
    );
  }
}

/** Applique UN fichier, dans sa transaction, sous le verrou des migrations. */
async function appliquer(client, f, par, ctx) {
  return avecReprises(
    { nom: f.nom },
    async () => {
      try {
        await client.query("begin");
        // Verrou de TRANSACTION, et non de session : voir l'en-tête du fichier.
        // Il sérialise deux migrateurs simultanés sur ce fichier précis. Il est
        // pris AVANT de poser `lock_timeout` : attendre un autre migrateur qui
        // applique un gros fichier n'est pas bloquer l'ingestion, et ne doit
        // pas coûter une tentative.
        await client.query("select pg_advisory_xact_lock($1)", [VERROU_MIGRATION]);
        await client.query("select set_config('lock_timeout', $1, true)", [`${ctx.delais.lockTimeoutMs}ms`]);
        // Relecture SOUS verrou : pendant qu'on attendait, l'autre migrateur a
        // pu appliquer ce fichier. La décision prise avant le verrou est
        // périmée ; rejouer le SQL serait au mieux inutile.
        const { rowCount: deja } = await client.query("select 1 from schema_migration where filename = $1", [
          f.nom,
        ]);
        if (deja) {
          await client.query("commit");
          return "deja";
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
        return "appliquee";
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      }
    },
    ctx,
  );
}

/**
 * Applique ce qui manque. Renvoie le compte-rendu ; ne quitte jamais le
 * process lui-même — c'est l'appelant qui décide du code de sortie.
 *
 * `ouvrirDirecte` décide où passent les scripts de pré-déploiement :
 *   · absent : sur la connexion du migrateur elle-même (tests, base locale) ;
 *   · une fonction : elle ouvre une connexion DÉDIÉE, au plus une fois, fermée
 *     en fin de course (c'est ce que fait `main()` avec MIGRATION_DATABASE_URL) ;
 *   · `null` : aucune connexion directe fiable — les scripts sont sautés, avec
 *     un avertissement, et chaque migration garde son propre garde-fou.
 *
 * @param {import("pg").Pool} pool
 * @param {{
 *   dossier?: string, baseline?: string | null, par?: string,
 *   ouvrirDirecte?: null | (() => Promise<any>),
 *   delais?: Partial<typeof DELAIS>, journal?: typeof log,
 *   attendre?: (ms: number) => Promise<unknown>,
 * }} [options]
 */
export async function migrer(
  pool,
  {
    dossier = DOSSIER_SQL,
    baseline = null,
    par = "migrate",
    ouvrirDirecte = undefined,
    delais = {},
    journal = log,
    attendre = dormir,
  } = {},
) {
  const ctx = { journal, delais: { ...DELAIS, ...delais }, attendre };
  const fichiers = await charger(dossier);
  const client = await pool.connect();
  // Une connexion tenue pendant toute la course, parfois inactive des minutes
  // pendant qu'un index se construit ailleurs : sans écouteur, une coupure
  // réseau ferait tomber le process sur un événement « error » non écouté au
  // lieu d'échouer proprement sur la requête suivante.
  const surErreur = (err) => journal.warn("connexion du migrateur interrompue", { err: String(err?.message ?? err) });
  client.on?.("error", surErreur);
  /** @type {null | { client: any, fermer: null | (() => Promise<unknown>) }} */
  let directe = null;
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
      journal.warn("étalonnage ignoré : la base est vierge, les migrations vont s'appliquer normalement", {
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
      journal.info("étalonnage", { jusqua: baseline, marques, deja: jusque.length - marques });
      rows.push(...jusque.map((f) => ({ filename: f.nom, checksum: f.checksum })));
    }

    const { enAttente, modifies } = aFaire(fichiers, rows);

    // Un fichier modifié après coup n'est PAS rejoué : la base ne correspond
    // plus au fichier, et le rejouer serait pire. On le crie, on continue.
    for (const nom of modifies) {
      journal.warn("migration modifiée après application — la base ne correspond plus au fichier", { nom });
    }

    const predeploiements = await chargerPredeploiements(dossier, enAttente);
    const predeployes = [];
    const appliquees = [];
    for (const f of enAttente) {
      const scripts = predeploiements.get(f.nom);
      if (scripts) {
        if (ouvrirDirecte === null) {
          journal.warn(
            "pré-déploiement sauté : aucune connexion directe (DATABASE_URL passe par un pooler et MIGRATION_DATABASE_URL est absente) — la migration garde son propre garde-fou",
            { migration: f.nom, scripts: scripts.map((s) => s.nom) },
          );
        } else {
          if (!directe) {
            if (ouvrirDirecte === undefined) directe = { client, fermer: null };
            else {
              const c = await ouvrirDirecte();
              c.on?.("error", surErreur);
              directe = { client: c, fermer: () => (typeof c.release === "function" ? c.release() : c.end()) };
            }
          }
          const etat = await preDeployer(directe, client, f.nom, scripts, ctx);
          if (etat === "fait") predeployes.push(...scripts.map((s) => s.nom));
        }
        await exigerIndexValides(client, f.nom, scripts, journal);
      }

      const debut = Date.now();
      let resultat;
      try {
        resultat = await appliquer(client, f, par, ctx);
      } catch (err) {
        journal.error("migration échouée — rien de ce fichier n'a été appliqué", {
          nom: f.nom,
          err: String(err?.message ?? err),
          code: err?.code,
        });
        throw err;
      }
      if (resultat === "deja") {
        journal.info("migration déjà appliquée par un autre migrateur", { nom: f.nom });
        continue;
      }
      appliquees.push(f.nom);
      journal.info("migration appliquée", { nom: f.nom, ms: Date.now() - debut });
    }

    journal.info("migrations à jour", {
      total: fichiers.length,
      appliquees: appliquees.length,
      modifiees: modifies.length,
    });
    return { appliquees, modifies, total: fichiers.length, predeployes };
  } finally {
    client.off?.("error", surErreur);
    client.release();
    if (directe?.fermer) await Promise.resolve(directe.fermer()).catch(() => {});
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
 * Environnement :
 *   DATABASE_URL            la base (obligatoire) ; en production, le pooler Neon.
 *   MIGRATION_DATABASE_URL  la MÊME base par une connexion directe, hors pooler
 *                           (facultatif) : les scripts de pré-déploiement y passent.
 *   MIGRATE_BASELINE        étalonnage, comme --baseline.
 *
 * `dossier` n'existe qu'à l'appel programmatique (preuve sur un répertoire
 * temporaire) : la ligne de commande migre toujours le `sql/` du paquet.
 *
 * @param {{ argv?: string[], env?: Record<string, string | undefined>, dossier?: string }} [options]
 * @returns {Promise<number>} 0 = à jour, 1 = une migration a échoué, 2 = pas de base
 */
export async function main({ argv = process.argv.slice(2), env = process.env, dossier = DOSSIER_SQL } = {}) {
  const iBase = argv.indexOf("--baseline");
  const baseline = iBase !== -1 ? argv[iBase + 1] : (env.MIGRATE_BASELINE || null);
  const url = env.DATABASE_URL;
  if (!url) {
    log.error("DATABASE_URL absent");
    return 2;
  }
  // La connexion des scripts de pré-déploiement. Un pooler reconnu n'en est
  // pas une : le verrou de session n'y tiendrait pas (cf. l'en-tête).
  const urlDirecte = env.MIGRATION_DATABASE_URL || url;
  const directeFiable = !estPooler(urlDirecte);
  if (env.MIGRATION_DATABASE_URL && !directeFiable) {
    log.warn("MIGRATION_DATABASE_URL passe par un pooler : les scripts de pré-déploiement seront sautés");
  }
  const ouvrirDirecte = directeFiable
    ? async () => {
        const c = new pg.Client({ connectionString: urlDirecte, application_name: "mip-migrate-direct" });
        await c.connect();
        return c;
      }
    : null;
  // Une seule connexion suffit et le process est éphémère : pas de pool large,
  // surtout sur Neon où les connexions sont une ressource comptée.
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrer(pool, { dossier, baseline, par: env.RAILWAY_SERVICE_NAME ?? "migrate", ouvrirDirecte });
    // Un fichier modifié après application est un AVERTISSEMENT (déjà journalisé
    // par `migrer`), pas un échec : on rend 0 dans les deux cas.
    return 0;
  } catch (err) {
    // Le détail d'une migration échouée est déjà journalisé par `migrer` ; une
    // erreur survenue avant (dossier illisible, numéro en double, connexion
    // refusée) ne l'est pas encore.
    log.error("migrateur arrêté", { err: String(err?.message ?? err), code: err?.code });
    return 1;
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
