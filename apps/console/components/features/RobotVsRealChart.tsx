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

// Robot en bleu acier MIP (pointillés), réel en orange signature — lisible
// dans les deux thèmes ; axes/grille thémés via globals.css.
const ROBOT = "#7f95b5";
const REAL = "#f89101";

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
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" fontSize={11} tickLine={false} />
        <YAxis fontSize={11} unit=" ms" width={80} tickLine={false} axisLine={false} />
        <Tooltip formatter={(v: number, name: string) => [`${Math.round(v)} ms`, name]} />
        <Legend />
        <Line
          type="monotone"
          dataKey="robot"
          name="🤖 Robot (latence moy.)"
          stroke={ROBOT}
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={{ r: 2.5, fill: ROBOT, strokeWidth: 0 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="reel"
          name="👤 Réel (LCP p75)"
          stroke={REAL}
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: REAL, strokeWidth: 0 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
