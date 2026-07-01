// Ligne d'angle mort : route où le robot dit « ok » alors que le réel est « poor ».
// Rendu 100 % serveur. Extrait de app/correlation/page.tsx.
import { fmtDate, fmtVital } from "@/lib/format";
import { type BlindSpotRow as BlindSpotData } from "@/lib/queries-v2";
import { STATE_CLASS } from "@/components/correlation/state";

export function BlindSpotRow({ spot: s }: { spot: BlindSpotData }) {
  return (
    <tr className="border-t border-line/60 transition hover:bg-panel2/60" data-testid={`blind-spot-${s.route}`}>
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
  );
}
