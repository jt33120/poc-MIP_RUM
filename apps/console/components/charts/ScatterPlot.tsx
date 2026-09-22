"use client";
// Nuage de points générique (recharts) — croise DEUX dimensions pour révéler les
// éléments « fréquents ET problématiques » (ex. interactions × latence INP,
// robot × réel). Bulle optionnelle (3ᵉ dimension = taille). Grammaire visuelle
// commune : accent orange, axes/grille/tooltip thémés via globals.css.
//
// SIGNATURE UNIFIÉE (F03, plan § 4.2) :
//   - `bandesY` pose les zones Bon / À améliorer / Mauvais d'un Web Vital sur l'axe y
//     SEULEMENT, en bandes pleines lues dans `THRESHOLDS` (P2) ;
//   - `repereX` pose une bande verticale nommée (ex. « seuil LCP Bon ») ;
//   - `etiquettes` écrit le libellé des n points les plus hauts — ceux qu'on cherche ;
//   - `points[].href` rend un point cliquable (`router.push`). Sans `href`, le point
//     n'est pas un lien, et l'alternative de la `Figure` englobante le dit ;
//   - `ariaLabel` est obligatoire : la zone graphique est une image.
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { VitalName } from "@/lib/fmt-ids";
import { SERIE } from "@/lib/palette";
import { THRESHOLDS } from "@/lib/rating";

export interface ScatterPoint {
  x: number;
  y: number;
  /** 3ᵉ dimension optionnelle = taille de la bulle. */
  z?: number;
  label: string;
  /** Couleur du point (défaut : série principale). */
  color?: string;
  /** Un clic navigue ; sans href, le point n'est pas cliquable. */
  href?: string;
}

/** Format d'axe sérialisable (compatible frontière RSC) : entier arrondi ou locale. */
export type NumFmt = "int" | "locale";
function numFmt(kind: NumFmt): (v: number) => string {
  return kind === "int"
    ? (v: number) => `${Math.round(v)}`
    : (v: number) => v.toLocaleString("fr-FR");
}

/** Indices des n points les plus hauts (y décroissant) : ceux qu'on étiquette. */
function plusHauts(points: ScatterPoint[], n: number): Set<number> {
  if (n <= 0) return new Set();
  return new Set(
    points
      .map((p, i) => ({ y: p.y, i }))
      .sort((a, b) => b.y - a.y)
      .slice(0, n)
      .map((p) => p.i),
  );
}

// Bandes pleines, même opacité que celles des séries (§ 4.2, ThresholdSeries).
const OPACITE_BANDE = 0.08;
const BANDES = [
  { cle: "good", fill: "rgb(var(--c-good))" },
  { cle: "warn", fill: "rgb(var(--c-warn))" },
  { cle: "bad", fill: "rgb(var(--c-bad))" },
] as const;

export function ScatterPlot({
  points,
  xLabel,
  yLabel,
  xUnit = "",
  yUnit = "",
  height = 300,
  xFormat = "locale",
  yFormat = "locale",
  etiquettes = 0,
  repereX,
  bandesY,
  ariaLabel,
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
  /** n points les plus hauts étiquetés. */
  etiquettes?: number;
  /** Bande verticale (ex. seuil LCP « Bon »). */
  repereX?: { valeur: number; libelle: string };
  /** Bandes horizontales Bon / À améliorer / Mauvais sur y seulement. */
  bandesY?: { vital: VitalName };
  ariaLabel: string;
}) {
  const router = useRouter();
  const fx = numFmt(xFormat);
  const fy = numFmt(yFormat);
  const hasZ = points.some((p) => p.z != null);
  const etiquetes = plusHauts(points, etiquettes);
  const donnees = points.map((p, i) => ({ ...p, etiquette: etiquetes.has(i) ? p.label : undefined }));
  const seuils = bandesY ? THRESHOLDS[bandesY.vital] : undefined;
  const maxY = points.length ? Math.max(...points.map((p) => p.y)) : 0;
  // Domaine y : la borne « Bon » reste visible même si tous les points sont bons.
  const hautY = seuils ? Math.max(maxY * 1.1, seuils[0] * 1.1) : undefined;
  const cliquable = points.some((p) => p.href);

  return (
    <div role="img" aria-label={ariaLabel} className="min-w-0" data-testid="scatter-plot">
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 16, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          {/* Des tableaux, pas des fragments : recharts range ses enfants par type. */}
          {seuils &&
            hautY != null &&
            [
              [0, seuils[0]],
              [seuils[0], seuils[1]],
              [seuils[1], Math.max(hautY, seuils[1])],
            ].map(([y1, y2], i) => (
              <ReferenceArea
                key={BANDES[i].cle}
                y1={y1}
                y2={y2}
                fill={BANDES[i].fill}
                fillOpacity={OPACITE_BANDE}
                ifOverflow="hidden"
              />
            ))}
          {repereX && [
            <ReferenceArea
              key="repere-zone"
              x1={0}
              x2={repereX.valeur}
              fill={SERIE.reference}
              fillOpacity={0.1}
              ifOverflow="hidden"
            />,
            <ReferenceLine
              key="repere-trait"
              x={repereX.valeur}
              stroke={SERIE.reference}
              strokeDasharray="4 3"
              label={{ value: repereX.libelle, position: "insideTopRight", fontSize: 10, fill: "currentColor" }}
            />,
          ]}
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
            domain={hautY != null ? [0, hautY > 10 ? Math.ceil(hautY) : hautY] : undefined}
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
                  {p.href && <div className="mt-1 text-ink-soft">Cliquer pour ouvrir</div>}
                </div>
              );
            }}
          />
          <Scatter
            data={donnees}
            fill={SERIE.principale}
            fillOpacity={0.75}
            isAnimationActive={false}
            cursor={cliquable ? "pointer" : undefined}
            onClick={(entree: unknown) => {
              const href = (entree as { payload?: ScatterPoint } | undefined)?.payload?.href;
              if (href) router.push(href);
            }}
          >
            {donnees.map((p, i) => (
              <Cell key={i} fill={p.color ?? SERIE.principale} />
            ))}
            {etiquettes > 0 && (
              <LabelList dataKey="etiquette" position="top" fontSize={10} fill="currentColor" />
            )}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
