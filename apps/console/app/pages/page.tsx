import { fmtVital } from "@/lib/format";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { slowResourcesByRoute, slowRoutes, type SlowResource } from "@/lib/queries";
import { RATING_CLASS, rating2026 } from "@/lib/rating";

export const dynamic = "force-dynamic";

export default async function SlowPages({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const period = PERIODS[f.period];
  const [rows, resources] = await Promise.all([slowRoutes(f), slowResourcesByRoute(f)]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Pages lentes</h1>
      <p className="mb-6 text-sm text-slate-500">
        Top routes par LCP p75 · fenêtre {period.label} · ressources lentes dominantes et long tasks par route
      </p>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Vues</th>
              <th className="px-4 py-3">LCP p75</th>
              <th className="px-4 py-3">INP p75</th>
              <th className="px-4 py-3">CLS p75</th>
              <th className="px-4 py-3">Long tasks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const res = resources.get(r.route) ?? [];
              return (
                <tr key={r.route} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.route}
                    {res.length > 0 && <SlowResources items={res} />}
                  </td>
                  <td className="px-4 py-3">{r.views}</td>
                  <td className="px-4 py-3"><Cell name="LCP" v={r.lcp_p75} /></td>
                  <td className="px-4 py-3"><Cell name="INP" v={r.inp_p75} /></td>
                  <td className="px-4 py-3"><Cell name="CLS" v={r.cls_p75} /></td>
                  <td className="px-4 py-3">
                    {r.longtasks > 0 ? (
                      <span className="rounded border border-orange-300 bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-800">
                        {r.longtasks}
                      </span>
                    ) : (
                      <span className="text-slate-300">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Aucune donnée sur {period.label}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Top 3 ressources lentes de la route, repliées par défaut (élément details natif). */
function SlowResources({ items }: { items: SlowResource[] }) {
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer select-none font-sans text-xs font-medium text-blue-600 hover:underline">
        {items.length} ressource(s) lente(s)
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.url} className="flex items-center gap-2 font-sans text-xs text-slate-600">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
              {it.type ?? "?"}
            </span>
            <span className="max-w-md truncate font-mono text-[11px]" title={it.url}>
              {it.url}
            </span>
            <span className="font-semibold text-slate-800">{fmtVital("dur", Number(it.avg_ms))}</span>
            <span className="text-slate-400">× {it.n}</span>
            {it.render_blocking && (
              <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                bloquant
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Cell({ name, v }: { name: string; v: number | null }) {
  if (v == null) return <span className="text-slate-300">—</span>;
  const rating = rating2026(name, Number(v));
  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${rating ? RATING_CLASS[rating] : ""}`}>
      {fmtVital(name, Number(v))}
    </span>
  );
}
