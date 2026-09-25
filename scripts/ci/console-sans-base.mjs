#!/usr/bin/env node
// LES GARDES DE M4 (C12) — « la console n'a plus de base » : ce qui le PROUVE.
//
//   node scripts/ci/console-sans-base.mjs            relevé : imprime ce qui reste, sort en 0
//   node scripts/ci/console-sans-base.mjs --strict   garde : sort en 1 au premier reste
//
// Aujourd'hui, le relevé tourne en CI et dit ce qu'il reste à couper. La bascule
// vers console-api garde son chemin local (le retour arrière, par drapeau) : la
// console importe encore ses chargeurs. La décommission (C12, après le rodage en
// mode strict) retire ce chemin et passe le relevé en `--strict` ; à partir de là,
// une régression rougit la CI. Trois gardes, celles du plan (C12) :
//
//   1. IMPORTS. Aucun fichier de `apps/console` (hors tests et artefacts) n'importe
//      — statiquement ou dynamiquement — `pg`, `bcryptjs`, ni un paquet backend
//      (`@mip/backend`, `@mip/db`, `@mip/analytics`, `@mip/control`).
//   2. TRAÇAGE DU BUILD. Après `next build`, aucun `.nft.json` de `.next/server` ne
//      liste `pg`, `pg-protocol`, `bcryptjs` ni ces paquets, et aucun fichier
//      serveur ne contient `pg-protocol`. Nécessaire parce que `pg` est aussi une
//      dépendance de la RACINE : un import oublié se résoudrait quand même.
//   3. ENVIRONNEMENT. Tenue par `apps/console/next.config.mjs` elle-même
//      (`MIP_CONSOLE_SANS_BASE=1`) : le build refuse de se faire si une variable de
//      base ou un secret d'identité est présent. Ici, on vérifie seulement que la
//      garde est là.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSOLE = path.join(RACINE, "apps", "console");

/** Les modules que la console sans base n'a plus le droit de charger. */
export const INTERDITS = /^(pg|pg-native|pg-protocol|bcryptjs|@mip\/(backend|db|analytics|control))(\/|$)/;
const IGNORES = new Set(["node_modules", ".next", "test-results", "public"]);

/** Tous les spécificateurs importés par un source (statique, dynamique, `require`, `export … from`). */
export function specificateurs(source) {
  const trouves = [];
  const motifs = [
    /\bimport\s+(?:type\s+)?[^'"]*?from\s*["']([^"']+)["']/g,
    /\bexport\s+[^'"]*?from\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const m of motifs) for (const r of source.matchAll(m)) trouves.push({ spec: r[1], type: /^import\s+type\b/.test(r[0]) });
  return trouves;
}

/** Garde 1 : les fichiers de la console qui importent un module interdit (hors `import type`, effacé au build). */
export function importsInterdits(racine = CONSOLE) {
  const fautes = [];
  (function parcourir(dossier) {
    for (const nom of readdirSync(dossier)) {
      if (IGNORES.has(nom)) continue;
      const p = path.join(dossier, nom);
      if (statSync(p).isDirectory()) parcourir(p);
      else if (/\.(ts|tsx|mjs|js)$/.test(nom) && !/\.d\.ts$/.test(nom)) {
        for (const { spec, type } of specificateurs(readFileSync(p, "utf8"))) {
          if (!type && INTERDITS.test(spec)) fautes.push(`${path.relative(racine, p)} → ${spec}`);
        }
      }
    }
  })(racine);
  return fautes;
}

/** Garde 2 : ce que le traçage du build embarque dans les fonctions serveur. */
export function traceInterdite(dossierNext = path.join(CONSOLE, ".next")) {
  const serveur = path.join(dossierNext, "server");
  if (!existsSync(serveur)) return null;
  const fautes = new Set();
  const MOTIF = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(pg|pg-protocol|pg-native|bcryptjs|@mip\/(?:backend|db|analytics|control))\//;
  (function parcourir(dossier) {
    for (const nom of readdirSync(dossier)) {
      const p = path.join(dossier, nom);
      if (statSync(p).isDirectory()) parcourir(p);
      else if (nom.endsWith(".nft.json")) {
        const { files = [] } = JSON.parse(readFileSync(p, "utf8"));
        for (const f of files) {
          const m = MOTIF.exec(f.replace(/\\/g, "/"));
          if (m) fautes.add(`${path.relative(serveur, p)} trace ${m[1]}`);
        }
      } else if (/\.(js|mjs)$/.test(nom) && readFileSync(p, "utf8").includes("pg-protocol")) {
        fautes.add(`${path.relative(serveur, p)} contient pg-protocol`);
      }
    }
  })(serveur);
  return [...fautes];
}

/** Garde 3 : la garde d'environnement est-elle en place dans next.config ? */
export function gardeEnvironnement(config = path.join(CONSOLE, "next.config.mjs")) {
  const texte = readFileSync(config, "utf8");
  return texte.includes("MIP_CONSOLE_SANS_BASE") && texte.includes("VARIABLES_DE_BASE");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const strict = process.argv.includes("--strict");
  const imports = importsInterdits();
  const trace = traceInterdite();
  const env = gardeEnvironnement();
  const parFichier = new Map();
  for (const f of imports) {
    const fichier = f.split(" → ")[0];
    parFichier.set(fichier, (parFichier.get(fichier) ?? 0) + 1);
  }
  console.log(`console sans base — ${strict ? "GARDE (--strict)" : "relevé"}`);
  console.log(`  1. imports interdits : ${imports.length} dans ${parFichier.size} fichier(s)`);
  for (const f of imports.slice(0, strict ? imports.length : 15)) console.log(`     · ${f}`);
  if (!strict && imports.length > 15) console.log(`     … et ${imports.length - 15} de plus`);
  if (trace === null) console.log("  2. traçage du build : pas de .next/server (lancer après `next build`)");
  else {
    const fonctions = new Set(trace.map((f) => f.split(" ")[0]));
    console.log(`  2. traçage du build : ${fonctions.size} fonction(s) serveur embarquent la base`);
    for (const f of trace.slice(0, strict ? trace.length : 10)) console.log(`     · ${f}`);
  }
  console.log(`  3. garde d'environnement dans next.config.mjs : ${env ? "présente" : "ABSENTE"}`);
  const restes = imports.length + (trace?.length ?? 0) + (env ? 0 : 1);
  if (strict && restes) {
    console.error(`::error::console sans base : ${restes} reste(s)`);
    process.exit(1);
  }
}
