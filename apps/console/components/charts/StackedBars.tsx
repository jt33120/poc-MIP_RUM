"use client";
// StackedBars — le SEUL composant qui empile (F04, plan § 3.10, § 4.2). Client (recharts).
//
// RÉSERVÉ AUX COMPTES. Empiler, c'est additionner : des pages vues par type, des
// occurrences par groupe, des alertes par sévérité. Un p75, un taux ou un nombre de
// visiteurs distincts ne s'empile pas (P5, V2) — ils passent par `ThresholdSeries`.
//
// DEUX FORMES, LE TEMPS DE LA MIGRATION (§ 6.4, précision F04). La nouvelle forme
// (`grille`, `points`, `series: SerieEmpilee[]`) pose les barres sur la grille des
// seaux (seau absent = 0 : c'est un compte), partage l'axe x de `ThresholdSeries`
// (`SERIE_MARGES`), porte annotations, zoom et séries cliquables, et double chaque
// ton de sévérité d'un motif. L'ancienne forme (`data`, `xKey`) reste acceptée
// telle quelle : chaque écran passe à la nouvelle dans son propre lot, et F69 la
// retire.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, type MouseEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Customized,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formater, type FormatId } from "@/lib/fmt-ids";
import { SEVERITE, categorie } from "@/lib/palette";
import {
  MAX_SERIES,
  SERIE_MARGES,
  formaterAxe,
  hrefZoom,
  libelleSeau,
  libelleSeauComplet,
  nombreOuNull,
  placerAnnotations,
  preparerPoints,
  type Annotation,
  type LignePreparee,
  type PointSerie,
} from "@/lib/series";
import {
  CoucheAnnotations,
  LegendeAnnotations,
  PointsIgnores,
  SeriesEcartees,
  useIdSvg,
  useSeauEnCours,
} from "./ThresholdSeries";

// ─────────────────────────────── Ancienne forme ───────────────────────────────

/** Ancienne forme (jusqu'à F69) : une couche par série, couleur fournie par l'appelant. */
export interface StackSeries {
  key: string;
  name: string;
  color: string;
}

interface FormeAncienne {
  /** Une valeur `null` ne dessine aucun segment ; l'infobulle l'omet (jamais « 0 »). */
  data: Record<string, number | string | null>[];
  xKey: string;
  series: StackSeries[];
  height?: number;
  yUnit?: string;
  showLegend?: boolean;
}

// ─────────────────────────────── Nouvelle forme ───────────────────────────────

export interface SerieEmpilee {
  cle: string;
  libelle: string;
  /** Couleur CATEGORIELLE. */
  categorieIndex?: number;
  /** Sévérités d'alerte (palette SEVERITE), toujours doublées d'un motif. */
  ton?: "bad" | "warn" | "neutre";
  /** Défaut : celui du ton (SEVERITE), plein sinon. */
  motif?: "plein" | "hachure" | "points";
  /** Clic sur un segment de cette série (ex. panel=error:<fp>) ; une série « Autres (somme) » n'en a pas. */
  href?: string;
}

interface FormeGrille {
  /** Débuts de seau ; seau absent = 0 (additif). */
  grille: string[];
  points: PointSerie[];
  /** ≤ 5 ; les suivantes sont nommées sous la figure, pas tracées. */
  series: SerieEmpilee[];
  format: FormatId;
  annotations?: Annotation[];
  annotationsIndisponibles?: string;
  seauSecondes: number;
  fuseau: string;
  /** Clic sur l'axe d'un seau (hors segment cliquable). */
  zoomHref?: string;
  /** Défaut 220. */
  hauteur?: number;
  ariaLabel: string;
  /** Panneaux empilés : même valeur = survol synchronisé (recharts `syncId`). Ajout F04. */
  synchro?: string;
  /** Défaut true. Panneaux empilés : un seul panneau liste les annotations en liens (un arrêt de tabulation chacune). Ajout F04. */
  legendeAnnotations?: boolean;
}

export type StackedBarsProps = FormeAncienne | FormeGrille;

export function StackedBars(props: StackedBarsProps) {
  return "grille" in props ? <BarresSurGrille {...props} /> : <BarresAnciennes {...props} />;
}

/** Jetons des tons de sévérité : ils suivent le mode sombre. */
const TONS: Record<NonNullable<SerieEmpilee["ton"]>, string> = {
  bad: "rgb(var(--c-bad))",
  warn: "rgb(var(--c-warn))",
  neutre: "rgb(var(--c-ink-soft))",
};

/** Le motif d'un ton est celui de sa sévérité (`SEVERITE`) : critique plein, avertissement hachuré, info pointillé. */
const MOTIF_DU_TON: Record<NonNullable<SerieEmpilee["ton"]>, NonNullable<SerieEmpilee["motif"]>> = {
  bad: SEVERITE.critical.motif,
  warn: SEVERITE.warning.motif === "hachures" ? "hachure" : "plein",
  neutre: SEVERITE.info.motif,
};

