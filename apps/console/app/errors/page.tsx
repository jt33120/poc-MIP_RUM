import Link from "next/link";
import { Sparkline } from "@/components/features/Sparkline";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate } from "@/lib/format";
import {
  errorGroups,
  errorSparklines,
  filtersToQuery,
  parseFilters,
  periodLabel,
  unfingerprintedCount,
  type SearchParams,
} from "@/lib/queries-v2";

export const dynamic = "force-dynamic";

export default async function Errors({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const f = parseFilters(await searchParams);
  const groups = await errorGroups(f);
  const [sparklines, legacyCount] = await Promise.all([
    errorSparklines(groups.map((g) => g.fingerprint), f),
    unfingerprintedCount(f),
  ]);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Erreurs JS"
        sub={
          <>
            Erreurs JavaScript regroupées par signature (type + message + frame) — une ligne = une cause
            récurrente · fenêtre {periodLabel(f)}
          </>
        }
      />
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Groupe</th>
              <th className="th">Occurrences</th>
              <th className="th">Sessions</th>
              <th className="th">24 h</th>
              <th className="th">Première vue</th>
              <th className="th">Dernière vue</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const href = `/errors/${encodeURIComponent(g.fingerprint)}${filtersToQuery(f)}`;
              return (
                <tr
                  key={`${g.app_id}|${g.fingerprint}`}
                  className="border-t border-line/60 transition hover:bg-panel2/60"
                  data-testid={`error-group-${g.fingerprint}`}
                >
                  <td className="max-w-md px-4 py-3">
                    <Link href={href} className="block">
                      <span className="mr-2 rounded border border-red-300 bg-red-100 px-1.5 py-0.5 font-mono text-xs text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                        {g.error_type ?? "Error"}
                      </span>
                      <span className="font-medium text-ink" title={g.sample_message ?? ""}>
                        {(g.sample_message ?? "(sans message)").slice(0, 120)}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs text-ink-faint">
                        {g.fingerprint} · {g.app_id}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-bold tabular-nums" data-testid="group-occurrences">
                    {g.occurrences}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{g.sessions}</td>
                  <td className="px-4 py-3">
                    <Sparkline values={sparklines.get(g.fingerprint) ?? new Array(24).fill(0)} />
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{fmtDate(g.first_seen)}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{fmtDate(g.last_seen)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={href} className="text-xs font-medium text-brand hover:underline">
                      détail →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!groups.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-faint">
                  Aucun groupe d&apos;erreur sur la période 🎉
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {legacyCount > 0 && (
        <p className="mt-3 text-xs text-ink-faint">
          {legacyCount} erreur(s) v0.1 sans fingerprint (antérieures à la migration) non groupées.
        </p>
      )}
    </div>
  );
}
