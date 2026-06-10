import { fmtVital } from "@/lib/format";
import { RATING_CLASS, RATING_LABEL, rating2026 } from "@/lib/rating";

/** Tendance vs période précédente : pour un vital, monter = se dégrader. */
function Trend({ p75, prev }: { p75: number; prev: number | null }) {
  if (prev == null || prev === 0) return null;
  const delta = ((p75 - prev) / prev) * 100;
  const flat = Math.abs(delta) < 2;
  const cls = flat ? "text-slate-400" : delta > 0 ? "text-red-600" : "text-emerald-600";
  const arrow = flat ? "→" : delta > 0 ? "↑" : "↓";
  return (
    <span className={`text-xs font-semibold ${cls}`} data-testid="trend" title="vs période précédente">
      {arrow} {delta > 0 ? "+" : ""}
      {delta.toFixed(0)} %
    </span>
  );
}

export function VitalCard({
  name,
  p75,
  n,
  prev = null,
  periodLabel = "24 h",
}: {
  name: string;
  p75: number | null;
  n: number;
  prev?: number | null;
  periodLabel?: string;
}) {
  const rating = p75 != null ? rating2026(name, p75) : null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-500">{name}</span>
        {rating && (
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RATING_CLASS[rating]}`}>
            {RATING_LABEL[rating]}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-slate-900" data-testid={`p75-${name}`}>
          {fmtVital(name, p75)}
        </span>
        {p75 != null && <Trend p75={p75} prev={prev} />}
      </div>
      <div className="mt-1 text-xs text-slate-400">
        p75 · {n} mesures · {periodLabel}
      </div>
    </div>
  );
}