interface SerieDessinee extends SerieEmpilee {
  couleur: string;
  motifEffectif: NonNullable<SerieEmpilee["motif"]>;
  remplissage: string;
  motifId: string;
}

/** Couleur, motif et remplissage de chaque série (exporté pour les tests). */
export function dessinerSeries(series: SerieEmpilee[], prefixeMotif: string): { dessinees: SerieDessinee[]; ecartees: string[] } {
  let rang = 0;
  const dessinees = series.slice(0, MAX_SERIES).map((s, i) => {
    const couleur = s.ton ? TONS[s.ton] : categorie(s.categorieIndex ?? rang++);
    const motifEffectif = s.motif ?? (s.ton ? MOTIF_DU_TON[s.ton] : "plein");
    const motifId = `${prefixeMotif}-${i}`;
    return { ...s, couleur, motifEffectif, motifId, remplissage: motifEffectif === "plein" ? couleur : `url(#${motifId})` };
  });
  return { dessinees, ecartees: series.slice(MAX_SERIES).map((s) => s.libelle) };
}

function Motif({ s }: { s: SerieDessinee }) {
  if (s.motifEffectif === "hachure") {
    return (
      <pattern id={s.motifId} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
        <rect width={6} height={6} fill={s.couleur} fillOpacity={0.3} />
        <line x1={0} y1={0} x2={0} y2={6} stroke={s.couleur} strokeWidth={3} />
      </pattern>
    );
  }
  if (s.motifEffectif === "points") {
    return (
      <pattern id={s.motifId} patternUnits="userSpaceOnUse" width={5} height={5}>
        <rect width={5} height={5} fill={s.couleur} fillOpacity={0.3} />
        <circle cx={2.5} cy={2.5} r={1.3} fill={s.couleur} />
      </pattern>
    );
  }
  return null;
}

function PaveMotif({ s }: { s: SerieDessinee }) {
  return (
    <svg width={12} height={10} aria-hidden="true" className="shrink-0">
      <rect x={0.5} y={0.5} width={11} height={9} rx={2} fill={s.remplissage} stroke={s.couleur} />
    </svg>
  );
}

function InfobulleEmpilee({
  active,
  label,
  payload,
  series,
  format,
  seauSecondes,
  fuseau,
  enCours,
  dernier,
}: {
  active?: boolean;
  label?: string;
  payload?: { payload?: LignePreparee }[];
  series: SerieDessinee[];
  format: FormatId;
  seauSecondes: number;
  fuseau: string;
  enCours: boolean;
  dernier: string | undefined;
}) {
  const ligne = payload?.[0]?.payload;
  if (!active || !ligne || label === undefined) return null;
  const valeurs = series.map((s) => nombreOuNull(ligne[s.cle]));
  // Des comptes s'additionnent : le total est une vraie mesure. Une valeur
  // inconnue le rend inconnu, jamais sous-estimé.
  const total = valeurs.some((v) => v === null) ? null : valeurs.reduce<number>((a, v) => a + (v ?? 0), 0);
  return (
    <div className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-ink shadow-sm">
      <p className="mb-1 font-medium">{libelleSeauComplet(label, seauSecondes, fuseau)}</p>
      {[...series].reverse().map((s) => (
        <p key={s.cle} className="flex items-center gap-1.5">
          <PaveMotif s={s} />
          <span className="text-ink-soft">{s.libelle} :</span>
          <span className="tabular-nums">{formater(format, nombreOuNull(ligne[s.cle]))}</span>
        </p>
      ))}
      {series.length > 1 && (
        <p className="mt-0.5 border-t border-line pt-0.5">
          <span className="text-ink-soft">Total : </span>
          <span className="tabular-nums">{formater(format, total)}</span>
        </p>
      )}
      {enCours && label === dernier && <p className="text-ink-soft">seau en cours</p>}
    </div>
  );
}

