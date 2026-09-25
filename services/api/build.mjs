// Construit le service `api` : UN fichier, `dist/server.mjs`, qui embarque les
// routes de l'API v1 de la console et tout ce qu'elles lisent.
//
// POURQUOI UN BUNDLE. Les lectures de l'API v1 vivent dans la console
// (`apps/console/lib/queries*`, en TypeScript, avec l'alias `@/`). Les déplacer
// dans un paquet est le travail de la piste C ; en attendant, esbuild compile ce
// graphe tel quel, avec quatre substitutions (`shims/`) :
//   next/server, next/headers   → NextRequest/NextResponse/after, sans Next ;
//   lib/auth.ts                 → aucune session : l'API publique est au jeton ;
//   lib/db.ts, lib/log-forward.ts → le pool du kit (`mip-api`), le journal du service ;
//   lib/api-relay.ts            → aucun relais : ce service EST la cible du relais ;
//   lib/ingest-relay.ts         → aucun relais vers le collector (C11 : le marqueur de
//                                 déploiement, une écriture que ce service refuse).
// Seul `pg` reste externe (installé dans l'image).
//
// LES GARDES, APRÈS CONSTRUCTION — un bundle qui les viole n'est pas écrit :
//   · ni `apps/console/lib/auth.ts`, ni `jose` dans le métafichier : le secret et
//     la vérification des sessions de la console ne doivent pas pouvoir entrer ici ;
//   · ni `dev-secret-mip-rum` (le secret de session de développement) dans le code ;
//   · aucun module `next/…` réel ;
//   · ni le relais de la console, ni `lib/platform-flag.ts` : le service ne
//     relaie pas, et `mip_api` n'a pas à lire `platform_flag`.
import { build } from "esbuild";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cheminDuFichier } from "./routeur.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..", "..");
const CONSOLE = path.join(RACINE, "apps", "console");
const APP = path.join(CONSOLE, "app");

/** Les fichiers de route servis : l'API v1 entière, et le résumé partenaire. */
export function fichiersDeRoutes() {
  const trouves = [];
  (function parcourir(dossier) {
    for (const nom of readdirSync(dossier)) {
      const p = path.join(dossier, nom);
      if (statSync(p).isDirectory()) parcourir(p);
      else if (nom === "route.ts") trouves.push(p);
    }
  })(path.join(APP, "api", "v1"));
  trouves.push(path.join(APP, "api", "rum", "summary", "route.ts"));
  return trouves.sort();
}

/** Les modules de la console remplacés, par chemin absolu SANS extension. */
const SUBSTITUTIONS = new Map([
  [path.join(CONSOLE, "lib", "auth"), path.join(ICI, "shims", "auth.mjs")],
  [path.join(CONSOLE, "lib", "db"), path.join(ICI, "shims", "db.mjs")],
  [path.join(CONSOLE, "lib", "log-forward"), path.join(ICI, "shims", "log-forward.mjs")],
  [path.join(CONSOLE, "lib", "api-relay"), path.join(ICI, "shims", "api-relay.mjs")],
  [path.join(CONSOLE, "lib", "ingest-relay"), path.join(ICI, "shims", "ingest-relay.mjs")],
]);

