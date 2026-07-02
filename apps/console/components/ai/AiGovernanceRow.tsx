// Ligne « Gouvernance des données » : joint un agrégat rum_ai (par route) au
// catalogue des usages IA pour exposer la nature de la donnée et le traitement
// PII appliqué avant l'appel externe. Rendu 100 % serveur.
import { catalogFor, isPiiRisk, type DataClass, type PiiHandling } from "@/lib/ai-catalog";
import type { AiGovRow } from "@/lib/queries-ai";
import { fmtCost, fmtLatency, fmtPct } from "./format";

const DATA_BADGE: Record<DataClass, { label: string; cls: string }> = {
  personal: { label: "Personnelle", cls: "bg-bad/10 text-bad" },
  business: { label: "Business", cls: "bg-perf/10 text-perf" },
  anonymized: { label: "Anonymisée", cls: "bg-good/10 text-good" },
  unknown: { label: "?", cls: "bg-ink-faint/10 text-ink-faint" },
};

const PII_BADGE: Record<PiiHandling, { label: string; cls: string }> = {
  scrubbed: { label: "Pseudonymisé", cls: "bg-good/10 text-good" },
  raw: { label: "Brut envoyé", cls: "bg-bad/10 text-bad" },
  mixed: { label: "Mixte", cls: "bg-warn/10 text-warn" },
  none: { label: "Sans PII", cls: "bg-ink-faint/10 text-ink-soft" },
  unknown: { label: "?", cls: "bg-ink-faint/10 text-ink-faint" },
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}

export function AiGovernanceRow({ row: r }: { row: AiGovRow }) {
  const u = catalogFor(r.route);
  const risk = isPiiRisk(u);
  const coverage = r.calls > 0 ? r.with_session / r.calls : 0;

  return (
    <tr
      className={`border-t border-line/60 transition hover:bg-panel2/60 ${risk ? "bg-bad/[0.04]" : ""}`}
      title={u.note}
    >
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          {risk && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" aria-label="risque PII" />}
          <span className="font-medium text-ink">{u.label}</span>
        </div>
        <span className="chip-mono mt-0.5 inline-block">{r.route ?? "(app)"}</span>
      </td>
      <td className="px-4 py-2.5"><Badge {...DATA_BADGE[u.dataClass]} /></td>
      <td className="px-4 py-2.5"><Badge {...PII_BADGE[u.pii]} /></td>
      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{r.calls}</td>
      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtCost(r.cost_usd)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{fmtLatency(r.latency_p75)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">{fmtPct(r.error_rate)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
        {r.with_session > 0 ? `${Math.round(coverage * 100)} %` : "—"}
      </td>
    </tr>
  );
}
