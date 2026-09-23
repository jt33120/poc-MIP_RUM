"use client";
// Courbe de tendance générique (recharts) — une série principale (ligne) et un
// volume optionnel (ex. % de satisfaction + nombre d'avis, coût + appels).
// Grammaire commune : accent orange, axes/grille/tooltip thémés via globals.css.
//
// LE VOLUME EST UN SECOND PANNEAU (F04, P5), plus un axe secondaire. Un taux sur
// l'axe de gauche et un nombre d'avis sur celui de droite se croisaient où le
// hasard des deux échelles le voulait, et ce croisement se lisait comme un fait.
// Le volume se lit désormais dans un panneau bas, sous la courbe, qui partage son
// axe x (mêmes marges, mêmes bandes, survol synchronisé) et a SON axe y.
//
// PLUSIEURS SÉRIES (F03, § 4.1) : `series` trace jusqu'à cinq courbes nommées, dont
// la couleur et le trait viennent de leur RÔLE (`styleDeRole`, lib/palette.ts) —
// la référence est grise et pointillée, le robot bleu et pointillé, le réel orange.
// Au-delà de cinq, les suivantes ne sont pas tracées et la figure le dit (P14 :
// rien de tronqué en silence ; un « top N » est un classement, pas N courbes).
//
// L'alternative textuelle est portée par la `Figure` englobante (mêmes lignes).
//
// ACCESSIBILITÉ (F54, § 3.9). Avec `ariaLabel`, la zone de la courbe est une image
// nommée (`role="img"`), comme celle de `ThresholdSeries` : sans nom, un lecteur
// d'écran n'annonçait que des graduations et des points isolés. Optionnel pour ne
// pas toucher les appelants hors du domaine usages ; tout nouvel appelant le donne.
import { useId, type ReactNode } from "react";
import {
  Bar,
  BarChart,
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
  /** Volume optionnel (barres discrètes, panneau bas). */
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

/** Largeur de l'axe y, la même pour la courbe et le panneau de volume : leurs x coïncident. */
const LARGEUR_AXE_Y = 44;
/** Hauteur du panneau de volume, prise sur la hauteur totale demandée. */
const HAUTEUR_VOLUME = 72;

export function LineTrend({
  data,
  valueName,
  valueUnit = "",
  volumeName = "volume",
  color = SERIE.principale,
  height = 240,
  domain,
  series,
  ariaLabel,
}: {
  data: LineTrendPoint[];
  valueName: string;
  valueUnit?: string;
  volumeName?: string;
  color?: string;
  /** Hauteur totale, panneau de volume compris. */
  height?: number;
  /** Domaine forcé de l'axe de la courbe (ex. [0, 100] pour un %). */
  domain?: [number, number];
  /** Séries nommées (≤ 5) à la place de `value` ; `valueName` reste le nom de la mesure. */
  series?: LineTrendSerie[];
  /** Nom de la courbe pour un lecteur d'écran : la zone de tracé devient `role="img"`. */
  ariaLabel?: string;
}) {
  const synchro = `tendance-${useId()}`;
  const hasVolume = data.some((d) => d.volume != null);
  const tracees = series?.slice(0, MAX_SERIES_TENDANCE);
  const ecartees = series && tracees ? series.slice(tracees.length) : [];
  let rangCategorie = 0;
  const lignes = tracees?.map((s) => {
    const style = styleDeRole(s.role, s.role === "categorie" ? (s.categorieIndex ?? rangCategorie++) : 0);
    return { ...s, ...style };
  });
  const marge = { top: 8, right: 8, bottom: 0, left: 0 };
  const hauteurCourbe = hasVolume ? Math.max(120, height - HAUTEUR_VOLUME) : height;

  return (
    <div className="min-w-0" data-testid="line-trend">
      <ZoneCourbe ariaLabel={ariaLabel}>
        <ResponsiveContainer width="100%" height={hauteurCourbe}>
          <ComposedChart data={data} margin={marge} syncId={hasVolume ? synchro : undefined}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" fontSize={11} tickLine={false} interval="preserveStartEnd" />
            <YAxis fontSize={11} width={LARGEUR_AXE_Y} tickLine={false} axisLine={false} unit={valueUnit} domain={domain} />
            <Tooltip
              formatter={(val: number, name) => [val == null ? "—" : `${val}${valueUnit}`, name]}
              contentStyle={{ fontSize: 12 }}
            />
            {/* Avec un panneau de volume, une barre CACHÉE met l'axe x en bandes, comme
                celui des barres du dessous : les deux panneaux tombent sur les mêmes x. */}
            {hasVolume && <Bar dataKey="__bandes" hide isAnimationActive={false} legendType="none" />}
            {lignes ? (
              lignes.map((s) => (
                <Line
                  key={s.cle}
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
      </ZoneCourbe>
      {hasVolume && (
        <div className="mt-1 min-w-0" data-testid="line-trend-volume">
          <p className="text-[11px] text-ink-soft">Volume : {volumeName}</p>
          <ResponsiveContainer width="100%" height={HAUTEUR_VOLUME - 16}>
            <BarChart data={data} margin={marge} syncId={synchro}>
              <XAxis dataKey="label" hide />
              <YAxis
                fontSize={10}
                width={LARGEUR_AXE_Y}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tickCount={3}
              />
              <Tooltip
                formatter={(val: number) => [val == null ? "—" : val.toLocaleString("fr-FR"), volumeName]}
                contentStyle={{ fontSize: 12 }}
                cursor={{ fill: "rgb(var(--c-ink-faint))", fillOpacity: 0.12 }}
              />
              <Bar
                dataKey="volume"
                name={volumeName}
                fill="rgb(var(--c-ink-faint))"
                fillOpacity={0.45}
                maxBarSize={26}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {ecartees.length > 0 && (
        <p className="mt-1 text-xs text-ink-soft" data-testid="series-ecartees">
          {ecartees.length} série{ecartees.length > 1 ? "s" : ""} non tracée{ecartees.length > 1 ? "s" : ""} (au plus{" "}
          {MAX_SERIES_TENDANCE} par graphique) : {ecartees.map((s) => s.libelle).join(", ")}.
        </p>
      )}
    </div>
  );
}

/**
 * La zone de tracé : une image NOMMÉE quand l'appelant donne un nom, rien de plus
 * sinon (le DOM des appelants sans `ariaLabel` ne change pas). Ce que l'image
 * dessine (points, graduations, infobulle) est doublé par l'alternative de la `Figure`.
 */
function ZoneCourbe({ ariaLabel, children }: { ariaLabel?: string; children: ReactNode }) {
  if (!ariaLabel) return <>{children}</>;
  return (
    <div role="img" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
