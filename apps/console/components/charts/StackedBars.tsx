"use client";
// Barres empilées (recharts) — volume dans le temps ventilé par catégorie
// (ex. erreurs/heure par groupe, alertes/jour par sévérité, coût/jour par
// modèle). Chaque `series` = une couche de couleur ; chaque ligne de `data`
// porte la clé d'axe + une valeur par série. Générique et thémé via globals.css.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface StackSeries {
  key: string;
  name: string;
  color: string;
}

export function StackedBars({
  data,
  xKey,
  series,
  height = 260,
  yUnit = "",
  showLegend = true,
}: {
  data: Record<string, number | string>[];
  xKey: string;
  series: StackSeries[];
  height?: number;
  yUnit?: string;
  showLegend?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} fontSize={11} tickLine={false} interval="preserveStartEnd" />
        <YAxis fontSize={11} width={44} tickLine={false} axisLine={false} unit={yUnit} allowDecimals={false} />
        <Tooltip
          formatter={(v: number, name) => [v.toLocaleString("fr-FR"), name]}
          contentStyle={{ fontSize: 12 }}
        />
        {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="a"
            fill={s.color}
            radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined}
            maxBarSize={48}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
