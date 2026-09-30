"use client";
// ThresholdSeries — la série temporelle de la console (F04, plan § 3.10, § 4.2).
// Client (recharts) : survol, zoom au clic, liens d'annotation ; et, depuis la vague 2
// de la refonte du monitoring (spec A2 § 5.4) : réticule partagé par toute la page,
// pinceau (glisser = plage de la page) et légende chiffrée et cliquable
// (`InteractionsSeries.tsx`).
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
//   - le MANQUE se voit : un seau couvert par une fenêtre hors collecte
//     (`fenetresCollecte`, registre `collecte_fenetre`) est hachuré en gris et dit
//     « non mesuré » — jamais un 0 mesuré pendant une panne ;
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
  Rectangle,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type RectangleProps,
} from "recharts";
import { largeurTexte, rangerEtiquettes } from "@/lib/etiquettes";
import { formater, formatDuVital, type FormatId, type VitalName } from "@/lib/fmt-ids";
import { accord, fmtHeure, fmtInstant, fmtJour } from "@/lib/format";
import { FUSEAU_AFFICHAGE, nomFuseau } from "@/lib/fuseau-local";
import { etiquettesGraduations } from "@/lib/graduations";
import { SYNCHRO_PAGE } from "@/lib/interactions-series";
import { styleDeRole } from "@/lib/palette";
import { RATING_LABEL, rating2026 } from "@/lib/rating";
import {
  FAIBLE_SOUS_DEFAUT,
  MAX_SERIES,
  SERIE_MARGES,
  bandesSeuils,
  bordsDeGrille,
  collecteDesSeaux,
  echelleY,
  estJour,
  fenetresDeLaGrille,
  formaterAxe,
  graduationsTemps,
  hrefZoom,
  jourDans,
  libellePeriodeEnCours,
  libellePremiereTranchePartielle,
  libelleSeau,
  libelleSeauComplet,
  nombreOuNull,
  phrasePeuDePoints,
  placerAnnotations,
  portionDeBarre,
  preparerPoints,
  premiereDonneeTardive,
  rognerBarre,
  tranchesMesurees,
  regrouperAnnotations,
  suitesDeSeaux,
  texteFenetreCollecte,
  type Annotation,
  type AnnotationPlacee,
  type BordsGrille,
  type CollecteSeau,
  type FenetreCollecte,
  type LignePreparee,
  type PointSerie,
  type SerieDef,
} from "@/lib/series";
import {
  BoutonLegende,
  InfobulleCourte,
  Reticule,
  ValeurLegende,
  classeAspect,
  publierInstant,
  useEtatLegende,
  usePinceau,
  useSurvol,
  useSynchronisation,
} from "./InteractionsSeries";

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
/**
 * Opacité des bandes en thème clair. En sombre, la classe `bande-seuil` la relève
 * (app/globals.css) : à 8 %, « À améliorer » se confondait avec le fond nuit.
 */
const OPACITE_BANDE = 0.08;
const TRAIT_ANNOTATION = "rgb(var(--c-ink-soft))";
const FOND_POINT_CREUX = "rgb(var(--c-panel))";
/** Au-delà, les points ne sont plus dessinés un par un (seuls les points isolés et creux le restent). */
const POINTS_VISIBLES_JUSQUA = 48;
/** Hauteur (px) sous laquelle une bande de seuil ne porte pas son nom : il déborderait sur la voisine. */
const BANDE_NOMMEE_DES = 14;
/** Hauteur de l'axe x et des marges basses, retirée de `hauteur` pour estimer la zone de tracé. */
const HORS_TRACE = 30;
/** Deux annotations plus proches que cela (px) partagent une étiquette. */
const ECART_ANNOTATIONS = 28;
const POLICE_ANNOTATION = 10;

/** Marge haute du tracé : une rangée d'étiquettes d'annotation, deux dès qu'il peut y avoir chevauchement. */
export function margeHauteAnnotations(n: number): number {
  if (n === 0) return 8;
  return n === 1 ? 20 : 32;
}

/**
 * Graduations x et y d'une figure temporelle, et le formateur d'étiquettes y :
 * une seule unité, des pas ronds (`lib/graduations.ts`). La recherche par valeur
 * (et non par rang) tient même si recharts saute une graduation.
 */
export function formateurGraduations(valeurs: number[], format: FormatId): (v: number) => string {
  const etiquettes = etiquettesGraduations(valeurs, format);
  const parValeur = new Map(valeurs.map((v, i) => [v, etiquettes[i]]));
  return (v: number) => parValeur.get(v) ?? formaterAxe(format, v);
}

/**
 * Motif « période en cours » d'une barre : la couleur PLEINE de la série, rayée du
 * fond. À 55 % d'opacité, la barre devenait bleu nuit ou violet foncé sur le fond
 * sombre pendant que sa pastille de légende restait vive : on ne reliait plus l'une à
 * l'autre (recette du 26/09/2026). La teinte reste donc celle de la légende ; seules
 * les rayures disent « incomplète ».
 */
