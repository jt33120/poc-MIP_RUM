import Link from "next/link";
import { HealthHeatmap, type HeatCell, dayKey, lastNDayKeys } from "@/components/charts/HealthHeatmap";
import { TrafficTimeseries } from "@/components/charts/TrafficTimeseries";
import { VitalsTimeseries } from "@/components/charts/VitalsTimeseries";
import { GlossaryTip } from "@/components/GlossaryTip";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { BriefingCard } from "@/components/BriefingCard";
import { VitalCard } from "@/components/VitalCard";
import { HealthBanner } from "@/components/health/HealthBanner";
import { AnomalyTable } from "@/components/health/AnomalyTable";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { healthScore } from "@/lib/health";
import { overviewStats, vitalSeries, vitalsP75 } from "@/lib/queries";
import { dailyLcpSeries, dailyTraffic, GRID_DAYS, healthGrid } from "@/lib/queries-grid";
import { THRESHOLDS } from "@/lib/rating";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const period = PERIODS[f.period];

  // toggle « heures ouvrées » de la heatmap, porté par l'URL (?hours=business),
  // en préservant les autres filtres (app/période/device)
  const businessHours = sp.hours === "business";
  const baseParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") baseParams.set(k, v);
  const hrefWith = (val: string | null) => {
    const p = new URLSearchParams(baseParams);
    if (val) p.set("hours", val);
    else p.delete("hours");
    const qs = p.toString();
    return qs ? `/?${qs}` : "/";
  };

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
  const pctOf = (cur: number, prev: number | null | undefined) =>
    prev != null && prev !== 0 ? { pct: ((cur - prev) / prev) * 100 } : null;

  // heatmap 14 j : axe des jours + index `${jour}|${heure}` des créneaux
  const gridDays = lastNDayKeys(GRID_DAYS);
  const gridByKey = new Map<string, HeatCell>(
    grid.map((c) => [`${dayKey(c.day)}|${c.hour}`, { good_w: c.good_w, total_w: c.total_w }]),
  );
  const gridHasData = grid.length > 0;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Vue d'ensemble"
        help="rum"
        sub={
          <>
            Core Web Vitals réels au p75 · seuils 2026 (LCP &lt; 2,0 s · INP &lt; 200 ms · CLS &lt; 0,1) ·
            fenêtre {period.label} · tendance vs période précédente
          </>
        }
      />

      {f.app && stats.sessions === 0 && (
        <div
          data-testid="onboarding-nudge"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm"
        >
          <span className="text-ink">
            <strong>Cette application n&apos;a pas encore reçu de données.</strong> Posez le capteur RUM
            sur votre site, puis simulez un parcours — les mesures apparaîtront ici.
          </span>
          <Link href={`/select/new?app=${encodeURIComponent(f.app)}`} className="btn-accent ml-auto shrink-0 px-3 py-1.5">
            Guide d&apos;intégration →
          </Link>
        </div>
      )}

      {f.app && stats.sessions > 0 && <BriefingCard app={f.app} />}

      <HealthBanner health={health} periodLabel={period.label} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {["LCP", "INP", "CLS", "FCP", "TTFB"].map((name) => (
          <VitalCard
            key={name}
            name={name}
            p75={byName[name]?.p75 ?? null}
            median={byName[name]?.p50 ?? null}
            n={byName[name]?.n ?? 0}
            prev={prevByName[name]?.p75 ?? null}
            periodLabel={period.label}
          />
        ))}
      </div>

      <SupervisionHero
        chartTitle={`LCP p75 dans le temps (buckets ${period.bucketLabel})`}
        chart={
          series.length ? (
            <VitalsTimeseries
              data={series.map((s) => ({ ...s, bucket: String(s.bucket), p75: Number(s.p75) }))}
              thresholds={THRESHOLDS.LCP}
            />
          ) : (
            <p className="py-12 text-center text-sm text-ink-faint">
              Pas de données sur la fenêtre — élargis la période ou ouvre la démo.
            </p>
          )
        }
      >
        <HeroStat
          label={`Sessions · ${period.label}`}
          value={stats.sessions.toLocaleString("fr-FR")}
          delta={pctOf(stats.sessions, statsPrev.sessions)}
        />
        <HeroStat
          label="Pages vues"
          value={stats.pageviews.toLocaleString("fr-FR")}
          delta={pctOf(stats.pageviews, statsPrev.pageviews)}
        />
        <HeroStat
          label="Taux d'erreur JS / page vue"
          value={`${errorRate} %`}
          delta={prevErrorRate != null ? { pct: (Number(errorRate) - prevErrorRate) / (prevErrorRate || 1) * 100, lowerIsBetter: true } : null}
          tone={Number(errorRate) > 2 ? "poor" : Number(errorRate) > 1 ? "warn" : "good"}
        />
        <HeroReading>
          Courbe = LCP p75 dans le temps face aux seuils 2026 (bande verte «&nbsp;bon&nbsp;» sous 2,0&nbsp;s,
          rouge «&nbsp;mauvais&nbsp;» au-delà). Les tuiles comparent le volume et la fiabilité à la période
          précédente. Détail vital par vital ci-dessous, historique 14&nbsp;jours plus bas.
        </HeroReading>
      </SupervisionHero>

      {/* Historique de santé 14 j (fenêtre fixe, comme les anomalies) :
          heatmap jour × heure + courbes de volume et de p75 LCP associées. */}
      <section className="card mt-6 p-4">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Historique de santé — {GRID_DAYS} derniers jours
            <GlossaryTip id="healthGrid" />
          </h2>
          {/* filtre heures ouvrées (Lun–Ven, 8h–19h) — ne montre que les créneaux à trafic attendu */}
          <div className="ml-auto flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5">
            <Link
              href={hrefWith(null)}
              scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                !businessHours ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-faint hover:text-ink-soft"
              }`}
            >
              24 h/24
            </Link>
            <Link
              href={hrefWith("business")}
              scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                businessHours ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-faint hover:text-ink-soft"
              }`}
            >
              Heures ouvrées
            </Link>
          </div>
        </div>
        <p className="mb-4 text-xs text-ink-faint">
          Fenêtre fixe (indépendante du filtre période) · une case = une heure, sa couleur = la part de
          mesures « good ».{" "}
          {businessHours
            ? "Vue Lun–Ven, 8h–19h."
            : "Une case vide = aucune page vue ce créneau (le RUM n'enregistre que le trafic réel) — les nuits/week-ends creux sont normaux."}
        </p>
        {gridHasData ? (
          <HealthHeatmap dayKeys={gridDays} byKey={gridByKey} businessOnly={businessHours} />
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
