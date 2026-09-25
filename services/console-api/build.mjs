// CONSTRUIT `dist/server.mjs` : le point d'entrée et `@mip/console-api` (TypeScript),
// en un seul module ESM. `pg` reste externe (module natif facultatif, et le seul
// paquet de l'image).
//
// LES CHARGEURS D'ÉCRANS (C2 → C5). Les lectures des écrans vivent dans la
// console (`apps/console/lib/`, en TypeScript, alias `@/`) : le service embarque
// ses CHARGEURS (`lib/chargeurs/*`) et ce qu'ils lisent, à l'octet près — même
// procédé que le service `api` pour les routes v1. Quatre substitutions (`shims/`) :
//   lib/db.ts          → le pool du kit (`mip-console-api`), injecté par server.mjs ;
//   lib/log-forward.ts → le journal du service ;
//   next/server, next/navigation → `after` et `unstable_rethrow`, sans Next.
//
// LA GARDE DU BUILD. De la console, seule sa COUCHE DE DONNÉES entre : jamais un
// écran (`app/`), un composant (`components/`), ni ce qui tient une session ou
// parle à ce service (`lib/auth.ts`, `lib/session-console.ts`, `lib/backend.ts`) ;
// jamais un module `next/…` réel ni React. Un bundle qui en contient est refusé.
//
//   node services/console-api/build.mjs        écrit dist/server.mjs et dist/meta.json
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..", "..");
const CONSOLE = path.join(RACINE, "apps", "console");

/** Les modules de la console remplacés, par chemin absolu SANS extension. */
const SUBSTITUTIONS = new Map([
  [path.join(CONSOLE, "lib", "db"), path.join(ICI, "shims", "db.mjs")],
  [path.join(CONSOLE, "lib", "log-forward"), path.join(ICI, "shims", "log-forward.mjs")],
]);

const substitutions = {
  name: "mip-console-api-substitutions",
  setup(b) {
    b.onResolve({ filter: /^next\/server$/ }, () => ({ path: path.join(ICI, "shims", "next-server.mjs") }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: path.join(ICI, "shims", "next-navigation.mjs") }));
    b.onResolve({ filter: /(^|\/)(db|log-forward)(\.ts)?$/ }, (args) => {
      if (!args.importer.startsWith(CONSOLE)) return undefined;
      const brut = args.path.replace(/\.ts$/, "");
      const absolu = brut.startsWith("@/") ? path.join(CONSOLE, brut.slice(2)) : path.resolve(args.resolveDir, brut);
      const remplacant = SUBSTITUTIONS.get(absolu);
      return remplacant ? { path: remplacant } : undefined;
    });
  },
};

/** Ce qui, de la console, n'a rien à faire dans le service. */
const INTERDITS_CONSOLE = [
  /apps\/console\/app\//,
  /apps\/console\/components\//,
  /apps\/console\/lib\/(auth|session-console|backend|db)\.ts$/,
];

/** Les fautes d'un bundle, d'après ses fichiers d'entrée. Vide : accepté. */
export function fautesDuBundle(entrees) {
  const fautes = [];
  const n = entrees.map((e) => e.replace(/\\/g, "/"));
  const hors = n.filter((f) => /(^|\/)apps\//.test(f) && !/(^|\/)apps\/console\/lib\//.test(f));
  if (hors.length) fautes.push(`le service importe l'application hors de sa couche de données : ${hors.slice(0, 5).join(", ")}`);
  const interdits = n.filter((f) => INTERDITS_CONSOLE.some((r) => r.test(f)));
  if (interdits.length) fautes.push(`le service importe ce qui tient une session ou parle à lui-même : ${interdits.slice(0, 5).join(", ")}`);
  if (n.some((f) => /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(next|react|react-dom)\//.test(f))) fautes.push("un module next/ ou React réel est dans le bundle");
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
    // Les paquets importés par la couche de données de la console, résolus depuis
    // le service : dans l'image, la console n'a pas de node_modules.
    nodePaths: [path.join(ICI, "node_modules")],
    plugins: [substitutions],
    banner: { js: "import { createRequire as __mipCreateRequire } from 'node:module'; const require = __mipCreateRequire(import.meta.url);" },
    logLevel: "warning",
    legalComments: "none",
  });
  const entrees = Object.keys(resultat.metafile.inputs);
  const fautes = fautesDuBundle(entrees);
  if (fautes.length) throw new Error(`bundle refusé : ${fautes.join(" ; ")}`);
  if (ecrire) {
    mkdirSync(path.join(ICI, "dist"), { recursive: true });
    for (const f of resultat.outputFiles) writeFileSync(f.path, f.contents);
    writeFileSync(path.join(ICI, "dist", "meta.json"), JSON.stringify(resultat.metafile));
  }
  return { entrees, octets: resultat.outputFiles.find((f) => f.path.endsWith(".mjs"))?.contents.byteLength ?? 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { entrees, octets } = await construire();
  console.log(`console-api : dist/server.mjs (${Math.round(octets / 1024)} Kio, ${entrees.length} fichiers)`);
}