export function MotifEnCours({ id, couleur }: { id: string; couleur: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
      <rect width={6} height={6} fill={couleur} />
      <line x1={0} y1={0} x2={0} y2={6} stroke="rgb(var(--c-panel))" strokeOpacity={0.55} strokeWidth={2} />
    </pattern>
  );
}

/**
 * Motif « non mesuré » (collecte interrompue) : hachures GRISES, dans l'autre sens
 * que celles du seau en cours (colorées) — un manque de collecte ne doit pas se
 * lire comme une période incomplète d'une série.
 */
export function MotifHorsCollecte({ id }: { id: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={7} height={7} patternTransform="rotate(-45)">
      <line x1={0} y1={0} x2={0} y2={7} stroke="rgb(var(--c-ink-faint))" strokeOpacity={0.7} strokeWidth={2} />
    </pattern>
  );
}

/** Pastille de légende « non mesuré » : le même motif que la zone. */
export function PaveHorsCollecte({ id }: { id: string }) {
  return (
    <svg width={12} height={10} aria-hidden="true" className="shrink-0">
      <rect x={0.5} y={0.5} width={11} height={9} rx={2} fill={`url(#${id})`} stroke="rgb(var(--c-ink-faint))" />
    </svg>
  );
}

/**
 * La collecte de chaque seau, calculée APRÈS le montage (comme le seau en cours) :
 * avant, `maintenant` est inconnu et le seau en cours n'est pas coupé à l'instant.
 */
export function useCollecteDesSeaux(
  grille: string[],
  seauSecondes: number,
  fuseau: string,
  fenetres: readonly FenetreCollecte[] | undefined,
  maintenant: number | null,
): { collecte: CollecteSeau[]; fenetres: FenetreCollecte[] } {
  return useMemo(() => {
    if (!fenetres || fenetres.length === 0) return { collecte: [], fenetres: [] };
    return {
      collecte: collecteDesSeaux(grille, seauSecondes, fenetres, { fuseau, maintenant: maintenant ?? Number.POSITIVE_INFINITY }),
      fenetres: fenetresDeLaGrille(fenetres, grille, seauSecondes, fuseau),
    };
  }, [grille, seauSecondes, fuseau, fenetres, maintenant]);
}

/** Zones pleine hauteur d'une suite de seaux hors collecte : hachurées (interrompue), voilées (partielle). */
export function zonesHorsCollecte(grille: string[], collecte: readonly CollecteSeau[], motif: string) {
  return [
    ...suitesDeSeaux(collecte, "partielle").map(([a, b]) => (
      <ReferenceArea
        key={`partielle-${a}`}
        x1={grille[a]}
        x2={grille[b]}
        className="zone-collecte-partielle"
        fill="rgb(var(--c-ink-faint))"
        fillOpacity={0.08}
        stroke="rgb(var(--c-ink-faint))"
        strokeOpacity={0.5}
        strokeDasharray="2 3"
        ifOverflow="hidden"
      />
    )),
    ...suitesDeSeaux(collecte, "interrompue").map(([a, b]) => (
      <ReferenceArea
        key={`interrompue-${a}`}
        x1={grille[a]}
        x2={grille[b]}
        className="zone-hors-collecte"
        fill={`url(#${motif})`}
        fillOpacity={1}
        stroke="none"
        ifOverflow="hidden"
      />
    )),
  ];
}

/** Sous la légende : chaque fenêtre de la plage, datée (« Collecte interrompue du … au … (heure de Paris) »). */
export function NoteHorsCollecte({ fenetres, fuseau }: { fenetres: readonly FenetreCollecte[]; fuseau: string }) {
  if (fenetres.length === 0) return null;
  return (
    <ul className="mt-1 text-xs text-ink-soft" data-testid="note-hors-collecte">
      {fenetres.slice(0, 3).map((f) => (
        <li key={`${f.debut}-${f.etat}`}>{texteFenetreCollecte(f, fuseau)}</li>
      ))}
      {fenetres.length > 3 && <li>et {fenetres.length - 3} autres périodes hors collecte</li>}
    </ul>
  );
}

/** Pastille de légende de la barre en cours : le même motif que la barre. */
export function PaveEnCours({ id }: { id: string }) {
  return (
    <svg width={12} height={10} aria-hidden="true" className="shrink-0">
      <rect x={0.5} y={0.5} width={11} height={9} rx={2} fill={`url(#${id})`} stroke="rgb(var(--c-ink-soft))" />
    </svg>
  );
}

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

/**
 * Les seaux du bord (`bordsDeGrille`) : premier seau que la plage ne couvre qu'en
 * partie, dernier seau encore en cours. Lu après le montage, comme le seau en cours.
 */
export function useBordsDeGrille(
  grille: string[],
  seauSecondes: number,
  fuseau: string,
  debutPlage: string | undefined,
  maintenant: number | null,
): BordsGrille {
  return useMemo(
    () => bordsDeGrille(grille, seauSecondes, { debutPlage, maintenant, fuseau }),
    [grille, seauSecondes, fuseau, debutPlage, maintenant],
  );
}

