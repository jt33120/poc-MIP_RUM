// Table de détail des anomalies LCP 24 h (vue v_anomaly), cible de l'ancre du
// badge « anomalies » du bandeau de santé. Extrait de app/page.tsx.
//
// F13 (plan § 5.1.2, zone 9) : la section EXISTE TOUJOURS, repliée (`<details
// id="anomalies">`). Zéro anomalie est une information (P6) : « Aucune anomalie
// (règle : z > 3, ≥ 5 h d'historique) », jamais une section qui disparaît ; sous
// un filtre de population, la détection n'est pas appliquée, et c'est dit. Une
// ligne ouvre la route à l'heure de l'anomalie (`lien`).
import Link from "next/link";
import { GlossaryTip } from "@/components/GlossaryTip";
import { type AnomalyRow, type Health } from "@/lib/health";
import { fmtDate, fmtVital } from "@/lib/format";

export const REGLE_ANOMALIES = "règle : z > 3, ≥ 5 h d'historique";

/** Détail des anomalies LCP 24 h (vue v_anomaly), cible de l'ancre du badge. */
export function AnomalyTable({
  health,
  lien,
  filtree = false,
}: {
  health: Health;
  /** Route et heure de l'anomalie (`/pages?route=…&from=…&to=…`). */
  lien?: (a: AnomalyRow) => string;
  /** Sous un filtre de population : la détection ne connaît que l'app et la route. */
  filtree?: boolean;
}) {
  const n = health.anomalies.length;
  return (
    <details id="anomalies" className="card mb-6 min-w-0 overflow-hidden" data-testid="anomalies" data-compte={n}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        <GlossaryTip id="anomaly" />
        Anomalies LCP (24 h) — {filtree ? "non cherchées sous filtre" : `${n.toLocaleString("fr-FR")} anomalie(s)`}
      </summary>
      {filtree ? (
        <p className="border-t border-line px-4 py-3 text-sm text-ink-soft" role="note">
          Anomalies non cherchées sous un filtre de population : la détection (p75 horaire contre la moyenne des 7 derniers
          jours) ne connaît que l&apos;app et la route.
        </p>
      ) : n === 0 ? (
        <p className="border-t border-line px-4 py-3 text-sm text-ink-soft" data-testid="anomalies-aucune">
          Aucune anomalie ({REGLE_ANOMALIES}).
        </p>
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">
              Anomalies LCP des 24 dernières heures : p75 horaire contre la moyenne des 7 jours glissants, |z| &gt; 3
            </caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th">App</th>
                <th scope="col" className="th">Route</th>
                <th scope="col" className="th">Heure</th>
                <th scope="col" className="th">LCP p75</th>
                <th scope="col" className="th">Moyenne 7 j</th>
                <th scope="col" className="th">z-score</th>
              </tr>
            </thead>
            <tbody>
              {health.anomalies.map((a) => (
                <tr
                  key={`${a.app_id}-${a.route}-${String(a.bucket)}`}
                  className="border-t border-line/60 transition hover:bg-panel2/60"
                  data-testid="anomalie"
                >
                  <td className="px-4 py-2 text-ink-soft">{a.app_id}</td>
                  <td className="px-4 py-2">
                    {lien ? (
                      <Link href={lien(a)} className="chip-mono underline-offset-2 hover:underline">
                        {a.route ?? "—"}
                      </Link>
                    ) : (
                      <span className="chip-mono">{a.route ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{fmtDate(a.bucket)}</td>
                  <td className="px-4 py-2 font-semibold tabular-nums">{fmtVital("LCP", a.p75)}</td>
                  <td className="px-4 py-2 tabular-nums text-ink-soft">{fmtVital("LCP", a.mean_7d)}</td>
                  <td className="px-4 py-2 font-semibold tabular-nums text-ink">
                    {a.z_score > 0 ? "+" : ""}
                    {a.z_score.toLocaleString("fr-FR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
