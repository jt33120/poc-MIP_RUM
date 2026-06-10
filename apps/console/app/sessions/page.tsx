import Link from "next/link";
import { browserFromUA, fmtDate } from "@/lib/format";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { listSessions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Sessions({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const rows = await listSessions(f);
  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])),
  ).toString();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Sessions</h1>
      <p className="mb-6 text-sm text-slate-500">
        Sessions sur {PERIODS[f.period].label} · anonymisées (user_hash, pas de PII) · clique une session pour sa
        timeline détaillée
      </p>
      <div className="flex flex-col gap-3">
        {rows.map((s) => (
          <div key={s.session_id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link
                href={`/sessions/${s.session_id}${qs ? `?${qs}` : ""}`}
                className="font-mono text-xs font-medium text-blue-600 hover:underline"
                data-testid="session-link"
              >
                {s.session_id.slice(0, 8)}…
              </Link>
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
        {!rows.length && (
          <p className="py-8 text-center text-slate-400">Aucune session sur {PERIODS[f.period].label}</p>
        )}
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{children}</span>;
}
