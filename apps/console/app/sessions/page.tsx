import { browserFromUA, fmtDate } from "@/lib/format";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

interface SessionRow {
  session_id: string;
  device_type: string | null;
  geo_country: string | null;
  user_agent: string | null;
  started_at: Date;
  last_seen_at: Date;
  page_count: number;
  routes: string[] | null;
  err_count: number;
}

export default async function Sessions() {
  const rows = await q<SessionRow>(
    `select s.*, p.routes, coalesce(e.err_count, 0)::int as err_count
     from rum_session s
     left join lateral (
       select array_agg(route order by started_at) as routes
       from rum_pageview where session_id = s.session_id
     ) p on true
     left join lateral (
       select count(*)::int as err_count
       from rum_error where session_id = s.session_id
     ) e on true
     order by s.last_seen_at desc
     limit 50`,
  );

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Sessions</h1>
      <p className="mb-6 text-sm text-slate-500">Sessions récentes · parcours (breadcrumbs de routes) · anonymisées (user_hash, pas de PII)</p>
      <div className="flex flex-col gap-3">
        {rows.map((s) => (
          <div key={s.session_id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-mono text-xs text-slate-400">{s.session_id.slice(0, 8)}…</span>
              <Badge>{s.device_type ?? "?"}</Badge>
              <Badge>{browserFromUA(s.user_agent)}</Badge>
              {s.geo_country && <Badge>{s.geo_country}</Badge>}
              <span className="text-slate-500">{s.page_count} page(s)</span>
              {s.err_count > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                  {s.err_count} erreur(s)
                </span>
              )}
              <span className="ml-auto text-xs text-slate-400">
                {fmtDate(s.started_at)} → {fmtDate(s.last_seen_at)}
              </span>
            </div>
            {s.routes?.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-1 font-mono text-xs text-slate-600">
                {s.routes.map((r, i) => (
                  <span key={i}>
                    {i > 0 && <span className="mx-1 text-slate-300">→</span>}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">{r}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {!rows.length && <p className="py-8 text-center text-slate-400">Aucune session</p>}
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{children}</span>;
}
