"use client";
// Courbe de tendance générique (recharts) — une série principale (ligne) et un
// volume optionnel en barres discrètes sur un axe secondaire (ex. % de
// satisfaction + nombre d'avis, coût + appels). Grammaire commune : accent
// orange, axes/grille/tooltip thémés via globals.css.
//
// PLUSIEURS SÉRIES (F03, § 4.1) : `series` trace jusqu'à cinq courbes nommées, dont
// la couleur et le trait viennent de leur RÔLE (`styleDeRole`, lib/palette.ts) —
// la référence est grise et pointillée, le robot bleu et pointillé, le réel orange.
// Au-delà de cinq, les suivantes ne sont pas tracées et la figure le dit (P14 :
// rien de tronqué en silence ; un « top N » est un classement, pas N courbes).
//
// L'alternative textuelle est portée par la `Figure` englobante (mêmes lignes).
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SERIE, styleDeRole, type RoleSerie } from "@/lib/palette";

export interface LineTrendPoint {
  label: string;
  /** `null` : aucune mesure sur ce point — un TROU dans la courbe (pas de `connectNulls`), jamais 0. */
  value?: number | null;
  /** Volume optionnel (barres discrètes, axe droit). */
  volume?: number;
  /** Valeurs des `series`, par clé (`null` = trou). */
  [cle: string]: string | number | null | undefined;
}

export interface LineTrendSerie {
  /** Clé de la valeur dans chaque point. */
  cle: string;
  /** « Rétention », « Période précédente ». */
  libelle: string;
  role: RoleSerie;
  /** Couleur catégorielle si role = "categorie" (défaut : rang parmi les catégories). */
  categorieIndex?: number;
}

/** Au plus cinq séries par graphique (P14). */
export const MAX_SERIES_TENDANCE = 5;

export function LineTrend({
  data,
  valueName,
  valueUnit = "",
  volumeName = "volume",
  color = SERIE.principale,
  height = 240,
  domain,
  series,
}: {
  data: LineTrendPoint[];
  valueName: string;
  valueUnit?: string;
  volumeName?: string;
  color?: string;
  height?: number;
  /** Domaine forcé de l'axe principal (ex. [0, 100] pour un %). */
  domain?: [number, number];
  /** Séries nommées (≤ 5) à la place de `value` ; `valueName` reste le nom de la mesure. */
  series?: LineTrendSerie[];
}) {
  const hasVolume = data.some((d) => d.volume != null);
  const tracees = series?.slice(0, MAX_SERIES_TENDANCE);
  const ecartees = series && tracees ? series.slice(tracees.length) : [];
  let rangCategorie = 0;
  const lignes = tracees?.map((s) => {
    const style = styleDeRole(s.role, s.role === "categorie" ? (s.categorieIndex ?? rangCategorie++) : 0);
    return { ...s, ...style };
  });

  return (
    <div className="min-w-0" data-testid="line-trend">
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
              val == null ? "—" : name === volumeName ? val.toLocaleString("fr-FR") : `${val}${valueUnit}`,
              name,
            ]}
            contentStyle={{ fontSize: 12 }}
          />
          {hasVolume && (
            <Bar yAxisId="vol" dataKey="volume" name={volumeName} fill="rgb(var(--c-ink-faint))" fillOpacity={0.25} maxBarSize={26} radius={[2, 2, 0, 0]} />
          )}
          {lignes ? (
            lignes.map((s) => (
              <Line
                key={s.cle}
                yAxisId="v"
                type="monotone"
                dataKey={s.cle}
                name={s.libelle}
                stroke={s.couleur}
                strokeWidth={s.role === "principale" ? 2.5 : 2}
                strokeDasharray={s.pointille ? "5 4" : undefined}
                dot={s.pointille ? false : { r: 2.5, fill: s.couleur, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))
          ) : (
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
          )}
          {lignes && <Legend wrapperStyle={{ fontSize: 11 }} />}
        </ComposedChart>
      </ResponsiveContainer>
      {ecartees.length > 0 && (
        <p className="mt-1 text-xs text-ink-soft" data-testid="series-ecartees">
          {ecartees.length} série{ecartees.length > 1 ? "s" : ""} non tracée{ecartees.length > 1 ? "s" : ""} (au plus{" "}
          {MAX_SERIES_TENDANCE} par graphique) : {ecartees.map((s) => s.libelle).join(", ")}.
        </p>
      )}
    </div>
  );
}
