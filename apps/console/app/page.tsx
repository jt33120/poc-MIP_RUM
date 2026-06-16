import { HealthHeatmap, type HeatCell, dayKey, lastNDayKeys } from "@/components/charts/HealthHeatmap";
import { TrafficTimeseries } from "@/components/charts/TrafficTimeseries";
import { VitalsTimeseries } from "@/components/charts/VitalsTimeseries";
import { GlossaryTip } from "@/components/GlossaryTip";
import { PageHeader } from "@/components/PageHeader";
import { VitalCard } from "@/components/VitalCard";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { fmtDate, fmtVital } from "@/lib/format";
import {
  dominantFactors,
  type Health,
  HEALTH_CLASS,
  type HealthLabel,
  healthScore,
} from "@/lib/health";
import { overviewStats, vitalSeries, vitalsP75 } from "@/lib/queries";
import { dailyLcpSeries, dailyTraffic, GRID_DAYS, healthGrid } from "@/lib/queries-grid";
import { THRESHOLDS } from "@/lib/rating";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const period = PERIODS[f.period];

  const [vitals, vitalsPrev, stats, statsPrev, series, health, grid, traffic, dailyLcp] =
    await Promise.all([
      vitalsP75(f),
      vitalsP75(f, true),
      overviewStats(f),
      overviewStats(f, true),
      vitalSeries(f, "LCP"),
      healthScore(f),
      healthGrid(f),
      dailyTraffic(f),
      dailyLcpSeries(f),
    ]);

  const byName = Object.fromEntries(vitals.map((v) => [v.name, v]));
  const prevByName = Object.fromEntries(vitalsPrev.map((v) => [v.name, v]));
  const errorRate = stats.pageviews ? ((stats.errors / stats.pageviews) * 100).toFixed(1) : "0";
  const prevErrorRate = statsPrev.pageviews ? (statsPrev.errors / statsPrev.pageviews) * 100 : null;

  // heatmap 14 j : axe des jours + index `${jour}|${heure}` des créneaux
  const gridDays = lastNDayKeys(GRID_DAYS);
  const gridByKey = new Map<string, HeatCell>(
    grid.map((c) => [`${dayKey(c.day)}|${c.hour}`, { good_w: c.good_w, total_w: c.total_w }]),
  );
  const gridHasData = grid.length > 0;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Overview"
        help="rum"
        sub={
          <>
            Core Web Vitals réels au p75 · seuils 2026 (LCP &lt; 2,0 s · INP &lt; 200 ms · CLS &lt; 0,1) ·
            fenêtre {period.label} · tendance vs période précédente
          </>
        }
      />

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

      <div className="card p-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          LCP p75 dans le temps (buckets {period.bucketLabel})
        </h2>
        {series.length ? (
          <VitalsTimeseries
            data={series.map((s) => ({ ...s, bucket: String(s.bucket), p75: Number(s.p75) }))}
            thresholds={THRESHOLDS.LCP}
          />
        ) : (
          <p className="py-12 text-center text-sm text-ink-faint">
            Pas de données sur la fenêtre — élargis la période ou ouvre la démo.
          </p>
        )}
      </div>

      {/* Historique de santé 14 j (fenêtre fixe, comme les anomalies) :
          heatmap jour × heure + courbes de volume et de p75 LCP associées. */}
      <section className="card mt-6 p-4">
        <h2 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Historique de santé — {GRID_DAYS} derniers jours
          <GlossaryTip id="healthGrid" />
        </h2>
        <p className="mb-4 text-xs text-ink-faint">
          Fenêtre fixe (indépendante du filtre période) · une case = une heure, sa couleur = la part de
          mesures « good » du créneau.
        </p>
        {gridHasData ? (
          <HealthHeatmap dayKeys={gridDays} byKey={gridByKey} />
        ) : (
          <p className="py-10 text-center text-sm text-ink-faint">
            Pas assez de données sur 14 jours — la heatmap se remplit au fil des mesures.
          </p>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Volume & fiabilité par jour
            </h3>
            {traffic.length ? (
              <TrafficTimeseries data={traffic.map((t) => ({ ...t, day: String(t.day) }))} />
            ) : (
              <p className="py-12 text-center text-sm text-ink-faint">Pas de données.</p>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              p75 LCP par jour
            </h3>
            {dailyLcp.length ? (
              <VitalsTimeseries
                data={dailyLcp.map((s) => ({ bucket: String(s.bucket), p75: Number(s.p75) }))}
                thresholds={THRESHOLDS.LCP}
                xAxis="day"
              />
            ) : (
              <p className="py-12 text-center text-sm text-ink-faint">Pas de données.</p>
            )}
          </div>
        </div>
      </section>

      <AnomalyTable health={health} />
    </div>
  );
}

const RING_STROKE: Record<HealthLabel, string> = {
  Excellent: "#10b981",
  Bon: "#0ea5e9",
  Dégradé: "#f59e0b",
  Critique: "#ef4444",
};

/** Anneau de score SVG (rendu serveur) — la pièce centrale du poste de pilotage. */
function HealthRing({ score, label }: { score: number; label: HealthLabel }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--c-line))" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={RING_STROKE[label]}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums leading-none text-ink" data-testid="health-score">
          {score}
        </span>
        <span className="mt-0.5 text-[10px] font-medium text-ink-faint">/ 100</span>
      </div>
    </div>
  );
}

