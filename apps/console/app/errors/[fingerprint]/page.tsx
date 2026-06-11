import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtDate } from "@/lib/format";
import {
  errorGroupDetail,
  filtersToQuery,
  parseFilters,
  type SearchParams,
} from "@/lib/queries-v2";

export const dynamic = "force-dynamic";

export default async function ErrorGroup({
  params,
  searchParams,
}: {
  params: Promise<{ fingerprint: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { fingerprint: raw } = await params;
  let fingerprint = raw;
  try {
    fingerprint = decodeURIComponent(raw);
  } catch {
    /* valeur brute conservée */
  }
  const f = parseFilters(await searchParams);
  const detail = await errorGroupDetail(fingerprint, f);
  if (!detail) notFound();
  const { group, last, occurrences } = detail;

  return (
    <div className="animate-fade-up">
      <Link
        href={`/errors${filtersToQuery(f)}`}
        className="mb-4 inline-block text-sm text-brand hover:underline"
      >
        ← Tous les groupes
      </Link>
      <h1 className="mb-1 flex items-center gap-3 text-xl font-bold tracking-tight">
        <span className="rounded border border-red-300 bg-red-100 px-2 py-0.5 font-mono text-base text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
          {group.error_type ?? "Error"}
        </span>
        <span className="truncate" title={group.sample_message ?? ""}>
          {group.sample_message ?? "(sans message)"}
        </span>
      </h1>
      <p className="mb-6 font-mono text-xs text-ink-faint">
        fingerprint {group.fingerprint} · app {group.app_id}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Occurrences" value={String(group.occurrences)} testid="detail-occurrences" />
        <Stat label="Sessions touchées" value={String(group.sessions)} testid="detail-sessions" />
        <Stat label="Première vue" value={fmtDate(group.first_seen)} />
        <Stat label="Dernière vue" value={fmtDate(group.last_seen)} />
      </div>

      <div className="card mb-6 overflow-hidden">
        <div className="border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Stack du dernier exemplaire ({last ? fmtDate(last.ts) : "—"})
          {last?.source && (
            <span className="ml-2 font-mono text-xs font-normal normal-case tracking-normal text-ink-faint">
              {last.source}
              {last.lineno != null && `:${last.lineno}`}
              {last.colno != null && `:${last.colno}`}
            </span>
          )}
        </div>
        {/* terminal navy permanent : lisible dans les deux thèmes */}
        <pre className="overflow-x-auto bg-navy-950 p-4 text-xs leading-relaxed text-slate-200">
          {last?.stack ?? last?.message ?? "(pas de stack capturée)"}
        </pre>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Occurrences ({occurrences.length} affichées)
        </div>
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Quand</th>
              <th className="th">Route</th>
              <th className="th">Kind</th>
              <th className="th">Message</th>
              <th className="th">Device</th>
              <th className="th">Session</th>
            </tr>
          </thead>
          <tbody>
            {occurrences.map((o) => (
              <tr key={o.id} className="border-t border-line/60 transition hover:bg-panel2/60">
                <td className="px-4 py-2 text-xs text-ink-soft">{fmtDate(o.ts)}</td>
                <td className="px-4 py-2"><span className="chip-mono">{o.route ?? "—"}</span></td>
                <td className="px-4 py-2">
                  <span className="chip-mono font-sans">{o.kind ?? "—"}</span>
                </td>
                <td className="max-w-sm truncate px-4 py-2 text-xs text-ink-soft" title={o.message ?? ""}>
                  {o.message ?? "—"}
                </td>
                <td className="px-4 py-2 text-xs text-ink-soft">{o.device_type ?? "—"}</td>
                <td className="px-4 py-2">
                  {o.session_id ? (
                    <Link
                      href={`/sessions/${encodeURIComponent(o.session_id)}${filtersToQuery(f)}`}
                      className="font-mono text-xs text-brand hover:underline"
                    >
                      {o.session_id.slice(0, 8)}… →
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {!occurrences.length && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                  Aucune occurrence avec ces filtres (device ?)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-1.5 text-xl font-bold tabular-nums" data-testid={testid}>
        {value}
      </div>
    </div>
  );
}
