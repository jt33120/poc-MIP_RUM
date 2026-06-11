import Link from "next/link";
import { RobotVsRealChart } from "@/components/features/RobotVsRealChart";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate, fmtVital } from "@/lib/format";
import {
  blindSpots,
  correlationCards,
  correlationRoutes,
  correlationSeries,
  filtersToQuery,
  parseFilters,
  periodLabel,
  type CorrCardRow,
  type SearchParams,
} from "@/lib/queries-v2";
import { RATING_CLASS, rating2026 } from "@/lib/rating";

export const dynamic = "force-dynamic";

const STATE_CLASS: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
  incident: "bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-300",
};

export default async function Correlation({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const f = parseFilters(sp);
  const [rows, routes, spots] = await Promise.all([
    correlationCards(f),
    correlationRoutes(f),
    blindSpots(f),
  ]);
  const requested = Array.isArray(sp.route) ? sp.route[0] : sp.route;
  const selectedRoute = requested && routes.includes(requested) ? requested : routes[0] ?? null;
  const series = selectedRoute ? await correlationSeries(selectedRoute, f) : [];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Corrélation synthétique ↔ RUM"
        sub={
          <>
            Ce que le robot MIP voit (DEM synthétique) face à ce que les utilisateurs réels subissent (RUM) ·
            fenêtre {periodLabel(f)}
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {rows.map((r) => (
          <RouteCard key={`${r.app_id}|${r.route}`} row={r} />
        ))}
        {!rows.length && (
          <p className="py-8 text-center text-ink-faint">
            Aucune donnée — lance le job sync-synthetic et la démo.
          </p>
        )}
      </div>

      {/* ----- Série historisée robot vs réel ----- */}
      <div className="card mt-8 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Robot vs réel dans le temps (buckets horaires, vue v_correlation)
          </h2>
          <div className="ml-auto flex flex-wrap gap-1">
            {routes.map((route) => (
              <Link
                key={route}
                href={`/correlation${filtersToQuery(f, { route })}`}
                className={`rounded-full px-3 py-1 font-mono text-xs transition ${
                  route === selectedRoute
                    ? "bg-accent font-semibold text-navy-950 shadow-sm"
                    : "bg-panel2 text-ink-soft hover:bg-line/60"
                }`}
              >
                {route}
              </Link>
            ))}
          </div>
        </div>
        {selectedRoute && series.length ? (
          <RobotVsRealChart
            data={series.map((s) => ({
              bucket: new Date(s.bucket).toISOString(),
              robot: s.syn_latency_avg != null ? Number(s.syn_latency_avg) : null,
              reel: s.rum_lcp_p75 != null ? Number(s.rum_lcp_p75) : null,
            }))}
          />
        ) : (
          <p className="py-10 text-center text-sm text-ink-faint">
            Pas encore de route avec données robot ET réel sur la période.
          </p>
        )}
      </div>

      {/* ----- Angles morts ----- */}
      <div className="card mt-8 overflow-hidden border-red-300/60 dark:border-red-400/30">
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 dark:border-red-400/20 dark:bg-red-400/10">
          <h2 className="text-sm font-bold text-red-800 dark:text-red-300">
            ⚠ Angles morts — le robot ne le voit pas
          </h2>
          <p className="mt-0.5 text-xs text-red-700 dark:text-red-300/80">
            Routes où le robot dit « ok » alors que les utilisateurs réels sont en « poor » (LCP p75 &gt; 2,5 s) ·
            vue v_blind_spot
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Route</th>
              <th className="th">Heure</th>
              <th className="th">Robot (latence moy.)</th>
              <th className="th">Réel (LCP p75)</th>
              <th className="th">Écart</th>
            </tr>
          </thead>
          <tbody>
            {spots.map((s, i) => (
              <tr key={i} className="border-t border-line/60 transition hover:bg-panel2/60" data-testid={`blind-spot-${s.route}`}>
                <td className="px-4 py-2"><span className="chip-mono">{s.route ?? "—"}</span></td>
                <td className="px-4 py-2 text-xs tabular-nums text-ink-soft">{fmtDate(s.bucket)}</td>
                <td className="px-4 py-2 tabular-nums">
                  {fmtVital("LCP", Number(s.syn_latency_avg))}
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${STATE_CLASS[s.syn_state] ?? ""}`}>
                    {s.syn_state}
                  </span>
                </td>
                <td className="px-4 py-2 font-bold tabular-nums text-red-700 dark:text-red-400">
                  {fmtVital("LCP", Number(s.rum_lcp_p75))}
                </td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800 dark:bg-red-400/10 dark:text-red-300">
                    +{s.gap_ms} ms — le robot ne le voit pas
                  </span>
                </td>
              </tr>
            ))}
            {!spots.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                  Aucun angle mort détecté sur la période 👍
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RouteCard({ row: r }: { row: CorrCardRow }) {
  const rum = r.rum_lcp_p75 != null ? Number(r.rum_lcp_p75) : null;
  const syn = r.syn_latency_avg != null ? Number(r.syn_latency_avg) : null;
  const gapPct = rum != null && syn != null && syn > 0 ? ((rum - syn) / syn) * 100 : null;
  const rating = rum != null ? rating2026("LCP", rum) : null;

  return (
    <div className="card p-4" data-testid={`corr-${r.route}`}>
      <div className="mb-3 flex items-center gap-3">
        <span className="font-mono text-sm font-semibold">{r.route ?? "(app)"}</span>
        <span className="text-xs text-ink-faint">{r.app_id}</span>
        {gapPct != null && (
          <span
            data-testid="gap"
            className={`ml-auto rounded-full px-3 py-1 text-xs font-bold ${
              gapPct > 0
                ? "bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-300"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300"
            }`}
          >
            écart {gapPct > 0 ? "+" : ""}
            {gapPct.toFixed(0)} %{" "}
            {gapPct > 0 ? "— les utilisateurs subissent plus que le robot ne voit" : "— réel plus rapide que le robot"}
          </span>
        )}
      </div>
      {/* duel robot/réel : acier neutre vs orange MIP (le réel = la vérité terrain) */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-line bg-panel2/70 p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            🤖 Robot — synthétique DEM
          </div>
          {syn != null ? (
            <>
              <div className="text-2xl font-bold tabular-nums">{fmtVital("LCP", syn)}</div>
              <div className="mt-1 text-xs text-ink-soft">
                latence moyenne · score {r.syn_score_avg != null ? Math.round(Number(r.syn_score_avg)) : "—"}
                {r.syn_state && (
                  <span className={`ml-2 rounded px-1.5 py-0.5 font-medium ${STATE_CLASS[r.syn_state] ?? ""}`}>
                    {r.syn_state}
                  </span>
                )}
              </div>
              <div className="mt-1 truncate text-xs text-ink-faint" title={r.syn_measures ?? ""}>
                {r.syn_measures}
              </div>
            </>
          ) : (
            <div className="py-3 text-sm text-ink-faint">pas de mesure synthétique sur cette route</div>
          )}
        </div>
        <div className="rounded-lg border border-accent/30 bg-accent/[0.06] p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent-deep dark:text-accent-soft">
            👤 Réel — utilisateurs (RUM)
          </div>
          {rum != null ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold tabular-nums">{fmtVital("LCP", rum)}</span>
                {rating && (
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RATING_CLASS[rating]}`}>
                    LCP p75
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-ink-soft">
                INP p75 {fmtVital("INP", r.rum_inp_p75 != null ? Number(r.rum_inp_p75) : null)} ·{" "}
                {r.rum_sessions ?? 0} session(s)
              </div>
            </>
          ) : (
            <div className="py-3 text-sm text-ink-faint">pas encore de trafic réel sur cette route</div>
          )}
        </div>
      </div>
    </div>
  );
}
