// Tick fréquent (toutes les 5 min) — remplace les jobs pg_cron `mip-slo-burn`,
// `mip-uptime` et `reconcile-alert-deliveries`, plus l'évaluation des règles
// d'alerte et la livraison des webhooks.
//
// Pourquoi la livraison est ici et non en base : elle passait par `pg_net`
// (`net.http_post`), extension INDISPONIBLE sur Neon — ce n'est pas une
// question de configuration, l'extension est refusée. Le dispatcher Node
// existait déjà pour le cas local (apps/ingest/dispatch-alerts.mjs) ; il
// devient le seul chemin, appelé ici.
import { dispatchOnce } from "ingest/dispatch-alerts.mjs";
import { pool } from "@/lib/db";
import { q } from "@/lib/db";
import { assertCronAuth, callFn, log, runSteps } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Sonder N URLs + livrer les webhooks dépasse le défaut de 10 s.
export const maxDuration = 60;

/**
 * Sonde les checks actifs et enregistre le résultat — portage de l'edge
 * function `uptime` (disparue avec le projet Supabase). `record_uptime_result`
 * gère l'alerte sur bascule UP->DOWN, donc rien de cette logique ne bouge.
 */
async function probeUptime() {
  const checks = await q<{
    id: string;
    url: string;
    method: string | null;
    expect_status: number | null;
    timeout_ms: number | null;
  }>("select id, url, method, expect_status, timeout_ms from uptime_check where enabled");

  let ran = 0;
  let down = 0;
  await Promise.all(
    checks.map(async (c) => {
      const started = Date.now();
      let ok = false;
      let status: number | null = null;
      let error: string | null = null;
      try {
        const res = await fetch(c.url, {
          method: c.method ?? "GET",
          redirect: "follow", // on juge le statut FINAL
          signal: AbortSignal.timeout(c.timeout_ms ?? 10_000),
        });
        // draine le corps pour libérer la connexion (sinon fuite de sockets)
        await res.arrayBuffer().catch(() => {});
        status = res.status;
        ok = res.status === (c.expect_status ?? 200);
        if (!ok) error = `HTTP ${res.status}`;
      } catch (e) {
        error = String((e as { message?: string })?.message ?? e).slice(0, 200);
      }
      ran++;
      if (!ok) down++;
      await q("select record_uptime_result($1, $2, $3, $4, $5)", [
        c.id,
        ok,
        status,
        Date.now() - started,
        error,
      ]).catch((err) => log.error("record_uptime_result failed", { check_id: c.id, err: String(err) }));
    }),
  );
  return { ran, down };
}

export async function GET(req: Request) {
  const denied = assertCronAuth(req);
  if (denied) return denied;

  return runSteps([
    // Évaluation des règles : insère les alert_event + les livraisons 'queued'.
    { name: "check_alerts", run: () => callFn("check_alerts()") },
    { name: "check_slo_burn", run: () => callFn("check_slo_burn()") },
    { name: "uptime", run: probeUptime },
    // Livraison effective des webhooks en attente (remplace pg_net).
    { name: "dispatch_alerts", run: () => dispatchOnce(pool) },
    // Réconciliation des livraisons 'sent' héritées de l'ère pg_net : sans
    // pg_net la fonction ne trouve rien à rapprocher, mais elle reste correcte
    // et bon marché — la garder évite de laisser des lignes 'sent' éternelles.
    { name: "reconcile_deliveries", run: () => callFn("reconcile_alert_deliveries()") },
  ]);
}
