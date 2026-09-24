// Préchargement de la sonde de banc dans un processus de SERVICE (le collector).
//
//   BENCH_SONDE_FICHIER=/tmp/sonde.json \
//     node --import ./scripts/bench/sonde-pg-preload.mjs services/collector/server.mjs
//
// Puis `kill -USR2 <pid>` : le relevé accumulé depuis le vidage précédent est
// écrit dans BENCH_SONDE_FICHIER (écriture atomique : fichier temporaire puis
// renommage, le pilote ne lit jamais un JSON à moitié écrit), et la sonde
// repart de zéro.
//
// POURQUOI LE `pg` DU COLLECTOR, RÉSOLU DEPUIS SON MANIFESTE. Node met un module
// en cache par chemin RÉEL : patcher un autre exemplaire de `pg` que celui
// qu'importe `services/collector/server.mjs` ne mesurerait rien, en silence.
// On le résout donc exactement comme lui (depuis `services/collector/`), et on
// journalise le chemin retenu. Un relevé à zéro lot dirait la même chose, trop
// tard.
//
// SIGUSR2 et pas un point HTTP : le collector ne doit exposer aucune route de
// banc, et SIGUSR2 n'est utilisé ni par Node (SIGUSR1 = inspecteur) ni par le
// kit (SIGTERM, SIGINT).
import { writeFileSync, renameSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { installerSonde } from "./sonde-pg.mjs";

const fichier = process.env.BENCH_SONDE_FICHIER;
if (!fichier) {
  console.error("[sonde-pg] BENCH_SONDE_FICHIER est obligatoire (chemin du relevé écrit à chaque SIGUSR2)");
  process.exit(2);
}

const depuis = new URL(process.env.BENCH_SONDE_DEPUIS ?? "../../services/collector/package.json", import.meta.url);
const exiger = createRequire(depuis);
const pg = exiger("pg");
const sonde = installerSonde(pg);
console.error(`[sonde-pg] sonde installée sur ${realpathSync(exiger.resolve("pg"))}`);

process.on("SIGUSR2", () => {
  const releve = sonde.vider();
  const tmp = `${fichier}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ecritLe: performance.timeOrigin + performance.now(), ...releve }));
  renameSync(tmp, fichier);
});
