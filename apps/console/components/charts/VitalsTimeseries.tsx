"use client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface SeriesPoint {
  bucket: string; // ISO date
  p75: number;
}

export function VitalsTimeseries({ data, unit = "ms" }: { data: SeriesPoint[]; unit?: string }) {
  const points = data.map((d) => ({
    ...d,
    label: new Date(d.bucket).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} />
        <YAxis stroke="#94a3b8" fontSize={12} unit={` ${unit}`} width={80} />
        <Tooltip formatter={(v: number) => [`${Math.round(v)} ${unit}`, "p75"]} />
        <Line type="monotone" dataKey="p75" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
