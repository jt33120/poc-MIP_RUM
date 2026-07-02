// Ligne « par route » : route + appels, tokens, coût, latence p75, taux d'erreur.
// Rendu 100 % serveur.
import { fmtCost, fmtLatency, fmtPct, fmtTokens } from "./format";
import type { AiRouteRow as AiRouteData } from "@/lib/queries-ai";

export function AiRouteRow({ row: r }: { row: AiRouteData }) {
  return (
    <tr className="border-t border-line/60 transition hover:bg-panel2/60">
      <td className="px-4 py-2"><span className="chip-mono">{r.route ?? "(app)"}</span></td>
      <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.calls}</td>
      <td className="px-4 py-2 text-right tabular-nums">{fmtTokens(r.total_tokens)}</td>
      <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmtCost(r.cost_usd)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{fmtLatency(r.latency_p75)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{fmtPct(r.error_rate)}</td>
    </tr>
  );
}
