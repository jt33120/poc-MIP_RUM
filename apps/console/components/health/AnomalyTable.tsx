// Table de détail des anomalies LCP 24 h (vue v_anomaly), cible de l'ancre du
// badge « anomalies » du bandeau de santé. Extrait de app/page.tsx.
import { GlossaryTip } from "@/components/GlossaryTip";
import { type Health } from "@/lib/health";
import { fmtDate, fmtVital } from "@/lib/format";

/** Détail des anomalies LCP 24 h (vue v_anomaly), cible de l'ancre du badge. */
export function AnomalyTable({ health }: { health: Health }) {
  if (!health.anomalies.length) return null;
  return (
    <div id="anomalies" className="card mt-6 overflow-hidden">
      <h2 className="flex items-center gap-1.5 border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Anomalies LCP (24 h) — p75 horaire vs moyenne 7 j glissants, |z| &gt; 3
        <GlossaryTip id="anomaly" />
      </h2>
      <table className="w-full text-sm">
        <thead className="bg-panel2">
          <tr>
            <th className="th">App</th>
            <th className="th">Route</th>
            <th className="th">Heure</th>
            <th className="th">LCP p75</th>
            <th className="th">Moyenne 7 j</th>
            <th className="th">z-score</th>
          </tr>
        </thead>
        <tbody>
          {health.anomalies.map((a) => (
            <tr
              key={`${a.app_id}-${a.route}-${String(a.bucket)}`}
              className="border-t border-line/60 transition hover:bg-panel2/60"
            >
              <td className="px-4 py-2 text-ink-soft">{a.app_id}</td>
              <td className="px-4 py-2"><span className="chip-mono">{a.route ?? "—"}</span></td>
              <td className="px-4 py-2 text-ink-soft">{fmtDate(a.bucket)}</td>
              <td className="px-4 py-2 font-semibold tabular-nums">{fmtVital("LCP", a.p75)}</td>
              <td className="px-4 py-2 tabular-nums text-ink-soft">{fmtVital("LCP", a.mean_7d)}</td>
              <td
                className={`px-4 py-2 font-semibold tabular-nums ${
                  a.z_score > 0 ? "text-bad-ink" : "text-good-ink"
                }`}
              >
                {a.z_score > 0 ? "+" : ""}
                {a.z_score.toLocaleString("fr-FR")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
