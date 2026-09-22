"use client";
// ThresholdSeries — la série temporelle de la console (F04, plan § 3.10, § 4.2).
// Client (recharts) : survol, zoom au clic, liens d'annotation.
//
// CE QU'ELLE GARANTIT, QUEL QUE SOIT L'APPELANT :
//   - une GRILLE : chaque seau attendu a sa place sur l'axe x ; un seau absent est un
//     trou (mesure) ou un 0 (compte déclaré `additive`), jamais une droite tirée entre
//     deux mesures éloignées. Aucun `connectNulls`, nulle part ;
//   - le VERDICT derrière la valeur (P2) : pour un vital, trois bandes pleines Bon /
//     À améliorer / Mauvais, bornes lues dans `lib/rating.ts`, domaine y qui garde la
//     bande « Bon » visible ; une borne « Mauvais » hors du domaine est DITE ;
//   - un seul axe y (P5) : deux grandeurs se lisent en panneaux empilés qui partagent
//     l'axe x (`SERIE_MARGES`), jamais sur un axe secondaire ; et pas d'empilement
//     (tout empilement additif passe par `StackedBars`) ;
//   - la couverture : point creux sous `faibleSous` mesures, seau en cours creux,
//     au plus cinq séries (les suivantes sont nommées, pas tracées), points hors
//     grille comptés ;
//   - le temps porte ses événements (P9) : annotations verticales cliquables, ou la
//     raison pour laquelle elles manquent.
//
// ACCESSIBILITÉ. La zone de tracé est `role="img"` + `ariaLabel` ; l'alternative
// tabulaire (une ligne par seau, effectif compris) est portée par la `Figure`
// englobante. Les annotations sont aussi rendues en liens dans la légende : c'est
// leur arrêt de tabulation (le triangle du dessin n'en est pas un).
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useId, useMemo, useState, type MouseEvent } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Customized,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formater, formatDuVital, type FormatId, type VitalName } from "@/lib/fmt-ids";
import { styleDeRole } from "@/lib/palette";
import { RATING_LABEL, rating2026 } from "@/lib/rating";
import {
  FAIBLE_SOUS_DEFAUT,
  MAX_SERIES,
  SERIE_MARGES,
  bandesSeuils,
  domaineY,
  estJour,
  formaterAxe,
  hrefZoom,
  jourDans,
  libelleSeau,
  libelleSeauComplet,
  nombreOuNull,
  placerAnnotations,
  preparerPoints,
  type Annotation,
  type AnnotationPlacee,
  type LignePreparee,
  type PointSerie,
  type SerieDef,
} from "@/lib/series";

// Le contrat du plan (§ 4.2) nomme ces exports sur ce composant. Un composant SERVEUR
// qui a besoin de la VALEUR de `SERIE_MARGES` l'importe de `lib/series.ts` : exportée
// d'un module client, elle lui arriverait comme une référence, pas comme un objet.
export { SERIE_MARGES, preparerPoints };
export type { Annotation, PointSerie, SerieDef };

/** Destination d'un seau et son libellé d'infobulle (`liensSeaux`, F65). */
export interface LienSeau {
  href: string;
  libelle: string;
}

/** Couleurs des bandes : jetons de `globals.css`, qui suivent le mode sombre. */
const BANDE = {
  bon: { fond: "rgb(var(--c-good))", texte: "rgb(var(--c-good-ink))" },
  ameliorer: { fond: "rgb(var(--c-warn))", texte: "rgb(var(--c-warn-ink))" },
  mauvais: { fond: "rgb(var(--c-bad))", texte: "rgb(var(--c-bad-ink))" },
} as const;
const OPACITE_BANDE = 0.08;
const TRAIT_ANNOTATION = "rgb(var(--c-ink-soft))";
const FOND_POINT_CREUX = "rgb(var(--c-panel))";
/** Au-delà, les points ne sont plus dessinés un par un (seuls les points isolés et creux le restent). */
const POINTS_VISIBLES_JUSQUA = 48;

