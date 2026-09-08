// Garde CI : empêche d'expédier un SDK périmé ou une version qui dérive.
// 1) apps/extension/vendor/mip-rum.js DOIT être identique au SDK fraîchement buildé
//    (packages/rum-sdk/dist/mip-rum.js). Sinon l'extension collecte avec un vieux SDK.
// 2) apps/console/public/*.js AUSSI : c'est la copie que la console SERT à chaque
//    visiteur et à elle-même (dogfooding). Elle était copiée à la main et sans
//    garde, et a dérivé de onze jours sans que rien ne le signale — la console
//    servait un SDK antérieur aux signaux qu'on venait d'ajouter.
// 3) manifest.version == version du package SDK (pas de dérive silencieuse).
// Prérequis : `pnpm --filter @mip/rum-sdk build` a tourné avant (comme en CI).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../../", import.meta.url); // repo root
const rel = (p) => new URL(p, root);

function sha(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

const errors = [];

// 1) bundle SDK
const dist = rel("packages/rum-sdk/dist/mip-rum.js");
const vendor = rel("apps/extension/vendor/mip-rum.js");
try {
  const a = sha(dist);
  const b = sha(vendor);
  if (a !== b) {
    errors.push(
      `vendor/mip-rum.js désynchronisé du SDK.\n  dist   ${a}\n  vendor ${b}\n  -> lance: (cd apps/extension && node build.mjs) puis commit vendor/`,
    );
  }
} catch (e) {
  errors.push(`impossible de comparer les bundles (le SDK est-il buildé ?) : ${e.message}`);
}

// 2) bundles servis par la console (dogfooding + snippet client)
for (const nom of ["mip-rum.js", "mip-rum-replay.js"]) {
  try {
    const a = sha(rel(`packages/rum-sdk/dist/${nom}`));
    const b = sha(rel(`apps/console/public/${nom}`));
    if (a !== b) {
      errors.push(
        `apps/console/public/${nom} désynchronisé du SDK.\n  dist   ${a}\n  public ${b}\n  -> lance: cp packages/rum-sdk/dist/${nom} apps/console/public/ puis commit`,
      );
    }
  } catch (e) {
    errors.push(`impossible de comparer ${nom} côté console : ${e.message}`);
  }
}

// 3) versions
const sdkVer = JSON.parse(readFileSync(rel("packages/rum-sdk/package.json"))).version;
const manifest = JSON.parse(readFileSync(rel("apps/extension/manifest.json")));
const pkg = JSON.parse(readFileSync(rel("apps/extension/package.json")));
if (manifest.version !== sdkVer)
  errors.push(`manifest.version (${manifest.version}) != SDK (${sdkVer})`);
if (pkg.version !== sdkVer) errors.push(`extension package.json (${pkg.version}) != SDK (${sdkVer})`);

if (errors.length) {
  console.error("✘ Extension désynchronisée :\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log(`✓ Extension synchronisée (SDK ${sdkVer}, bundle identique).`);
