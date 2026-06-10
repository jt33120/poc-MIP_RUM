import { fmtVital } from "@/lib/format";
import { q } from "@/lib/db";
import { RATING_CLASS, rating2026 } from "@/lib/rating";

export const dynamic = "force-dynamic";

interface RouteRow {
  route: string;
  views: number;
  lcp_p75: number | null;
  inp_p75: number | null;
  cls_p75: number | null;
}

export default async function SlowPages() {
  const rows = await q<RouteRow>(
    `select m.route,
            (select count(*)::int from rum_pageview p where p.route = m.route) as views,
            percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'LCP') as lcp_p75,
            percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'INP') as inp_p75,
            percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'CLS') as cls_p75
     from rum_metric m
     where m.ts > now() - interval '24 hours' and m.route is not null
     group by m.route
     order by lcp_p75 desc nulls last`,
  );

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Pages lentes</h1>
      <p className="mb-6 text-sm text-slate-500">Top routes par LCP p75 · fenêtre 24 h</p>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Vues</th>
              <th className="px-4 py-3">LCP p75</th>
              <th className="px-4 py-3">INP p75</th>
              <th className="px-4 py-3">CLS p75</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.route} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-xs">{r.route}</td>
                <td className="px-4 py-3">{r.views}</td>
                <td className="px-4 py-3"><Cell name="LCP" v={r.lcp_p75} /></td>
                <td className="px-4 py-3"><Cell name="INP" v={r.inp_p75} /></td>
                <td className="px-4 py-3"><Cell name="CLS" v={r.cls_p75} /></td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Aucune donnée sur 24 h</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
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
