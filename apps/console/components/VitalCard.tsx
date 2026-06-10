import { fmtVital } from "@/lib/format";
import { RATING_CLASS, RATING_LABEL, rating2026 } from "@/lib/rating";

export function VitalCard({
  name,
  p75,
  n,
}: {
  name: string;
  p75: number | null;
  n: number;
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
      <div className="mt-2 text-3xl font-bold text-slate-900" data-testid={`p75-${name}`}>
        {fmtVital(name, p75)}
      </div>
      <div className="mt-1 text-xs text-slate-400">p75 · {n} mesures · 24 h</div>
    </div>
  );
}
