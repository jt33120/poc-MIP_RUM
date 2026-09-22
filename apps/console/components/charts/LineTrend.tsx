"use client";
// Courbe de tendance générique (recharts) — une série principale (ligne) et un
// volume optionnel en barres discrètes sur un axe secondaire (ex. % de
// satisfaction + nombre d'avis, coût + appels). Grammaire commune : accent
// orange, axes/grille/tooltip thémés via globals.css.
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface LineTrendPoint {
  label: string;
  /** `null` : aucune mesure sur ce point — un TROU dans la courbe (pas de `connectNulls`), jamais 0. */
  value: number | null;
  /** Volume optionnel (barres discrètes, axe droit). */
  volume?: number;
}

const ACCENT = "#f89101";

export function LineTrend({
  data,
  valueName,
  valueUnit = "",
  volumeName = "volume",
  color = ACCENT,
  height = 240,
  domain,
}: {
  data: LineTrendPoint[];
  valueName: string;
  valueUnit?: string;
  volumeName?: string;
  color?: string;
  height?: number;
  /** Domaine forcé de l'axe principal (ex. [0, 100] pour un %). */
  domain?: [number, number];
}) {
  const hasVolume = data.some((d) => d.volume != null);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" fontSize={11} tickLine={false} interval="preserveStartEnd" />
        <YAxis
          yAxisId="v"
          fontSize={11}
          width={44}
          tickLine={false}
          axisLine={false}
          unit={valueUnit}
          domain={domain}
        />
        {hasVolume && (
          <YAxis yAxisId="vol" orientation="right" fontSize={11} width={36} tickLine={false} axisLine={false} allowDecimals={false} />
        )}
        <Tooltip
          formatter={(val: number, name) => [
            name === volumeName ? val.toLocaleString("fr-FR") : `${val}${valueUnit}`,
            name,
          ]}
          contentStyle={{ fontSize: 12 }}
        />
        {hasVolume && (
          <Bar yAxisId="vol" dataKey="volume" name={volumeName} fill="rgb(var(--c-ink-faint))" fillOpacity={0.25} maxBarSize={26} radius={[2, 2, 0, 0]} />
        )}
        <Line
          yAxisId="v"
          type="monotone"
          dataKey="value"
          name={valueName}
          stroke={color}
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
