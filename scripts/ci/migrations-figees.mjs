#!/usr/bin/env node
// Garde CI : une migration fusionnée ne se modifie plus.
//
//   node scripts/ci/migrations-figees.mjs <base>      (en CI : origin/master)
//
// POURQUOI. Le migrateur (`@mip/db/migrate.mjs`) retient chaque fichier appliqué
// par son NOM et son empreinte. Un fichier modifié après application n'est PAS
// rejoué — le rejouer serait pire —, il est seulement signalé : « migration
// modifiée après application — la base ne correspond plus au fichier ». À partir
// de là, une base neuve (recette, CI, auto-hébergement) et la production ne
// sont plus le même schéma, et rien ne le dit ailleurs que dans un journal de
// pré-déploiement. C'est arrivé : le relevé du 23/09/2026 porte cet avertissement
// sur `schema.sql`. La seule parade est d'empêcher la modification AVANT la
// fusion : c'est ce script.
//
// CE QUI EST FIGÉ. Les fichiers que le registre retient, et eux seuls :
// `packages/db/sql/schema.sql` et `packages/db/sql/migration-vNN.sql`.
//   · `pending/` n'est pas figé : rien n'y est appliqué.
//   · `predeploy-vNN-*.sql` non plus : ils ne vont pas au registre, ne passent
//     que tant que leur migration est en attente, et sont idempotents (le
//     remodelage P1 en a d'ailleurs réécrit les commentaires).
//
// LA RÈGLE, fichier par fichier, entre la base de fusion et HEAD (c'est la
// comparaison de `git diff <base>...HEAD`) :
//   · ajouté ............................. accepté, SI son numéro dépasse la
//     dernière migration de la base. Une v45 glissée dans un trou, ou une v87
//     qui arrive après qu'une autre branche a fusionné sa v88, passerait APRÈS
//     v88 en production et AVANT sur une base neuve : renuméroter ;
//   · modifié, ou changé de type ......... refusé ;
//   · supprimé ........................... refusé (le registre le garde : une
//     base neuve n'aurait plus ce que la production a) ;
//   · déplacé à contenu IDENTIQUE, même nom de fichier ... accepté. Le registre
//     est indexé par nom, pas par chemin : c'est ce qui a permis à P1 de
//     déménager `apps/ingest/sql` vers `packages/db/sql`. Renommé (v50 → v51)
//     ou déplacé ET modifié : refusé.
// La comparaison se fait sur le contenu (identifiants de blob), sans compter sur
// la détection de renommage de git, dont le seuil dépend du nombre de fichiers
// touchés par la branche.
//
// ÉCHAPPATOIRE : AUCUNE, et c'est voulu — ni label, ni variable. Une
// échappatoire dans le script serait utilisée le jour où l'on est pressé, qui
// est précisément le jour où la production diverge sans bruit. Une migration
// fusionnée qui se trompe se CORRIGE par une nouvelle migration (numéro
// suivant). Le seul cas qui l'interdit — un fichier fusionné qui casse une base
// VIERGE, qu'aucune migration postérieure ne peut réparer puisqu'il échoue
// avant — relève d'une décision humaine hors de ce script : un administrateur
// fusionne en passant outre la vérification (geste tracé sur la PR), puis
// réaligne à la main l'empreinte en production
// (`update schema_migration set checksum = '<sha256 du nouveau fichier>'
//   where filename = '<fichier>'`), faute de quoi l'avertissement du migrateur
// reste vrai.
//
// Codes de sortie : 0 = rien à redire ; 1 = au moins une violation ; 2 = la
// comparaison est impossible (base introuvable, clone superficiel, git absent).
// Une comparaison impossible n'est JAMAIS un succès.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Le dossier du registre. */
export const DOSSIER = "packages/db/sql";

/**
 * Emplacements antérieurs du même dossier. Tant qu'une base de comparaison les
 * contient (avant la fusion de P1), un fichier qui en part pour `DOSSIER` sans
 * changer de contenu est un DÉMÉNAGEMENT, pas une suppression. Inerte ensuite.
 */
export const ANCIENS_DOSSIERS = ["apps/ingest/sql"];

const DOSSIERS = [DOSSIER, ...ANCIENS_DOSSIERS];
const RE_MIGRATION = /^migration-v(\d+)\.sql$/;

/** Le fichier est-il retenu par le registre (schema.sql ou migration-vNN.sql, À LA RACINE d'un dossier suivi) ? */
export function estFige(chemin) {
  const dossier = path.posix.dirname(chemin);
  const nom = path.posix.basename(chemin);
  return DOSSIERS.includes(dossier) && (nom === "schema.sql" || RE_MIGRATION.test(nom));
}

/** Numéro d'une migration, `null` pour schema.sql. */
export function numero(chemin) {
  const m = RE_MIGRATION.exec(path.posix.basename(chemin));
  return m ? Number(m[1]) : null;
}

/**
 * Lit la sortie de `git diff --raw -z --no-abbrev --no-renames` :
 * `:<mode> <mode> <blob avant> <blob après> <statut>\0<chemin>\0`, répété.
 * @returns {Array<{ statut: string, chemin: string, avant: string, apres: string }>}
 */
