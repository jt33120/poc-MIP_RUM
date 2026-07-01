// Ligne du tableau « Traces les plus lentes » : décomposition front / serveur /
// réseau + lien session. Rendu 100 % serveur. Extrait de app/tracing/page.tsx.
import Link from "next/link";
import type { SlowTrace } from "@/lib/queries-tracing";
import { fmtMs } from "@/components/tracing/format";

/** Ligne détaillant une trace lente et son statut front. */
export function SlowRow({ t }: { t: SlowTrace }) {
  const bad = (t.front_status ?? 0) >= 400 || (t.front_status ?? 0) === 0;
  return (
    <tr className="border-t border-line/60 transition hover:bg-panel2/60">
      <td className="px-4 py-3 font-mono text-xs">
        <span className="mr-1.5 rounded bg-panel2 px-1.5 py-0.5 font-semibold text-ink-soft">{t.method}</span>
        {t.url}
      </td>
      <td className="px-4 py-3">
        <span
          className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${
            bad
              ? "border-red-300 bg-red-100 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300"
              : "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"
          }`}
        >
          {t.front_status || "réseau"}
        </span>
      </td>
      <td className="px-4 py-3 font-semibold tabular-nums">{fmtMs(t.front_ms)}</td>
      <td className="px-4 py-3 tabular-nums">{fmtMs(t.back_ms)}</td>
      <td className="px-4 py-3 tabular-nums">{fmtMs(t.network_ms)}</td>
      <td className="px-4 py-3">
        {t.session_id ? (
          <Link href={`/sessions/${t.session_id}`} className="font-mono text-xs text-brand hover:underline">
            {t.session_id.slice(0, 8)}…
          </Link>
        ) : (
          <span className="text-ink-faint/60">—</span>
        )}
      </td>
    </tr>
  );
}
