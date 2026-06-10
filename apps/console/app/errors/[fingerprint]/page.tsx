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
    <div>
      <Link href={`/errors${filtersToQuery(f)}`} className="mb-4 inline-block text-sm text-blue-600 hover:underline">
        ← Tous les groupes
      </Link>
      <h1 className="mb-1 flex items-center gap-3 text-2xl font-bold">
        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-base">
          {group.error_type ?? "Error"}
        </span>
        <span className="truncate" title={group.sample_message ?? ""}>
          {group.sample_message ?? "(sans message)"}
        </span>
      </h1>
      <p className="mb-6 font-mono text-xs text-slate-400">
        fingerprint {group.fingerprint} · app {group.app_id}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Occurrences" value={String(group.occurrences)} testid="detail-occurrences" />
        <Stat label="Sessions touchées" value={String(group.sessions)} testid="detail-sessions" />
        <Stat label="Première vue" value={fmtDate(group.first_seen)} />
        <Stat label="Dernière vue" value={fmtDate(group.last_seen)} />
      </div>

      <div className="mb-6 rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-500">
          Stack du dernier exemplaire ({last ? fmtDate(last.ts) : "—"})
          {last?.source && (
            <span className="ml-2 font-mono text-xs font-normal text-slate-400">
              {last.source}
              {last.lineno != null && `:${last.lineno}`}
              {last.colno != null && `:${last.colno}`}
            </span>
          )}
        </div>
        <pre className="overflow-x-auto bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
          {last?.stack ?? last?.message ?? "(pas de stack capturée)"}
        </pre>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-500">
          Occurrences ({occurrences.length} affichées)
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Quand</th>
              <th className="px-4 py-2">Route</th>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Message</th>
              <th className="px-4 py-2">Device</th>
              <th className="px-4 py-2">Session</th>
            </tr>
          </thead>
          <tbody>
            {occurrences.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-xs">{fmtDate(o.ts)}</td>
                <td className="px-4 py-2 font-mono text-xs">{o.route ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{o.kind ?? "—"}</span>
                </td>
                <td className="max-w-sm truncate px-4 py-2 text-xs" title={o.message ?? ""}>
                  {o.message ?? "—"}
                </td>
                <td className="px-4 py-2 text-xs">{o.device_type ?? "—"}</td>
                <td className="px-4 py-2">
                  {o.session_id ? (
                    <Link
                      href={`/sessions/${encodeURIComponent(o.session_id)}${filtersToQuery(f)}`}
                      className="font-mono text-xs text-blue-600 hover:underline"
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
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
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
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold" data-testid={testid}>{value}</div>
    </div>
  );
}
