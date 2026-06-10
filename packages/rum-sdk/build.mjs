import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const common = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ["es2020"],
  logLevel: "warning",
};

await build({
  ...common,
  format: "iife",
  globalName: "MIPRum",
  outfile: "dist/mip-rum.js",
});
await build({ ...common, format: "esm", outfile: "dist/index.mjs" });

const raw = readFileSync("dist/mip-rum.js");
const gz = gzipSync(raw).length;
console.log(
  `dist/mip-rum.js  ${(raw.length / 1024).toFixed(1)} KB raw  |  ${(gz / 1024).toFixed(1)} KB gzip`,
);
if (gz > 30 * 1024) {
  console.warn("⚠️  bundle gzip > 30 KB (cible PLAN §6.4)");
}
