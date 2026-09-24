#!/usr/bin/env node
// FABRIQUER ET FAIRE TOURNER les clés de signature des sessions (ES256).
//
// Trois gestes, et aucun n'écrit de fichier : la sortie va dans le presse-papiers
// (`| pbcopy`), puis dans la variable. Un jeu privé n'a rien à faire sur un disque,
// dans un dépôt, un ticket ou une conversation.
//
//   node scripts/ops/generer-cles-session.mjs --nouvelle | pbcopy
//        un jeu PRIVÉ d'une clé → variable `SESSION_SIGNING_KEYS` (console-api, Railway)
//   pbpaste | node scripts/ops/generer-cles-session.mjs --publique | pbcopy
//        sa partie PUBLIQUE → `SESSION_PUBLIC_JWKS` (console, Vercel ; non secrète)
//   pbpaste | node scripts/ops/generer-cles-session.mjs --rotation | pbcopy
//        le jeu privé courant + une clé neuve EN SECONDE position (elle ne signe pas
//        encore) → publier d'abord sa clé publique sur Vercel, puis la passer en tête
//        (`--promouvoir`), puis retirer l'ancienne 8 h plus tard (`--retirer`)
//
// Le `kid` dit la date : `session-AAAAMMJJ-xxxx`. Jamais « test » ni « dev » :
// console-api refuse ces clés hors d'un poste de travail.
import { webcrypto as crypto } from "node:crypto";

function kidDuJour() {
  const jour = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const alea = Buffer.from(crypto.getRandomValues(new Uint8Array(3))).toString("hex");
  return `session-${jour}-${alea}`;
}

async function nouvelleCle(kid = kidDuJour()) {
  const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", paire.privateKey);
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, kid, alg: "ES256", use: "sig" };
}

async function lireEntree() {
  let texte = "";
  for await (const morceau of process.stdin) texte += morceau;
  let jeu;
  try {
    jeu = JSON.parse(texte);
  } catch {
    throw new Error("entrée illisible : un jeu JWKS {\"keys\":[…]} est attendu sur l'entrée standard");
  }
  if (!Array.isArray(jeu?.keys) || !jeu.keys.length) throw new Error("jeu JWKS vide");
  return jeu;
}

const publique = ({ kty, crv, x, y, kid, alg, use }) => ({ kty, crv, x, y, kid, alg, use });

async function main(argv) {
  const geste = argv.find((a) => a.startsWith("--")) ?? "--aide";
  let sortie;
  switch (geste) {
    case "--nouvelle":
      sortie = { keys: [await nouvelleCle()] };
      break;
    case "--publique":
      sortie = { keys: (await lireEntree()).keys.map(publique) };
      break;
    case "--rotation": {
      const jeu = await lireEntree();
      if (jeu.keys.length !== 1) throw new Error("rotation : partir d'un jeu d'UNE clé (la courante)");
      sortie = { keys: [jeu.keys[0], await nouvelleCle()] };
      break;
    }
    case "--promouvoir": {
      const jeu = await lireEntree();
      if (jeu.keys.length !== 2) throw new Error("promouvoir : partir du jeu de rotation (deux clés)");
      sortie = { keys: [jeu.keys[1], jeu.keys[0]] };
      break;
    }
    case "--retirer": {
      const jeu = await lireEntree();
      if (jeu.keys.length !== 2) throw new Error("retirer : partir du jeu de rotation promu (deux clés)");
      sortie = { keys: [jeu.keys[0]] };
      break;
    }
    default:
      console.error("usage : --nouvelle | --publique | --rotation | --promouvoir | --retirer (voir l'en-tête du script)");
      process.exit(2);
  }
  process.stdout.write(JSON.stringify(sortie));
  const kids = sortie.keys.map((k) => k.kid).join(", ");
  console.error(`${geste.slice(2)} : ${sortie.keys.length} clé(s) — ${kids}${sortie.keys.some((k) => k.d) ? " (PRIVÉES : presse-papiers, puis variable Railway)" : " (publiques)"}`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
