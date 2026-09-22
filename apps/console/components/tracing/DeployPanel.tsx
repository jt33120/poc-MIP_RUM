// Panneau « Déploiements & régression » (Voie A · inc. 3) — rendu serveur.
// Liste les déploiements récents et, pour le dernier, indique si une régression
// (LCP p75 ou volume d'erreurs) a suivi. Répond à « et l'heure de régression ».
import { fmtMs } from "@/components/tracing/format";
import type { Filters } from "@/lib/filters";
import { assessRegression, latestDeployImpact, listDeploys } from "@/lib/queries-deploys";

function fmtWhen(ts: Date): string {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export async function DeployPanel({ f }: { f: Filters }) {
  const [deploys, impact] = await Promise.all([listDeploys(f, 6), latestDeployImpact(f)]);
  if (!deploys.length) return null; // rien tant qu'aucun déploiement n'est enregistré

  const lcp = assessRegression(impact?.lcp_before ?? null, impact?.lcp_after ?? null);
  // `null` quand une fenêtre n'a aucune page vue : assessRegression rend alors deltaPct null.
  const err = assessRegression(impact?.errors_before ?? null, impact?.errors_after ?? null);
  const regressed = lcp.regressed || err.regressed;

  return (
    <section className="card mb-6 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Déploiements & régression</h2>
        <span className="text-[11px] text-ink-faint">
          app entière, fenêtre ±2 h autour du dernier déploiement — plage et filtres de population non appliqués
        </span>
      </div>

      {impact?.deploy_ts && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            regressed
              ? "border-red-300/60 bg-red-50 text-red-800 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200"
              : "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200"
          }`}
        >
          {regressed ? (
            <>
              <strong>Régression détectée</strong> après le déploiement du {fmtWhen(impact.deploy_ts)}
              {impact.version ? ` (${impact.version})` : ""} —{" "}
              {lcp.regressed && lcp.deltaPct != null && (
                <>LCP p75 <strong>+{lcp.deltaPct}%</strong> ({fmtMs(impact.lcp_before)} → {fmtMs(impact.lcp_after)})</>
              )}
              {lcp.regressed && err.regressed ? " · " : ""}
              {err.regressed && err.deltaPct != null && (
                <>erreurs JS <strong>+{err.deltaPct}%</strong> ({impact.errors_before} → {impact.errors_after})</>
              )}
              .
            </>
          ) : (
            <>
              <strong>Aucune régression</strong> après le dernier déploiement du {fmtWhen(impact.deploy_ts)}
              {impact.version ? ` (${impact.version})` : ""} — LCP p75 {fmtMs(impact.lcp_before)} →{" "}
              {fmtMs(impact.lcp_after)}.
            </>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {deploys.map((d) => (
          <li key={d.id} className="flex items-center gap-3 rounded-lg border border-line bg-panel2 px-3 py-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {d.version ?? "déploiement"}
            </span>
            <span className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {d.env}
            </span>
            <span className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {d.source}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-ink-soft">{fmtWhen(d.ts)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
