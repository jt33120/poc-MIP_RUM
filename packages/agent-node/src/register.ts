// Entrée de PRÉCHARGEMENT (`node -r @mip/agent-node/register`) : elle n'a qu'un
// effet de bord — installer le runtime. Tout le comportement vit dans runtime.ts,
// que l'API publique (index.ts) partage par le registre global de symboles : il
// n'existe donc qu'un seul patch de console/http/pg et un seul contexte de
// requête, que l'application précharge l'agent, l'importe, ou les deux.
// Construit par esbuild (dist/register.js, CJS).
import { runtime } from "./runtime";

const agent = runtime();

if (!agent.cfg.enabled) {
  if (process.env.MIP_RUM_DEBUG) {
    console.warn("[mip-agent] désactivé : définir MIP_RUM_ENDPOINT et MIP_RUM_APP_ID");
  }
} else {
  agent.installer();
}
