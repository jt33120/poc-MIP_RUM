// Page « Prévisions » (AIOps) : projette la dérive des indicateurs clés sur les
// 14 derniers jours pour anticiper AVANT l'incident — complément prédictif des
// anomalies z-score (réactives) et du burn-rate SLO. Régression linéaire pure
// (lib/forecast), réutilise les séries journalières existantes (queries-grid).
import { fmtLatency } from "@/components/ai/format";
import { PageHeader } from "@/components/PageHeader";
import { parseFilters, type SearchParams } from "@/lib/filters";
import {
  etaToThreshold,
  forecastNext,
  linfit,
  trendDir,
  type TrendDir,
} from "@/lib/forecast";
import { dailyLcpSeries, dailyTraffic } from "@/lib/queries-grid";

export const dynamic = "force-dynamic";

const HORIZON = 3; // jours projetés
const ARROW: Record<TrendDir, string> = { up: "▲", down: "▼", flat: "—" };

interface Metric {
  key: string;
  label: string;
  help: string;
  values: (number | null)[];
  fmt: (v: number | null) => string;
  threshold: number | null;
  higherIsWorse: boolean;
  thresholdLabel: string;
}

export default async function Forecast({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const [traffic, lcp] = await Promise.all([dailyTraffic(f), dailyLcpSeries(f)]);

  // Axe canonique : les 14 jours zéro-remplis du trafic. On aligne LCP dessus.
  const lcpByDay = new Map(lcp.map((r) => [String(r.bucket).slice(0, 10), Number(r.p75)]));
  const days = traffic.map((t) => String(t.day).slice(0, 10));
  const lcpVals = days.map((d) => (lcpByDay.has(d) ? lcpByDay.get(d)! : null));
  const errVals = traffic.map((t) => (t.pageviews ? (t.errors / t.pageviews) * 100 : null));
  const pvVals = traffic.map((t) => t.pageviews);

  const metrics: Metric[] = [
    {
      key: "lcp",
      label: "LCP p75",
      help: "Vitesse d'affichage perçue. Seuil « à améliorer » : 2,5 s.",
      values: lcpVals,
      fmt: (v) => fmtLatency(v),
      threshold: 2500,
      higherIsWorse: true,
      thresholdLabel: "2,5 s",
    },
    {
      key: "err",
      label: "Taux d'erreur JS",
      help: "Part de pages vues avec au moins une erreur. Seuil d'alerte : 2 %.",
      values: errVals,
      fmt: (v) => (v == null ? "—" : `${v.toFixed(1)} %`),
      threshold: 2,
      higherIsWorse: true,
      thresholdLabel: "2 %",
    },
    {
      key: "traffic",
      label: "Trafic (pages vues / j)",
      help: "Charge projetée — anticiper les pics (capacity planning côté expérience).",
      values: pvVals,
      fmt: (v) => (v == null ? "—" : Math.round(v).toLocaleString("fr-FR")),
      threshold: null,
      higherIsWorse: true,
      thresholdLabel: "",
    },
  ];

  const hasData = traffic.some((t) => t.pageviews > 0) || lcp.length > 0;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Prévisions"
        help="forecast"
        sub={
          <>
            Projection linéaire des indicateurs clés sur 14 jours — anticiper la dérive <em>avant</em>{" "}
            l&apos;incident, en complément des anomalies (réactives) et du burn-rate SLO
          </>
        }
      />

      {!hasData ? (
        <div className="card p-8 text-center text-ink-soft">
          Pas assez d&apos;historique sur 14 jours — les prévisions apparaissent au fil des mesures.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {metrics.map((m) => (
            <MetricCard key={m.key} m={m} />
          ))}
        </div>
      )}

      {hasData && (
        <p className="mt-6 max-w-3xl text-xs text-ink-faint">
          Méthode : régression par moindres carrés sur les points journaliers (transparente, explicable).
          Une projection n&apos;est pas une certitude — elle signale une tendance à surveiller, pas un
          futur garanti.
        </p>
      )}
    </div>
  );
}

function MetricCard({ m }: { m: Metric }) {
  const fit = linfit(m.values);
  const current = [...m.values].reverse().find((v) => v != null) ?? null;
  const projected = fit ? forecastNext(fit, HORIZON) : null;
  const dir: TrendDir = fit ? trendDir(fit, current ?? 1) : "flat";
  const eta =
    fit && m.threshold != null && current != null
      ? etaToThreshold(fit, current, m.threshold, m.higherIsWorse)
      : null;

  // couleur de la tendance selon le sens « défavorable »
  const bad = dir === (m.higherIsWorse ? "up" : "down");
  const arrowCls = dir === "flat" ? "text-ink-faint" : bad ? "text-bad" : "text-good";

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {m.label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums tracking-tight text-ink">{m.fmt(current)}</span>
        <span className={`text-sm font-semibold ${arrowCls}`} title="tendance 14 j">{ARROW[dir]}</span>
      </div>
      <div className="mt-1 text-xs text-ink-soft">
        projeté à J+{HORIZON} : <span className="font-semibold tabular-nums">{m.fmt(projected)}</span>
      </div>

      <ForecastSpark values={m.values} fit={fit} threshold={m.threshold} />

      {m.threshold != null && (
        <div className="mt-3 text-xs">
          {eta === 0 ? (
            <span className="rounded-full bg-bad/10 px-2 py-0.5 font-semibold text-bad">
              seuil {m.thresholdLabel} déjà dépassé
            </span>
          ) : eta != null && eta <= 7 ? (
            <span className="rounded-full bg-warn/10 px-2 py-0.5 font-semibold text-warn">
              ⚠ dépassement du seuil {m.thresholdLabel} vers J+{Math.ceil(eta)}
            </span>
          ) : (
            <span className="rounded-full bg-good/10 px-2 py-0.5 font-semibold text-good">
              sous le seuil {m.thresholdLabel} sur l&apos;horizon
            </span>
          )}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">{m.help}</p>
    </div>
  );
}

/** Mini-graphe : points réels (ligne) + projection (pointillés) + ligne de seuil. */
function ForecastSpark({
  values,
  fit,
  threshold,
}: {
  values: (number | null)[];
  fit: ReturnType<typeof linfit>;
  threshold: number | null;
}) {
  const W = 240;
  const H = 56;
  const n = values.length;
  const proj = fit ? Array.from({ length: HORIZON }, (_, i) => forecastNext(fit, i + 1)) : [];
  const all = [...values.filter((v): v is number => v != null), ...proj, ...(threshold != null ? [threshold] : [])];
  if (all.length < 2) return <div className="mt-3 h-14" />;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const totalX = n - 1 + HORIZON;
  const x = (i: number) => (i / totalX) * (W - 4) + 2;
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);

  const realPts = values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
  const projPts =
    fit != null
      ? [`${x(n - 1)},${y(forecastNext(fit, 0))}`, ...proj.map((v, i) => `${x(n + i)},${y(v)}`)].join(" ")
      : "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="tendance projetée">
      {threshold != null && (
        <line x1={2} x2={W - 2} y1={y(threshold)} y2={y(threshold)} style={{ stroke: "#dc2626" }} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
      )}
      {realPts && <polyline points={realPts} fill="none" style={{ stroke: "rgb(var(--c-brand))" }} strokeWidth={2} />}
      {projPts && <polyline points={projPts} fill="none" style={{ stroke: "#f89101" }} strokeWidth={2} strokeDasharray="3 3" />}
    </svg>
  );
}
