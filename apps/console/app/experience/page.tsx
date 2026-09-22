// Page « Expérience » : le ressenti utilisateur (feedbacks) marié à la perf
// mesurée. Les trois constituants du ressenti côte à côte — LCP p75 et son
// verdict web.dev, frustration pour 1 000 sessions, CSAT —, la tendance, les
// verbatims et le CSAT par route. Rendu 100 % serveur, filtres app/période.
//
// PAS DE SCORE COMPOSITE. L'ancien « score d'expérience /100 » reposait sur des
// paliers de LCP sans source (100 / 82 / 55 / 32) et une pondération 60/40 au
// jugé : un chiffre qui avait l'air d'une mesure sans en être une. Chacun des
// trois constituants a sa source ; aucun n'est pondéré.
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { LineTrend } from "@/components/charts/LineTrend";
import { ExperienceUnavailable } from "@/components/ExperienceUnavailable";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import type { SearchParams } from "@/lib/filters";
import { fmtVital } from "@/lib/format";
import { pageFilters } from "@/lib/page-filters";
import { hrefWithQuery } from "@/lib/query-contract";
import { RATING_LABEL, rating2026, texteSeuils } from "@/lib/rating";
import {
  experienceContext,
  feedbackByRoute,
  feedbackStats,
  feedbackTrend,
  recentFeedback,
} from "@/lib/queries-experience";

export const dynamic = "force-dynamic";

const RATING_TONE = { good: "good", "needs-improvement": "warn", poor: "poor" } as const;

