import { build } from "esbuild";

// Deux formats, parce que trois consommateurs : le SDK web (ESM, bundlé par
// esbuild), le SDK React Native (CJS pour Metro, ESM pour les bundlers
// modernes) et l'agent Node (CJS). `platform: "neutral"` interdit toute
// résolution implicite vers un module natif Node : un import interdit casse ici
// le build, pas chez le client.
//
// Volontairement NON minifié : chaque consommateur minifie son propre bundle, et
// du code déjà minifié empêcherait de lire un diff de taille.
const common = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  target: "es2019",
  platform: "neutral",
  logLevel: "warning",
};

await build({ ...common, format: "esm", outfile: "dist/index.mjs" });
await build({ ...common, format: "cjs", outfile: "dist/index.js" });
console.log("rum-core -> dist/index.js + dist/index.mjs");
