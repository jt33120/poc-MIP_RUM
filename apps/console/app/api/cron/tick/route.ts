// Tick fréquent — évaluation des alertes, SLO, sondes uptime, livraison des
// webhooks, réconciliation. Le travail vit dans `ingest/jobs/planifie.mjs`,
// partagé avec le service `scheduler` : la sonde uptime et le dispatcher ne
// sont plus écrits ici.
import { assertCronAuth, lancer } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Sonder N URLs + livrer les webhooks dépasse le défaut de 10 s.
export const maxDuration = 60;

export async function GET(req: Request) {
  return assertCronAuth(req) ?? (await lancer("tick"));
}
