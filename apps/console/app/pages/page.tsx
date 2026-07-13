import { Histogram, PercentileTable } from "@/components/Distribution";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { RankBar } from "@/components/charts/RankBar";
import { HISTO_BUCKETS, VITAL_CAP } from "@/lib/distribution";
import { fmtVital } from "@/lib/format";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import {
  slowResourcesByRoute,
  slowRoutes,
  vitalHistogram,
  vitalPercentiles,
  type SlowResource,
} from "@/lib/queries";
import { RATING_CLASS, RATING_HEX, rating2026 } from "@/lib/rating";

export const dynamic = "force-dynamic";

export default async function SlowPages({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const period = PERIODS[f.period];
  const [rows, resources, pcts, lcpH, inpH, clsH] = await Promise.all([
    slowRoutes(f),
    slowResourcesByRoute(f),
    vitalPercentiles(f),
    vitalHistogram(f, "LCP", VITAL_CAP.LCP, HISTO_BUCKETS),
    vitalHistogram(f, "INP", VITAL_CAP.INP, HISTO_BUCKETS),
    vitalHistogram(f, "CLS", VITAL_CAP.CLS, HISTO_BUCKETS),
  ]);

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

      {(() => {
        // Hero : classement des routes par LCP p75 (le message central de la page).
        const ranked = [...rows]
          .filter((r) => r.lcp_p75 != null)
          .sort((a, b) => Number(b.lcp_p75) - Number(a.lcp_p75))
          .slice(0, 8);
        const worst = ranked[0];
        const poorCount = rows.filter(
          (r) => r.lcp_p75 != null && rating2026("LCP", Number(r.lcp_p75)) === "poor",
        ).length;
        const totalLongtasks = rows.reduce((s, r) => s + (r.longtasks ?? 0), 0);
        return (
          <SupervisionHero
            chartTitle="Routes les plus lentes — LCP p75"
            chart={
              <RankBar
                data={ranked.map((r) => {
                  const rating = rating2026("LCP", Number(r.lcp_p75));
                  return {
                    label: r.route,
                    value: Number(r.lcp_p75),
                    display: fmtVital("LCP", Number(r.lcp_p75)),
                    color: rating ? RATING_HEX[rating] : "#94a3b8",
                    sub: `${r.views.toLocaleString("fr-FR")} vues${r.longtasks ? ` · ${r.longtasks} long tasks` : ""}`,
                    title: `${r.route} — LCP p75 ${fmtVital("LCP", Number(r.lcp_p75))}`,
                  };
                })}
                labelWidth="13rem"
              />
            }
          >
            <HeroStat label={`Routes suivies · ${period.label}`} value={rows.length.toLocaleString("fr-FR")} />
            <HeroStat
              label="Routes « mauvais » LCP"
              value={poorCount.toLocaleString("fr-FR")}
              tone={poorCount > 0 ? "poor" : "good"}
              hint="LCP p75 > 4,0 s (seuil 2026)"
            />
            <HeroStat
              label="Route la plus lente"
              value={worst ? fmtVital("LCP", Number(worst.lcp_p75)) : "—"}
              hint={worst?.route}
              tone="warn"
            />
            <HeroReading>
              Chaque barre = une route, longueur et couleur = son LCP p75 (vert «&nbsp;bon&nbsp;» → rouge
              «&nbsp;mauvais&nbsp;»). {totalLongtasks > 0 ? `${totalLongtasks} tâches JS longues au total sur la fenêtre. ` : ""}
              Distribution complète et détail ressource par route ci-dessous.
            </HeroReading>
          </SupervisionHero>
        );
      })()}

      {/* Distribution & percentiles (Lot 3) : ce que le p75 seul masque —
          longue traîne (p90/p95/p99) et forme de la distribution. */}
      <section className="mb-6 space-y-4">
        <PercentileTable rows={pcts} />
        <div className="grid gap-4 md:grid-cols-3">
          <Histogram name="LCP" rows={lcpH} cap={VITAL_CAP.LCP} />
          <Histogram name="INP" rows={inpH} cap={VITAL_CAP.INP} />
          <Histogram name="CLS" rows={clsH} cap={VITAL_CAP.CLS} />
        </div>
      </section>

      <h2 className="mb-2 text-sm font-semibold text-ink">Par route</h2>
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
