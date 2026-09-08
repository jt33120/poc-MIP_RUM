// Tick horaire — rollups, nouvelles erreurs, anomalies IA. Le travail vit dans
// `ingest/jobs/planifie.mjs`, partagé avec le service `scheduler`.
import { assertCronAuth, lancer } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  return assertCronAuth(req) ?? (await lancer("horaire"));
}