/**
 * Forme de barre (`shape` et `activeBar` de recharts) qui ne dessine que la portion
 * RÉELLE des seaux du bord : le premier seau partiel garde sa fin, le seau en cours
 * s'arrête à « maintenant ». Pleine largeur, la barre en cours promettait une heure
 * qui n'a pas eu lieu, et le premier seau paraissait un creux de trafic.
 */
export function formeBarreAuxBords(bords: BordsGrille, n: number) {
  function BarreAuxBords(brut: unknown) {
    const props = (brut ?? {}) as RectangleProps & { index?: unknown };
    const x = typeof props.x === "number" ? props.x : Number.NaN;
    const largeur = typeof props.width === "number" ? props.width : Number.NaN;
    const index = typeof props.index === "number" ? props.index : -1;
    const portion = portionDeBarre(index, n, bords);
    if (!portion || !Number.isFinite(x) || !Number.isFinite(largeur) || largeur <= 0) return <Rectangle {...props} />;
    const r = rognerBarre(x, largeur, portion);
    return <Rectangle {...props} x={r.x} width={r.largeur} />;
  }
  return BarreAuxBords;
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
 *
 * ANTI-COLLISION (recette du 26/09/2026). Les annotations à moins de
 * `ECART_ANNOTATIONS` px les unes des autres partagent UNE étiquette (« 3 alertes à
 * 14:14 », `regrouperAnnotations`) ; chaque trait reste à son instant. Les
 * étiquettes qui se chevauchent encore passent sur une seconde rangée ; celle qui
 * ne trouve pas de place n'est pas écrite — son triangle garde l'infobulle, et la
 * légende sous la figure liste chaque annotation.
 */
export function CoucheAnnotations({
  placees,
  grille,
  fuseau,
  onAller,
  ...etat
}: EtatGraphique & { placees: AnnotationPlacee[]; grille: string[]; fuseau: string; onAller: (href: string) => void }) {
  const axe = etat.xAxisMap ? Object.values(etat.xAxisMap)[0] : undefined;
  const offset = etat.offset;
  if (!axe?.scale || !offset || placees.length === 0) return null;
  const largeurSeau = axe.scale.bandwidth?.() ?? 0;
  const milieu = offset.left + offset.width / 2;
  const haut = offset.top;
  const bas = offset.top + offset.height;
  const positions = placees.flatMap(({ annotation, index, fraction }) => {
    const x0 = axe.scale!(grille[index]);
    if (x0 === undefined || !Number.isFinite(x0)) return [];
    return [{ annotation, x: x0 + fraction * largeurSeau }];
  });
  const groupes = regrouperAnnotations(positions, { ecart: ECART_ANNOTATIONS, fuseau });
  const gaucheCadre = offset.left - SERIE_MARGES.gauche;
  const droiteCadre = offset.left + offset.width + SERIE_MARGES.droite;
  // Étendue de chaque étiquette : à droite du trait dans la moitié gauche, à gauche au-delà.
  const etendues = groupes.map((g) => {
    const largeur = largeurTexte(g.libelle, POLICE_ANNOTATION);
    const aDroite = g.x > milieu;
    const debut = aDroite ? Math.max(gaucheCadre, g.x - 6 - largeur) : g.x + 6;
    return { debut, fin: Math.min(droiteCadre, debut + largeur), aDroite };
  });
  const rangees = rangerEtiquettes(etendues, placees.length > 1 ? 2 : 1);
  return (
    <g className="couche-annotations" data-testid="annotations">
      {groupes.map((g, k) => {
        const { aDroite } = etendues[k];
        const rangee = rangees[k];
        const titre = g.annotations.map((a) => a.libelle).join(" · ");
        const dessin = (
          <>
            {g.xs.map((x, i) => (
              <line key={i} x1={x} x2={x} y1={haut} y2={bas} stroke={TRAIT_ANNOTATION} strokeWidth={1} strokeDasharray="3 2" />
            ))}
            <path d={`M ${g.x - 4} ${haut - 7} L ${g.x + 4} ${haut - 7} L ${g.x} ${haut - 1} Z`} fill={TRAIT_ANNOTATION} />
            {rangee >= 0 && (
              <text
                x={aDroite ? g.x - 6 : g.x + 6}
                y={haut - 2 - rangee * 12}
                textAnchor={aDroite ? "end" : "start"}
                fontSize={POLICE_ANNOTATION}
                fill={TRAIT_ANNOTATION}
                data-rangee={rangee}
              >
                {g.libelle}
              </text>
            )}
          </>
        );
        const cle = `${g.annotations[0].t}-${k}`;
        if (!g.href) {
          return (
            <g key={cle} data-groupe={g.annotations.length}>
              <title>{titre}</title>
              {dessin}
            </g>
          );
        }
        const href = g.href;
        return (
          <a
            key={cle}
            href={href}
            aria-hidden="true"
            tabIndex={-1}
            className="cursor-pointer"
            data-groupe={g.annotations.length}
            onClick={(e: MouseEvent) => {
              // Le clic ne doit pas AUSSI zoomer sur le seau qui est dessous.
              e.preventDefault();
              e.stopPropagation();
              onAller(href);
            }}
          >
            <title>{titre}</title>
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
  const n = libelles.length;
  return (
    <p className="mt-1 text-xs text-ink-soft" data-testid="series-non-tracees">
      {n} {accord(n, "série")} non {accord(n, "tracée")} (au plus {MAX_SERIES} par graphique) : {libelles.join(", ")}.
    </p>
  );
}

/** Points reçus hors de la grille : un appelant mal aligné se voit. */
export function PointsIgnores({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <p className="mt-1 text-xs text-ink-soft" data-testid="points-hors-grille">
      {n.toLocaleString("fr-FR")} {accord(n, "point")} hors des tranches du graphique, non {accord(n, "tracé")}.
    </p>
  );
}

/**
 * La collecte vient de commencer : seuls les deux derniers seaux portent des
 * données (`premiereDonneeTardive`). Sur 24 h, la figure n'a alors qu'une barre au
 * bout de 23 heures vides, « vide en pratique » (recette du 26/09/2026) : une ligne
 * au-dessus du dessin dit depuis quand les données arrivent. Le dessin reste (la
 * barre en cours est lisible, l'infobulle et l'alternative donnent les valeurs).
 *
 * `debutCollecte` (instant ISO donné par l'appelant) permet d'écrire « Collecte
 * commencée » ; à défaut, seul le début du premier seau non vide est connu, et la
 * phrase dit « Premières données » — une application sans trafic la nuit n'a pas
 * « commencé sa collecte » à 8 h.
 */
export function NoteCollecteRecente({
  grille,
  premier,
  seauSecondes,
  debutCollecte,
}: {
  grille: string[];
  premier: number;
  seauSecondes: number;
  debutCollecte?: string;
}) {
  const t = debutCollecte ?? grille[premier];
  const fuseau = nomFuseau(FUSEAU_AFFICHAGE);
  let quand: string;
  if (estJour(t)) quand = `le ${t.slice(8, 10)}/${t.slice(5, 7)}`;
  else if (seauSecondes >= 86_400) quand = debutCollecte ? `le ${fmtInstant(t)} (${fuseau})` : `le ${fmtJour(t)}`;
  else if (grille.length * seauSecondes <= 86_400) quand = `à ${fmtHeure(t)} (${fuseau})`;
  else quand = `le ${fmtInstant(t)} (${fuseau})`;
  return (
    <p className="mb-1 text-xs text-ink-soft" data-testid="collecte-recente">
      <span className="font-medium text-ink">
        {debutCollecte ? "Collecte commencée" : "Premières données"} {quand}
      </span>{" "}
      : trop peu de recul pour lire une évolution sur la période.
    </p>
  );
}

/**
 * Moins de trois tranches mesurées sur toute la grille : un ou deux points ne
 * dessinent pas une évolution, et l'axe vide autour ne dit rien de lui-même
 * (recette du 26/09/2026 : un seul point à 92 ms, 23 h d'axe vides sans message).
 */
export function NotePeuDePoints({ n, seauSecondes, jours }: { n: number; seauSecondes: number; jours: boolean }) {
  return (
    <p className="mb-1 text-xs text-ink-soft" data-testid="peu-de-points">
      <span className="font-medium text-ink">{phrasePeuDePoints(n, seauSecondes, jours)}</span>
      {"\u00a0"}: trop peu de points pour lire une évolution.
    </p>
  );
}

/** Pastille et libellé d'une série ; le libellé passe à la ligne, jamais tronqué (texte entier en infobulle). */
function EntreeLegende({ s }: { s: SerieTracee }) {
  return (
    <>
      {s.forme === "barres" ? <PaveLegende couleur={s.couleur} opacite={0.85} /> : <TraitLegende couleur={s.couleur} pointille={s.pointille} />}
      <span className="min-w-0 break-words" title={s.libelleComplet ?? s.libelle}>
        {s.libelle}
      </span>
    </>
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
  premierPartiel,
  liens,
  collecte,
  survole = true,
}: {
  active?: boolean;
  label?: string;
  payload?: { payload?: LignePreparee }[];
  /** Faux sur un graphique synchronisé que la souris ne survole pas : infobulle courte. */
  survole?: boolean;
  /** État de collecte par seau, indexé par `t`. */
  collecte?: ReadonlyMap<string, CollecteSeau>;
  series: SerieTracee[];
  format: FormatId;
  vital?: VitalName;
  bande?: { basseCle: string; hauteCle: string; libelle: string };
  seauSecondes: number;
  fuseau: string;
  dernierEnCours: boolean;
  dernier: string | undefined;
  /** Le premier seau et son libellé, quand la plage n'en couvre qu'une partie. */
  premierPartiel?: { t: string; libelle: string } | null;
  liens?: Record<string, LienSeau>;
}) {
  const ligne = payload?.[0]?.payload;
  if (!active || !ligne || label === undefined) return null;
  if (!survole) {
    const premiere = series[0];
    return (
      <InfobulleCourte
        heure={libelleSeau(label, seauSecondes, fuseau)}
        valeur={premiere ? formater(format, nombreOuNull(ligne[premiere.cle])) : "—"}
      />
    );
  }
  return (
    <div className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-ink shadow-sm">
      <p className="mb-1 font-medium">{liens?.[label]?.libelle ?? libelleSeauComplet(label, seauSecondes, fuseau)}</p>
      <LigneCollecte etat={collecte?.get(label) ?? null} vide={series.every((s) => nombreOuNull(ligne[s.cle]) === null)} />
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
      {dernierEnCours && label === dernier && (
        <p className="text-ink-soft">{libellePeriodeEnCours(seauSecondes, estJour(label))}</p>
      )}
      {premierPartiel && label === premierPartiel.t && <p className="text-ink-soft">{premierPartiel.libelle}</p>}
    </div>
  );
}

/**
 * L'infobulle d'un seau hors collecte : « Aucune donnée reçue — collecte
 * interrompue » n'est pas « 0 — collecte en service ».
 */
export function LigneCollecte({ etat, vide }: { etat: CollecteSeau; vide: boolean }) {
  if (etat === null) return null;
  if (etat === "interrompue" && vide) {
    return (
      <p className="text-ink-soft" data-infobulle-collecte="interrompue">
        Aucune donnée reçue — collecte interrompue
      </p>
    );
  }
  return (
    <p className="text-ink-soft" data-infobulle-collecte="partielle">
      Collecte partielle sur cette tranche
    </p>
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
  episodes,
  annotations,
  annotationsIndisponibles,
  seauSecondes,
  fuseau,
  zoomHref,
  hauteur = 220,
  ariaLabel,
  legendeAnnotations = true,
  liensSeaux,
  debutCollecte,
  noteCollecte = true,
  fenetresCollecte,
  debutPlage,
  apercu = false,
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
  /**
   * Épisodes hors de la plage habituelle (A2 § 6.1), en bornes de la grille : une
   * colonne `signal` à 10 % derrière la série — jamais du rouge, réservé au seuil
   * web.dev franchi (A2 § 8.5). Ajout de la vague 3b.
   */
  episodes?: readonly { x1: string; x2: string; enCours: boolean }[];
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
  /**
   * Ajout F04, SANS EFFET depuis la vague 2 (spec A2 § 5.4) : toutes les séries de la
   * page partagent le réticule (`SYNCHRO_PAGE`), synchronisées par instant et non plus
   * par rang. Gardé pour les appelants existants.
   */
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
  /**
   * Instant ISO du début de la collecte, s'il est connu : quand seuls les deux
   * derniers seaux ont des données, la figure écrit au-dessus du dessin « Collecte
   * commencée à 14:02 (heure de Paris) » : une barre seule au bout de 24 h vides ne
   * dit rien d'elle-même. À défaut, le début du premier seau non vide (« Premières
   * données à 14:00 »).
   */
  debutCollecte?: string;
  /**
   * Défaut true. Panneaux empilés : un seul panneau porte la note « Collecte
   * commencée… » et les fenêtres hors collecte datées (les hachures, elles, sont sur
   * chaque panneau).
   */
  noteCollecte?: boolean;
  /**
   * Fenêtres hors collecte de la plage (chargeur `chargeurs/collecte.ts`) : un seau
   * entièrement couvert par une fenêtre `interrompue` est « non mesuré » (hachuré,
   * valeur `null` même pour un compte), un seau recoupé est voilé. Ajout du 29/09/2026.
   */
  fenetresCollecte?: readonly FenetreCollecte[];
  /**
   * Début de la plage (ISO UTC, `query.range.from`) : le premier seau de la grille
   * commence AVANT lui, et n'en couvre qu'une partie. Il est alors marqué (point
   * creux, barre réduite à sa part, légende). Absent : le premier seau est entier.
   */
  debutPlage?: string;
  /**
   * Vignette (recette du 30/09/2026) : la courbe et ses axes, sans légende ni notes.
   * La vignette s'ouvre en grand (`FicheMesure`) ; c'est là que la légende complète,
   * chiffrée et cliquable, se lit.
   */
  apercu?: boolean;
}) {
  const router = useRouter();
  const motifs = useIdSvg("en-cours");
  const motifHorsCollecte = useIdSvg("hors-collecte");
  const { enCours, maintenant } = useSeauEnCours(grille, seauSecondes, fuseau);
  const bords = useBordsDeGrille(grille, seauSecondes, fuseau, debutPlage, maintenant);
  const { collecte, fenetres: fenetresVisibles } = useCollecteDesSeaux(grille, seauSecondes, fuseau, fenetresCollecte, maintenant);
  const collecteParSeau = useMemo(() => new Map(grille.map((t, i) => [t, collecte[i] ?? null])), [grille, collecte]);
  const { tracees, ecartees } = useMemo(() => tracerSeries(series), [series]);
  const legende = useEtatLegende();
  const { survole, entrer, sortir } = useSurvol();
  const synchroniser = useSynchronisation(grille, seauSecondes, fuseau);
  const pinceau = usePinceau({ grille, seauSecondes, gabarit: zoomHref });
  // Les séries masquées (Alt-clic) sortent de l'échelle : on masque une série pour
  // lire les autres, pas pour garder l'axe qu'elle imposait.
  const visibles = useMemo(() => {
    const v = tracees.filter((s) => legende.aspect(s.cle) !== "masquee");
    return v.length > 0 ? v : tracees;
  }, [tracees, legende]);
  const prep = useMemo(
    () => preparerPoints(grille, points, tracees, { faibleSous, seauEnCours: enCours, premierPartiel: bords.premierPartiel !== null, collecte }),
    [grille, points, tracees, faibleSous, enCours, bords.premierPartiel, collecte],
  );
  const formeBarre = useMemo(() => formeBarreAuxBords(bords, grille.length), [bords, grille.length]);
  const premierPartiel =
    bords.premierPartiel !== null && debutPlage && grille[0] !== undefined
      ? { t: grille[0], libelle: libellePremiereTranchePartielle(debutPlage, seauSecondes, fuseau) }
      : null;
  const aDesBarres = tracees.some((s) => s.forme === "barres");
  // Une bande de verdict derrière des barres de comptes n'aurait pas de sens : un
  // compte n'a pas de seuil (R-S). Le plan l'interdit ; on ne la dessine pas.
  const vitalEffectif = aDesBarres ? undefined : vital;
  const echelle = useMemo(
    () => echelleY(prep.lignes, visibles, format, { vital: vitalEffectif, bande }),
    [prep.lignes, visibles, format, vitalEffectif, bande],
  );
  const haut = echelle.haut;
  const etiquetteY = useMemo(() => formateurGraduations(echelle.valeurs, format), [echelle.valeurs, format]);
  const graduationsX = useMemo(() => graduationsTemps(grille, seauSecondes, fuseau), [grille, seauSecondes, fuseau]);
  const bandes = vitalEffectif ? bandesSeuils(vitalEffectif, haut) : null;
  const premier = useMemo(
    () => premiereDonneeTardive(prep.lignes, tracees.map((s) => s.cle)),
    [prep.lignes, tracees],
  );
  // Seules les MESURES comptent : un compte absent vaut 0 (une vraie valeur), une
  // mesure absente est un trou. Une série de comptes n'a jamais « trop peu de points ».
  const mesurees = useMemo(
    () => tranchesMesurees(prep.lignes, tracees.filter((s) => !s.additive).map((s) => s.cle)),
    [prep.lignes, tracees],
  );
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
  const indexEnCours = enCours ? grille.length - 1 : -1;
  const periodeEnCours = libellePeriodeEnCours(seauSecondes, estJour(dernier ?? ""));
  const margeHaut = margeHauteAnnotations(placees.length);
  // Le nom d'une bande n'est écrit que si elle a la hauteur d'une ligne de texte :
  // « À améliorer » et « Mauvais » se superposaient sur une bande de 6 px.
  const hauteurTrace = Math.max(hauteur - margeHaut - HORS_TRACE, 1);
  const nomBande = (y1: number, y2: number, value: string, fill: string) =>
    ((y2 - y1) / haut) * hauteurTrace >= BANDE_NOMMEE_DES
      ? // En haut à GAUCHE de la bande : la dernière mesure (à droite, souvent
        // près de 0) ne recouvre plus « Bon », ni une annotation récente « À améliorer ».
        { value, position: "insideTopLeft" as const, fontSize: 10, fill }
      : undefined;
  const barres = tracees.map((s, i) => ({ s, id: `${motifs}-${i}` })).filter(({ s }) => s.forme === "barres");

  return (
    <div
      className="min-w-0"
      data-testid="threshold-series"
      data-vital={vitalEffectif}
      data-seaux={grille.length}
      data-collecte-recente={premier !== null ? "" : undefined}
      data-apercu={apercu ? "" : undefined}
    >
      {premier !== null && noteCollecte && (
        <NoteCollecteRecente grille={grille} premier={premier} seauSecondes={seauSecondes} debutCollecte={debutCollecte} />
      )}
      {premier === null && noteCollecte && mesurees > 0 && mesurees < 3 && grille.length >= 3 && (
        <NotePeuDePoints n={mesurees} seauSecondes={seauSecondes} jours={estJour(dernier ?? "")} />
      )}
      {(barres.length > 0 || collecte.length > 0) && (
        <svg width={0} height={0} aria-hidden="true" className="absolute">
          <defs>
            {barres.map(({ s, id }) => (
              <MotifEnCours key={id} id={id} couleur={s.couleur} />
            ))}
            {collecte.length > 0 && <MotifHorsCollecte id={motifHorsCollecte} />}
          </defs>
        </svg>
      )}
      <div
        role="img"
        aria-label={ariaLabel}
        className={`select-none ${zoomHref || liensSeaux ? "cursor-pointer" : ""}`}
        data-synchro={SYNCHRO_PAGE}
        data-pinceau={pinceau.actif ? "" : undefined}
        onMouseEnter={entrer}
        onMouseLeave={sortir}
      >
        <ResponsiveContainer width="100%" height={hauteur}>
          <ComposedChart
            data={donnees}
            syncId={SYNCHRO_PAGE}
            syncMethod={synchroniser}
            margin={{ top: margeHaut, right: SERIE_MARGES.droite, bottom: 0, left: 0 }}
            onMouseDown={pinceau.debuter}
            onMouseMove={(etat) => {
              publierInstant(typeof etat?.activeLabel === "string" ? etat.activeLabel : null);
              pinceau.etendre(etat);
            }}
            onClick={(etat) => {
              // Le clic qui termine un pinceau (appliqué ou annulé par Échap) ne zoome pas.
              if (pinceau.clicAbsorbe()) return;
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
                className="bande-seuil bande-bon"
                fill={BANDE.bon.fond}
                fillOpacity={OPACITE_BANDE}
                stroke="none"
                ifOverflow="hidden"
                label={nomBande(bandes.bon.y1, bandes.bon.y2, RATING_LABEL.good, BANDE.bon.texte)}
              />
            )}
            {bandes?.ameliorer && (
              <ReferenceArea
                y1={bandes.ameliorer.y1}
                y2={bandes.ameliorer.y2}
                className="bande-seuil bande-ameliorer"
                fill={BANDE.ameliorer.fond}
                fillOpacity={OPACITE_BANDE}
                stroke="none"
                ifOverflow="hidden"
                label={nomBande(bandes.ameliorer.y1, bandes.ameliorer.y2, RATING_LABEL["needs-improvement"], BANDE.ameliorer.texte)}
              />
            )}
            {bandes?.mauvais && (
              <ReferenceArea
                y1={bandes.mauvais.y1}
                y2={bandes.mauvais.y2}
                className="bande-seuil bande-mauvais"
                fill={BANDE.mauvais.fond}
                fillOpacity={OPACITE_BANDE}
                stroke="none"
                ifOverflow="hidden"
                label={nomBande(bandes.mauvais.y1, bandes.mauvais.y2, RATING_LABEL.poor, BANDE.mauvais.texte)}
              />
            )}
            {zonesHorsCollecte(grille, collecte, motifHorsCollecte)}
            <XAxis
              dataKey="t"
              fontSize={11}
              tickLine={false}
              ticks={graduationsX}
              // Un nombre CONSTANT de graduations sauté quand la place manque : le pas
              // reste régulier (« preserveStartEnd » gardait la dernière et bouchait).
              interval="equidistantPreserveStart"
              minTickGap={12}
              tickFormatter={(t: string) => libelleSeau(t, seauSecondes, fuseau)}
            />
            <YAxis
              type="number"
              domain={[0, haut]}
              ticks={echelle.valeurs}
              interval={0}
              allowDataOverflow
              width={SERIE_MARGES.gauche}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={etiquetteY}
            />
            {pinceau.trace && (
              <ReferenceArea
                x1={pinceau.trace.debut}
                x2={pinceau.trace.fin}
                className="zone-pinceau"
                fill="rgb(var(--c-brand))"
                fillOpacity={0.12}
                stroke="rgb(var(--c-brand))"
                strokeOpacity={0.6}
                ifOverflow="hidden"
              />
            )}
            <Tooltip
              isAnimationActive={false}
              cursor={<Reticule />}
              content={
                <Infobulle
                  survole={survole}
                  series={visibles}
                  format={format}
                  vital={vitalEffectif}
                  bande={bande}
                  seauSecondes={seauSecondes}
                  fuseau={fuseau}
                  dernierEnCours={enCours}
                  dernier={dernier}
                  premierPartiel={premierPartiel}
                  liens={liensSeaux}
                  collecte={collecteParSeau}
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
            {episodes?.map((e) => (
              <ReferenceArea
                key={`${e.x1}-${e.x2}`}
                x1={e.x1}
                x2={e.x2}
                fill="rgb(var(--c-signal))"
                fillOpacity={0.1}
                stroke="rgb(var(--c-signal))"
                strokeOpacity={0.35}
                strokeDasharray={e.enCours ? "3 3" : undefined}
                ifOverflow="hidden"
                data-testid="episode-plage"
              />
            ))}
            {/* Aucune série en barres : une barre CACHÉE met l'axe x en bandes, comme
                celui de StackedBars — deux panneaux empilés tombent alors sur les
                mêmes x (sinon recharts pose les points aux bords, les barres au milieu). */}
            {!aDesBarres && <Bar dataKey="__bandes" hide isAnimationActive={false} legendType="none" />}
            {tracees.map((s, rang) =>
              s.forme === "barres" ? (
                <Bar
                  key={s.cle}
                  dataKey={s.cle}
                  name={s.libelle}
                  fill={s.couleur}
                  maxBarSize={32}
                  shape={formeBarre}
                  activeBar={formeBarre}
                  isAnimationActive={false}
                  hide={legende.aspect(s.cle) === "masquee"}
                  className={classeAspect(legende.aspect(s.cle))}
                >
                  {prep.lignes.map((_l, i) =>
                    i === indexEnCours ? (
                      // La barre en cours est PLEINE et hachurée, cernée de sa couleur :
                      // pâle et en pointillés, elle passait pour un espace réservé (et
                      // se fondait dans le fond nuit en thème sombre).
                      <Cell key={i} fill={`url(#${motifs}-${rang})`} fillOpacity={1} stroke={s.couleur} strokeWidth={1} data-en-cours="" />
                    ) : (
                      <Cell
                        key={i}
                        fillOpacity={prep.creux[s.cle]?.includes(i) ? 0.4 : 0.85}
                        stroke={prep.creux[s.cle]?.includes(i) ? s.couleur : undefined}
                        strokeDasharray={prep.creux[s.cle]?.includes(i) ? "3 2" : undefined}
                      />
                    ),
                  )}
                </Bar>
              ) : (
                <Line
                  key={s.cle}
                  type="monotone"
                  dataKey={s.cle}
                  name={s.libelle}
                  hide={legende.aspect(s.cle) === "masquee"}
                  className={classeAspect(legende.aspect(s.cle))}
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
            <Customized component={<CoucheAnnotations placees={placees} grille={grille} fuseau={fuseau} onAller={aller} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {!apercu && (
      <>
      {/* Recette du 30/09/2026 : une légende sur une ligne, en petit. Les séries et les
          seuils gardent leur texte ; les repères secondaires (effectif faible, tranche en
          cours, début partiel, collecte interrompue) s'écrivent court, le libellé complet
          au survol et pour les lecteurs d'écran. */}
      <ul className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-soft" data-testid="legende-serie">
        {tracees.map((s) => (
          <li key={s.cle} className="flex min-w-0 items-center gap-1.5" data-serie={s.cle}>
            {/* Légende chiffrée et cliquable (spec A2 § 5.4) : clic = isoler, Alt-clic =
                masquer ; la valeur suit le seau survolé sur n'importe quel graphique de
                la page, sinon la dernière connue. Une seule série : rien à isoler. */}
            {tracees.length > 1 ? (
              <BoutonLegende cle={s.cle} libelle={s.libelle} aspect={legende.aspect(s.cle)} onBasculer={legende.basculer}>
                <EntreeLegende s={s} />
              </BoutonLegende>
            ) : (
              <EntreeLegende s={s} />
            )}
            <ValeurLegende lignes={prep.lignes} cle={s.cle} grille={grille} seauSecondes={seauSecondes} fuseau={fuseau} format={format} />
          </li>
        ))}
        {bande && (
          <li className="flex items-center gap-1.5" data-testid="legende-bande">
            <PaveLegende couleur="rgb(var(--c-ink-faint))" />
            {bande.libelle}
          </li>
        )}
        {episodes && episodes.length > 0 && (
          <li className="flex min-w-0 items-center gap-1.5" data-testid="legende-episodes" title="hors plage habituelle (détecté par calcul)">
            <PaveLegende couleur="rgb(var(--c-signal))" opacite={0.25} />
            <span aria-hidden>hors plage</span>
            <span className="sr-only">hors plage habituelle (détecté par calcul)</span>
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
          <li className="flex items-center gap-1.5" data-testid="legende-faible-effectif" title={`moins de ${faibleSous} mesures`}>
            <PointCreuxLegende />
            <span aria-hidden>&lt; {faibleSous} mes.</span>
            <span className="sr-only">moins de {faibleSous} mesures</span>
          </li>
        )}
        {enCours && (
          <li className="flex items-center gap-1.5" data-testid="legende-seau-en-cours" title={periodeEnCours}>
            {barres.length > 0 ? <PaveEnCours id={barres[0].id} /> : <PointCreuxLegende />}
            <span aria-hidden>en cours</span>
            <span className="sr-only">{periodeEnCours}</span>
          </li>
        )}
        {premierPartiel && (
          <li className="flex min-w-0 items-center gap-1.5" data-testid="legende-premier-partiel" title={premierPartiel.libelle}>
            <PointCreuxLegende />
            <span aria-hidden>début partiel</span>
            <span className="sr-only">{premierPartiel.libelle}</span>
          </li>
        )}
        {prep.horsCollecte.length > 0 && (
          <li className="flex items-center gap-1.5" data-testid="legende-hors-collecte" title="non mesuré (collecte interrompue)">
            <PaveHorsCollecte id={motifHorsCollecte} />
            <span aria-hidden>non mesuré</span>
            <span className="sr-only">non mesuré (collecte interrompue)</span>
          </li>
        )}
      </ul>
      {noteCollecte && <NoteHorsCollecte fenetres={fenetresVisibles} fuseau={fuseau} />}
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
      </>
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
