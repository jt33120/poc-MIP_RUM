#!/usr/bin/env node
// Codemod du remodelage P1 : `apps/ingest` éclaté en `packages/backend`,
// `packages/db` et `services/collector`, `apps/mcp` devenu `packages/mcp-tools`.
//
//   node scripts/dev/codemod-backend.mjs --dry-run   liste ce qu'il changerait
//   node scripts/dev/codemod-backend.mjs             l'applique
//
// POURQUOI UN SCRIPT, ET PAS UNE SUITE DE `sed` À LA MAIN. Le renommage touche
// des centaines de spécificateurs, dans le code, la config et les documents.
// Fait à la main, il se fait une fois, sur une base qui aura bougé le temps que
// la PR soit relue. Écrit ici, il se REJOUE : on repart de `master` à jour, on
// relance, on obtient le même résultat — et la relecture porte sur les règles,
// pas sur huit cents lignes de diff.
//
// IDEMPOTENT. Relancé sur un arbre déjà transformé, il ne trouve plus rien :
// aucun fichier ne reste sous les anciens chemins, et aucune règle de texte ne
// retombe sur son propre résultat (`@mip/backend/lib/` ne contient pas
// `"ingest/lib/`). Un fichier ajouté entre-temps sous `apps/ingest/` est, lui,
// déplacé au passage suivant : c'est ce qui rend le rejeu après rebase sûr.
//
// L'ORDRE DES RÈGLES EST LE CONTRAT (plan P1, PR-B). Chaque chemin prend la
// PREMIÈRE règle qui le couvre : `_shared` doit passer avant « le reste de
// apps/ingest », sinon il atterrirait sous `packages/backend/supabase/…`.
//
// CE QU'IL NE FAIT PAS, À DESSEIN :
//   - toucher aux documents HISTORIQUES (docs/archive/**, CHANGELOG.md,
//     BUILD_LOG.md) : ils décrivent le passé, avec les chemins du passé ;
//   - toucher aux fichiers de migration déjà appliqués (schema.sql,
//     migration-vNN.sql) : le migrateur les identifie par empreinte sha256, et
//     réécrire un commentaire y ferait crier « migration modifiée après
//     application » à chaque déploiement de production ;
//   - les manifestes (noms de paquets, dépendances), le lockfile, les
//     Dockerfiles : ce sont des décisions, pas des substitutions — ils sont
//     écrits à la main, dans un commit à part.
//
// Zéro dépendance : node et git suffisent.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SEC = process.argv.includes("--dry-run");
const RACINE = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...args) => execFileSync("git", args, { cwd: RACINE, encoding: "utf8", maxBuffer: 64 << 20 });

// ---------------------------------------------------------------------------
// 1. DÉPLACEMENTS — règles 1 à 6 et 10 du plan, dans cet ordre.
// ---------------------------------------------------------------------------
// Un préfixe finissant par « / » couvre un dossier ; sinon, un fichier exact.
const DEPLACEMENTS = [
  ["apps/ingest/supabase/functions/_shared/", "packages/backend/shared/"], // 1
  ["apps/ingest/sql/", "packages/db/sql/"], // 2
  ["apps/ingest/migrate.mjs", "packages/db/migrate.mjs"], // 3
  ["services/ingest/", "services/collector/"], // 4
  ["apps/ingest/dev-server.mjs", "services/collector/dev-server.mjs"], // 4
  ["apps/ingest/replay-dev-server.mjs", "services/collector/replay-dev-server.mjs"], // 4
  ["apps/ingest/dispatch-alerts.mjs", "packages/backend/lib/dispatch-alerts.mjs"], // 5
  ["apps/ingest/", "packages/backend/"], // 6
  ["apps/mcp/", "packages/mcp-tools/"], // 10
];

/** Où va ce chemin (fichier ou dossier) ? Identité s'il ne bouge pas. */
export function destination(p) {
  for (const [de, vers] of DEPLACEMENTS) {
    if (de.endsWith("/") ? p.startsWith(de) || p + "/" === de : p === de) {
      return p + "/" === de ? vers.slice(0, -1) : vers + p.slice(de.length);
    }
  }
  return p;
}

// Les paquets de bibliothèque : un import qui FRANCHIT une frontière de paquet
// doit passer par le nom du paquet, jamais par `../../` — dans les images
// Docker, les paquets vivent sous node_modules/@mip/*, pas côte à côte.
const PAQUETS = [
  ["packages/backend/", "@mip/backend/"],
  ["packages/db/", "@mip/db/"],
  ["packages/mcp-tools/", "@mip/mcp-tools/"],
  ["services/collector/", null],
  ["services/scheduler/", null],
  ["services/mcp/", null],
];
const paquetDe = (p) => PAQUETS.find(([racine]) => p.startsWith(racine)) ?? null;

