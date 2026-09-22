"use client";
// Graphe de prévision (recharts) — points réels (ligne pleine) prolongés par la
// projection (ligne pointillée) et une ligne de seuil horizontale. Promeut les
// sparklines de la page Prévisions en graphe lisible avec axes.
import { fmtLatency } from "@/lib/format";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Format des valeurs, par NOM : un composant serveur ne peut pas passer une
 * fonction à ce composant client — Next.js refuse de la sérialiser, et c'est ce
 * qui faisait planter /forecast au rendu. Les noms suivent le `FormatId` du plan
 * (lib/fmt-ids.ts, F03), qui remplacera ce type.
 */
export type FormatSerie = "ms" | "count" | "pour100";

const FORMATS: Record<FormatSerie, (v: number) => string> = {
  ms: (v) => fmtLatency(v),
  count: (v) => Math.round(v).toLocaleString("fr-FR"),
  pour100: (v) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pour 100`,
};

export interface ForecastPoint {
  label: string;
  real: number | null;
  proj: number | null;
}

const REAL = "#2563eb";
const PROJ = "#f89101";
const THRESH = "#dc2626";

export function ForecastChart({
  data,
  threshold,
  thresholdLabel,
  unit = "",
  height = 260,
  format,
}: {
  data: ForecastPoint[];
  threshold?: number | null;
  thresholdLabel?: string;
  unit?: string;
  height?: number;
  format?: FormatSerie;
}) {
  const fmt = format ? FORMATS[format] : (v: number) => v.toLocaleString("fr-FR");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" fontSize={11} tickLine={false} interval="preserveStartEnd" />
        <YAxis fontSize={11} width={52} tickLine={false} axisLine={false} tickFormatter={fmt} unit={unit} />
        <Tooltip
          formatter={(v: number, name) => [fmt(v) + (unit ? ` ${unit}` : ""), name]}
          contentStyle={{ fontSize: 12 }}
        />
        {threshold != null && (
          <ReferenceLine
            y={threshold}
            stroke={THRESH}
            strokeDasharray="4 4"
            label={{ value: `seuil ${thresholdLabel ?? ""}`.trim(), position: "insideTopRight", fontSize: 10, fill: THRESH }}
          />
        )}
        {/* Pas de connectNulls : un jour sans mesure reste un trou, pas un segment inventé. */}
        <Line type="monotone" dataKey="real" name="réel" stroke={REAL} strokeWidth={2.5} dot={{ r: 2 }} />
        <Line
          type="monotone"
          dataKey="proj"
          name="projection"
          stroke={PROJ}
          strokeWidth={2.5}
          strokeDasharray="4 4"
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
