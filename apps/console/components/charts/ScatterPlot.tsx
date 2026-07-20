"use client";
// Nuage de points générique (recharts) — croise DEUX dimensions pour révéler les
// éléments « fréquents ET problématiques » (ex. interactions × latence INP,
// robot × réel). Bulle optionnelle (3ᵉ dimension = taille). Grammaire visuelle
// commune : accent orange, axes/grille/tooltip thémés via globals.css.
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

export interface ScatterPoint {
  x: number;
  y: number;
  /** 3ᵉ dimension optionnelle = taille de la bulle. */
  z?: number;
  label: string;
  /** Couleur du point (défaut : accent). */
  color?: string;
}

const ACCENT = "#f89101";

/** Format d'axe sérialisable (compatible frontière RSC) : entier arrondi ou locale. */
export type NumFmt = "int" | "locale";
function numFmt(kind: NumFmt): (v: number) => string {
  return kind === "int"
    ? (v: number) => `${Math.round(v)}`
    : (v: number) => v.toLocaleString("fr-FR");
}

export function ScatterPlot({
  points,
  xLabel,
  yLabel,
  xUnit = "",
  yUnit = "",
  height = 300,
  xFormat = "locale",
  yFormat = "locale",
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  height?: number;
  // Token SÉRIALISABLE (pas une fonction) : ScatterPlot est un composant client,
  // une fonction passée en prop depuis un server component casse la sérialisation
  // RSC (« Functions cannot be passed to Client Components »).
  xFormat?: NumFmt;
  yFormat?: NumFmt;
}) {
  const fx = numFmt(xFormat);
  const fy = numFmt(yFormat);
  const hasZ = points.some((p) => p.z != null);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          name={xLabel}
          fontSize={11}
          tickLine={false}
          unit={xUnit}
          tickFormatter={fx}
          label={{ value: xLabel, position: "insideBottom", offset: -12, fontSize: 11, fill: "currentColor" }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={56}
          unit={yUnit}
          tickFormatter={fy}
        />
        {hasZ && <ZAxis type="number" dataKey="z" range={[40, 420]} />}
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as ScatterPoint;
            return (
              <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-card">
                <div className="mb-1 max-w-[220px] truncate font-semibold text-ink">{p.label}</div>
                <div className="tabular-nums text-ink-soft">
                  {xLabel} : {fx(p.x)}
                  {xUnit}
                </div>
                <div className="tabular-nums text-ink-soft">
                  {yLabel} : {fy(p.y)}
                  {yUnit}
                </div>
              </div>
            );
          }}
        />
        <Scatter data={points} fill={ACCENT} fillOpacity={0.75}>
          {points.map((p, i) => (
            <Cell key={i} fill={p.color ?? ACCENT} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
