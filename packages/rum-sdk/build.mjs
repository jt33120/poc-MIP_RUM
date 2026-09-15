import { build } from "esbuild";
import { copyFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ["es2020"],
  logLevel: "warning",
};

await build({
  ...common,
  entryPoints: ["src/index.ts"],
  format: "iife",
  globalName: "MIPRum",
  outfile: "dist/mip-rum.js",
});
// Les deux surfaces réellement livrées doivent provenir du même build. La CI
// vérifie ensuite le diff : impossible de publier une API P2 uniquement dans dist.
copyFileSync("dist/mip-rum.js", "../../apps/console/public/mip-rum.js");
copyFileSync("dist/mip-rum.js", "../../apps/extension/vendor/mip-rum.js");
await build({
  ...common,
  entryPoints: ["src/index.ts"],
  format: "esm",
  outfile: "dist/index.mjs",
});
// v0.3 B2 — bundle replay SÉPARÉ (rrweb.record), lazy-loadé par le cœur :
// rrweb ne doit jamais entrer dans mip-rum.js
await build({
  ...common,
  entryPoints: ["src/replay-entry.ts"],
  format: "iife",
  globalName: "MIPRumReplay",
  outfile: "dist/mip-rum-replay.js",
});

const size = (file) => {
  const raw = readFileSync(file);
  return { raw: raw.length, gz: gzipSync(raw).length };
};
const fmt = ({ raw, gz }) =>
  `${(raw / 1024).toFixed(1)} KB raw  |  ${(gz / 1024).toFixed(1)} KB gzip`;

const core = size("dist/mip-rum.js");
const replay = size("dist/mip-rum-replay.js");
console.log(`dist/mip-rum.js         ${fmt(core)}`);
console.log(`dist/mip-rum-replay.js  ${fmt(replay)}`);

if (core.gz > 35 * 1024) {
  console.error(
    "❌ bundle CŒUR > 35 KB gzip (budget ROADMAP v0.3 B2) — rrweb doit rester dans mip-rum-replay.js",
  );
  process.exitCode = 1;
}
// garde-fou : si rrweb fuyait hors du bundle replay, celui-ci deviendrait minuscule
if (replay.gz < 5 * 1024) {
  console.error("❌ bundle replay anormalement petit — rrweb.record absent ?");
  process.exitCode = 1;
}