export function lireDiffRaw(sortie) {
  const morceaux = sortie.split("\0");
  const entrees = [];
  for (let i = 0; i + 1 < morceaux.length; i += 2) {
    const meta = morceaux[i];
    if (!meta.startsWith(":")) continue;
    const [, , avant, apres, statut] = meta.slice(1).split(" ");
    entrees.push({ statut: statut[0], chemin: morceaux[i + 1], avant, apres });
  }
  return entrees;
}

/**
 * Le verdict, sans git : pur, donc testable ligne à ligne.
 * @param {Array<{ statut: string, chemin: string, avant: string, apres: string }>} entrees
 * @param {{ maxBase: number | null }} base  numéro de la dernière migration de la base
 */
export function analyser(entrees, { maxBase }) {
  const figees = entrees.filter((e) => estFige(e.chemin));
  const ajouts = figees.filter((e) => e.statut === "A");
  const consommes = new Set();
  const violations = [];
  const deplacees = [];
  const ajoutees = [];

  for (const e of figees) {
    if (e.statut === "M" || e.statut === "T") {
      violations.push({ chemin: e.chemin, raison: "modifiée après fusion — écrire une nouvelle migration" });
    } else if (e.statut === "D") {
      const nom = path.posix.basename(e.chemin);
      const cible = ajouts.find((a) => !consommes.has(a) && path.posix.basename(a.chemin) === nom);
      if (!cible) {
        violations.push({ chemin: e.chemin, raison: "supprimée ou renommée — le registre la retient par son nom" });
      } else {
        consommes.add(cible);
        if (cible.apres === e.avant) deplacees.push({ de: e.chemin, vers: cible.chemin });
        else violations.push({ chemin: cible.chemin, raison: `déplacée depuis ${e.chemin} ET modifiée` });
      }
    } else if (e.statut !== "A") {
      // C, U, X… : rien de tout cela ne devrait toucher une migration fusionnée.
      violations.push({ chemin: e.chemin, raison: `changement inattendu (statut ${e.statut})` });
    }
  }

  for (const a of ajouts) {
    if (consommes.has(a)) continue;
    const n = numero(a.chemin);
    if (n != null && maxBase != null && n <= maxBase) {
      violations.push({
        chemin: a.chemin,
        raison: `ajoutée sous la dernière migration de la base (v${maxBase}) : elle passerait après v${maxBase} en production et avant sur une base neuve — renuméroter au-delà`,
      });
    } else ajoutees.push(a.chemin);
  }
  return { violations, deplacees, ajoutees };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Compare HEAD à sa base de fusion avec `base`.
 * @param {{ base: string, cwd?: string }} options
 */
export function verifierMigrationsFigees({ base, cwd = process.cwd() }) {
  let fusion;
  try {
    fusion = git(["merge-base", base, "HEAD"], cwd).trim();
  } catch (err) {
    const detail = String(err?.stderr ?? err?.message ?? err).trim();
    throw Object.assign(
      new Error(
        `base de comparaison introuvable (« ${base} ») : ${detail || "pas de base de fusion"}. ` +
          "En CI, récupérer l'historique de la base (actions/checkout avec fetch-depth: 0, ou git fetch origin master).",
      ),
      { code: "BASE_INTROUVABLE" },
    );
  }
  const avant = git(["ls-tree", "--name-only", fusion, "--", ...DOSSIERS.map((d) => `${d}/`)], cwd)
    .split("\n")
    .filter((c) => estFige(c));
  const numeros = avant.map(numero).filter((n) => n != null);
  const maxBase = numeros.length ? Math.max(...numeros) : null;
  const sortie = git(["diff", "--raw", "-z", "--no-abbrev", "--no-renames", fusion, "HEAD", "--", ...DOSSIERS], cwd);
  return { fusion, maxBase, ...analyser(lireDiffRaw(sortie), { maxBase }) };
}

/** Programme : rend le code de sortie, ne quitte pas lui-même. */
export function main(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env } = {}) {
  const base = argv[0];
  if (!base || base.startsWith("-")) {
    console.error("usage : node scripts/ci/migrations-figees.mjs <base>   (ex. origin/master)");
    return 2;
  }
  let r;
  try {
    r = verifierMigrationsFigees({ base, cwd });
  } catch (err) {
    console.error(`migrations-figees : ${err.message}`);
    return 2;
  }
  const annoter = env.GITHUB_ACTIONS === "true";
  console.log(
    `migrations-figees : base de fusion ${r.fusion.slice(0, 12)} (dernière migration v${r.maxBase ?? "—"}) — ` +
      `${r.ajoutees.length} ajoutée(s), ${r.deplacees.length} déplacée(s) à l'identique, ${r.violations.length} violation(s)`,
  );
  for (const a of r.ajoutees) console.log(`  + ${a}`);
  for (const v of r.violations) {
    console.error(`  ✗ ${v.chemin} : ${v.raison}`);
    if (annoter) console.log(`::error file=${v.chemin}::Migration figée : ${v.raison}`);
  }
  if (r.violations.length) {
    console.error(
      "Une migration fusionnée ne se modifie plus : la production ne la rejouera pas. " +
        "Écrire une nouvelle migration (voir l'en-tête de ce script).",
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
