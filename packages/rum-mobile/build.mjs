import { build } from "esbuild";

const common = { entryPoints: ["src/index.ts"], bundle: true, target: "es2019", platform: "neutral", logLevel: "warning" };
// CJS (main / react-native) + ESM (module) — métro et bundlers modernes.
await build({ ...common, format: "cjs", outfile: "dist/index.js" });
await build({ ...common, format: "esm", outfile: "dist/index.mjs" });
console.log("rum-mobile -> dist/index.js + dist/index.mjs");