// Spécificateurs relatifs : import/export … from, import(), require(),
// vi.mock(), new URL(…, import.meta.url), et `import "./x"`.
const SPEC_RELATIF =
  /((?:\bfrom|\bimport|\brequire|\bvi\.mock|\bvi\.importActual(?:<[^>]*>)?|\bnew URL)\s*\(?\s*)(["'])(\.\.?\/[^"'\n]*)\2/g;

/** Réécrit les imports relatifs d'un fichier déplacé de `ancien` vers `nouveau`. */
export function reciblerRelatifs(contenu, ancien, nouveau) {
  return contenu.replace(SPEC_RELATIF, (tout, avant, q, spec) => {
    const dossierFinal = spec.endsWith("/") ? "/" : "";
    const cibleAncienne = path.posix.normalize(path.posix.join(path.posix.dirname(ancien), spec));
    const cible = destination(cibleAncienne);
    const chez = paquetDe(nouveau);
    const la = paquetDe(cible);
    let nouveauSpec;
    if (la && la !== chez && la[1]) {
      nouveauSpec = la[1] + cible.slice(la[0].length);
    } else {
      nouveauSpec = path.posix.relative(path.posix.dirname(nouveau), cible);
      if (!nouveauSpec.startsWith(".")) nouveauSpec = "./" + nouveauSpec;
    }
    nouveauSpec += nouveauSpec.endsWith("/") ? "" : dossierFinal;
    return nouveauSpec === spec ? tout : `${avant}${q}${nouveauSpec}${q}`;
  });
}

// ---------------------------------------------------------------------------
// 2. TEXTE — chemins cités et spécificateurs nus (règles 1 à 11).
// ---------------------------------------------------------------------------
const REGLES_TEXTE = [
  ["1 _shared", /apps\/ingest\/supabase\/functions\/_shared\b/g, "packages/backend/shared"],
  // 1 bis : le même dossier cité SANS le préfixe du paquet — la liste
  // `FICHIERS_CODE` du planificateur de reprises (relative à la racine du
  // paquet) et les commentaires qui nomment « _shared/otlp.mjs ».
  ["1 _shared (relatif)", /(?<![\w-])(?:supabase\/functions\/)?_shared\//g, "shared/"],
  ["2 sql", /apps\/ingest\/sql\b/g, "packages/db/sql"],
  ["3 migrate", /apps\/ingest\/migrate\b/g, "packages/db/migrate"],
  ["4 dev-server", /apps\/ingest\/((?:replay-)?dev-server)\b/g, "services/collector/$1"],
  ["4 collector", /services\/ingest\b/g, "services/collector"],
  ["5 dispatch-alerts", /apps\/ingest\/dispatch-alerts\b/g, "packages/backend/lib/dispatch-alerts"],
  ["6 backend", /apps\/ingest\b/g, "packages/backend"],
  // 2, 6 bis : les mêmes chemins écrits en SEGMENTS — `join(RACINE, "apps",
  // "ingest", "sql")`, la forme de la plupart des tests SQL.
  ["2 sql (segments)", /(["'])apps\1(\s*,\s*)\1ingest\1(\s*,\s*)\1sql\1/g, "$1packages$1$2$1db$1$3$1sql$1"],
  ["6 backend (segments)", /(["'])apps\1(\s*,\s*)\1ingest\1/g, "$1packages$1$2$1backend$1"],
  // 7 à 9 : ANCRÉS SUR LE GUILLEMET (ou l'accent grave d'un document). Sans
  // ancrage, `apps/ingest/lib/` et `…/node_modules/ingest/lib/` seraient
  // réécrits aussi, en chemins qui n'existent pas.
  ["7 spécificateur", /(["'`])ingest\/(lib|jobs|shared)\//g, "$1@mip/backend/$2/"],
  ["8 spécificateur", /(["'`])ingest\/dispatch-alerts\.mjs/g, "$1@mip/backend/lib/dispatch-alerts.mjs"],
  ["9 spécificateur", /(["'`])ingest\/migrate\.mjs/g, "$1@mip/db/migrate.mjs"],
  ["10 mcp-tools", /apps\/mcp\b/g, "packages/mcp-tools"],
  ["10 spécificateur", /\bmip-mcp\//g, "@mip/mcp-tools/"],
];
// 11 : les deux imports relatifs du catalogue MCP depuis la console.
const REGLE_CATALOGUE = [
  "11 catalogue",
  /(["'])(?:\.\.\/)+mcp\/lib\/catalogue\.mjs\1/g,
  '"@mip/mcp-tools/lib/catalogue.mjs"',
];

const HISTORIQUE = [/^docs\/archive\//, /^CHANGELOG\.md$/, /^BUILD_LOG\.md$/];
const EXCLUS = [
  /^pnpm-lock\.yaml$/, // régénéré par pnpm install
  /^scripts\/dev\/codemod-backend\.mjs$/, // ses propres règles citent les anciens chemins
  /^(apps\/ingest|packages\/db)\/sql\/(schema|migration-v\d+)\.sql$/, // empreintes du registre
  // Ses chemins surveillés sont l'UNION des anciens et des nouveaux (PR-A2) :
  // les réécrire effacerait les anciens avant que le déménagement soit déployé.
  /^\.railway\/railway\.ts$/,
];

function appliquerTexte(fichier, contenu, compte) {
  let s = contenu;
  const regles = fichier.startsWith("apps/console/") ? [...REGLES_TEXTE, REGLE_CATALOGUE] : REGLES_TEXTE;
  for (const [nom, re, par] of regles) {
    s = s.replace(re, (...m) => {
      compte[nom] = (compte[nom] ?? 0) + 1;
      return m[0].replace(new RegExp(re.source), par);
    });
  }
  return s;
}

// Un octet nul trahit un binaire — sauf dans un SOURCE, où il peut être voulu :
// `lib/backfills/error-groups.mjs` sépare ses clés composites par un \0
// littéral. Sauter ce fichier sur ce critère laissait un import cassé.
const SOURCE = /\.(mjs|cjs|js|ts|tsx|json|md|ya?ml|sql|sh|txt)$/;
const estBinaire = (f, buf) => !SOURCE.test(f) && buf.subarray(0, 8000).includes(0);

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------
const suivis = git("ls-files", "-z").split("\0").filter(Boolean);

// Phase 1 : déplacements, fichier par fichier (`git mv` : l'historique suit).
const deplaces = new Map(); // nouveau chemin -> ancien chemin
for (const f of suivis) {
  const d = destination(f);
  if (d === f) continue;
  deplaces.set(d, f);
}
console.log(`${SEC ? "[à blanc] " : ""}${deplaces.size} fichier(s) à déplacer`);
for (const [nouveau, ancien] of deplaces) {
  if (SEC) {
    console.log(`  mv ${ancien} -> ${nouveau}`);
    continue;
  }
  mkdirSync(path.join(RACINE, path.dirname(nouveau)), { recursive: true });
  git("mv", ancien, nouveau);
}

// Phase 2 : texte. En mode à blanc, on lit les fichiers à leur place ACTUELLE.
const tous = SEC ? suivis : git("ls-files", "-z").split("\0").filter(Boolean);
const bilan = {};
let modifies = 0;
for (const f of tous) {
  if (EXCLUS.some((re) => re.test(f)) || HISTORIQUE.some((re) => re.test(f))) continue;
  const lieu = path.join(RACINE, f);
  if (!existsSync(lieu)) continue;
  const buf = readFileSync(lieu);
  if (estBinaire(f, buf)) continue;
  const avant = buf.toString("utf8");
  const nouveau = SEC ? destination(f) : f;
  const ancien = SEC ? f : (deplaces.get(f) ?? f);
  let apres = avant;
  const compte = {};
  if (ancien !== nouveau && /\.(mjs|js|ts|tsx)$/.test(f)) {
    const recible = reciblerRelatifs(apres, ancien, nouveau);
    if (recible !== apres) compte["imports relatifs recalculés"] = 1;
    apres = recible;
  }
  apres = appliquerTexte(nouveau, apres, compte);
  if (apres === avant) continue;
  modifies++;
  for (const [k, v] of Object.entries(compte)) bilan[k] = (bilan[k] ?? 0) + v;
  if (SEC) console.log(`  réécrit ${nouveau}  ${JSON.stringify(compte)}`);
  else writeFileSync(lieu, apres);
}
console.log(`${SEC ? "[à blanc] " : ""}${modifies} fichier(s) réécrit(s)`, bilan);

// Phase 3 (règle 12) : la vitrine publique lit le document de couverture via
// un JSON EXTRAIT. Réécrire le document sans régénérer l'extraction ferait
// citer à `/presentation` des chemins morts.
if (!SEC && modifies > 0) {
  execFileSync("node", ["scripts/couverture-extraire.mjs"], { cwd: RACINE, stdio: "inherit" });
}
