// Page « Prévisions » (AIOps) : projette la dérive des indicateurs clés sur les
// 14 derniers jours pour anticiper AVANT l'incident — complément prédictif des
// anomalies z-score (réactives) et du burn-rate SLO. Régression linéaire pure
// (lib/forecast), réutilise les séries journalières existantes (queries-grid).
import { fmtBorne, fmtLatency } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { ForecastChart, type ForecastPoint } from "@/components/charts/ForecastChart";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { EchecLecture } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { lire } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import {
  HORIZON_JOURS as HORIZON,
  buildForecastNarrative,
  cleJour,
  etaToThreshold,
  forecastNext,
  linfit,
  trendDir,
  type TrendDir,
} from "@/lib/forecast";
import { dailyLcpSeries, dailyTraffic } from "@/lib/queries-grid";
import { THRESHOLDS, rating2026, type Rating } from "@/lib/rating";

export const dynamic = "force-dynamic";

const ARROW: Record<TrendDir, string> = { up: "▲", down: "▼", flat: "—" };
// Borne « Bon » du LCP, lue dans lib/rating.ts : au-delà, le verdict passe à « À améliorer ».
const LCP_BON = THRESHOLDS.LCP[0];
const LCP_BON_TEXTE = fmtBorne("LCP", LCP_BON);
// Ton de la tuile « LCP p75 actuel » : le verdict à trois niveaux de `rating2026`,
// jamais un seuil binaire — 3 s est « À améliorer », pas « Mauvais ».
const TON_VERDICT: Record<Rating, "good" | "warn" | "poor"> = { good: "good", "needs-improvement": "warn", poor: "poor" };

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
  const ecran = await pageFilters(await searchParams, "/forecast");
  if (!ecran.ok) return <FilterProblemNotice title="Prévisions" problem={ecran.problem} />;
  const f = ecran.filters;
  // CHAQUE LECTURE EST INDÉPENDANTE (F02, § 3.8 règle 1). Ces deux lectures lèvent
  // depuis F02 : sans `lire()`, une base indisponible remplaçait tout l'écran par
  // `error.tsx`. Désormais seule la partie qui dépend d'une lecture en échec le dit.
  const [trafficLu, lcpLu] = await Promise.all([lire(() => dailyTraffic(f)), lire(() => dailyLcpSeries(f))]);

  const entete = (
    <PageHeader
      title="Prévisions"
      help="forecast"
      sub={
        <>
          Anticiper la dérive <em>avant</em> l&apos;incident, en complément des anomalies (réactives) et
          du burn-rate SLO
        </>
      }
    />
  );

  // Le trafic porte l'axe des 14 jours (zéro-rempli) sur lequel tout s'aligne :
  // sans lui, aucune série ni carte n'a d'axe — l'écran entier est « en échec ».
  if (!trafficLu.ok) {
    return (
      <div className="animate-fade-up">
        {entete}
        <EchecLecture titre="Historique des 14 derniers jours" />
      </div>
    );
  }
  const traffic = trafficLu.data;
  // LCP illisible : `null`, jamais `[]` — un vide se lirait « aucune mesure ».
  const lcp = lcpLu.ok ? lcpLu.data : null;

  // Axe canonique : les 14 jours zéro-remplis du trafic. On aligne LCP dessus.
  const lcpByDay = new Map((lcp ?? []).map((r) => [cleJour(r.bucket), Number(r.p75)]));
  const days = traffic.map((t) => cleJour(t.day));
  const lcpVals = days.map((d) => (lcpByDay.has(d) ? lcpByDay.get(d)! : null));
  const errVals = traffic.map((t) => (t.pageviews ? (t.errors / t.pageviews) * 100 : null));
  const pvVals = traffic.map((t) => t.pageviews);

  const metrics: Metric[] = [
    {
      key: "lcp",
      label: "LCP p75",
      help: `Vitesse d'affichage perçue. Au-delà de ${LCP_BON_TEXTE}, le verdict web.dev passe à « À améliorer ».`,
      values: lcpVals,
      fmt: (v) => fmtLatency(v),
      threshold: LCP_BON,
      higherIsWorse: true,
      thresholdLabel: LCP_BON_TEXTE,
    },
    {
      key: "err",
      // Un ratio d'occurrences, pas une part : une page peut porter plusieurs
      // erreurs, et le ratio peut dépasser 100. Aucun seuil publié n'existe pour
      // lui : la tendance est montrée, sans verdict (§ 1.5 R-S du plan).
      label: "Occurrences d'erreurs pour 100 pages vues",
      help: "Somme des occurrences d'erreurs JS du jour, rapportée à ses pages vues. Aucun seuil publié n'existe pour ce ratio : la tendance est montrée sans verdict.",
      values: errVals,
      fmt: (v) => (v == null ? "—" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pour 100`),
      threshold: null,
      higherIsWorse: true,
      thresholdLabel: "",
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

  const hasData = traffic.some((t) => t.pageviews > 0) || (lcp?.length ?? 0) > 0;
  // LCP en échec : sa carte part avec le hero et la synthèse (seule métrique bornée,
  // la synthèse dirait « stable » sur un LCP qu'on n'a pas lu).
  const cartes = lcp ? metrics : metrics.filter((m) => m.key !== "lcp");

  // Synthèse déterministe : ETA au seuil des métriques bornées.
  const narrative = buildForecastNarrative(
    metrics
      .filter((m) => m.threshold != null)
      .map((m) => {
        const fit = linfit(m.values);
        const current = [...m.values].reverse().find((v) => v != null) ?? null;
        const eta = fit && current != null ? etaToThreshold(fit, current, m.threshold!, m.higherIsWorse) : null;
        return { label: m.label, thresholdLabel: m.thresholdLabel, eta };
      }),
  );
  const NARR_STYLE = {
    risk: "border-bad/30 bg-bad/10",
    watch: "border-warn/30 bg-warn/10",
    ok: "border-good/30 bg-good/10",
  } as const;
  const NARR_DOT = { risk: "bg-bad", watch: "bg-warn", ok: "bg-good" } as const;

  return (
    <div className="animate-fade-up">
      {entete}

      {!lcp && (
        <div className="mb-6">
          <EchecLecture titre="LCP p75 — réel et projection" />
        </div>
      )}

      {!hasData ? (
        // Sans LCP lu, « pas assez d'historique » serait une affirmation sur une
        // série qu'on n'a pas lue : l'état « en échec » ci-dessus suffit.
        lcp && (
          <div className="card p-8 text-center text-ink-soft">
            Pas assez d&apos;historique sur 14 jours — les prévisions apparaissent au fil des mesures.
          </div>
        )
      ) : (
        <>
        {lcp && (() => {
          // Hero : prévision de la métrique phare (LCP p75) — réel + projection + seuil.
          const m = metrics[0];
          const fit = linfit(m.values);
          const proj = fit ? Array.from({ length: HORIZON }, (_v, i) => forecastNext(fit, i + 1)) : [];
          const current = [...m.values].reverse().find((v) => v != null) ?? null;
          const projected = fit ? forecastNext(fit, HORIZON) : null;
          const eta =
            fit && current != null && m.threshold != null
              ? etaToThreshold(fit, current, m.threshold, m.higherIsWorse)
              : null;
          const fmtDay = (d: string) => {
            const [, mo, da] = d.split("-");
            return `${da}/${mo}`;
          };
          const chartData: ForecastPoint[] = days.map((d, i) => ({ label: fmtDay(d), real: m.values[i], proj: null }));
          if (fit && chartData.length) chartData[chartData.length - 1].proj = forecastNext(fit, 0);
          proj.forEach((v, i) => chartData.push({ label: `J+${i + 1}`, real: null, proj: v }));
          // Sans valeur (« — »), ton neutre : une absence de mesure n'est pas « bonne ».
          const verdict = current != null ? rating2026("LCP", current) : null;
          const tonActuel = verdict ? TON_VERDICT[verdict] : "neutral";
          return (
            <SupervisionHero
              chartTitle={`LCP p75 — réel + projection à J+${HORIZON}`}
              chart={
                <ForecastChart
                  data={chartData}
                  threshold={m.threshold}
                  thresholdLabel={m.thresholdLabel}
                  format="ms"
                />
              }
            >
              <HeroStat
                label="Tendance générale"
                value={narrative.status === "risk" ? "Action requise" : narrative.status === "watch" ? "À surveiller" : "Stable"}
                tone={narrative.status === "risk" ? "poor" : narrative.status === "watch" ? "warn" : "good"}
              />
              <HeroStat
                label="LCP p75 actuel"
                value={m.fmt(current)}
                tone={tonActuel}
                hint={`projeté J+${HORIZON} : ${m.fmt(projected)}`}
              />
              <HeroStat
                label={`Seuil ${LCP_BON_TEXTE}`}
                value={eta === 0 ? "dépassé" : eta != null && eta <= HORIZON ? `~J+${Math.ceil(eta)}` : "hors horizon"}
                tone={eta === 0 ? "poor" : eta != null && eta <= HORIZON ? "warn" : "good"}
                hint="échéance estimée de dépassement"
              />
              <HeroReading>
                La ligne pleine (bleue) = les 14 jours réels, prolongée en pointillé (orange) par la projection
                linéaire ; la ligne rouge = la borne « Bon » du LCP ({LCP_BON_TEXTE}), au-delà de laquelle il est « À améliorer ». Si le pointillé croise le rouge sur
                l&apos;horizon, c&apos;est le moment d&apos;agir. Les deux autres métriques sont détaillées
                ci-dessous.
              </HeroReading>
            </SupervisionHero>
          );
        })()}

        {/* Synthèse (narration déterministe) */}
        {lcp && (
          <div className={`mb-6 rounded-xl border px-4 py-3 ${NARR_STYLE[narrative.status]}`}>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              <span className={`h-1.5 w-1.5 rounded-full ${NARR_DOT[narrative.status]}`} />
              Synthèse — {narrative.status === "risk" ? "action requise" : narrative.status === "watch" ? "à surveiller" : "stable"}
            </div>
            <ul className="mt-1.5 space-y-0.5 text-sm text-ink">
              {narrative.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {cartes.map((m) => (
            <MetricCard key={m.key} m={m} />
          ))}
        </div>
        </>
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
  const arrowCls = dir === "flat" ? "text-ink-faint" : bad ? "text-bad-ink" : "text-good-ink";

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
            <span className="rounded-full bg-bad/10 px-2 py-0.5 font-semibold text-bad-ink">
              seuil {m.thresholdLabel} déjà dépassé
            </span>
          ) : eta != null && eta <= HORIZON ? (
            <span className="rounded-full bg-warn/10 px-2 py-0.5 font-semibold text-warn-ink">
              ⚠ dépassement du seuil {m.thresholdLabel} vers J+{Math.ceil(eta)}
            </span>
          ) : (
            <span className="rounded-full bg-good/10 px-2 py-0.5 font-semibold text-good-ink">
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
