// Empreinte d'un secret d'identité — la valeur à poser dans IDENTITY_HASH_FINGERPRINT.
//
// POURQUOI SUR L'ENTRÉE STANDARD. Un secret passé en argument finit dans
// l'historique du shell et dans `ps` ; en variable d'environnement, dans les
// journaux d'un outil qui les vide. Par stdin, il ne touche ni l'un ni l'autre :
//
//   pbpaste | node scripts/ops/empreinte-identite.mjs
//   railway variables --service collector --json | jq -r .IDENTITY_HASH_SECRET \
//     | node scripts/ops/empreinte-identite.mjs
//
// Le calcul est CELUI du collector (`empreinteIdentite`, séparation de domaine
// comprise) : un outil qui le recopierait finirait par en diverger. Seule
// l'empreinte sort — jamais le secret, même tronqué. Un saut de ligne final
// (celui d'`echo` ou d'un presse-papiers) est retiré : Railway ne le stocke
// pas non plus. Un secret plus court que 32 caractères est refusé, comme au
// démarrage du collector.
import { empreinteIdentite } from "../../packages/backend/lib/identity-hash.mjs";

const MIN = 32;

let brut = "";
process.stdin.setEncoding("utf8");
for await (const morceau of process.stdin) brut += morceau;
const secret = brut.replace(/\r?\n$/, "");

if (!secret) {
  console.error("secret attendu sur l'entrée standard (rien reçu)");
  process.exit(2);
}
if (secret.length < MIN) {
  console.error(`secret trop court : ${MIN} caractères au minimum (le collector le refuserait)`);
  process.exit(2);
}
process.stdout.write(`${empreinteIdentite(secret)}\n`);
