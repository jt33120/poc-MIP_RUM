// Page « Performance IA » : usage & performance des appels LLM (tokens, coût,
// latence, erreurs) corrélés au RUM. Rendu 100 % serveur, filtres app/période
// via le modèle « v2 » (comme errors/correlation). Calquée sur la structure de
// app/correlation/page.tsx.
import { AiBar } from "@/components/ai/AiBar";
import { AiCallRow } from "@/components/ai/AiCallRow";
import { fmtCost, fmtLatency, fmtPct, fmtTokens } from "@/components/ai/format";
import { AiKpi } from "@/components/ai/AiKpi";
import { AiModelRow } from "@/components/ai/AiModelRow";
import { AiRouteRow } from "@/components/ai/AiRouteRow";
import { PageHeader } from "@/components/PageHeader";
import {
  aiByModel,
  aiByRoute,
  aiDaily,
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
  const [overview, byModel, byRoute, daily, recent] = await Promise.all([
    aiOverview(f),
    aiByModel(f),
    aiByRoute(f),
    aiDaily(f),
    recentAiCalls(f),
  ]);

  const empty = overview.calls === 0;
  const maxCost = daily.reduce((m, d) => Math.max(m, d.cost_usd), 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Performance IA"
        sub={
          <>
            Usage &amp; performance des appels LLM — tokens, coût, latence — corrélés au parcours
            utilisateur (RUM) · fenêtre {periodLabel(f)}
          </>
        }
      />

      {empty ? (
        <div className="card p-8 text-center text-ink-soft">
          Aucun appel IA sur la période — instrumentez le backend (voir docs/AI_UTI.md).
        </div>
      ) : (
        <>
          {/* ----- Rangée KPI ----- */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <AiKpi label="Appels" value={overview.calls} testId="ai-calls" hint={`fenêtre ${periodLabel(f)}`} />
            <AiKpi label="Tokens (total)" value={fmtTokens(overview.total_tokens)} hint="prompt + complétion" />
            <AiKpi label="Coût (USD)" value={fmtCost(overview.cost_usd)} testId="ai-cost" hint="cumulé sur la période" />
            <AiKpi label="Latence p75" value={fmtLatency(overview.latency_p75)} testId="ai-latency" hint="75ᵉ percentile" />
            <AiKpi
              label="Taux d'erreur"
              value={fmtPct(overview.error_rate)}
              tone={overview.error_rate > 0 ? "danger" : "ink"}
              hint="appels en erreur"
            />
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

          {/* ----- Coût par jour ----- */}
          <div className="card mt-8 p-4">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Coût par jour
            </h2>
            {daily.length ? (
              <div className="flex flex-col">
                {daily.map((d) => (
                  <AiBar key={d.day} row={d} maxCost={maxCost} />
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-ink-faint">Pas de données journalières sur la période.</p>
            )}
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
