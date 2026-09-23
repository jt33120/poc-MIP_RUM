// Edge function Supabase (Deno) — monitoring SYNTHÉTIQUE (uptime).
// Déclenchée toutes les 5 min par pg_cron via pg_net (migration-v42). Lit les
// checks actifs (uptime_check), sonde chaque URL avec fetch (timeout par check),
// et écrit le résultat via le RPC record_uptime_result() qui alerte sur bascule
// UP->DOWN. verify_jwt=off : la fonction n'accepte aucune donnée, elle ne fait
// que sonder les URLs DÉJÀ configurées en base — surface d'abus quasi nulle.
// @ts-nocheck deno runtime
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createLogger } from "../../../shared/log.mjs";

const log = createLogger("uptime");
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function probe(check: {
  url: string;
  method?: string;
  expect_status?: number;
  timeout_ms?: number;
}): Promise<{ ok: boolean; status: number | null; latency: number; error: string | null }> {
  const started = Date.now();
  try {
    const res = await fetch(check.url, {
      method: check.method ?? "GET",
      redirect: "follow", // 3xx suivis : on juge le statut FINAL
      signal: AbortSignal.timeout(check.timeout_ms ?? 10_000),
    });
    // draine le corps pour libérer la connexion (sinon fuite de sockets)
    await res.arrayBuffer().catch(() => {});
    const latency = Date.now() - started;
    const ok = res.status === (check.expect_status ?? 200);
    return { ok, status: res.status, latency, error: ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return {
      ok: false,
      status: null,
      latency: Date.now() - started,
      error: String((e as { message?: string })?.message ?? e).slice(0, 200),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const { data: checks, error } = await supabase
    .from("uptime_check")
    .select("id, url, method, expect_status, timeout_ms")
    .eq("enabled", true);
  if (error) {
    log.error("load checks failed", { err: error });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  let ran = 0;
  let down = 0;
  await Promise.all(
    (checks ?? []).map(async (c) => {
      const r = await probe(c);
      ran++;
      if (!r.ok) down++;
      const { error: rpcErr } = await supabase.rpc("record_uptime_result", {
        p_check_id: c.id,
        p_ok: r.ok,
        p_status: r.status,
        p_latency: r.latency,
        p_error: r.error,
      });
      if (rpcErr) log.error("record failed", { check_id: c.id, err: rpcErr });
    }),
  );

  return new Response(JSON.stringify({ ran, down }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