const substitutions = {
  name: "mip-api-substitutions",
  setup(b) {
    b.onResolve({ filter: /^next\/server$/ }, () => ({ path: path.join(ICI, "shims", "next-server.mjs") }));
    b.onResolve({ filter: /^next\/headers$/ }, () => ({ path: path.join(ICI, "shims", "next-headers.mjs") }));
    b.onResolve({ filter: /(^|\/)(auth|db|log-forward|api-relay|ingest-relay)(\.ts)?$/ }, (args) => {
      if (!args.importer.startsWith(CONSOLE)) return undefined;
      const brut = args.path.replace(/\.ts$/, "");
      const absolu = brut.startsWith("@/") ? path.join(CONSOLE, brut.slice(2)) : path.resolve(args.resolveDir, brut);
      const remplacant = SUBSTITUTIONS.get(absolu);
      return remplacant ? { path: remplacant } : undefined;
    });
    // La table des routes, module virtuel généré depuis l'arborescence.
    b.onResolve({ filter: /^mip:routes$/ }, () => ({ path: "routes", namespace: "mip-routes" }));
    b.onLoad({ filter: /.*/, namespace: "mip-routes" }, () => {
      const fichiers = fichiersDeRoutes();
      const lignes = fichiers.map((f, i) => `import * as r${i} from ${JSON.stringify(f)};`);
      const table = fichiers.map((f, i) => `{ chemin: ${JSON.stringify(cheminDuFichier(path.relative(APP, f)))}, module: r${i} }`);
      return { contents: `${lignes.join("\n")}\nexport const ROUTES = [\n  ${table.join(",\n  ")}\n];\n`, resolveDir: RACINE, loader: "js" };
    });
  },
};

/**
 * Ce qu'un bundle de l'API publique ne doit JAMAIS contenir. Pure : les entrées
 * du métafichier et le code produit.
 * @returns {string[]} les fautes, vide si le bundle est acceptable
 */
export function fautesDuBundle(entrees, code) {
  const fautes = [];
  const normalisees = entrees.map((e) => e.replace(/\\/g, "/"));
  if (normalisees.some((e) => e.endsWith("apps/console/lib/auth.ts"))) fautes.push("lib/auth.ts de la console est dans le bundle");
  if (normalisees.some((e) => /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?jose\//.test(e))) fautes.push("jose est dans le bundle");
  if (normalisees.some((e) => /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?next\//.test(e))) fautes.push("un module next/ réel est dans le bundle");
  if (code.includes("dev-secret-mip-rum")) fautes.push("le secret de session de développement est dans le bundle");
  if (normalisees.some((e) => /apps\/console\/lib\/(api-relay|ingest-relay|platform-flag)\.ts$/.test(e))) {
    fautes.push("le relais de la console (ou sa lecture de platform_flag) est dans le bundle : le service est la cible du relais");
  }
  return fautes;
}

export async function construire({ ecrire = true } = {}) {
  const resultat = await build({
    entryPoints: [path.join(ICI, "server.mjs")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outfile: path.join(ICI, "dist", "server.mjs"),
    write: false,
    metafile: true,
    sourcemap: "linked",
    external: ["pg", "pg-native"],
    alias: { "@": CONSOLE },
    // Les paquets du workspace et `pg`, résolus depuis le service même quand
    // c'est un fichier de la console qui les importe : dans l'image, la console
    // n'a pas de node_modules.
    nodePaths: [path.join(ICI, "node_modules")],
    plugins: [substitutions],
    // Un module ESM embarqué qui appelle `require` (dépendances CommonJS) en a besoin.
    banner: { js: "import { createRequire as __mipCreateRequire } from 'node:module'; const require = __mipCreateRequire(import.meta.url);" },
    logLevel: "warning",
    legalComments: "none",
  });

  const entrees = Object.keys(resultat.metafile.inputs);
  const code = resultat.outputFiles.find((f) => f.path.endsWith(".mjs"))?.text ?? "";
  const fautes = fautesDuBundle(entrees, code);
  if (fautes.length) throw new Error(`bundle refusé : ${fautes.join(" ; ")}`);

  if (ecrire) {
    mkdirSync(path.join(ICI, "dist"), { recursive: true });
    for (const f of resultat.outputFiles) writeFileSync(f.path, f.contents);
    writeFileSync(path.join(ICI, "dist", "meta.json"), JSON.stringify(resultat.metafile));
  }
  return { entrees, routes: fichiersDeRoutes().length, octets: code.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = await construire();
  console.log(`api : ${r.routes} fichiers de route, ${r.entrees.length} modules, ${Math.round(r.octets / 1024)} Kio → dist/server.mjs`);
}
