import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

// Sortie dans vendor/ (PAS dist/ : dist/ est gitignoré repo-large, mais une
// extension chargée "unpacked" a besoin de tous ses fichiers committés — pas de
// build serveur intermédiaire comme pour la console). Service worker MV3 — ESM
// (manifest.background.type="module"), pas de minify (POC lisible en dev).
mkdirSync("vendor", { recursive: true });
await build({
  entryPoints: ["src/background.ts"],
  bundle: true,
  format: "esm",
  target: ["chrome111"], // injection MAIN world (chrome.scripting world:"MAIN") requiert >=111
  outfile: "vendor/background.js",
  logLevel: "warning",
});

// Popup (Ext-C) : transparence + octroi de permission (chrome.permissions.request,
// geste utilisateur satisfait par le clic sur l'icône qui ouvre ce popup).
await build({
  entryPoints: ["src/popup.ts"],
  bundle: true,
  format: "esm",
  target: ["chrome111"],
  outfile: "vendor/popup.js",
  logLevel: "warning",
});

// Le capteur navigateur réutilise LE MÊME bundle SDK que le script classique —
// aucune divergence de logique de collecte entre les deux modes RUM.
copyFileSync("../../packages/rum-sdk/dist/mip-rum.js", "vendor/mip-rum.js");

console.log("vendor/background.js + vendor/popup.js + vendor/mip-rum.js (copié depuis packages/rum-sdk/dist) prêts.");
