import { fmtVital } from "@/lib/format";
import { q } from "@/lib/db";
import { RATING_CLASS, rating2026 } from "@/lib/rating";

export const dynamic = "force-dynamic";

interface CorrRow {
  app_id: string;
  route: string | null;
  rum_lcp_p75: number | null;
  rum_inp_p75: number | null;
  rum_sessions: number | null;
  syn_latency_avg: number | null;
  syn_score_avg: number | null;
  syn_state: string | null;
  syn_measures: string | null;
}

interface BucketRow {
  route: string;
  bucket: Date;
  rum_lcp_p75: number | null;
  syn_latency_avg: number | null;
  syn_state: string | null;
}

const STATE_CLASS: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  incident: "bg-red-100 text-red-800",
};

export default async function Correlation() {
  // agrégats 24 h par app/route, robot et réel calculés chacun de leur côté
  const rows = await q<CorrRow>(
    `with rum as (
       select app_id, route,
              percentile_cont(0.75) within group (order by value) filter (where name = 'LCP') as rum_lcp_p75,
              percentile_cont(0.75) within group (order by value) filter (where name = 'INP') as rum_inp_p75,
              count(distinct session_id)::int as rum_sessions
       from rum_metric where ts > now() - interval '24 hours'
       group by 1, 2
     ),
     syn as (
       select app_id, route_hint as route,
              avg(latency_ms) as syn_latency_avg,
              avg(score) as syn_score_avg,
              case max(case state when 'incident' then 3 when 'warn' then 2 when 'ok' then 1 else 0 end)
                when 3 then 'incident' when 2 then 'warn' when 1 then 'ok' end as syn_state,
              string_agg(distinct measure_name, ', ') as syn_measures
       from syn_snapshot where captured_at > now() - interval '24 hours'
       group by 1, 2
     )
     select coalesce(r.app_id, s.app_id) as app_id, coalesce(r.route, s.route) as route,
            r.rum_lcp_p75, r.rum_inp_p75, r.rum_sessions,
            s.syn_latency_avg, s.syn_score_avg, s.syn_state, s.syn_measures
     from rum r full outer join syn s using (app_id, route)
     order by (r.rum_lcp_p75 is not null and s.syn_latency_avg is not null) desc, app_id, route`,
  );
  const buckets = await q<BucketRow>(
    `select route, bucket, rum_lcp_p75, syn_latency_avg, syn_state
     from v_correlation
     where rum_lcp_p75 is not null and syn_latency_avg is not null
     order by bucket desc, route limit 24`,
  );

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Corrélation synthétique ↔ RUM</h1>
      <p className="mb-6 text-sm text-slate-500">
        Ce que le robot MIP voit (DEM synthétique) face à ce que les utilisateurs réels subissent (RUM) · fenêtre 24 h
      </p>

      <div className="flex flex-col gap-4">
        {rows.map((r) => (
          <RouteCard key={`${r.app_id}|${r.route}`} row={r} />
        ))}
        {!rows.length && <p className="py-8 text-center text-slate-400">Aucune donnée — lance le job sync-synthetic et la démo.</p>}
      </div>

      {buckets.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-500">
            Détail horaire (vue SQL v_correlation)
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Heure</th>
                <th className="px-4 py-2">Route</th>
                <th className="px-4 py-2">Robot (latence moy.)</th>
                <th className="px-4 py-2">Réel (LCP p75)</th>
                <th className="px-4 py-2">État synthétique</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-xs">{new Date(b.bucket).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</td>
                  <td className="px-4 py-2 font-mono text-xs">{b.route}</td>
                  <td className="px-4 py-2">{fmtVital("LCP", Number(b.syn_latency_avg))}</td>
                  <td className="px-4 py-2">{fmtVital("LCP", Number(b.rum_lcp_p75))}</td>
                  <td className="px-4 py-2">
                    {b.syn_state && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATE_CLASS[b.syn_state] ?? ""}`}>{b.syn_state}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RouteCard({ row: r }: { row: CorrRow }) {
  const rum = r.rum_lcp_p75 != null ? Number(r.rum_lcp_p75) : null;
  const syn = r.syn_latency_avg != null ? Number(r.syn_latency_avg) : null;
  const gapPct = rum != null && syn != null && syn > 0 ? ((rum - syn) / syn) * 100 : null;
  const rating = rum != null ? rating2026("LCP", rum) : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid={`corr-${r.route}`}>
      <div className="mb-3 flex items-center gap-3">
        <span className="font-mono text-sm font-semibold">{r.route ?? "(app)"}</span>
        <span className="text-xs text-slate-400">{r.app_id}</span>
        {gapPct != null && (
          <span
            data-testid="gap"
            className={`ml-auto rounded-full px-3 py-1 text-xs font-bold ${gapPct > 0 ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}
          >
            écart {gapPct > 0 ? "+" : ""}{gapPct.toFixed(0)} % {gapPct > 0 ? "— les utilisateurs subissent plus que le robot ne voit" : "— réel plus rapide que le robot"}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">🤖 Robot — synthétique DEM</div>
          {syn != null ? (
            <>
              <div className="text-2xl font-bold">{fmtVital("LCP", syn)}</div>
              <div className="mt-1 text-xs text-slate-500">
                latence moyenne · score {r.syn_score_avg != null ? Math.round(Number(r.syn_score_avg)) : "—"}
                {r.syn_state && <span className={`ml-2 rounded px-1.5 py-0.5 font-medium ${STATE_CLASS[r.syn_state] ?? ""}`}>{r.syn_state}</span>}
              </div>
              <div className="mt-1 truncate text-xs text-slate-400" title={r.syn_measures ?? ""}>{r.syn_measures}</div>
            </>
          ) : (
            <div className="py-3 text-sm text-slate-400">pas de mesure synthétique sur cette route</div>
          )}
        </div>
        <div className="rounded border border-blue-200 bg-blue-50 p-3">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">👤 Réel — utilisateurs (RUM)</div>
          {rum != null ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{fmtVital("LCP", rum)}</span>
                {rating && <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RATING_CLASS[rating]}`}>LCP p75</span>}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                INP p75 {fmtVital("INP", r.rum_inp_p75 != null ? Number(r.rum_inp_p75) : null)} · {r.rum_sessions ?? 0} session(s)
              </div>
            </>
          ) : (
            <div className="py-3 text-sm text-slate-400">pas encore de trafic réel sur cette route</div>
          )}
        </div>
      </div>
    </div>
  );
}