function BarresSurGrille({
  grille,
  points,
  series,
  format,
  annotations,
  annotationsIndisponibles,
  seauSecondes,
  fuseau,
  zoomHref,
  hauteur = 220,
  ariaLabel,
  synchro,
  legendeAnnotations = true,
}: FormeGrille) {
  const router = useRouter();
  const prefixe = useIdSvg("motif");
  const { enCours, maintenant } = useSeauEnCours(grille, seauSecondes, fuseau);
  const { dessinees, ecartees } = useMemo(() => dessinerSeries(series, prefixe), [series, prefixe]);
  const prep = useMemo(
    () =>
      preparerPoints(
        grille,
        points,
        dessinees.map((s) => ({ cle: s.cle, libelle: s.libelle, role: "categorie" as const, additive: true })),
        { seauEnCours: enCours },
      ),
    [grille, points, dessinees, enCours],
  );
  const haut = useMemo(() => {
    let max = 0;
    for (const l of prep.lignes) max = Math.max(max, dessinees.reduce((a, s) => a + Math.max(nombreOuNull(l[s.cle]) ?? 0, 0), 0));
    return max > 0 ? max * 1.1 : 1;
  }, [prep.lignes, dessinees]);
  const placees = useMemo(
    () => placerAnnotations(annotations ?? [], grille, seauSecondes, fuseau),
    [annotations, grille, seauSecondes, fuseau],
  );
  const dernier = grille[grille.length - 1];
  const indexEnCours = enCours ? grille.length - 1 : -1;

  return (
    <div className="min-w-0" data-testid="stacked-bars" data-seaux={grille.length}>
      {/* Motifs définis hors du graphique : la légende (rendue au serveur) s'en sert aussi. */}
      <svg width={0} height={0} aria-hidden="true" className="absolute">
        <defs>
          {dessinees.map((s) => (
            <Motif key={s.motifId} s={s} />
          ))}
        </defs>
      </svg>
      <div role="img" aria-label={ariaLabel} className={zoomHref ? "cursor-pointer" : undefined}>
        <ResponsiveContainer width="100%" height={hauteur}>
          <BarChart
            data={prep.lignes}
            syncId={synchro}
            margin={{ top: placees.length > 0 ? 20 : 8, right: SERIE_MARGES.droite, bottom: 0, left: 0 }}
            onClick={(etat) => {
              if (!zoomHref || !etat || typeof etat.activeLabel !== "string") return;
              const href = hrefZoom(zoomHref, etat.activeLabel, seauSecondes, maintenant ?? Date.now());
              if (href) router.push(href);
            }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
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
              cursor={{ fill: "rgb(var(--c-ink-faint))", fillOpacity: 0.12 }}
              content={
                <InfobulleEmpilee
                  series={dessinees}
                  format={format}
                  seauSecondes={seauSecondes}
                  fuseau={fuseau}
                  enCours={enCours}
                  dernier={dernier}
                />
              }
            />
            {dessinees.map((s, i) => (
              <Bar
                key={s.cle}
                dataKey={s.cle}
                name={s.libelle}
                stackId="pile"
                fill={s.remplissage}
                stroke={s.motifEffectif === "plein" ? undefined : s.couleur}
                strokeWidth={s.motifEffectif === "plein" ? 0 : 1}
                maxBarSize={48}
                radius={i === dessinees.length - 1 ? [3, 3, 0, 0] : undefined}
                isAnimationActive={false}
                className={s.href ? "cursor-pointer" : undefined}
                onClick={
                  s.href
                    ? (_d: unknown, _i: number, e: MouseEvent) => {
                        // Le segment mène à SA destination ; le zoom du seau ne s'y ajoute pas.
                        e.stopPropagation();
                        router.push(s.href!);
                      }
                    : undefined
                }
              >
                {prep.lignes.map((_l, k) => (
                  <Cell key={k} fillOpacity={k === indexEnCours ? 0.45 : 1} />
                ))}
              </Bar>
            ))}
            <Customized component={<CoucheAnnotations placees={placees} grille={grille} onAller={(href) => router.push(href)} />} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft" data-testid="legende-serie">
        {dessinees.map((s) => (
          <li key={s.cle} className="flex min-w-0 items-center gap-1.5">
            <PaveMotif s={s} />
            {s.href ? (
              <Link href={s.href} className="min-w-0 break-words text-perf underline-offset-2 hover:underline">
                {s.libelle}
              </Link>
            ) : (
              <span className="min-w-0 break-words">{s.libelle}</span>
            )}
          </li>
        ))}
        {enCours && (
          <li className="flex items-center gap-1.5" data-testid="legende-seau-en-cours">
            <svg width={12} height={10} aria-hidden="true" className="shrink-0">
              <rect x={0.5} y={0.5} width={11} height={9} rx={2} fill="rgb(var(--c-ink-soft))" fillOpacity={0.3} />
            </svg>
            seau en cours (barre pâle)
          </li>
        )}
      </ul>
      <SeriesEcartees libelles={ecartees} />
      <PointsIgnores n={prep.ignores} />
      {legendeAnnotations && (
        <LegendeAnnotations placees={placees} indisponibles={annotationsIndisponibles} fuseau={fuseau} />
      )}
    </div>
  );
}

// L'ancienne forme, inchangée (retirée par F69).
function BarresAnciennes({ data, xKey, series, height = 260, yUnit = "", showLegend = true }: FormeAncienne) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} fontSize={11} tickLine={false} interval="preserveStartEnd" />
        <YAxis fontSize={11} width={44} tickLine={false} axisLine={false} unit={yUnit} allowDecimals={false} />
        <Tooltip
          formatter={(v: number, name) => [v.toLocaleString("fr-FR"), name]}
          contentStyle={{ fontSize: 12 }}
        />
        {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="a"
            fill={s.color}
            radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined}
            maxBarSize={48}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
