// Donut — rendu serveur (SVG déterministe, zéro JS client), même idiome que
// Histogram/Funnel. Répartition d'un tout en parts (ex. nouveaux vs revenants,
// canaux d'acquisition). Anneau + centre libre (total, part dominante) + légende.
import type { ReactNode } from "react";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/** Point sur le cercle de rayon r (angle en degrés, 0 = haut, sens horaire). */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** Chemin d'un arc annulaire entre deux angles. */
function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, rOuter, a1);
  const [x1, y1] = polar(cx, cy, rOuter, a0);
  const [x2, y2] = polar(cx, cy, rInner, a0);
  const [x3, y3] = polar(cx, cy, rInner, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${x0} ${y0}`,
    `A ${rOuter} ${rOuter} 0 ${large} 0 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rInner} ${rInner} 0 ${large} 1 ${x3} ${y3}`,
    "Z",
  ].join(" ");
}

export function Donut({
  slices,
  centerValue,
  centerLabel,
  size = 200,
  thickness = 34,
}: {
  slices: DonutSlice[];
  /** Grand chiffre au centre (ex. total). */
  centerValue?: ReactNode;
  /** Petit label sous le chiffre central. */
  centerLabel?: ReactNode;
  size?: number;
  thickness?: number;
}) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter - thickness;

  let angle = 0;
  const arcs =
    total > 0
      ? slices
          .filter((s) => s.value > 0)
          .map((s) => {
            const sweep = (s.value / total) * 360;
            const a0 = angle;
            const a1 = angle + Math.min(sweep, 359.999); // évite un arc complet dégénéré
            angle = a1;
            return { ...s, d: arcPath(cx, cy, rOuter, rInner, a0, a1), pct: (s.value / total) * 100 };
          })
      : [];

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Répartition">
          {total === 0 ? (
            <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke="rgb(var(--c-panel2))" strokeWidth={thickness} />
          ) : (
            arcs.map((a, i) => (
              <path key={i} d={a.d} fill={a.color}>
                <title>{`${a.label} : ${a.value.toLocaleString("fr-FR")} (${Math.round(a.pct)} %)`}</title>
              </path>
            ))
          )}
        </svg>
        {(centerValue != null || centerLabel != null) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerValue != null && (
              <span className="text-2xl font-bold tabular-nums tracking-tight text-ink">{centerValue}</span>
            )}
            {centerLabel != null && <span className="text-[10px] uppercase tracking-wider text-ink-faint">{centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {slices.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <li key={s.label} className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
              <span className="text-ink-soft">{s.label}</span>
              <span className="ml-auto pl-4 font-semibold tabular-nums text-ink">
                {s.value.toLocaleString("fr-FR")}
              </span>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-faint">{pct} %</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
