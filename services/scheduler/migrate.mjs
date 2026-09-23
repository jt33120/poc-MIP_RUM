// Pré-déploiement du service `scheduler` : applique les migrations SQL en attente.
//
// POURQUOI UN FICHIER DE CÂBLAGE ICI, et pas le fichier du migrateur directement
// dans la commande Railway. La commande de pré-déploiement vit dans
// `.railway/railway.ts` ; le migrateur, lui, déménage au gré du code (P1 : de
// l'ancien paquet « ingest » vers `packages/db/migrate.mjs`, spécificateur
// `@mip/db/migrate.mjs`). Si la
// commande pointait sur le fichier du noyau, un renommage changerait À LA FOIS
// le code et l'infrastructure, dans deux systèmes qui ne se déploient pas
// ensemble — et une commande de pré-déploiement qui pointe dans le vide fait
// échouer chaque déploiement du scheduler. Ce chemin-ci, lui, est STABLE : le
// renommage n'a changé que l'import ci-dessous, jamais la commande.
//
// Seul le scheduler migre (contrat de service, règle 8) : c'est le service dont
// la disparition se verrait tout de suite. Le programme lui-même — registre,
// verrou de transaction, étalonnage — est dans `main()` du migrateur.
import { main } from "@mip/db/migrate.mjs";
import { createLogger } from "@mip/backend/shared/log.mjs";

const log = createLogger("migrate");

// Fail-fast, comme le worker. Sans DATABASE_URL il n'y a rien à migrer : on le
// dit et on refuse, plutôt que de laisser partir un déploiement dont le schéma
// n'a pas été vérifié. `main()` refuserait aussi ; le dire ICI rend le refus
// indépendant de ce que fera le migrateur après son déménagement.
if (!process.env.DATABASE_URL) {
  log.error("DATABASE_URL absent — le pré-déploiement refuse de migrer");
  process.exit(2);
}

// Code de sortie non nul = pré-déploiement en échec = Railway garde l'ancien
// déploiement en service. C'est exactement ce qu'on veut d'une migration ratée.
process.exitCode = await main();
