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
//
// RECETTE DU 26/09/2026. Axes à pas ronds et à une seule unité (« 2 750 / ms » sur
// deux lignes devient « 2,5 s ») ; étiquettes posées sans se chevaucher ni sortir du
// cadre (`placerEtiquettesNuage`) : marge haute pour le point le plus haut, marge
// droite pour un libellé au bord. Une étiquette sans place n'est pas écrite ; le
// point garde son infobulle.
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  Cell,
  Customized,
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
import { largeurTexte, placerEtiquettesNuage } from "@/lib/etiquettes";
import { formater, type VitalName } from "@/lib/fmt-ids";
import { etiquettesGraduations, graduationsY, type Graduations } from "@/lib/graduations";
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

const NBSP = String.fromCharCode(0xa0);

/**
 * Étiquettes d'un axe à graduations rondes, dans une seule unité : une durée
 * (« ms ») passe en secondes pour tout l'axe dès 1 s, une part (« % ») garde son
 * signe ; toute autre unité est dans le titre de l'axe, pas répétée à chaque pas.
 */
function etiquettesAxe(g: Graduations, unite: string, fmt: NumFmt): (v: number) => string {
  const u = unite.trim();
  let textes: string[];
  if (u === "ms") textes = etiquettesGraduations(g.valeurs, "ms");
  else if (u === "%") textes = etiquettesGraduations(g.valeurs.map((v) => v / 100), "pct");
  else textes = g.valeurs.map((v) => numFmt(fmt)(v));
  const parValeur = new Map(g.valeurs.map((v, i) => [v, textes[i]]));
  return (v: number) => parValeur.get(v) ?? numFmt(fmt)(v);
}

/** Une valeur d'infobulle avec son unité : « 2,8 s », « 34,7 % », « 12 interactions ». */
function valeurAvecUnite(v: number, unite: string, fmt: NumFmt): string {
  const u = unite.trim();
  if (u === "ms") return formater("ms", v);
  if (u === "%") return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${NBSP}%`;
  return `${numFmt(fmt)(v)}${u ? `${NBSP}${u}` : ""}`;
}

/** Une étiquette trop longue est coupée au milieu (le début et la fin identifient) ; le texte entier est dans l'infobulle. */
function abreger(texte: string, max = 32): string {
  if (texte.length <= max) return texte;
  const tete = Math.ceil((max - 1) / 2);
  return `${texte.slice(0, tete)}…${texte.slice(texte.length - (max - 1 - tete))}`;
}

interface EtatNuage {
  xAxisMap?: Record<string, { scale?: (v: number) => number }>;
  yAxisMap?: Record<string, { scale?: (v: number) => number }>;
  offset?: { top: number; left: number; width: number; height: number };
}

const POLICE_ETIQUETTE = 10;
const MARGE = { top: 24, right: 28, bottom: 24, left: 8 } as const;

/** Les étiquettes des points les plus hauts, posées par `Customized` qui donne les échelles. */
function CoucheEtiquettes({
  points,
  rayon,
  ...etat
}: EtatNuage & { points: { x: number; y: number; texte: string; z?: number }[]; rayon: (z?: number) => number }) {
  const sx = etat.xAxisMap ? Object.values(etat.xAxisMap)[0]?.scale : undefined;
  const sy = etat.yAxisMap ? Object.values(etat.yAxisMap)[0]?.scale : undefined;
  const o = etat.offset;
  if (!sx || !sy || !o || points.length === 0) return null;
  const aPoser = points.map((p) => ({
    x: sx(p.x),
    y: sy(p.y),
    rayon: rayon(p.z),
    largeur: largeurTexte(p.texte, POLICE_ETIQUETTE),
    hauteur: POLICE_ETIQUETTE + 2,
  }));
  const places = placerEtiquettesNuage(aPoser, {
    gauche: o.left,
    haut: 1,
    droite: o.left + o.width + MARGE.right - 2,
    bas: o.top + o.height,
  });
  return (
    <g className="etiquettes-nuage" data-testid="etiquettes-nuage">
      {places.map((pl, i) =>
        pl ? (
          <text key={i} x={pl.x} y={pl.y} textAnchor={pl.ancre} fontSize={POLICE_ETIQUETTE} fill="currentColor" className="text-ink-soft">
            {points[i].texte}
          </text>
        ) : null,
      )}
    </g>
  );
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

// Bandes pleines, même opacité que celles des séries (§ 4.2, ThresholdSeries) ;
// relevée en thème sombre par la classe `bande-seuil` (app/globals.css).
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
  const hasZ = points.some((p) => p.z != null);
  const etiquetes = plusHauts(points, etiquettes);
  const donnees = points;
  const seuils = bandesY ? THRESHOLDS[bandesY.vital] : undefined;
  const maxY = points.length ? Math.max(...points.map((p) => p.y)) : 0;
  const maxX = points.length ? Math.max(...points.map((p) => p.x), repereX?.valeur ?? 0) : 0;
  // Domaines à pas ronds, depuis 0. En y, la borne « Bon » reste visible même si tous
  // les points sont bons.
  const gradY = graduationsY(seuils ? Math.max(maxY, seuils[0] * 1.1) : maxY, { entier: yFormat === "int" && maxY >= 5 });
  const gradX = graduationsY(maxX, { entier: xFormat === "int" && maxX >= 5 });
  const hautY = gradY.haut;
  const etiquetteX = etiquettesAxe(gradX, xUnit, xFormat);
  const etiquetteY = etiquettesAxe(gradY, yUnit, yFormat);
  const cliquable = points.some((p) => p.href);
  // Rayon d'un point (px) : celui du symbole de recharts, ou de la bulle (`ZAxis`, aire 40 à 420).
  const zs = points.map((p) => p.z).filter((z): z is number => z != null && Number.isFinite(z));
  const [zMin, zMax] = zs.length ? [Math.min(...zs), Math.max(...zs)] : [0, 0];
  const rayon = (z?: number) => {
    if (!hasZ || z == null) return 5;
    const aire = zMax > zMin ? 40 + ((z - zMin) / (zMax - zMin)) * 380 : 230;
    return Math.sqrt(aire / Math.PI);
  };
  // Les points à étiqueter, du plus haut au plus bas : le premier posé est le plus cherché.
  const aEtiqueter = [...etiquetes]
    .sort((a, b) => points[b].y - points[a].y)
    .map((i) => ({ x: points[i].x, y: points[i].y, z: points[i].z, texte: abreger(points[i].label) }));

  return (
    <div role="img" aria-label={ariaLabel} className="min-w-0" data-testid="scatter-plot">
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={MARGE}>
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
                className="bande-seuil"
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
            domain={[0, gradX.haut]}
            ticks={gradX.valeurs}
            interval="equidistantPreserveStart"
            tickFormatter={etiquetteX}
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
            domain={[0, hautY]}
            ticks={gradY.valeurs}
            interval={0}
            tickFormatter={etiquetteY}
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
                    {xLabel} : {valeurAvecUnite(p.x, xUnit, xFormat)}
                  </div>
                  <div className="tabular-nums text-ink-soft">
                    {yLabel} : {valeurAvecUnite(p.y, yUnit, yFormat)}
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
          </Scatter>
          {aEtiqueter.length > 0 && <Customized component={<CoucheEtiquettes points={aEtiqueter} rayon={rayon} />} />}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
