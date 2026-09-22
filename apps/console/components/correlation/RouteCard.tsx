// Carte de corrélation d'une route : duel robot (synthétique DEM) vs réel (RUM)
// avec badge d'écart. Rendu 100 % serveur. Extrait de app/correlation/page.tsx.
import { fmtVital } from "@/lib/format";
import { type CorrCardRow } from "@/lib/queries-v2";
import { RATING_CLASS, rating2026 } from "@/lib/rating";
import { STATE_CLASS } from "@/components/correlation/state";

export function RouteCard({ row: r }: { row: CorrCardRow }) {
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
                ? "bg-bad/10 text-bad-ink"
                : "bg-good/10 text-good-ink"
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
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
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
