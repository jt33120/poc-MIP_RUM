import { build } from "esbuild";

// Agent Node -> un seul fichier CJS préchargeable (node -r). core.ts est bundlé
// dedans ; aucune dépendance runtime (uniquement node:* + fetch global >= Node 18).
await build({
  entryPoints: ["src/register.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "dist/register.js",
  logLevel: "warning",
});
console.log("agent-node -> dist/register.js");
