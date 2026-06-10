import Link from "next/link";
import { Sparkline } from "@/components/features/Sparkline";
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
    <div>
      <h1 className="mb-1 text-2xl font-bold">Erreurs JS</h1>
      <p className="mb-6 text-sm text-slate-500">
        Groupes d&apos;erreurs par fingerprint (type + message normalisé + frame) · fenêtre {periodLabel(f)}
      </p>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Groupe</th>
              <th className="px-4 py-3">Occurrences</th>
              <th className="px-4 py-3">Sessions</th>
              <th className="px-4 py-3">24 h</th>
              <th className="px-4 py-3">Première vue</th>
              <th className="px-4 py-3">Dernière vue</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const href = `/errors/${encodeURIComponent(g.fingerprint)}${filtersToQuery(f)}`;
              return (
                <tr key={`${g.app_id}|${g.fingerprint}`} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`error-group-${g.fingerprint}`}>
                  <td className="max-w-md px-4 py-3">
                    <Link href={href} className="block">
                      <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                        {g.error_type ?? "Error"}
                      </span>
                      <span className="font-medium" title={g.sample_message ?? ""}>
                        {(g.sample_message ?? "(sans message)").slice(0, 120)}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs text-slate-400">
                        {g.fingerprint} · {g.app_id}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-bold" data-testid="group-occurrences">{g.occurrences}</td>
                  <td className="px-4 py-3">{g.sessions}</td>
                  <td className="px-4 py-3">
                    <Sparkline values={sparklines.get(g.fingerprint) ?? new Array(24).fill(0)} />
                  </td>
                  <td className="px-4 py-3 text-xs">{fmtDate(g.first_seen)}</td>
                  <td className="px-4 py-3 text-xs">{fmtDate(g.last_seen)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={href} className="text-xs font-medium text-blue-600 hover:underline">
                      détail →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!groups.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Aucun groupe d&apos;erreur sur la période 🎉
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {legacyCount > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          {legacyCount} erreur(s) v0.1 sans fingerprint (antérieures à la migration) non groupées.
        </p>
      )}
    </div>
  );
}
