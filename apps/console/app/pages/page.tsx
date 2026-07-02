import { PageHeader } from "@/components/PageHeader";
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
    <div className="animate-fade-up">
      <PageHeader
        title="Pages lentes"
        sub={
          <>
            Les routes au chargement perçu le plus lent (LCP p75) et ce qui le cause — ressources et
            tâches JS longues · fenêtre {period.label}
          </>
        }
      />
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Route</th>
              <th className="th">Vues</th>
              <th className="th">LCP p75</th>
              <th className="th">INP p75</th>
              <th className="th">CLS p75</th>
              <th className="th">Long tasks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const res = resources.get(r.route) ?? [];
              return (
                <tr key={r.route} className="border-t border-line/60 align-top transition hover:bg-panel2/60">
                  <td className="px-4 py-3 font-mono text-xs text-ink">
                    {r.route}
                    {res.length > 0 && <SlowResources items={res} />}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r.views}</td>
                  <td className="px-4 py-3"><Cell name="LCP" v={r.lcp_p75} /></td>
                  <td className="px-4 py-3"><Cell name="INP" v={r.inp_p75} /></td>
                  <td className="px-4 py-3"><Cell name="CLS" v={r.cls_p75} /></td>
                  <td className="px-4 py-3">
                    {r.longtasks > 0 ? (
                      <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-xs font-medium tabular-nums text-accent-deep dark:text-accent-soft">
                        {r.longtasks}
                      </span>
                    ) : (
                      <span className="text-ink-faint/60">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-faint">
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
      <summary className="cursor-pointer select-none font-sans text-xs font-medium text-brand hover:underline">
        {items.length} ressource(s) lente(s)
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.url} className="flex items-center gap-2 font-sans text-xs text-ink-soft">
            <span className="chip-mono text-[11px]">{it.type ?? "?"}</span>
            <span className="max-w-md truncate font-mono text-[11px]" title={it.url}>
              {it.url}
            </span>
            <span className="font-semibold tabular-nums text-ink">{fmtVital("dur", Number(it.avg_ms))}</span>
            <span className="text-ink-faint">× {it.n}</span>
            {it.render_blocking && (
              <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
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
  if (v == null) return <span className="text-ink-faint/60">—</span>;
  const rating = rating2026(name, Number(v));
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${rating ? RATING_CLASS[rating] : ""}`}
    >
      {fmtVital(name, Number(v))}
    </span>
  );
}
