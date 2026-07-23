// Espace PARTENAIRE « Supervision IA — propulsée par xSOM AI Guard ». Lit
// EXCLUSIVEMENT l'API xSOM (via la façade fetchAiSummary) : aucune donnée ni
// calcul IA côté MIP RUM (cf. ADR-0001). Clairement badgé « partenaire · propulsé
// par xSOM » — un placement partenaire, visuellement distinct du produit RUM natif.
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { LineTrend, type LineTrendPoint } from "@/components/charts/LineTrend";
import { fmtLatency, fmtPct } from "@/lib/format";
import type { XsomAiFields } from "@/lib/xsom-ai";

const fmtUsd = (v: number | null): string =>
  v == null ? "—" : v > 0 && v < 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
const fmtInt = (v: number | null): string => (v == null ? "—" : v.toLocaleString("fr-FR"));

/** Bandeau « sponsorisé par xSOM » — attribution claire + appel à l'action. */
export function XsomSponsorBanner({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-ai/30 bg-ai/5 p-4 transition hover:border-ai/50 hover:bg-ai/10"
    >
      <span className="rounded-full border border-ai/40 bg-ai/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ai">
        Partenaire
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">Supervision IA propulsée par xSOM AI Guard</div>
        <div className="text-xs text-ink-soft">
          Le suivi de vos appels LLM (coût, tokens, latence, qualité) est fourni par notre partenaire{" "}
          <strong>xSOM AI Guard</strong> — service indépendant du RUM MIP.
        </div>
      </div>
      <span className="shrink-0 rounded-lg border border-ai/40 px-3 py-1.5 text-xs font-semibold text-ai">
        Découvrir xSOM →
      </span>
    </a>
  );
}

/** Rendu des métriques IA renvoyées par xSOM (jamais recalculées côté MIP). */
export function XsomAiPanel({ ai, periodLabel }: { ai: XsomAiFields; periodLabel: string }) {
  const series: LineTrendPoint[] = ai.ai_series.map((p) => ({
    label: p.date.slice(5), // MM-DD
    value: Number(p.cost_usd ?? 0),
    volume: p.calls,
  }));

  return (
    <>
      <SupervisionHero
        chartTitle={`Coût & volume IA — ${periodLabel} · source xSOM`}
        chart={
          series.length >= 2 ? (
            <LineTrend data={series} valueName="Coût" valueUnit=" $" volumeName="appels" color="#7c3aed" />
          ) : (
            <p className="py-12 text-center text-sm text-ink-faint">Série indisponible sur cette période.</p>
          )
        }
      >
        <HeroStat label="Appels IA" value={fmtInt(ai.ai_calls)} />
        <HeroStat label="Coût cumulé" value={fmtUsd(ai.ai_cost_usd)} tone="warn" />
        <HeroStat label="Latence p75" value={fmtLatency(ai.ai_p75_latency_ms)} />
        <HeroStat
          label="Taux d'erreur"
          value={fmtPct(ai.ai_error_rate)}
          tone={ai.ai_error_rate && ai.ai_error_rate > 0 ? "warn" : "good"}
        />
        <HeroReading>
          Données <strong>fournies par xSOM AI Guard</strong> pour l'app sélectionnée. MIP RUM n'ingère ni ne
          stocke ces métriques — il les affiche via l'API du partenaire.
        </HeroReading>
      </SupervisionHero>

      <h2 className="mb-2 text-sm font-semibold text-ink">Par fonction IA · source xSOM</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Fonction</th>
              <th className="th">Route</th>
              <th className="th text-right">Appels</th>
              <th className="th text-right">Coût</th>
              <th className="th text-right">Latence p75</th>
              <th className="th text-right">Erreurs</th>
            </tr>
          </thead>
          <tbody>
            {ai.ai_by_operation.map((o) => (
              <tr key={`${o.operation ?? ""}-${o.route ?? ""}`} className="border-t border-line/60 transition hover:bg-panel2/60">
                <td className="px-4 py-2 font-medium text-ink">{o.operation ?? "—"}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-soft">{o.route ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{fmtInt(o.calls)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtUsd(o.cost_usd)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtLatency(o.p75_latency_ms)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtPct(o.error_rate)}</td>
              </tr>
            ))}
            {!ai.ai_by_operation.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-faint">
                  Aucune fonction IA sur la période.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
