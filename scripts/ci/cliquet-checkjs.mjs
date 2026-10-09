#!/usr/bin/env node
// Garde CI : le JavaScript du backend ne gagne pas d'erreur de typage.
//
//   node scripts/ci/cliquet-checkjs.mjs            vérifie (CI)
//   node scripts/ci/cliquet-checkjs.mjs --ecrire   réécrit le relevé après une baisse
//
// POURQUOI UN CLIQUET ET PAS UN BLOCAGE. Au premier passage de `checkJs` sur le
// backend (08/10/2026), TypeScript relevait une centaine d'erreurs dans du code
// en service depuis des semaines : surtout des inférences trop étroites (un
// `{}` par défaut dont on lit ensuite `.log`, une union d'objets littéraux), peu
// de vraies fautes. Les corriger d'un coup aurait touché tout `packages/backend`
// pendant que d'autres chantiers y travaillent. Le cliquet fige le compte : une
// PR qui en ajoute échoue, une PR qui en retire réécrit le relevé (`--ecrire`).
// Quand le compte atteint zéro, le job devient un simple `tsc -p` bloquant.
//
// Le compte est tenu PAR FICHIER : une erreur corrigée ici ne doit pas payer une
// erreur ajoutée ailleurs.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const RELEVE = "scripts/ci/cliquet-checkjs.json";
const ecrire = process.argv.includes("--ecrire");

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
let sortie = "";
try {
  sortie = execFileSync(process.execPath, [tsc, "-p", "tsconfig.backend.json", "--pretty", "false"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // tsc sort en 1 (ou 2) dès qu'il y a une erreur : la sortie reste lisible.
  if (typeof err.stdout !== "string") throw err;
  sortie = err.stdout;
}

/** @type {Record<string, number>} */
const actuel = {};
for (const ligne of sortie.split("\n")) {
  const m = /^(.+?)\(\d+,\d+\): error TS\d+:/.exec(ligne);
  if (m) actuel[m[1]] = (actuel[m[1]] ?? 0) + 1;
}
// Une erreur sans fichier (configuration, option inconnue) n'est pas comptable :
// c'est le cliquet lui-même qui est cassé.
const globales = sortie.split("\n").filter((l) => /^error TS\d+:/.test(l));
if (globales.length) {
  console.error(`checkJs : erreur de configuration\n${globales.join("\n")}`);
  process.exit(1);
}

const trie = Object.fromEntries(Object.entries(actuel).sort(([a], [b]) => a.localeCompare(b)));
const total = Object.values(trie).reduce((s, n) => s + n, 0);

if (ecrire) {
  writeFileSync(RELEVE, `${JSON.stringify({ total, fichiers: trie }, null, 2)}\n`);
  console.log(`checkJs : relevé réécrit, ${total} erreur(s) dans ${Object.keys(trie).length} fichier(s)`);
  process.exit(0);
}

const releve = JSON.parse(readFileSync(RELEVE, "utf8"));
const hausses = [];
const baisses = [];
for (const f of new Set([...Object.keys(releve.fichiers), ...Object.keys(trie)])) {
  const avant = releve.fichiers[f] ?? 0;
  const apres = trie[f] ?? 0;
  if (apres > avant) hausses.push(`  ${f} : ${avant} → ${apres}`);
  else if (apres < avant) baisses.push(`  ${f} : ${avant} → ${apres}`);
}

if (hausses.length) {
  console.error(`checkJs : des erreurs de typage en plus dans le backend (relevé ${releve.total}, maintenant ${total})`);
  console.error(hausses.join("\n"));
  console.error("\nDétail : node node_modules/typescript/bin/tsc -p tsconfig.backend.json");
  process.exit(1);
}
if (baisses.length) {
  console.log(`checkJs : ${releve.total - total} erreur(s) en moins — réécrire le relevé :`);
  console.log("  node scripts/ci/cliquet-checkjs.mjs --ecrire");
  console.log(baisses.join("\n"));
  // Un relevé trop haut laisserait revenir les erreurs corrigées : on le refuse.
  process.exit(1);
}
console.log(`checkJs : ${total} erreur(s), comme le relevé`);
