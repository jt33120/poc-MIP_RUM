import { fmtVital } from "@/lib/format";
import { GLOSSARY, type GlossaryId } from "@/lib/glossary";
import { RATING_BAR, RATING_CLASS, RATING_LABEL, THRESHOLDS, rating2026 } from "@/lib/rating";
import { GlossaryTip } from "./GlossaryTip";

/** Tendance vs période précédente : pour un vital, monter = se dégrader. */
function Trend({ p75, prev }: { p75: number; prev: number | null }) {
  if (prev == null || prev === 0) return null;
  const delta = ((p75 - prev) / prev) * 100;
  const flat = Math.abs(delta) < 2;
  const cls = flat
    ? "text-ink-faint"
    : delta > 0
      ? "text-red-600 dark:text-red-400"
      : "text-emerald-600 dark:text-emerald-400";
  const arrow = flat ? "→" : delta > 0 ? "↑" : "↓";
  return (
    <span className={`text-xs font-semibold tabular-nums ${cls}`} data-testid="trend" title="vs période précédente">
      {arrow} {delta > 0 ? "+" : ""}
      {delta.toFixed(0)} %
    </span>
  );
}

/**
 * Jauge de seuils 2026 : zones good/à améliorer/poor en filigrane, curseur
 * positionné au p75 — lecture de l'état en un coup d'œil (dashboard dense).
 */
function ThresholdMeter({ name, p75 }: { name: string; p75: number }) {
  const t = THRESHOLDS[name];
  if (!t) return null;
  const [good, warn] = t;
  const max = warn * 1.4; // zone poor visible mais bornée
  const pos = Math.min(p75 / max, 1) * 100;
  const rating = rating2026(name, p75);
  return (
    <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full">
      <div className="absolute inset-y-0 left-0 bg-emerald-500/25" style={{ width: `${(good / max) * 100}%` }} />
      <div
        className="absolute inset-y-0 bg-amber-500/25"
        style={{ left: `${(good / max) * 100}%`, width: `${((warn - good) / max) * 100}%` }}
      />
      <div className="absolute inset-y-0 bg-red-500/25" style={{ left: `${(warn / max) * 100}%`, right: 0 }} />
      <div
        className={`absolute inset-y-0 w-1 -translate-x-1/2 rounded-full ${rating ? RATING_BAR[rating] : "bg-ink"}`}
        style={{ left: `${pos}%` }}
        title={`p75 vs seuils (good ≤ ${fmtVital(name, good)} · poor > ${fmtVital(name, warn)})`}
      />
    </div>
  );
}

// En-dessous de ce nombre de mesures, un p75 est statistiquement instable (il tombe
// dans la queue de distribution) : on le signale et on montre la médiane, plus robuste.
const LOW_SAMPLE = 100;

export function VitalCard({
  name,
  p75,
  median = null,
  n,
  prev = null,
  periodLabel = "24 h",
}: {
  name: string;
  p75: number | null;
  median?: number | null;
  n: number;
  prev?: number | null;
  periodLabel?: string;
}) {
  const rating = p75 != null ? rating2026(name, p75) : null;
  const lowSample = n > 0 && n < LOW_SAMPLE;
  return (
    <div className="card p-4 transition hover:shadow-pop">
      <div className="flex items-center justify-between gap-2">
        {/* La bulle OUVRE le nom : sur deux colonnes à 390 px, une bulle de
            288 px centrée après le nom de la carte de droite sortait de l'écran
            et élargissait la page. En tête, elle s'ouvre vers l'intérieur. */}
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {name in GLOSSARY && <GlossaryTip id={name as GlossaryId} />}
          {name}
        </span>
        {rating && (
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${RATING_CLASS[rating]}`}>
            {RATING_LABEL[rating]}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-ink" data-testid={`p75-${name}`}>
          {fmtVital(name, p75)}
        </span>
        {p75 != null && <Trend p75={p75} prev={prev} />}
      </div>
      {p75 != null && <ThresholdMeter name={name} p75={p75} />}
      <div className="mt-2 text-xs text-ink-faint">
        p75 · {n} mesures · {periodLabel}
      </div>
      {lowSample && (
        <div
          className="mt-1 text-[11px] text-amber-600 dark:text-amber-400"
          title="Sur peu de mesures, le p75 est instable (il tombe dans la queue de distribution). La médiane est plus robuste."
        >
          échantillon faible{median != null && <> · médiane {fmtVital(name, median)}</>}
        </div>
      )}
    </div>
  );
}
