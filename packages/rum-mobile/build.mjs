import { build } from "esbuild";

// CJS (main / react-native) + ESM (module) — Metro et bundlers modernes.
// `bundle: true` inline `@mip/rum-core` : l'artefact publié ne contient AUCUN
// import vers un autre package du dépôt, donc aucune source TypeScript non
// compilée à résoudre chez le consommateur.
const common = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  target: "es2019",
  platform: "neutral",
  logLevel: "warning",
};

await build({ ...common, format: "cjs", outfile: "dist/index.js" });
await build({ ...common, format: "esm", outfile: "dist/index.mjs" });
console.log("rum-mobile -> dist/index.js + dist/index.mjs");
