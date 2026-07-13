// Rafraîchit les assets Swagger UI vendorisés dans public/vendor/swagger/ depuis
// le paquet swagger-ui-dist (devDependency épinglée). On VENDORISE (copie
// committée) plutôt que de charger un CDN : la console est « souveraine UE »,
// aucun asset ne doit venir d'un tiers externe au runtime. À relancer après un
// bump de swagger-ui-dist :  node scripts/vendor-swagger.mjs
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const src = dirname(require.resolve("swagger-ui-dist/package.json"));
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "vendor", "swagger");

mkdirSync(out, { recursive: true });
for (const f of ["swagger-ui.css", "swagger-ui-bundle.js"]) {
  copyFileSync(join(src, f), join(out, f));
  console.log(`copié ${f}`);
}
console.log(`Assets Swagger UI vendorisés dans ${out}`);
