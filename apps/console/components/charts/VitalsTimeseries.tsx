"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface SeriesPoint {
  bucket: string; // ISO date
  p75: number;
}

// Orange signature MIP pour la série réelle ; axes/grille thémés via globals.css.
const ACCENT = "#f89101";

export function VitalsTimeseries({
  data,
  unit = "ms",
  thresholds,
  xAxis = "time",
}: {
  data: SeriesPoint[];
  unit?: string;
  thresholds?: [number, number];
  /** "time" : buckets infra-journaliers (HH:mm) · "day" : buckets journaliers (JJ/MM). */
  xAxis?: "time" | "day";
}) {
  const points = data.map((d) => ({
    ...d,
    label:
      xAxis === "day"
        ? new Date(d.bucket).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
        : new Date(d.bucket).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="mipArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" fontSize={11} tickLine={false} />
        <YAxis fontSize={11} unit={` ${unit}`} width={80} tickLine={false} axisLine={false} />
        <Tooltip formatter={(v: number) => [`${Math.round(v)} ${unit}`, "p75"]} />
        {thresholds && (
          <>
            <ReferenceLine
              y={thresholds[0]}
              stroke="#10b981"
              strokeDasharray="4 4"
              label={{ value: "good", position: "insideTopRight", fontSize: 10, fill: "#10b981" }}
            />
            <ReferenceLine
              y={thresholds[1]}
              stroke="#ef4444"
              strokeDasharray="4 4"
              label={{ value: "poor", position: "insideTopRight", fontSize: 10, fill: "#ef4444" }}
            />
          </>
        )}
        <Area
          type="monotone"
          dataKey="p75"
          stroke={ACCENT}
          strokeWidth={2.5}
          fill="url(#mipArea)"
          dot={{ r: 2.5, fill: ACCENT, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
