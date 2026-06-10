import { VitalsTimeseries } from "@/components/charts/VitalsTimeseries";
import { VitalCard } from "@/components/VitalCard";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { fmtDate, fmtVital } from "@/lib/format";
import { dominantFactors, type Health, HEALTH_CLASS, healthScore } from "@/lib/health";
import { overviewStats, vitalSeries, vitalsP75 } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const period = PERIODS[f.period];

  const [vitals, vitalsPrev, stats, statsPrev, series, health] = await Promise.all([
    vitalsP75(f),
    vitalsP75(f, true),
    overviewStats(f),
    overviewStats(f, true),
    vitalSeries(f, "LCP"),
    healthScore(f),
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

      <HealthBanner health={health} periodLabel={period.label} />

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

      <AnomalyTable health={health} />
    </div>
  );
}

/** Bandeau santé v0.3 : score composite + facteurs dominants + badge anomalies. */
function HealthBanner({ health, periodLabel }: { health: Health; periodLabel: string }) {
  if (health.score == null || health.label == null) {
    return (
      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <span className="text-sm text-slate-400">
          Santé : données insuffisantes sur la fenêtre ({periodLabel}) pour calculer un score.
        </span>
      </div>
    );
  }
  const dominant = dominantFactors(health);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-3xl font-bold text-slate-900" data-testid="health-score">
          {health.score}
          <span className="text-base font-medium text-slate-400"> / 100</span>
        </span>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-sm font-semibold ${HEALTH_CLASS[health.label]}`}
          data-testid="health-label"
        >
          {health.label}
        </span>
      </div>
      <div className="min-w-0 flex-1 text-xs text-slate-500">
        <span className="font-semibold text-slate-600">Santé ({periodLabel})</span> — 40 % vitals
        (LCP x2) · 30 % erreurs · 20 % stabilité · 10 % anomalies 24 h.
        {dominant.length > 0 && (
          <>
            {" "}
            Points perdus :{" "}
            {dominant
              .map((d) => `${d.label} −${(d.max - (d.earned ?? 0)).toLocaleString("fr-FR")} pt (${d.detail})`)
              .join(" · ")}
          </>
        )}
      </div>
      {health.anomalies.length > 0 && (
        <a
          href="#anomalies"
          className="rounded-full border border-red-300 bg-red-100 px-2.5 py-0.5 text-sm font-semibold text-red-800 hover:bg-red-200"
          data-testid="anomaly-badge"
        >
          {health.anomalies.length} anomalie(s) détectée(s)
        </a>
      )}
    </div>
  );
}

/** Détail des anomalies LCP 24 h (vue v_anomaly), cible de l'ancre du badge. */
function AnomalyTable({ health }: { health: Health }) {
  if (!health.anomalies.length) return null;
  return (
    <div id="anomalies" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-slate-500">
        Anomalies LCP (24 h) — p75 horaire vs moyenne 7 j glissants, |z| &gt; 3
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
            <th className="py-1.5 pr-4 font-medium">App</th>
            <th className="py-1.5 pr-4 font-medium">Route</th>
            <th className="py-1.5 pr-4 font-medium">Heure</th>
            <th className="py-1.5 pr-4 font-medium">LCP p75</th>
            <th className="py-1.5 pr-4 font-medium">Moyenne 7 j</th>
            <th className="py-1.5 font-medium">z-score</th>
          </tr>
        </thead>
        <tbody>
          {health.anomalies.map((a) => (
            <tr key={`${a.app_id}-${a.route}-${String(a.bucket)}`} className="border-b border-slate-100">
              <td className="py-1.5 pr-4 text-slate-500">{a.app_id}</td>
              <td className="py-1.5 pr-4 font-mono text-xs">{a.route ?? "—"}</td>
              <td className="py-1.5 pr-4 text-slate-500">{fmtDate(a.bucket)}</td>
              <td className="py-1.5 pr-4 font-semibold">{fmtVital("LCP", a.p75)}</td>
              <td className="py-1.5 pr-4 text-slate-500">{fmtVital("LCP", a.mean_7d)}</td>
              <td className={`py-1.5 font-semibold ${a.z_score > 0 ? "text-red-600" : "text-emerald-600"}`}>
                {a.z_score > 0 ? "+" : ""}
                {a.z_score.toLocaleString("fr-FR")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
