// Page « Performance IA » : usage & performance des appels LLM (tokens, coût,
// latence, erreurs) corrélés au RUM. Rendu 100 % serveur, filtres app/période
// via le modèle « v2 » (comme errors/correlation). Calquée sur la structure de
// app/correlation/page.tsx.
import { AiCallRow } from "@/components/ai/AiCallRow";
import { AiGovernanceRow } from "@/components/ai/AiGovernanceRow";
import { fmtCost, fmtLatency, fmtPct, fmtTokens } from "@/components/ai/format";
import { AiModelRow } from "@/components/ai/AiModelRow";
import { AiRouteRow } from "@/components/ai/AiRouteRow";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { LineTrend } from "@/components/charts/LineTrend";
import { catalogFor, isPiiRisk } from "@/lib/ai-catalog";
import {
  aiByModel,
  aiByRoute,
  aiDaily,
  aiErrorBreakdown,
  aiGovernance,
  aiOverview,
  aiSatisfaction,
  recentAiCalls,
} from "@/lib/queries-ai";
import { parseFilters, periodLabel, type SearchParams } from "@/lib/queries-v2";

export const dynamic = "force-dynamic";

export default async function PerformanceIA({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const f = parseFilters(await searchParams);
  const [overview, byModel, byRoute, daily, recent, governance, satisfaction, aiErrors] =
    await Promise.all([
      aiOverview(f),
      aiByModel(f),
      aiByRoute(f),
      aiDaily(f),
      recentAiCalls(f),
      aiGovernance(f),
      aiSatisfaction(f),
      aiErrorBreakdown(f),
    ]);

  const empty = overview.calls === 0;
  // Appels exposant de la donnée personnelle non (ou mal) pseudonymisée.
  const piiRiskCalls = governance
    .filter((g) => isPiiRisk(catalogFor(g.route)))
    .reduce((n, g) => n + g.calls, 0);

  // Qualité IA ↔ satisfaction : CSAT (part de notes ≥ 4) des sessions AVEC IA
  // vs SANS IA. Le différenciateur — relier la dépense/fiabilité LLM au ressenti.
  const segAi = satisfaction.find((s) => s.used_ai);
  const segNoAi = satisfaction.find((s) => !s.used_ai);
  const csatOf = (s?: { sessions: number; positives: number }) =>
    s && s.sessions > 0 ? s.positives / s.sessions : null;
  const csatAi = csatOf(segAi);
  const csatNoAi = csatOf(segNoAi);
  const csatDelta = csatAi != null && csatNoAi != null ? csatAi - csatNoAi : null;
  const hasFeedback = (segAi?.sessions ?? 0) + (segNoAi?.sessions ?? 0) > 0;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Performance IA"
        domain="ai"
        sub="Chaque appel LLM du backend, rattaché à la session RUM qui l'a déclenché."
      />

      {empty ? (
        <div className="card p-8 text-center text-ink-soft">
          Aucun appel IA sur la période — instrumentez le backend (voir docs/AI_UTI.md).
        </div>
      ) : (
        <>
          {/* Hero : coût LLM dans le temps (ligne) + volume d'appels (barres). */}
          <SupervisionHero
            chartTitle="Coût & volume d'appels LLM par jour"
            chart={
              daily.length ? (
                <LineTrend
                  data={daily.map((d) => ({
                    label: new Date(d.day).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
                    value: Number(d.cost_usd.toFixed(4)),
                    volume: d.calls,
                  }))}
                  valueName="Coût (USD)"
                  volumeName="appels"
                  color="#7c3aed"
                />
              ) : (
                <p className="py-12 text-center text-sm text-ink-faint">Pas de données journalières sur la période.</p>
              )
            }
          >
            <HeroStat
              label="Coût cumulé (USD)"
              value={<span data-testid="ai-cost">{fmtCost(overview.cost_usd)}</span>}
              hint={`${fmtTokens(overview.total_tokens)} tokens`}
            />
            <HeroStat
              label="Appels"
              value={<span data-testid="ai-calls">{overview.calls.toLocaleString("fr-FR")}</span>}
              hint={`fenêtre ${periodLabel(f)}`}
            />
            <HeroStat
              label="Latence p75"
              value={<span data-testid="ai-latency">{fmtLatency(overview.latency_p75)}</span>}
            />
            <HeroStat
              label="Taux d'erreur"
              value={fmtPct(overview.error_rate)}
              tone={overview.error_rate > 0 ? "poor" : "good"}
              hint="appels en erreur"
            />
            <HeroReading>
              La ligne violette = le coût quotidien des appels LLM, les barres = le nombre d&apos;appels. Un
              décrochage coût/appels révèle des requêtes plus chères (modèle ou tokens). Répartition par modèle
              et par route dans les tables ci-dessous.
            </HeroReading>
          </SupervisionHero>

          {/* ----- Qualité perçue (IA ↔ satisfaction) & fiabilité ----- */}
          <section className="mt-8 grid gap-4 lg:grid-cols-2">
            {/* Satisfaction : CSAT des sessions AVEC IA vs SANS IA */}
            <div className="card p-5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Satisfaction ↔ IA
              </h2>
              <p className="mt-1 text-xs text-ink-faint">
                Part de retours positifs (note ≥ 4/5) des sessions qui ont déclenché l&apos;IA, comparée
                aux sessions sans IA. Le pont coût/fiabilité → ressenti réel.
              </p>
              {hasFeedback ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-ai">
                        Avec IA
                      </div>
                      <div className="mt-0.5 text-2xl font-bold tabular-nums text-ink">
                        {csatAi != null ? fmtPct(csatAi) : "—"}
                      </div>
                      <div className="text-[11px] text-ink-faint">{segAi?.sessions ?? 0} session(s)</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                        Sans IA
                      </div>
                      <div className="mt-0.5 text-2xl font-bold tabular-nums text-ink">
                        {csatNoAi != null ? fmtPct(csatNoAi) : "—"}
                      </div>
                      <div className="text-[11px] text-ink-faint">{segNoAi?.sessions ?? 0} session(s)</div>
                    </div>
                  </div>
                  {csatDelta != null && (
                    <p
                      className={`mt-3 border-t border-line pt-3 text-xs ${
                        csatDelta <= -0.02 ? "text-bad" : csatDelta >= 0.02 ? "text-good" : "text-ink-soft"
                      }`}
                    >
                      {csatDelta <= -0.02
                        ? `Les sessions avec IA sont ${Math.abs(Math.round(csatDelta * 100))} pt(s) MOINS satisfaites — à investiguer (latence, erreurs, pertinence).`
                        : csatDelta >= 0.02
                          ? `Les sessions avec IA sont ${Math.round(csatDelta * 100)} pt(s) plus satisfaites.`
                          : "Pas d'écart de satisfaction notable entre sessions avec et sans IA."}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-4 rounded-lg border border-line bg-panel2 px-3 py-2 text-xs text-ink-soft">
                  Pas encore de feedback sur la période — la corrélation apparaît dès que le widget d&apos;avis
                  (<code className="chip-mono">MIPRum.track(&apos;feedback&apos;)</code>) collecte des retours.
                </p>
              )}
            </div>

            {/* Fiabilité : répartition des échecs par type (timeout, refus, quota…) */}
            <div className="card p-5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Fiabilité — échecs par type
              </h2>
              <p className="mt-1 text-xs text-ink-faint">
                Ce qui casse concrètement sur les appels LLM (au-delà du seul taux d&apos;erreur).
              </p>
              {aiErrors.length ? (
                <ul className="mt-4 flex flex-col gap-2">
                  {aiErrors.map((e, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-mono text-xs text-ink">{e.error_type}</span>
                      <span className="tabular-nums font-semibold text-bad">
                        {e.calls.toLocaleString("fr-FR")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 rounded-lg border border-good/30 bg-good/5 px-3 py-2 text-xs text-good">
                  Aucun appel LLM en erreur sur la période.
                </p>
              )}
            </div>
          </section>

          {/* ----- Gouvernance des données ----- */}
          <div className="card mt-8 overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel2 px-4 py-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Gouvernance des données
              </h2>
              {piiRiskCalls > 0 && (
                <span className="rounded-full bg-bad/10 px-2 py-0.5 text-[11px] font-semibold text-bad">
                  {piiRiskCalls} appel(s) avec PII envoyée en clair
                </span>
              )}
              <p className="w-full text-xs text-ink-faint">
                Nature de la donnée envoyée au fournisseur externe et traitement PII appliqué avant l'appel —
                <span className="text-bad"> « Brut envoyé »</span> sur donnée personnelle = à corriger côté backend.
              </p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th text-left">Usage</th>
                  <th className="th text-left">Donnée</th>
                  <th className="th text-left">Pseudonymisation</th>
                  <th className="th text-right">Appels</th>
                  <th className="th text-right">Coût</th>
                  <th className="th text-right">Latence p75</th>
                  <th className="th text-right">% erreur</th>
                  <th className="th text-right">Reliés session</th>
                </tr>
              </thead>
              <tbody>
                {governance.map((r, i) => (
                  <AiGovernanceRow key={`${r.route}|${i}`} row={r} />
                ))}
              </tbody>
            </table>
          </div>

          {/* ----- Par modèle ----- */}
          <div className="card mt-8 overflow-hidden">
            <div className="border-b border-line bg-panel2 px-4 py-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Par modèle</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th text-left">Provider</th>
                  <th className="th text-left">Modèle</th>
                  <th className="th text-right">Appels</th>
                  <th className="th text-right">Tokens</th>
                  <th className="th text-right">Coût</th>
                  <th className="th text-right">Latence p75</th>
                  <th className="th text-right">% erreur</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map((r, i) => (
                  <AiModelRow key={`${r.provider}|${r.model}|${i}`} row={r} />
                ))}
              </tbody>
            </table>
          </div>

          {/* ----- Par route ----- */}
          <div className="card mt-8 overflow-hidden">
            <div className="border-b border-line bg-panel2 px-4 py-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Par route</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th text-left">Route</th>
                  <th className="th text-right">Appels</th>
                  <th className="th text-right">Tokens</th>
                  <th className="th text-right">Coût</th>
                  <th className="th text-right">Latence p75</th>
                  <th className="th text-right">% erreur</th>
                </tr>
              </thead>
              <tbody>
                {byRoute.map((r, i) => (
                  <AiRouteRow key={`${r.route}|${i}`} row={r} />
                ))}
              </tbody>
            </table>
          </div>

          {/* ----- Derniers appels ----- */}
          <div className="card mt-8 overflow-hidden">
            <div className="border-b border-line bg-panel2 px-4 py-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Derniers appels</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th text-left">Heure</th>
                  <th className="th text-left">Provider / modèle</th>
                  <th className="th text-left">Route</th>
                  <th className="th text-right">Tokens</th>
                  <th className="th text-right">Coût</th>
                  <th className="th text-right">Latence</th>
                  <th className="th text-left">Statut</th>
                  <th className="th text-right">Session</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <AiCallRow key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
