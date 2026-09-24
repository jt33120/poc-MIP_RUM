#!/usr/bin/env node
// Garde de construction d'image : ce que `pnpm deploy` a posé est ce que le
// lockfile du dépôt a figé, paquet par paquet, empreinte par empreinte.
//
//   node scripts/ci/deploy-fidele.mjs <pnpm-lock.yaml> <dossier déployé>
//
// Appelé par chaque `services/<x>/Dockerfile`, juste après `pnpm deploy`.
//
// POURQUOI. La recette des images est `pnpm fetch → install --offline → build
// → pnpm deploy --prod` (contrat de service § 9). Les deux premières étapes
// garantissent que rien ne s'installe hors du lockfile. La dernière, sous
// pnpm 9, NE LE GARANTIT PAS : `deploy` réécrit les dépendances de workspace
// (`workspace:*` → `file:`), ce qui périme l'entrée du service dans le lockfile,
// et il RÉSOUT de nouveau ses dépendances — en préférant les versions déjà
// verrouillées, sans y être tenu. Constaté en construisant : hors ligne, il
// réclame les métadonnées du registre pour `pg@8.21.0`, que `pnpm fetch` ne met
// pas en cache (ERR_PNPM_NO_OFFLINE_META). Il tourne donc en ligne, et une
// dépendance transitive publiée entre deux constructions pourrait entrer dans
// l'image sans passer par le lockfile, donc sans relecture. (pnpm 10 déploie
// depuis le lockfile partagé ; la migration de pnpm est un autre chantier.)
//
// Plutôt que de croire la préférence, on la VÉRIFIE : chaque paquet du
// registre présent dans l'arbre déployé doit figurer dans `pnpm-lock.yaml` à la
// même version ET avec la même empreinte d'intégrité. Les paquets du workspace
// (`file:`) sont hors du champ : leur contenu vient des sources copiées, pas
// d'un registre.
//
// Codes de sortie : 0 = fidèle ; 1 = au moins un écart ; 2 = comparaison
// impossible (fichier absent, format illisible). Une comparaison impossible
// n'est JAMAIS un succès : un lockfile dont le format change ne doit pas faire
// passer toutes les images en silence.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Où pnpm écrit le lockfile de l'arbre déployé, relatif au dossier déployé. */
export const LOCK_DEPLOYE = "node_modules/.pnpm/lock.yaml";

// Une entrée de la section `packages:` d'un lockfile v9 : la clé à deux espaces
// (entre apostrophes quand elle commence par `@`), puis sa `resolution` sur la
// ligne suivante. La section `snapshots:` a les mêmes clés mais jamais de
// `resolution` : elle ne matche pas, et c'est voulu — on compare des tarballs,
// pas des graphes de pairs.
const ENTREE = /^ {2}(?:'([^']+)'|([^\s'][^\s]*)):\n {4}resolution: (\{[^\n]*\})$/gm;

/**
 * @param {string} texte contenu d'un lockfile pnpm v9
 * @returns {Map<string, string>} `nom@version` → texte de sa `resolution`
 */
export function resolutions(texte) {
  const m = new Map();
  for (const r of texte.matchAll(ENTREE)) m.set(r[1] ?? r[2], r[3]);
  return m;
}

/** Un paquet du workspace, posé depuis les sources et non depuis un registre. */
export function estWorkspace(cle, resolution) {
  return cle.includes("@file:") || resolution.includes("type: directory");
}

/**
 * @param {string} lockDepot `pnpm-lock.yaml` du dépôt
 * @param {string} lockDeploye lockfile de l'arbre déployé
 * @returns {{ verifies: number, ecarts: { paquet: string, raison: string }[] }}
 */
export function comparer(lockDepot, lockDeploye) {
  const depot = resolutions(lockDepot);
  const deploye = resolutions(lockDeploye);
  if (depot.size === 0) throw new Error("lockfile du dépôt illisible : aucune entrée `packages:` reconnue");
  if (deploye.size === 0) throw new Error("lockfile déployé illisible : aucune entrée `packages:` reconnue");
  const ecarts = [];
  let verifies = 0;
  for (const [cle, resolution] of deploye) {
    if (estWorkspace(cle, resolution)) continue;
    const attendue = depot.get(cle);
    if (attendue === undefined) ecarts.push({ paquet: cle, raison: "absent du lockfile du dépôt" });
    else if (attendue !== resolution) ecarts.push({ paquet: cle, raison: `empreinte différente (${resolution} ≠ ${attendue})` });
    else verifies += 1;
  }
  return { verifies, ecarts };
}

/** Programme : rend le code de sortie, ne quitte pas lui-même. */
export function main(argv = process.argv.slice(2)) {
  const [lockfile, dossier] = argv;
  if (!lockfile || !dossier) {
    console.error("usage : node scripts/ci/deploy-fidele.mjs <pnpm-lock.yaml> <dossier déployé>");
    return 2;
  }
  let r;
  try {
    r = comparer(readFileSync(lockfile, "utf8"), readFileSync(path.join(dossier, LOCK_DEPLOYE), "utf8"));
  } catch (err) {
    console.error(`deploy-fidele : ${err.message}`);
    return 2;
  }
  for (const e of r.ecarts) console.error(`  ✗ ${e.paquet} : ${e.raison}`);
  if (r.ecarts.length) {
    console.error(
      `deploy-fidele : ${r.ecarts.length} paquet(s) de ${dossier} hors du lockfile. ` +
        "L'image embarquerait du code que personne n'a relu : mettre le lockfile à jour dans une PR.",
    );
    return 1;
  }
  console.log(`deploy-fidele : ${r.verifies} paquet(s) du registre, tous conformes au lockfile`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
