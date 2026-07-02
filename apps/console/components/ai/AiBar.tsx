// Ligne « coût par jour » : une barre horizontale proportionnelle au coût du
// jour (largeur = coût / coût max × 100). Aucune lib de graphe — pur CSS/serveur.
import { fmtCost, fmtTokens } from "./format";
import type { AiDailyRow } from "@/lib/queries-ai";

export function AiBar({ row, maxCost }: { row: AiDailyRow; maxCost: number }) {
  const pct = maxCost > 0 ? Math.max((row.cost_usd / maxCost) * 100, 2) : 0;
  const day = new Date(row.day).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
  return (
    <div className="flex items-center gap-3 py-1.5" data-testid={`ai-day-${row.day}`}>
      <span className="w-16 shrink-0 text-xs tabular-nums text-ink-soft">{day}</span>
      <div className="relative h-4 flex-1 overflow-hidden rounded bg-panel2">
        <div
          className="absolute inset-y-0 left-0 rounded bg-accent/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">
        {fmtCost(row.cost_usd)}
      </span>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-faint">
        {fmtTokens(row.total_tokens)}
      </span>
    </div>
  );
}
