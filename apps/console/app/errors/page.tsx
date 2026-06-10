import { browserFromUA, fmtDate } from "@/lib/format";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ErrorRow {
  message: string;
  error_type: string | null;
  kind: string;
  occurrences: number;
  last_seen: Date;
  sample_ua: string | null;
  sample_route: string | null;
}

export default async function Errors() {
  const rows = await q<ErrorRow>(
    `select e.message, e.error_type, e.kind,
            count(*)::int as occurrences,
            max(e.ts) as last_seen,
            max(s.user_agent) as sample_ua,
            max(e.route) as sample_route
     from rum_error e
     left join rum_session s using (session_id)
     group by e.message, e.error_type, e.kind
     order by occurrences desc, last_seen desc
     limit 50`,
  );

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Erreurs JS</h1>
      <p className="mb-6 text-sm text-slate-500">Top erreurs réelles (error + unhandledrejection), dédupliquées par message</p>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">Occurrences</th>
              <th className="px-4 py-3">Dernière vue</th>
              <th className="px-4 py-3">Navigateur</th>
              <th className="px-4 py-3">Route</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="max-w-md truncate px-4 py-3 font-medium" title={r.message}>{r.message}</td>
                <td className="px-4 py-3">{r.error_type ?? "—"}</td>
                <td className="px-4 py-3"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.kind}</span></td>
                <td className="px-4 py-3 font-bold">{r.occurrences}</td>
                <td className="px-4 py-3 text-xs">{fmtDate(r.last_seen)}</td>
                <td className="px-4 py-3">{browserFromUA(r.sample_ua)}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.sample_route ?? "—"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Aucune erreur captée 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
