// Jauge en anneau — rendu serveur (SVG déterministe, zéro JS). Une valeur 0..100
// (ex. budget d'erreur consommé) : anneau de fond + arc coloré par état, valeur
// au centre. Plusieurs jauges côte à côte forment le « mur de SLO ».
import type { ReactNode } from "react";

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export type GaugeTone = "good" | "warn" | "poor";

const TONE_HEX: Record<GaugeTone, string> = {
  good: "#059669",
  warn: "#d97706",
  poor: "#dc2626",
};

export function Gauge({
  value,
  tone,
  label,
  sub,
  size = 116,
  thickness = 11,
}: {
  /** 0..100 (borné). */
  value: number;
  tone: GaugeTone;
  label: ReactNode;
  sub?: ReactNode;
  size?: number;
  thickness?: number;
}) {
  const v = Math.max(0, Math.min(100, value));
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - thickness / 2 - 1;
  const sweep = (v / 100) * 359.999;

  return (
    <div className="flex w-[8.5rem] flex-col items-center gap-1 text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${Math.round(v)} %`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(var(--c-panel2))" strokeWidth={thickness} />
          {v > 0 && (
            <path
              d={arc(cx, cy, r, 0, sweep)}
              fill="none"
              stroke={TONE_HEX[tone]}
              strokeWidth={thickness}
              strokeLinecap="round"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold tabular-nums tracking-tight text-ink">{Math.round(v)}%</span>
        </div>
      </div>
      <span className="max-w-full truncate text-xs font-medium text-ink" title={typeof label === "string" ? label : undefined}>
        {label}
      </span>
      {sub && <span className="text-[10px] text-ink-faint">{sub}</span>}
    </div>
  );
}
