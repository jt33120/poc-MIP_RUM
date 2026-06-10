"use client";
// Série historisée robot (latence synthétique) vs réel (LCP p75) — buckets horaires v_correlation.
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface RobotRealPoint {
  bucket: string; // ISO date
  robot: number | null;
  reel: number | null;
}

export function RobotVsRealChart({ data }: { data: RobotRealPoint[] }) {
  const points = data.map((d) => ({
    ...d,
    label: new Date(d.bucket).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} />
        <YAxis stroke="#94a3b8" fontSize={12} unit=" ms" width={80} />
        <Tooltip formatter={(v: number, name: string) => [`${Math.round(v)} ms`, name]} />
        <Legend />
        <Line
          type="monotone"
          dataKey="robot"
          name="🤖 Robot (latence moy.)"
          stroke="#64748b"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={{ r: 3 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="reel"
          name="👤 Réel (LCP p75)"
          stroke="#2563eb"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
