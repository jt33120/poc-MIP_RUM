// Page « Expérience » : le ressenti utilisateur (feedbacks) marié à la perf
// mesurée. Un score d'expérience /100, le CSAT, la tendance, les verbatims et le
// CSAT par route. Rendu 100 % serveur, filtres app/période (modèle « v2 »).
import Link from "next/link";
import { AiKpi } from "@/components/ai/AiKpi";
import { PageHeader } from "@/components/PageHeader";
import { experienceScore, frustrationPenalty, scoreTone } from "@/lib/experience";
import { parseFilters, periodLabel, type SearchParams } from "@/lib/queries-v2";
import {
  experienceContext,
  feedbackByRoute,
  feedbackStats,
  feedbackTrend,
  recentFeedback,
} from "@/lib/queries-experience";

export const dynamic = "force-dynamic";

const TONE_TEXT = { good: "text-good", warn: "text-warn", bad: "text-bad" } as const;

/** LCP p75 -> sous-score perçu 0..100 (repères Web Vitals 2026). */
function vitalsScore(lcpP75: number | null): number {
  if (lcpP75 == null) return 70; // pas de vitals sur la fenêtre : base neutre
  if (lcpP75 <= 2000) return 100;
  if (lcpP75 <= 2500) return 82;
  if (lcpP75 <= 4000) return 55;
  return 32;
}

export default async function Experience({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const f = parseFilters(await searchParams);
  const [stats, ctx, trend, recent, byRoute] = await Promise.all([
    feedbackStats(f),
    experienceContext(f),
    feedbackTrend(f),
    recentFeedback(f),
    feedbackByRoute(f),
  ]);

  const csatVal = stats.count ? stats.positives / stats.count : null;
  const ratePer1k = ctx.sessions ? (ctx.frustration / ctx.sessions) * 1000 : 0;
  const score = experienceScore({
    vitals: vitalsScore(ctx.lcp_p75),
    frustrationPenalty: frustrationPenalty(ratePer1k),
    csat: csatVal,
  });
  const tone = scoreTone(score);
  const maxTrend = trend.reduce((m, t) => Math.max(m, t.count), 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Expérience"
        help="experience"
        sub={
          <>
            Le ressenti des utilisateurs (feedbacks) relié à la performance qu&apos;ils ont subie · fenêtre{" "}
            {periodLabel(f)}
          </>
        }
      />

      {/* Score + KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <div className="card p-4 transition hover:shadow-pop">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Score d&apos;expérience
          </div>
          <div className={`mt-2 text-3xl font-bold tabular-nums tracking-tight ${TONE_TEXT[tone]}`} data-testid="xp-score">
            {score}
            <span className="text-lg text-ink-faint">/100</span>
          </div>
          <div className="mt-2 text-xs text-ink-faint">perf perçue × frustration × CSAT</div>
        </div>
        <AiKpi
          label="CSAT"
          value={csatVal == null ? "—" : `${Math.round(csatVal * 100)} %`}
          tone={csatVal != null && csatVal < 0.5 ? "danger" : "ink"}
          hint="retours ≥ 4/5"
        />
        <AiKpi label="Réponses" value={stats.count} testId="xp-count" hint={`fenêtre ${periodLabel(f)}`} />
        <AiKpi label="Note moyenne" value={stats.avg == null ? "—" : stats.avg.toFixed(1)} hint="sur 5" />
        <AiKpi
          label="Détracteurs"
          value={stats.detractors}
          tone={stats.detractors > 0 ? "danger" : "ink"}
          hint="notes 1–2"
        />
      </div>

      {stats.count === 0 && (
        <div className="card mt-6 p-6 text-sm text-ink-soft">
          <p className="font-medium text-ink">Aucun feedback sur la période.</p>
          <p className="mt-1">
            Le score ci-dessus repose alors sur la seule performance perçue. Pour collecter le ressenti,
            ajoutez le widget après le snippet RUM :
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-panel2 p-3 font-mono text-xs text-ink-soft">
            {`<script src="/mip-rum-feedback.js"></script>`}
          </pre>
          <p className="mt-2 text-xs text-ink-faint">
            Il envoie <code>MIPRum.track(&quot;feedback&quot;, …)</code> — aucune autre configuration.
          </p>
        </div>
      )}

      {/* Tendance CSAT */}
      {trend.length > 0 && (
        <div className="card mt-8 p-4">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Satisfaction dans le temps
          </h2>
          <div className="flex flex-col gap-1.5">
            {trend.map((t) => {
              const pct = t.count ? Math.round((t.positives / t.count) * 100) : 0;
              return (
                <div key={t.bucket} className="flex items-center gap-3 text-xs">
                  <span className="w-24 shrink-0 tabular-nums text-ink-faint">{t.bucket.slice(0, 10)}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                    <div className="h-full rounded-full bg-good" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-24 shrink-0 text-right tabular-nums text-ink-soft">
                    {pct}% · {t.count} avis
                  </span>
                </div>
              );
            })}
          </div>
          <p className="sr-only">Volume max : {maxTrend}</p>
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
                    <td className={`px-4 py-2 text-right font-semibold tabular-nums ${c < 0.5 ? "text-bad" : c < 0.8 ? "text-warn" : "text-good"}`}>
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
                <span className="shrink-0 tabular-nums text-warn" title={`${r.score ?? "?"}/5`}>
                  {"★".repeat(r.score ?? 0)}
                  <span className="text-ink-faint">{"★".repeat(Math.max(0, 5 - (r.score ?? 0)))}</span>
                </span>
                <span className="min-w-0 flex-1 text-sm text-ink">
                  {r.comment ? r.comment : <span className="text-ink-faint">(sans commentaire)</span>}
                </span>
                <span className="shrink-0 chip-mono">{r.route ?? "(app)"}</span>
                {r.session_id && (
                  <Link href={`/sessions/${r.session_id}`} className="shrink-0 text-xs font-medium text-perf hover:underline">
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
