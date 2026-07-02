// Ligne « par modèle » : fournisseur/modèle + appels, tokens, coût, latence p75,
// taux d'erreur. Rendu 100 % serveur.
import { fmtCost, fmtLatency, fmtPct, fmtTokens } from "./format";
import type { AiModelRow as AiModelData } from "@/lib/queries-ai";

export function AiModelRow({ row: r }: { row: AiModelData }) {
  return (
    <tr className="border-t border-line/60 transition hover:bg-panel2/60">
      <td className="px-4 py-2 text-xs text-ink-soft">{r.provider ?? "—"}</td>
      <td className="px-4 py-2"><span className="chip-mono">{r.model ?? "—"}</span></td>
      <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.calls}</td>
      <td className="px-4 py-2 text-right tabular-nums">{fmtTokens(r.total_tokens)}</td>
      <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmtCost(r.cost_usd)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{fmtLatency(r.latency_p75)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{fmtPct(r.error_rate)}</td>
    </tr>
  );
}