/** Barre de contribution d'un facteur du score (earned/max). */
function FactorBar({
  label,
  detail,
  earned,
  max,
}: {
  label: string;
  detail: string;
  earned: number | null;
  max: number;
}) {
  const ratio = earned == null ? null : earned / max;
  const color =
    ratio == null
      ? "bg-ink-faint/40"
      : ratio >= 0.85
        ? "bg-emerald-500"
        : ratio >= 0.5
          ? "bg-amber-500"
          : "bg-red-500";
  return (
    <div title={detail}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-ink-soft">{label}</span>
        <span className="tabular-nums text-ink-faint">
          {earned == null ? "n/a" : `${earned.toLocaleString("fr-FR")} / ${max}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel2">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${(ratio ?? 0) * 100}%` }} />
      </div>
    </div>
  );
}

/** Bandeau santé v0.3 : score composite + facteurs dominants + badge anomalies. */
function HealthBanner({ health, periodLabel }: { health: Health; periodLabel: string }) {
  if (health.score == null || health.label == null) {
    return (
      <div className="card mb-6 p-4">
        <span className="text-sm text-ink-faint">
          Santé : données insuffisantes sur la fenêtre ({periodLabel}) pour calculer un score.
        </span>
      </div>
    );
  }
  const dominant = dominantFactors(health);
  return (
    <div className="card mb-6 flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
      <div className="flex items-center gap-5">
        <HealthRing score={health.score} label={health.label} />
        <div>
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Santé ({periodLabel})
            <GlossaryTip id="health" />
          </div>
          <span
            className={`mt-1.5 inline-block rounded-full border px-3 py-1 text-sm font-semibold ${HEALTH_CLASS[health.label]}`}
            data-testid="health-label"
          >
            {health.label}
          </span>
          {health.anomalies.length > 0 && (
            <a
              href="#anomalies"
              className="mt-2 block w-fit rounded-full border border-red-300 bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800 transition hover:bg-red-200 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300 dark:hover:bg-red-400/20"
              data-testid="anomaly-badge"
            >
              {health.anomalies.length} anomalie(s) détectée(s)
            </a>
          )}
        </div>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {health.factors.map((x) => (
          <FactorBar key={x.key} label={x.label} detail={x.detail} earned={x.earned} max={x.max} />
        ))}
      </div>
      <div className="w-full text-xs text-ink-faint">
        40 % vitals (LCP x2) · 30 % erreurs · 20 % stabilité · 10 % anomalies 24 h.
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
    </div>
  );
}

/** Détail des anomalies LCP 24 h (vue v_anomaly), cible de l'ancre du badge. */
function AnomalyTable({ health }: { health: Health }) {
  if (!health.anomalies.length) return null;
  return (
    <div id="anomalies" className="card mt-6 overflow-hidden">
      <h2 className="flex items-center gap-1.5 border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Anomalies LCP (24 h) — p75 horaire vs moyenne 7 j glissants, |z| &gt; 3
        <GlossaryTip id="anomaly" />
      </h2>
      <table className="w-full text-sm">
        <thead className="bg-panel2">
          <tr>
            <th className="th">App</th>
            <th className="th">Route</th>
            <th className="th">Heure</th>
            <th className="th">LCP p75</th>
            <th className="th">Moyenne 7 j</th>
            <th className="th">z-score</th>
          </tr>
        </thead>
        <tbody>
          {health.anomalies.map((a) => (
            <tr
              key={`${a.app_id}-${a.route}-${String(a.bucket)}`}
              className="border-t border-line/60 transition hover:bg-panel2/60"
            >
              <td className="px-4 py-2 text-ink-soft">{a.app_id}</td>
              <td className="px-4 py-2"><span className="chip-mono">{a.route ?? "—"}</span></td>
              <td className="px-4 py-2 text-ink-soft">{fmtDate(a.bucket)}</td>
              <td className="px-4 py-2 font-semibold tabular-nums">{fmtVital("LCP", a.p75)}</td>
              <td className="px-4 py-2 tabular-nums text-ink-soft">{fmtVital("LCP", a.mean_7d)}</td>
              <td
                className={`px-4 py-2 font-semibold tabular-nums ${
                  a.z_score > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
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
    const cls = flat
      ? "text-ink-faint"
      : worse
        ? "text-red-600 dark:text-red-400"
        : "text-emerald-600 dark:text-emerald-400";
    trend = (
      <span className={`text-xs font-semibold tabular-nums ${cls}`} title="vs période précédente">
        {flat ? "→" : delta > 0 ? "↑" : "↓"} {delta > 0 ? "+" : ""}
        {delta.toFixed(0)} %
      </span>
    );
  }
  return (
    <div className="card p-4 transition hover:shadow-pop">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums tracking-tight" data-testid={testid}>
          {value}
        </span>
        {trend}
      </div>
    </div>
  );
}