/**
 * Seau en cours : le dernier seau de la grille n'est pas fini. Lu APRÈS le montage :
 * l'heure du serveur et celle du navigateur diffèrent, et un rendu qui en dépend
 * dès le serveur ne s'hydraterait pas à l'identique.
 */
export function useSeauEnCours(
  grille: string[],
  seauSecondes: number,
  fuseau: string,
): { enCours: boolean; maintenant: number | null } {
  const [maintenant, setMaintenant] = useState<number | null>(null);
  const dernier = grille[grille.length - 1];
  useEffect(() => setMaintenant(Date.now()), [dernier]);
  if (maintenant === null || dernier === undefined) return { enCours: false, maintenant };
  // Une grille de jours finit « en cours » quand son dernier jour est aujourd'hui
  // dans le fuseau d'affichage ; une grille qui se prolonge (projection) ne l'est pas.
  if (estJour(dernier)) return { enCours: jourDans(maintenant, fuseau) === dernier, maintenant };
  const debut = Date.parse(dernier);
  return { enCours: Number.isFinite(debut) && debut + seauSecondes * 1000 > maintenant, maintenant };
}

/** Identifiant sûr pour `url(#…)` (useId de React produit des « : » ou des « « » »). */
export function useIdSvg(prefixe: string): string {
  return `${prefixe}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

// ─────────────────────────────── Annotations ───────────────────────────────

interface EtatGraphique {
  xAxisMap?: Record<string, { scale?: ((v: string) => number | undefined) & { bandwidth?: () => number } }>;
  offset?: { top: number; height: number; left: number; width: number };
}

/**
 * Traits verticaux, étiquette en haut, triangle cliquable (§ 3.7). Posée par
 * `Customized`, qui lui passe les échelles du graphique : un déploiement à 14:05
 * dans un seau d'une heure est tracé au douzième du seau, pas à son début.
 */
export function CoucheAnnotations({
  placees,
  grille,
  onAller,
  ...etat
}: EtatGraphique & { placees: AnnotationPlacee[]; grille: string[]; onAller: (href: string) => void }) {
  const axe = etat.xAxisMap ? Object.values(etat.xAxisMap)[0] : undefined;
  const offset = etat.offset;
  if (!axe?.scale || !offset || placees.length === 0) return null;
  const largeurSeau = axe.scale.bandwidth?.() ?? 0;
  const milieu = offset.left + offset.width / 2;
  const haut = offset.top;
  const bas = offset.top + offset.height;
  return (
    <g className="couche-annotations" data-testid="annotations">
      {placees.map(({ annotation, index, fraction }, k) => {
        const x0 = axe.scale!(grille[index]);
        if (x0 === undefined || !Number.isFinite(x0)) return null;
        const x = x0 + fraction * largeurSeau;
        const aDroite = x > milieu;
        const dessin = (
          <>
            <line x1={x} x2={x} y1={haut} y2={bas} stroke={TRAIT_ANNOTATION} strokeWidth={1} strokeDasharray="3 2" />
            <path d={`M ${x - 4} ${haut - 7} L ${x + 4} ${haut - 7} L ${x} ${haut - 1} Z`} fill={TRAIT_ANNOTATION} />
            <text
              x={aDroite ? x - 6 : x + 6}
              y={haut - 2}
              textAnchor={aDroite ? "end" : "start"}
              fontSize={10}
              fill={TRAIT_ANNOTATION}
            >
              {annotation.libelle}
            </text>
          </>
        );
        const cle = `${annotation.t}-${k}`;
        if (!annotation.href) return <g key={cle}>{dessin}</g>;
        const href = annotation.href;
        return (
          <a
            key={cle}
            href={href}
            aria-hidden="true"
            tabIndex={-1}
            className="cursor-pointer"
            onClick={(e: MouseEvent) => {
              // Le clic ne doit pas AUSSI zoomer sur le seau qui est dessous.
              e.preventDefault();
              e.stopPropagation();
              onAller(href);
            }}
          >
            <title>{annotation.libelle}</title>
            {dessin}
          </a>
        );
      })}
    </g>
  );
}

/** Annotations en liens accessibles, et la raison de leur absence (P9, § 3.7). */
export function LegendeAnnotations({
  placees,
  indisponibles,
  fuseau,
}: {
  placees: AnnotationPlacee[];
  indisponibles?: string;
  fuseau: string;
}) {
  if (placees.length === 0 && !indisponibles) return null;
  return (
    <div className="mt-1 text-xs text-ink-soft" data-testid="legende-annotations">
      {placees.length > 0 && (
        <p className="min-w-0 break-words">
          <span className="font-medium">Annotations : </span>
          {placees.map(({ annotation }, k) => {
            const quand = libelleSeau(annotation.t, 21_600, fuseau);
            const texte = `${annotation.libelle} (${quand})`;
            return (
              <span key={`${annotation.t}-${k}`}>
                {k > 0 && " · "}
                {annotation.href ? (
                  <Link href={annotation.href} className="text-perf underline-offset-2 hover:underline">
                    {texte}
                  </Link>
                ) : (
                  texte
                )}
              </span>
            );
          })}
        </p>
      )}
      {indisponibles && <p>Annotations non affichées : {indisponibles}.</p>}
    </div>
  );
}

// ─────────────────────────────── Légende ───────────────────────────────

export function TraitLegende({ couleur, pointille }: { couleur: string; pointille: boolean }) {
  return (
    <svg width={18} height={8} aria-hidden="true" className="shrink-0">
      <line x1={1} x2={17} y1={4} y2={4} stroke={couleur} strokeWidth={2.5} strokeDasharray={pointille ? "4 3" : undefined} />
    </svg>
  );
}

function PaveLegende({ couleur, opacite = 0.3 }: { couleur: string; opacite?: number }) {
  return (
    <svg width={12} height={10} aria-hidden="true" className="shrink-0">
      <rect x={0.5} y={0.5} width={11} height={9} rx={2} fill={couleur} fillOpacity={opacite} stroke={couleur} strokeOpacity={0.6} />
    </svg>
  );
}

function PointCreuxLegende() {
  return (
    <svg width={10} height={10} aria-hidden="true" className="shrink-0">
      <circle cx={5} cy={5} r={3.5} fill={FOND_POINT_CREUX} stroke="rgb(var(--c-ink-soft))" strokeWidth={1.5} />
    </svg>
  );
}

/**
 * Séries au-delà de cinq : nommées, jamais tracées en silence (P14). Même texte que
 * LineTrend ; identifiant de test distinct (`series-non-tracees`), pour qu'une page
 * qui montre les deux composants garde des sélecteurs univoques.
 */
export function SeriesEcartees({ libelles }: { libelles: string[] }) {
  if (libelles.length === 0) return null;
  const s = libelles.length > 1 ? "s" : "";
  return (
    <p className="mt-1 text-xs text-ink-soft" data-testid="series-non-tracees">
      {libelles.length} série{s} non tracée{s} (au plus {MAX_SERIES} par graphique) : {libelles.join(", ")}.
    </p>
  );
}

/** Points reçus hors de la grille : un appelant mal aligné se voit. */
export function PointsIgnores({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <p className="mt-1 text-xs text-ink-soft" data-testid="points-hors-grille">
      {n} point{n > 1 ? "s" : ""} hors de la grille des seaux, non tracé{n > 1 ? "s" : ""}.
    </p>
  );
}

// ─────────────────────────────── Infobulle ───────────────────────────────

interface SerieTracee extends SerieDef {
  couleur: string;
  pointille: boolean;
}

function Infobulle({
  active,
  label,
  payload,
  series,
  format,
  vital,
  bande,
  seauSecondes,
  fuseau,
  dernierEnCours,
  dernier,
  liens,
}: {
  active?: boolean;
  label?: string;
  payload?: { payload?: LignePreparee }[];
  series: SerieTracee[];
  format: FormatId;
  vital?: VitalName;
  bande?: { basseCle: string; hauteCle: string; libelle: string };
  seauSecondes: number;
  fuseau: string;
  dernierEnCours: boolean;
  dernier: string | undefined;
  liens?: Record<string, LienSeau>;
}) {
  const ligne = payload?.[0]?.payload;
  if (!active || !ligne || label === undefined) return null;
  return (
    <div className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-ink shadow-sm">
      <p className="mb-1 font-medium">{liens?.[label]?.libelle ?? libelleSeauComplet(label, seauSecondes, fuseau)}</p>
      {series.map((s) => {
        const v = nombreOuNull(ligne[s.cle]);
        const n = s.effectifCle ? nombreOuNull(ligne[s.effectifCle]) : null;
        const verdict = vital && s.role === "principale" && v !== null ? rating2026(vital, v) : null;
        return (
          <p key={s.cle} className="flex items-center gap-1.5">
            <TraitLegende couleur={s.couleur} pointille={s.pointille} />
            <span className="text-ink-soft">{s.libelle} :</span>
            <span className="tabular-nums">{formater(format, v)}</span>
            {verdict && <span className="text-ink-soft">({RATING_LABEL[verdict]})</span>}
            {n !== null && <span className="text-ink-soft">· n = {formater("count", n)}</span>}
          </p>
        );
      })}
      {bande && (nombreOuNull(ligne[bande.basseCle]) !== null || nombreOuNull(ligne[bande.hauteCle]) !== null) && (
        <p className="text-ink-soft">
          {bande.libelle} : {formater(format, nombreOuNull(ligne[bande.basseCle]))} –{" "}
          {formater(format, nombreOuNull(ligne[bande.hauteCle]))}
        </p>
      )}
      {dernierEnCours && label === dernier && <p className="text-ink-soft">seau en cours</p>}
    </div>
  );
}

// ─────────────────────────────── Composant ───────────────────────────────

/** Rôle → couleur et trait ; les catégories sans index prennent leur rang. */
export function tracerSeries(series: SerieDef[]): { tracees: SerieTracee[]; ecartees: string[] } {
  let rang = 0;
  const tracees = series.slice(0, MAX_SERIES).map((s) => {
    const style = styleDeRole(s.role, s.role === "categorie" ? (s.categorieIndex ?? rang++) : 0);
    return { ...s, ...style };
  });
  return { tracees, ecartees: series.slice(MAX_SERIES).map((s) => s.libelle) };
}

export function ThresholdSeries({
  grille,
  points,
  series,
  format,
  vital,
  faibleSous = FAIBLE_SOUS_DEFAUT,
  bande,
  annotations,
  annotationsIndisponibles,
  seauSecondes,
  fuseau,
  zoomHref,
  hauteur = 220,
  ariaLabel,
  synchro,
  legendeAnnotations = true,
  liensSeaux,
}: {
  /** OBLIGATOIRE : débuts de seau attendus, ISO UTC (`bucketStarts`) ou jours « AAAA-MM-JJ ». */
  grille: string[];
  /** `t` ∈ grille ; déjà alignés (`alignerSeaux`). */
  points: PointSerie[];
  /** ≤ 5 (P14) ; les suivantes sont nommées sous la figure, pas tracées. */
  series: SerieDef[];
  format: FormatId;
  /** Bandes Bon / À améliorer / Mauvais (THRESHOLDS) ; seulement un p75 (R-V) ; sans effet avec une série "barres". */
  vital?: VitalName;
  /** Défaut 30 : point creux si l'effectif du seau est sous ce nombre. */
  faibleSous?: number;
  /** Bande d'incertitude (projection). */
  bande?: { basseCle: string; hauteCle: string; libelle: string };
  annotations?: Annotation[];
  /** Raison si les annotations ne peuvent pas être lues (B1). */
  annotationsIndisponibles?: string;
  /** Largeur d'un seau : axe, infobulle et zoom au clic. */
  seauSecondes: number;
  /** Fuseau d'affichage des heures d'axe (« UTC » pour les seaux du contrat). */
  fuseau: string;
  /** Gabarit d'URL avec {from} {to} pour le clic sur un seau. */
  zoomHref?: string;
  /** Défaut 220. */
  hauteur?: number;
  ariaLabel: string;
  /** Panneaux empilés : même valeur = survol synchronisé (recharts `syncId`). Ajout F04. */
  synchro?: string;
  /** Défaut true. Panneaux empilés : un seul panneau liste les annotations en liens (un arrêt de tabulation chacune). Ajout F04. */
  legendeAnnotations?: boolean;
  /**
   * Lien et libellé d'un seau, calculés CÔTÉ SERVEUR, par élément de la grille :
   * prioritaires sur `zoomHref`. Une grille de jours locaux n'a pas de zoom par
   * gabarit (ses bornes UTC dépendent du fuseau, § 3.3, R-T) : le serveur les
   * convertit (`bornesJourLocal`) et l'infobulle écrit les deux fuseaux. Ajout F65.
   */
  liensSeaux?: Record<string, LienSeau>;
}) {
  const router = useRouter();
  const { enCours, maintenant } = useSeauEnCours(grille, seauSecondes, fuseau);
  const { tracees, ecartees } = useMemo(() => tracerSeries(series), [series]);
  const prep = useMemo(
    () => preparerPoints(grille, points, tracees, { faibleSous, seauEnCours: enCours }),
    [grille, points, tracees, faibleSous, enCours],
  );
  const aDesBarres = tracees.some((s) => s.forme === "barres");
  // Une bande de verdict derrière des barres de comptes n'aurait pas de sens : un
  // compte n'a pas de seuil (R-S). Le plan l'interdit ; on ne la dessine pas.
  const vitalEffectif = aDesBarres ? undefined : vital;
  const [, haut] = useMemo(() => domaineY(prep.lignes, tracees, { vital: vitalEffectif, bande }), [prep.lignes, tracees, vitalEffectif, bande]);
  const bandes = vitalEffectif ? bandesSeuils(vitalEffectif, haut) : null;
  const placees = useMemo(
    () => placerAnnotations(annotations ?? [], grille, seauSecondes, fuseau),
    [annotations, grille, seauSecondes, fuseau],
  );
  const donnees = useMemo(
    () =>
      bande
        ? prep.lignes.map((l) => {
            const bas = nombreOuNull(l[bande.basseCle]);
            const hautBande = nombreOuNull(l[bande.hauteCle]);
            return { ...l, __bande: bas !== null && hautBande !== null ? [bas, hautBande] : null };
          })
        : prep.lignes,
    [prep.lignes, bande],
  );
  // Le clic d'une annotation arrête sa propagation : il ne zoome pas en plus.
  const aller = (href: string) => router.push(href);
  const dernier = grille[grille.length - 1];
  const dessinerPoints = grille.length <= POINTS_VISIBLES_JUSQUA;
  const formatSeuil = vitalEffectif ? formatDuVital(vitalEffectif) : format;

  return (
    <div className="min-w-0" data-testid="threshold-series" data-vital={vitalEffectif} data-seaux={grille.length}>
      <div role="img" aria-label={ariaLabel} className={zoomHref || liensSeaux ? "cursor-pointer" : undefined}>
        <ResponsiveContainer width="100%" height={hauteur}>
          <ComposedChart
            data={donnees}
            syncId={synchro}
            margin={{ top: placees.length > 0 ? 20 : 8, right: SERIE_MARGES.droite, bottom: 0, left: 0 }}
            onClick={(etat) => {
              if (!etat || typeof etat.activeLabel !== "string") return;
              const lie = liensSeaux?.[etat.activeLabel];
              if (lie) {
                router.push(lie.href);
                return;
              }
              if (!zoomHref) return;
              const href = hrefZoom(zoomHref, etat.activeLabel, seauSecondes, maintenant ?? Date.now());
              if (href) router.push(href);
            }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            {bandes && (
              <ReferenceArea
                y1={bandes.bon.y1}
                y2={bandes.bon.y2}
                className="bande-bon"
                fill={BANDE.bon.fond}
                fillOpacity={OPACITE_BANDE}
                stroke="none"
                ifOverflow="hidden"
                label={{ value: RATING_LABEL.good, position: "insideBottomRight", fontSize: 10, fill: BANDE.bon.texte }}
              />
            )}
            {bandes?.ameliorer && (
              <ReferenceArea
                y1={bandes.ameliorer.y1}
                y2={bandes.ameliorer.y2}
                className="bande-ameliorer"
                fill={BANDE.ameliorer.fond}
                fillOpacity={OPACITE_BANDE}
                stroke="none"
                ifOverflow="hidden"
                label={{ value: RATING_LABEL["needs-improvement"], position: "insideTopRight", fontSize: 10, fill: BANDE.ameliorer.texte }}
              />
            )}
            {bandes?.mauvais && (
              <ReferenceArea
                y1={bandes.mauvais.y1}
                y2={bandes.mauvais.y2}
                className="bande-mauvais"
                fill={BANDE.mauvais.fond}
                fillOpacity={OPACITE_BANDE}
                stroke="none"
                ifOverflow="hidden"
                label={{ value: RATING_LABEL.poor, position: "insideTopRight", fontSize: 10, fill: BANDE.mauvais.texte }}
              />
            )}
            <XAxis
              dataKey="t"
              fontSize={11}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={12}
              tickFormatter={(t: string) => libelleSeau(t, seauSecondes, fuseau)}
            />
            <YAxis
              type="number"
              domain={[0, haut]}
              allowDataOverflow
              width={SERIE_MARGES.gauche}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              allowDecimals={format !== "count"}
              tickFormatter={(v: number) => formaterAxe(format, v)}
            />
            <Tooltip
              isAnimationActive={false}
              content={
                <Infobulle
                  series={tracees}
                  format={format}
                  vital={vitalEffectif}
                  bande={bande}
                  seauSecondes={seauSecondes}
                  fuseau={fuseau}
                  dernierEnCours={enCours}
                  dernier={dernier}
                  liens={liensSeaux}
                />
              }
            />
            {bande && (
              <Area
                dataKey="__bande"
                name={bande.libelle}
                stroke="none"
                fill="rgb(var(--c-ink-faint))"
                fillOpacity={0.22}
                isAnimationActive={false}
                activeDot={false}
              />
            )}
            {/* Aucune série en barres : une barre CACHÉE met l'axe x en bandes, comme
                celui de StackedBars — deux panneaux empilés tombent alors sur les
                mêmes x (sinon recharts pose les points aux bords, les barres au milieu). */}
            {!aDesBarres && <Bar dataKey="__bandes" hide isAnimationActive={false} legendType="none" />}
            {tracees.map((s) =>
              s.forme === "barres" ? (
                <Bar key={s.cle} dataKey={s.cle} name={s.libelle} fill={s.couleur} maxBarSize={32} isAnimationActive={false}>
                  {prep.lignes.map((_l, i) => (
                    <Cell
                      key={i}
                      fillOpacity={prep.creux[s.cle]?.includes(i) ? 0.4 : 0.85}
                      stroke={prep.creux[s.cle]?.includes(i) ? s.couleur : undefined}
                      strokeDasharray={prep.creux[s.cle]?.includes(i) ? "3 2" : undefined}
                    />
                  ))}
                </Bar>
              ) : (
                <Line
                  key={s.cle}
                  type="monotone"
                  dataKey={s.cle}
                  name={s.libelle}
                  stroke={s.couleur}
                  strokeWidth={s.role === "principale" ? 2.5 : 2}
                  strokeDasharray={s.pointille ? "5 4" : undefined}
                  isAnimationActive={false}
                  activeDot={{ r: 4 }}
                  dot={rendreDot({
                    couleur: s.couleur,
                    creux: new Set(prep.creux[s.cle]),
                    isoles: new Set((prep.segments[s.cle] ?? []).filter(([a, b]) => a === b).map(([a]) => a)),
                    tous: dessinerPoints && !s.pointille,
                  })}
                />
              ),
            )}
            <Customized component={<CoucheAnnotations placees={placees} grille={grille} onAller={aller} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft" data-testid="legende-serie">
        {tracees.map((s) => (
          <li key={s.cle} className="flex min-w-0 items-center gap-1.5">
            {s.forme === "barres" ? <PaveLegende couleur={s.couleur} opacite={0.85} /> : <TraitLegende couleur={s.couleur} pointille={s.pointille} />}
            <span className="min-w-0 break-words">{s.libelle}</span>
          </li>
        ))}
        {bande && (
          <li className="flex items-center gap-1.5">
            <PaveLegende couleur="rgb(var(--c-ink-faint))" />
            {bande.libelle}
          </li>
        )}
        {bandes && (
          <>
            <li className="flex items-center gap-1.5" data-bande-legende="bon">
              <PaveLegende couleur={BANDE.bon.fond} />
              {RATING_LABEL.good} ≤ {formater(formatSeuil, bandes.seuils[0])}
            </li>
            <li className="flex items-center gap-1.5" data-bande-legende="ameliorer">
              <PaveLegende couleur={BANDE.ameliorer.fond} />
              {RATING_LABEL["needs-improvement"]}
            </li>
            <li className="flex items-center gap-1.5" data-bande-legende="mauvais">
              <PaveLegende couleur={BANDE.mauvais.fond} />
              {RATING_LABEL.poor} &gt; {formater(formatSeuil, bandes.seuils[1])}
            </li>
          </>
        )}
        {prep.faibleEffectif && (
          <li className="flex items-center gap-1.5" data-testid="legende-faible-effectif">
            <PointCreuxLegende />
            moins de {faibleSous} mesures
          </li>
        )}
        {enCours && (
          <li className="flex items-center gap-1.5" data-testid="legende-seau-en-cours">
            <PointCreuxLegende />
            seau en cours
          </li>
        )}
      </ul>
      {bandes?.horsEchelle && (
        <p className="mt-1 text-xs text-ink-soft" data-testid="seuil-hors-echelle">
          {bandes.horsEchelle}
        </p>
      )}
      <SeriesEcartees libelles={ecartees} />
      <PointsIgnores n={prep.ignores} />
      {legendeAnnotations && (
        <LegendeAnnotations placees={placees} indisponibles={annotationsIndisponibles} fuseau={fuseau} />
      )}
    </div>
  );
}

/**
 * Points d'une ligne : creux (effectif faible, seau en cours), isolés (un seau
 * mesuré entre deux trous : sans point, il serait invisible), ou tous, petits,
 * quand la grille est courte.
 */
function rendreDot({
  couleur,
  creux,
  isoles,
  tous,
}: {
  couleur: string;
  creux: Set<number>;
  isoles: Set<number>;
  tous: boolean;
}) {
  function Point(props: { cx?: number; cy?: number; index?: number; key?: string }) {
    const { cx, cy, index = -1 } = props;
    const cle = props.key ?? `point-${index}`;
    if (cx == null || cy == null || !Number.isFinite(cx) || !Number.isFinite(cy)) return <g key={cle} />;
    if (creux.has(index)) {
      return <circle key={cle} cx={cx} cy={cy} r={3.5} fill={FOND_POINT_CREUX} stroke={couleur} strokeWidth={1.5} data-creux="" />;
    }
    if (isoles.has(index)) return <circle key={cle} cx={cx} cy={cy} r={3} fill={couleur} data-isole="" />;
    if (tous) return <circle key={cle} cx={cx} cy={cy} r={2.5} fill={couleur} />;
    return <g key={cle} />;
  }
  return Point;
}
