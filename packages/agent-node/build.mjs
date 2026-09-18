import { build } from "esbuild";

// Deux entrées, un seul runtime. `register` est préchargeable (`node -r`),
// `index` est l'API publique importée par l'application. Chacune bundle sa copie
// de runtime.ts ; à l'exécution, elles se rejoignent sur le registre global de
// symboles, si bien que console/http/pg ne sont patchés qu'une fois.
// Aucune dépendance runtime (uniquement node:* + fetch global >= Node 18).
for (const entree of ["register", "index"]) {
  await build({
    entryPoints: [`src/${entree}.ts`],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    outfile: `dist/${entree}.js`,
    logLevel: "warning",
  });
}
console.log("agent-node -> dist/register.js, dist/index.js");
