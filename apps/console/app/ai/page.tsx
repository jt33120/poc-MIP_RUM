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
  aiGovernance,
  aiOverview,
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
  const [overview, byModel, byRoute, daily, recent, governance] = await Promise.all([
    aiOverview(f),
    aiByModel(f),
    aiByRoute(f),
    aiDaily(f),
    recentAiCalls(f),
    aiGovernance(f),
  ]);

  const empty = overview.calls === 0;
  // Appels exposant de la donnée personnelle non (ou mal) pseudonymisée.
  const piiRiskCalls = governance
    .filter((g) => isPiiRisk(catalogFor(g.route)))
    .reduce((n, g) => n + g.calls, 0);

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
