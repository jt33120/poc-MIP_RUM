// Ligne « derniers appels » : heure, provider/modèle, route, tokens, coût,
// latence, statut (badge vert ok / rouge error) + lien session. Rendu serveur.
import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { fmtCost, fmtLatency, fmtTokens } from "./format";
import type { AiCallRow as AiCallData } from "@/lib/queries-ai";

export function AiCallRow({ row: r }: { row: AiCallData }) {
  const ok = r.status !== "error";
  return (
    <tr className="border-t border-line/60 transition hover:bg-panel2/60">
      <td className="px-4 py-2 text-xs tabular-nums text-ink-soft">{fmtDate(r.ts)}</td>
      <td className="px-4 py-2">
        <span className="chip-mono">{r.model ?? "—"}</span>
        <span className="ml-2 text-xs text-ink-faint">{r.provider ?? ""}</span>
      </td>
      <td className="px-4 py-2 text-xs text-ink-soft">{r.route ?? "—"}</td>
      <td className="px-4 py-2 text-right tabular-nums">{fmtTokens(r.total_tokens)}</td>
      <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmtCost(r.cost_usd)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{fmtLatency(r.latency_ms)}</td>
      <td className="px-4 py-2">
        {ok ? (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300">
            ok
          </span>
        ) : (
          <span
            className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800 dark:bg-red-400/10 dark:text-red-300"
            title={r.error_type ?? undefined}
          >
            {r.error_type ?? "error"}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        {r.session_id ? (
          <Link
            href={`/sessions/${r.session_id}`}
            className="font-mono text-xs text-brand hover:underline"
          >
            {r.session_id.slice(0, 8)}
          </Link>
        ) : (
          <span className="text-xs text-ink-faint">—</span>
        )}
      </td>
    </tr>
  );
}