export default async function Experience({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const ecran = await pageFilters((await searchParams) ?? {}, "/experience");
  if (!ecran.ok) return <FilterProblemNotice title="Expérience" problem={ecran.problem} />;
  const f = ecran.filters;
  const [stats, ctx, trend, recent, byRoute] = await Promise.all([
    feedbackStats(f),
    experienceContext(f),
    feedbackTrend(f),
    recentFeedback(f),
    feedbackByRoute(f),
  ]);

  const csatVal = stats.count ? stats.positives / stats.count : null;
  // Sans session, pas de taux : « — », jamais « 0 », qui se lirait « aucune frustration ».
  const frustrationPour1000 = ctx.sessions ? (ctx.frustration / ctx.sessions) * 1000 : null;
  const lcpRating = ctx.lcp_p75 == null ? null : rating2026("LCP", ctx.lcp_p75);
  // Jour sans avis noté : pas de point — un « 0 % » dessinerait une chute de satisfaction.
  const trendPoints = trend
    .filter((t) => t.count > 0)
    .map((t) => ({
      label: new Date(t.bucket).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
      value: Math.round((t.positives / t.count) * 100),
      volume: t.count,
    }));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Expérience"
        help="experience"
        sub="Le ressenti des utilisateurs (feedbacks) relié à la performance qu'ils ont subie."
      />

      <SupervisionHero
        chartTitle="Satisfaction dans le temps — part des avis ≥ 4/5, par jour"
        chart={
          trendPoints.length > 0 ? (
            <LineTrend
              data={trendPoints}
              valueName="CSAT"
              valueUnit="%"
              volumeName="avis"
              color="#059669"
              domain={[0, 100]}
            />
          ) : (
            <ExperienceUnavailable />
          )
        }
      >
        <HeroStat
          label="LCP p75"
          value={fmtVital("LCP", ctx.lcp_p75)}
          tone={lcpRating ? RATING_TONE[lcpRating] : "neutral"}
          hint={lcpRating ? `${RATING_LABEL[lcpRating]} — ${texteSeuils("LCP")}` : "aucune mesure LCP sur la période"}
        />
        <HeroStat
          label="Frustration"
          value={frustrationPour1000 == null ? "—" : frustrationPour1000.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
          hint={frustrationPour1000 == null ? "aucune session sur la période" : "clics rageurs et morts pour 1 000 sessions"}
        />
        <HeroStat
          label="CSAT"
          value={csatVal == null ? "—" : `${Math.round(csatVal * 100)} %`}
          tone={csatVal != null && csatVal < 0.5 ? "poor" : "neutral"}
          hint="retours ≥ 4/5"
        />
        <HeroStat
          label="Réponses"
          value={<span data-testid="xp-count">{stats.count}</span>}
          hint={`note moy. ${stats.avg == null ? "—" : stats.avg.toFixed(1)}/5 · ${stats.detractors} détracteur(s)`}
        />
        <HeroReading>
          Les trois constituants du ressenti, côte à côte et sans pondération : ce que l&apos;utilisateur
          subit (LCP p75, jugé aux seuils web.dev), ce qui l&apos;agace (clics rageurs et morts) et ce
          qu&apos;il déclare (part des avis ≥ 4/5). La courbe ne trace que les jours où au moins un avis
          noté existe.
        </HeroReading>
      </SupervisionHero>

      {stats.count === 0 && (
        <div className="card mt-6 p-6 text-sm text-ink-soft">
          <p className="font-medium text-ink">Aucun feedback sur la période.</p>
          <p className="mt-1">
            La satisfaction ne se calcule donc pas ; la performance et la frustration ci-dessus restent
            mesurées. Pour collecter le ressenti, ajoutez le widget après le snippet RUM :
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-panel2 p-3 font-mono text-xs text-ink-soft">
            {`<script src="/mip-rum-feedback.js"></script>`}
          </pre>
          <p className="mt-2 text-xs text-ink-faint">
            Il envoie <code>MIPRum.track(&quot;feedback&quot;, …)</code> — aucune autre configuration.
            Après un avis envoyé, le widget se tait <strong>60 jours</strong> pour ce visiteur et
            cette application ; ajustez avec{" "}
            <code>window.MIPRumFeedback = {"{ cooldownDays: 30 }"}</code>.
          </p>
        </div>
      )}

      {/* CSAT par route */}
      {byRoute.length > 0 && (
        <div className="card mt-8 overflow-hidden">
          <div className="border-b border-line bg-panel2 px-4 py-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Satisfaction par page
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-panel2">
              <tr>
                <th className="th text-left">Page</th>
                <th className="th text-right">Avis</th>
                <th className="th text-right">CSAT</th>
                <th className="th text-right">Note moy.</th>
              </tr>
            </thead>
            <tbody>
              {byRoute.map((r, i) => {
                const c = r.count ? r.positives / r.count : 0;
                return (
                  <tr key={`${r.route}|${i}`} className="border-t border-line/60">
                    <td className="px-4 py-2"><span className="chip-mono">{r.route ?? "(app)"}</span></td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.count}</td>
                    <td className={`px-4 py-2 text-right font-semibold tabular-nums ${c < 0.5 ? "text-bad-ink" : c < 0.8 ? "text-warn-ink" : "text-good-ink"}`}>
                      {Math.round(c * 100)}%
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{r.avg == null ? "—" : r.avg.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Verbatims */}
      {recent.length > 0 && (
        <div className="card mt-8 overflow-hidden">
          <div className="border-b border-line bg-panel2 px-4 py-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Derniers retours</h2>
          </div>
          <ul className="divide-y divide-line/60">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <span className="shrink-0 tabular-nums text-warn-ink" title={`${r.score ?? "?"}/5`}>
                  {"★".repeat(r.score ?? 0)}
                  <span className="text-ink-faint">{"★".repeat(Math.max(0, 5 - (r.score ?? 0)))}</span>
                </span>
                <span className="min-w-0 flex-1 text-sm text-ink">
                  {r.comment ? r.comment : <span className="text-ink-faint">(sans commentaire)</span>}
                </span>
                <span className="shrink-0 chip-mono">{r.route ?? "(app)"}</span>
                {r.session_id && (
                  <Link
                    href={hrefWithQuery(`/sessions/${encodeURIComponent(r.session_id)}`, ecran.query)}
                    className="shrink-0 text-xs font-medium text-perf hover:underline"
                  >
                    session →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
