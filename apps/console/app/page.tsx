import { VitalsTimeseries, type SeriesPoint } from "@/components/charts/VitalsTimeseries";
import { VitalCard } from "@/components/VitalCard";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

interface VitalRow {
  name: string;
  p75: number;
  n: number;
}

export default async function Overview() {
  const vitals = await q<VitalRow>(
    `select name,
            percentile_cont(0.75) within group (order by value) as p75,
            count(*)::int as n
     from rum_metric
     where ts > now() - interval '24 hours'
     group by name`,
  );
  const [stats] = await q<{ sessions: number; errors: number; pageviews: number }>(
    `select
       (select count(*) from rum_session where last_seen_at > now() - interval '24 hours')::int as sessions,
       (select count(*) from rum_error   where ts > now() - interval '24 hours')::int as errors,
       (select count(*) from rum_pageview where started_at > now() - interval '24 hours')::int as pageviews`,
  );
  const series = await q<SeriesPoint>(
    `select date_bin('5 minutes', ts, timestamptz '2000-01-01') as bucket,
            percentile_cont(0.75) within group (order by value) as p75
     from rum_metric
     where name = 'LCP' and ts > now() - interval '24 hours'
     group by 1 order by 1`,
  );

  const byName = Object.fromEntries(vitals.map((v) => [v.name, v]));
  const errorRate = stats.pageviews ? ((stats.errors / stats.pageviews) * 100).toFixed(1) : "0";

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Overview</h1>
      <p className="mb-6 text-sm text-slate-500">
        Core Web Vitals réels au p75 · seuils 2026 (LCP &lt; 2,0 s · INP &lt; 200 ms · CLS &lt; 0,1) · fenêtre 24 h
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {["LCP", "INP", "CLS", "FCP", "TTFB"].map((name) => (
          <VitalCard
            key={name}
            name={name}
            p75={byName[name]?.p75 ?? null}
            n={byName[name]?.n ?? 0}
          />
        ))}
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="Sessions (24 h)" value={String(stats.sessions)} testid="stat-sessions" />
        <Stat label="Pages vues (24 h)" value={String(stats.pageviews)} testid="stat-pageviews" />
        <Stat label="Taux d'erreur JS / page vue" value={`${errorRate} %`} testid="stat-errors" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-500">LCP p75 dans le temps (buckets 5 min)</h2>
        {series.length ? (
          <VitalsTimeseries data={series.map((s) => ({ ...s, bucket: String(s.bucket), p75: Number(s.p75) }))} />
        ) : (
          <p className="py-12 text-center text-sm text-slate-400">Pas encore de données — ouvre la démo ou le site instrumenté.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold" data-testid={testid}>{value}</div>
    </div>
  );
}
