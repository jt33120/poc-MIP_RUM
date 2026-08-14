// Tick horaire — remplace les jobs pg_cron `refresh_rum_rollups` (5 * * * *),
// `mip-new-errors` (*/15) et `mip-ai-op-anomaly` (*/30).
//
// ⚠ Fréquence RÉDUITE pour les deux derniers : ils tournaient toutes les 15 et
// 30 minutes sous pg_cron, ils passent à l'heure. Raison : Vercel Cron facture
// et plafonne le NOMBRE de jobs déclarés, et grouper évite d'en déclarer un par
// fonction. Conséquence assumée : une nouvelle erreur ou une anomalie IA peut
// mettre jusqu'à une heure à lever une alerte, contre 15/30 min avant. Si ce
// délai devient gênant, sortir ces deux appels dans leur propre route avec leur
// propre planification.
import { assertCronAuth, callFn, runSteps } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = assertCronAuth(req);
  if (denied) return denied;

  return runSteps([
    // Pré-agrégat horaire (lu par la console si RUM_USE_ROLLUPS=1).
    { name: "refresh_rum_rollups", run: () => callFn("refresh_rum_rollups(26)") },
    { name: "check_new_errors", run: () => callFn("check_new_errors()") },
    { name: "check_ai_op_anomalies", run: () => callFn("check_ai_op_anomalies()") },
  ]);
}
