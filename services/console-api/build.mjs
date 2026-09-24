// CONSTRUIT `dist/server.mjs` : le point d'entrée et `@mip/console-api` (TypeScript),
// en un seul module ESM. `pg` reste externe (module natif facultatif, et le seul
// paquet de l'image).
//
// LA GARDE DU BUILD. `console-api` sert la console ; il n'en IMPORTE rien. La
// console dépend du contrat, le service du contrat et de ses paquets : jamais
// l'inverse, jamais les deux sens (plan backend, § « où vit le code »). Un bundle
// qui contient un fichier de `apps/` est refusé : c'est le signe qu'un traitement
// a pris un raccourci vers la console au lieu de passer par un paquet.
//
//   node services/console-api/build.mjs        écrit dist/server.mjs et dist/meta.json
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ICI = path.dirname(fileURLToPath(import.meta.url));

/** Les fautes d'un bundle, d'après ses fichiers d'entrée. Vide : accepté. */
export function fautesDuBundle(entrees) {
  const fautes = [];
  const console_ = entrees.filter((f) => /(^|\/)apps\//.test(f));
  if (console_.length) fautes.push(`le service importe l'application : ${console_.slice(0, 5).join(", ")}`);
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
