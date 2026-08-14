// Tick quotidien (03:17 UTC) — remplace les jobs pg_cron `mip-purge-daily`
// (rétention) et `mip-meter-daily` (metering/facturation).
//
// `purge_rum_tenants` (migration-v14) et non `purge_rum` (v09) : la v14 respecte
// la rétention PAR CLIENT (app_registry.retention_days), la v09 applique un
// délai global. Les deux jobs pg_cron portaient le même nom
// `mip-purge-daily` — le second écrasait le premier, donc c'est bien la version
// multi-tenant qui tournait en prod. Même comportement ici.
import { assertCronAuth, callFn, runSteps } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// La purge parcourt toutes les tables de télémétrie dans l'ordre des FK.
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = assertCronAuth(req);
  if (denied) return denied;

  return runSteps([
    { name: "purge_rum_tenants", run: () => callFn("purge_rum_tenants(30)") },
    // meter_tenant_usage() par défaut sur CURRENT_DATE - 1 : la veille est
    // complète à 03:17 UTC, contrairement au jour courant.
    { name: "meter_tenant_usage", run: () => callFn("meter_tenant_usage()") },
  ]);
}
