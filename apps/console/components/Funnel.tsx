// Entonnoir (Lot 6c) — sélecteur d'étapes (form GET, sans JS client) + rendu des
// barres de conversion. Le sélecteur préserve les filtres courants via des champs
// cachés. Le graphe : une barre par étape (largeur ∝ vs départ) + conversion/abandon.
import type { FunnelStep } from "@/lib/funnel";
import type { EventOption } from "@/lib/queries-funnel";

const MAX_STEPS = 4;
/** Taux sans dénominateur (personne au départ) : « — », jamais « 0 % » (V3). */
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** Champs cachés reprenant les filtres courants (tout sauf les étapes s1..sN). */
function preservedParams(sp: Record<string, string | string[] | undefined>) {
  const skip = new Set(Array.from({ length: MAX_STEPS }, (_, i) => `s${i + 1}`));
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(sp)) {
    if (skip.has(k)) continue;
    if (typeof v === "string") out.push([k, v]);
  }
  return out;
}

export function StepPicker({
  events,
  selected,
  sp,
}: {
  events: EventOption[];
  selected: string[];
  sp: Record<string, string | string[] | undefined>;
}) {
  return (
    <form method="GET" className="flex flex-wrap items-end gap-3" data-testid="funnel-picker">
      {preservedParams(sp).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {Array.from({ length: MAX_STEPS }, (_, i) => (
        <label key={i} className="text-xs font-medium text-ink-soft">
          Étape {i + 1}
          <select name={`s${i + 1}`} defaultValue={selected[i] ?? ""} className="field mt-1 block w-48">
            <option value="">—</option>
            {events.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="submit" className="btn-accent">
        Construire l&apos;entonnoir
      </button>
    </form>
  );
}

export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const start = steps[0]?.reached ?? 0;
  if (!steps.length) return null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      {steps.map((s) => {
        const w = start > 0 ? Math.max(2, (s.reached / start) * 100) : 0;
        return (
          <div key={s.ord} className="flex items-center gap-3">
            <div className="w-40 shrink-0 truncate font-mono text-xs text-ink" title={s.name}>
              <span className="text-ink-faint">{s.ord}.</span> {s.name}
            </div>
            <div className="relative h-6 flex-1 overflow-hidden rounded bg-panel2">
              <div className="h-full rounded bg-accent/70" style={{ width: `${w}%` }} />
              <span className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold tabular-nums text-ink">
                {s.reached.toLocaleString("fr-FR")}
              </span>
            </div>
            <div className="w-32 shrink-0 text-right text-xs tabular-nums">
              <span className="text-ink-soft">{pct(s.convFromStart)}</span>
              {s.ord > 1 && (
                <span className="ml-2 text-bad-ink" title="abandon depuis l'étape précédente">
                  −{s.dropoff.toLocaleString("fr-FR")}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
