"use client";
// Courbe « volume & fiabilité » associée à la heatmap : aire = pages vues
// (échelle gauche), ligne = erreurs JS (échelle droite). Même grammaire
// visuelle que VitalsTimeseries (orange signature, axes thémés via globals.css).
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SERIE, categorie } from "@/lib/palette";

export interface TrafficPoint {
  day: string; // ISO date (jour)
  pageviews: number;
  errors: number;
}

const ACCENT = SERIE.principale;
// Un compte d'erreurs n'est pas un verdict (aucun seuil publié, règle R-S) : pas de
// rouge, une couleur catégorielle.
const ERR = categorie(0);

export function TrafficTimeseries({ data }: { data: TrafficPoint[] }) {
  const points = data.map((d) => ({
    ...d,
    label: new Date(d.day).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="mipTraffic" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.32} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" fontSize={11} tickLine={false} />
        <YAxis yAxisId="pv" fontSize={11} width={48} tickLine={false} axisLine={false} />
        <YAxis
          yAxisId="err"
          orientation="right"
          fontSize={11}
          width={40}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          formatter={(v: number, name) => [
            v.toLocaleString("fr-FR"),
            name === "pageviews" ? "Pages vues" : "Erreurs JS",
          ]}
        />
        <Area
          yAxisId="pv"
          type="monotone"
          dataKey="pageviews"
          stroke={ACCENT}
          strokeWidth={2.5}
          fill="url(#mipTraffic)"
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          yAxisId="err"
          type="monotone"
          dataKey="errors"
          stroke={ERR}
          strokeWidth={2}
          dot={{ r: 2, fill: ERR, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
