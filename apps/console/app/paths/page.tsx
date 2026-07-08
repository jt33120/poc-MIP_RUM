import { PageHeader } from "@/components/PageHeader";
import { Sankey } from "@/components/Sankey";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { entryExitRoutes, routeTransitions } from "@/lib/queries-paths";
import { buildSankey } from "@/lib/sankey";

export const dynamic = "force-dynamic";

export default async function Paths({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const period = PERIODS[f.period];
  const [transitions, { entries, exits }] = await Promise.all([
    routeTransitions(f),
    entryExitRoutes(f),
  ]);
  const maxT = transitions[0]?.n ?? 0;
  // Lot 6b : flux Sankey (source -> cible) construit sur les mêmes transitions.
  const sankey = buildSankey(
    transitions.map((t) => ({ from: t.from_route, to: t.to_route, count: t.n })),
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Parcours"
        sub={
          <>
            Comment les visiteurs circulent entre les routes — pages d&apos;entrée et de sortie,
            transitions les plus fréquentes (recharges exclues) · fenêtre {period.label}
          </>
        }
      />

      {/* Entrées / sorties : où commencent et se terminent les sessions. */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <BoundaryCard title="Pages d'entrée" hint="1re route de la session" rows={entries} />
        <BoundaryCard title="Pages de sortie" hint="dernière route de la session" rows={exits} />
      </div>

      {/* Flux de navigation (Sankey) : où va le trafic, source -> cible. */}
      <section className="mb-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">Flux de navigation</h2>
          {sankey.totalFlow > sankey.shownFlow && (
            <span className="text-[11px] text-ink-faint">
              top routes · {sankey.shownFlow} / {sankey.totalFlow} transitions affichées
            </span>
          )}
        </div>
        <div className="card p-4">
          <Sankey model={sankey} />
        </div>
      </section>

      {/* Transitions route → route (arêtes du graphe de navigation). */}
      <h2 className="mb-2 text-sm font-semibold text-ink">Transitions les plus fréquentes</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">De</th>
              <th className="th">Vers</th>
              <th className="th w-40">Volume</th>
            </tr>
          </thead>
          <tbody>
            {transitions.map((t) => (
              <tr
                key={`${t.from_route}→${t.to_route}`}
                className="border-t border-line/60 transition hover:bg-panel2/60"
              >
                <td className="px-4 py-2 font-mono text-xs text-ink-soft">{t.from_route}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink">
                  <span className="mr-1 text-accent/70">→</span>
                  {t.to_route}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${maxT ? Math.max(3, (t.n / maxT) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums text-ink-soft">{t.n}</span>
                  </div>
                </td>
              </tr>
            ))}
            {!transitions.length && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-ink-faint">
                  Aucune transition sur {period.label} (il faut ≥ 2 pages vues par session)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BoundaryCard({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: { route: string; n: number }[];
}) {
  const total = rows.reduce((acc, r) => acc + r.n, 0);
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="text-[11px] text-ink-faint">{hint}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const pct = total ? Math.round((r.n / total) * 100) : 0;
          return (
            <div key={r.route} className="flex items-center gap-2 text-xs">
              <span className="w-14 shrink-0 text-right tabular-nums text-ink-soft">{pct}%</span>
              <span className="flex-1 truncate font-mono text-ink" title={r.route}>
                {r.route}
              </span>
              <span className="w-10 text-right tabular-nums text-ink-faint">{r.n}</span>
            </div>
          );
        })}
        {!rows.length && <p className="py-4 text-center text-ink-faint">Aucune donnée</p>}
      </div>
    </div>
  );
}
