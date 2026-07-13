"use client";
// Radar de sous-scores /100 (recharts) — décompose UN score composite en ses
// dimensions (ex. score d'expérience = perf perçue × anti-frustration ×
// satisfaction). Montre d'un coup la forme du profil : équilibré, ou creusé sur
// un axe. Accent orange signature, grille/texte thémés via globals.css.
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface RadarAxis {
  axis: string;
  /** Valeur 0..100. */
  value: number;
}

const ACCENT = "#f89101";

export function RadarScore({ data, height = 260 }: { data: RadarAxis[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 24 }} outerRadius="72%">
        <PolarGrid stroke="rgb(var(--c-line))" />
        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "rgb(var(--c-ink-soft))" }} />
        <PolarRadiusAxis
          domain={[0, 100]}
          tickCount={5}
          tick={{ fontSize: 9, fill: "rgb(var(--c-ink-faint))" }}
          axisLine={false}
        />
        <Radar
          dataKey="value"
          stroke={ACCENT}
          strokeWidth={2}
          fill={ACCENT}
          fillOpacity={0.28}
          dot={{ r: 3, fill: ACCENT, strokeWidth: 0 }}
        />
        <Tooltip
          formatter={(v: number) => [`${Math.round(v)} / 100`, "sous-score"]}
          contentStyle={{ fontSize: 12 }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
