// Tick quotidien (03:17 UTC) — purge de rétention par client et comptage du
// volume. Le travail vit dans `ingest/jobs/planifie.mjs`, partagé avec le
// service `scheduler` ; cette route n'est qu'un déclencheur authentifié.
import { assertCronAuth, lancer } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// La purge parcourt toutes les tables de télémétrie dans l'ordre des FK.
export const maxDuration = 300;

export async function GET(req: Request) {
  return assertCronAuth(req) ?? (await lancer("quotidien"));
}
