// Bandeau de santé de l'Overview : anneau de score + facteurs dominants + badge
// anomalies. Rendu 100 % serveur (aucune interactivité). Extrait de app/page.tsx.
import { GlossaryTip } from "@/components/GlossaryTip";
import { dominantFactors, type Health, HEALTH_CLASS, type HealthLabel } from "@/lib/health";

const RING_STROKE: Record<HealthLabel, string> = {
  Excellent: "#10b981",
  Bon: "#0ea5e9",
  Dégradé: "#f59e0b",
  Critique: "#ef4444",
};

/** Anneau de score SVG (rendu serveur) — la pièce centrale du poste de pilotage. */
function HealthRing({ score, label }: { score: number; label: HealthLabel }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--c-line))" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={RING_STROKE[label]}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums leading-none text-ink" data-testid="health-score">
          {score}
        </span>
        <span className="mt-0.5 text-[10px] font-medium text-ink-faint">/ 100</span>
      </div>
    </div>
  );
}

/** Barre de contribution d'un facteur du score (earned/max). */
function FactorBar({
  label,
  detail,
  earned,
  max,
}: {
  label: string;
  detail: string;
  earned: number | null;
  max: number;
}) {
  const ratio = earned == null ? null : earned / max;
  const color =
    ratio == null
      ? "bg-ink-faint/40"
      : ratio >= 0.85
        ? "bg-emerald-500"
        : ratio >= 0.5
          ? "bg-amber-500"
          : "bg-red-500";
  return (
    // `min-w-0` : un élément de grille ne descend pas sous le min-content de
    // son contenu sans lui. Le libellé d'un facteur élargissait donc la grille,
    // puis le bandeau, puis la page — de 6 px sur une fenêtre de 390.
    <div title={detail} className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium text-ink-soft">{label}</span>
        <span className="shrink-0 tabular-nums text-ink-faint">
          {earned == null ? "n/a" : `${earned.toLocaleString("fr-FR")} / ${max}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel2">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${(ratio ?? 0) * 100}%` }} />
      </div>
    </div>
  );
}

/** Bandeau santé v0.3 : score composite + facteurs dominants + badge anomalies. */
export function HealthBanner({ health, periodLabel }: { health: Health; periodLabel: string }) {
  if (health.score == null || health.label == null) {
    return (
      <div className="card mb-6 p-4">
        <span className="text-sm text-ink-faint">
          Santé : données insuffisantes sur la fenêtre ({periodLabel}) pour calculer un score.
        </span>
      </div>
    );
  }
  const dominant = dominantFactors(health);
  return (
    <div className="card mb-6 flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
      <div className="flex items-center gap-5">
        <HealthRing score={health.score} label={health.label} />
        <div>
          {/* La bulle OUVRE le libellé : posée après lui, à droite de l'anneau,
              sa bulle de 288 px centrée sortait de l'écran et portait la page à
              415 px sur une fenêtre de 390. En tête, elle s'ouvre toujours vers
              l'intérieur. */}
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            <GlossaryTip id="health" />
            Santé ({periodLabel})
          </div>
          <span
            className={`mt-1.5 inline-block rounded-full border px-3 py-1 text-sm font-semibold ${HEALTH_CLASS[health.label]}`}
            data-testid="health-label"
          >
            {health.label}
          </span>
          {health.anomalies.length > 0 && (
            <a
              href="#anomalies"
              className="mt-2 block w-fit rounded-full border border-red-300 bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800 transition hover:bg-red-200 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300 dark:hover:bg-red-400/20"
              data-testid="anomaly-badge"
            >
              {health.anomalies.length} anomalie(s) détectée(s)
            </a>
          )}
        </div>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {health.factors.map((x) => (
          <FactorBar key={x.key} label={x.label} detail={x.detail} earned={x.earned} max={x.max} />
        ))}
      </div>
      <div className="w-full text-xs text-ink-faint">
        40 % vitals (LCP x2) · 30 % erreurs · 20 % stabilité · 10 % anomalies 24 h.
        {dominant.length > 0 && (
          <>
            {" "}
            Points perdus :{" "}
            {dominant
              .map((d) => `${d.label} −${(d.max - (d.earned ?? 0)).toLocaleString("fr-FR")} pt (${d.detail})`)
              .join(" · ")}
          </>
        )}
      </div>
    </div>
  );
}
