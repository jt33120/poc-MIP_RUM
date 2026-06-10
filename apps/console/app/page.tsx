import { VitalsTimeseries } from "@/components/charts/VitalsTimeseries";
import { VitalCard } from "@/components/VitalCard";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { overviewStats, vitalSeries, vitalsP75 } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const period = PERIODS[f.period];

  const [vitals, vitalsPrev, stats, statsPrev, series] = await Promise.all([
    vitalsP75(f),
    vitalsP75(f, true),
    overviewStats(f),
    overviewStats(f, true),
    vitalSeries(f, "LCP"),
  ]);

  const byName = Object.fromEntries(vitals.map((v) => [v.name, v]));
  const prevByName = Object.fromEntries(vitalsPrev.map((v) => [v.name, v]));
  const errorRate = stats.pageviews ? ((stats.errors / stats.pageviews) * 100).toFixed(1) : "0";
  const prevErrorRate = statsPrev.pageviews ? (statsPrev.errors / statsPrev.pageviews) * 100 : null;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Overview</h1>
      <p className="mb-6 text-sm text-slate-500">
        Core Web Vitals réels au p75 · seuils 2026 (LCP &lt; 2,0 s · INP &lt; 200 ms · CLS &lt; 0,1) ·
        fenêtre {period.label} · tendance vs période précédente
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {["LCP", "INP", "CLS", "FCP", "TTFB"].map((name) => (
          <VitalCard
            key={name}
            name={name}
            p75={byName[name]?.p75 ?? null}
            n={byName[name]?.n ?? 0}
            prev={prevByName[name]?.p75 ?? null}
            periodLabel={period.label}
          />
        ))}
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat
          label={`Sessions (${period.label})`}
          value={String(stats.sessions)}
          prev={statsPrev.sessions}
          current={stats.sessions}
          testid="stat-sessions"
        />
        <Stat
          label={`Pages vues (${period.label})`}
          value={String(stats.pageviews)}
          prev={statsPrev.pageviews}
          current={stats.pageviews}
          testid="stat-pageviews"
        />
        <Stat
          label="Taux d'erreur JS / page vue"
          value={`${errorRate} %`}
          prev={prevErrorRate}
          current={Number(errorRate)}
          lowerIsBetter
          testid="stat-errors"
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-500">
          LCP p75 dans le temps (buckets {period.bucketLabel})
        </h2>
        {series.length ? (
          <VitalsTimeseries data={series.map((s) => ({ ...s, bucket: String(s.bucket), p75: Number(s.p75) }))} />
        ) : (
          <p className="py-12 text-center text-sm text-slate-400">
            Pas de données sur la fenêtre — élargis la période ou ouvre la démo.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  prev,
  current,
  lowerIsBetter = false,
  testid,
}: {
  label: string;
  value: string;
  prev: number | null;
  current: number;
  lowerIsBetter?: boolean;
  testid: string;
}) {
  let trend: React.ReactNode = null;
  if (prev != null && prev !== 0) {
    const delta = ((current - prev) / prev) * 100;
    const flat = Math.abs(delta) < 2;
    const worse = lowerIsBetter ? delta > 0 : delta < 0;
    const cls = flat ? "text-slate-400" : worse ? "text-red-600" : "text-emerald-600";
    trend = (
      <span className={`text-xs font-semibold ${cls}`} title="vs période précédente">
        {flat ? "→" : delta > 0 ? "↑" : "↓"} {delta > 0 ? "+" : ""}
        {delta.toFixed(0)} %
      </span>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold" data-testid={testid}>
          {value}
        </span>
        {trend}
      </div>
    </div>
  );
}
