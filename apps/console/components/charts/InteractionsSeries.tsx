"use client";
// Les gestes communs aux séries temporelles (`ThresholdSeries`, `StackedBars`) —
// refonte monitoring, vague 2 (spec A2 § 5.4). La logique pure est dans
// `lib/interactions-series.ts` ; ici, ce qui a besoin du navigateur :
//
//   - l'INSTANT SURVOLÉ, partagé par toute la page : le graphique survolé le publie,
//     chaque légende le lit pour afficher la valeur de ses séries au même instant. Un
//     magasin externe (`useSyncExternalStore`) plutôt qu'un contexte : seules les
//     légendes s'abonnent, les graphiques recharts ne se redessinent pas à chaque
//     déplacement de la souris ;
//   - le RÉTICULE : trait vertical (séries) ou bande du seau (barres), absent quand
//     l'instant tombe hors de la grille du graphique ;
//   - le PINCEAU : glisser sur au moins deux seaux, relâcher = toute la page passe sur
//     la plage (gabarit de zoom de l'écran) ; Échap annule ; désactivé au tactile
//     (§ 5.5 : le sélecteur de plage suffit) ;
//   - l'ENTRÉE DE LÉGENDE : bouton `aria-pressed` (isolée), Alt-clic masque, clavier
//     Entrée / Espace (Alt compris).
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { formater, type FormatId } from "@/lib/fmt-ids";
import {
  LEGENDE_INITIALE,
  PINCEAU_MIN_SEAUX,
  PINCEAU_REPOS,
  aspectSerie,
  basculerLegende,
  gestePinceau,
  hrefPlage,
  indexSeauContenant,
  valeurLegende,
  type AspectSerie,
  type EtatLegende,
  type EtatPinceau,
  type GestePinceau,
} from "@/lib/interactions-series";
import { estJour, type LignePreparee } from "@/lib/series";

// ─────────────────────────────── Instant survolé ───────────────────────────────

let instantSurvole: string | null = null;
const abonnes = new Set<() => void>();

/** Publie le début du seau survolé (ou `null` en sortant) ; sans effet s'il n'a pas changé. */
export function publierInstant(instant: string | null): void {
  if (instant === instantSurvole) return;
  instantSurvole = instant;
  for (const f of abonnes) f();
}

function sAbonner(f: () => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

/** L'instant survolé sur la page (début de seau ISO ou jour), `null` hors survol. */
export function useInstantSurvole(): string | null {
  return useSyncExternalStore(
    sAbonner,
    () => instantSurvole,
    () => null,
  );
}

/**
 * La fonction de synchronisation recharts (`syncMethod`) d'un graphique : l'instant
 * publié par le graphique survolé (`activeLabel`) est ramené au seau qui le contient
 * ICI. Recharts appelle aussi cette fonction sur le graphique émetteur : elle y rend
 * son propre seau.
 */
export function useSynchronisation(grille: readonly string[], seauSecondes: number, fuseau: string) {
  return useCallback(
    (ticks: ReadonlyArray<{ value?: unknown }>, etat: { activeLabel?: unknown }) => {
      const i = indexSeauContenant(grille, seauSecondes, fuseau, etat.activeLabel);
      if (i < 0) return -1;
      const cible = grille[i];
      return ticks.findIndex((t) => t.value === cible);
    },
    [grille, seauSecondes, fuseau],
  );
}

// ─────────────────────────────── Réticule ───────────────────────────────

/**
 * Curseur recharts (`<Tooltip cursor={<Reticule />}>`). Recharts lui passe `points`
 * (graphique composé : trait vertical) ou un rectangle (graphique en barres : le
 * seau), et `payloadIndex` : -1 quand l'instant d'un autre graphique tombe hors de
 * cette grille — on ne dessine alors rien, plutôt qu'un trait au bord.
 */
export function Reticule(props: {
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payloadIndex?: number;
}) {
  if (props.payloadIndex === undefined || props.payloadIndex < 0) return null;
  if (props.points && props.points.length >= 2) {
    const [a, b] = props.points;
    if (![a.x, a.y, b.y].every(Number.isFinite)) return null;
    return (
      <line
        x1={a.x}
        x2={b.x}
        y1={a.y}
        y2={b.y}
        stroke="rgb(var(--c-ink-soft))"
        strokeWidth={1}
        strokeDasharray="3 2"
        pointerEvents="none"
        className="reticule"
      />
    );
  }
  const { x, y, width, height } = props;
  if (x === undefined || y === undefined || width === undefined || height === undefined) return null;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill="rgb(var(--c-ink-faint))"
      fillOpacity={0.12}
      pointerEvents="none"
      className="reticule"
    />
  );
}

/**
 * Survol de CE graphique : l'infobulle complète n'apparaît que sur le graphique
 * survolé ; les autres, synchronisés, montrent le réticule, le point actif et une
 * valeur courte (spec A2 § 5.4).
 */
export function useSurvol() {
  const [survole, setSurvole] = useState(false);
  const entrer = useCallback(() => setSurvole(true), []);
  const sortir = useCallback(() => {
    setSurvole(false);
    publierInstant(null);
  }, []);
  return { survole, entrer, sortir };
}

/** Infobulle courte d'un graphique synchronisé (pas survolé) : l'heure et une valeur. */
export function InfobulleCourte({ heure, valeur }: { heure: string; valeur: string }) {
  return (
    <div className="rounded border border-line bg-panel/90 px-1.5 py-0.5 text-[11px] tabular-nums text-ink-soft shadow-sm" data-infobulle="courte">
      {heure} · <span className="text-ink">{valeur}</span>
    </div>
  );
}

// ─────────────────────────────── Pinceau ───────────────────────────────

/** Pointeur précis (souris, pavé) : le pinceau n'existe pas au tactile (§ 5.5). */
function usePointeurFin(): boolean {
  return useSyncExternalStore(
    (f) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia("(pointer: fine)");
      mq.addEventListener?.("change", f);
      return () => mq.removeEventListener?.("change", f);
    },
    () => (typeof window !== "undefined" && !!window.matchMedia ? window.matchMedia("(pointer: fine)").matches : false),
    () => false,
  );
}

/**
 * Le pinceau d'un graphique. `gabarit` : le gabarit de zoom de l'écran ({from} {to},
 * `gabaritZoom`) — sans lui, pas de pinceau (l'écran ne sait pas changer de plage).
 * Le clic simple (un seul seau) reste le zoom au clic : `clicAbsorbe()` dit au
 * gestionnaire de clic d'ignorer le clic qui suit un pinceau appliqué ou annulé. La
 * machine à états est `gestePinceau` (lib/interactions-series.ts).
 */
export function usePinceau({
  grille,
  seauSecondes,
  gabarit,
}: {
  grille: readonly string[];
  seauSecondes: number;
  gabarit: string | undefined;
}) {
  const router = useRouter();
  const pointeurFin = usePointeurFin();
  const actif = pointeurFin && !!gabarit && grille.length >= PINCEAU_MIN_SEAUX && !estJour(grille[0] ?? "");
  // L'état vit hors du rendu (les écouteurs de fenêtre le lisent à jour) ; la zone
  // est recopiée dans l'état React pour être dessinée.
  const etatRef = useRef<EtatPinceau>(PINCEAU_REPOS);
  const [zone, setZone] = useState<EtatPinceau["zone"]>(null);
  const appliquer = useCallback(
    (geste: GestePinceau) => {
      const { etat, plage } = gestePinceau(etatRef.current, geste, grille, seauSecondes);
      etatRef.current = etat;
      setZone(etat.zone);
      return plage;
    },
    [grille, seauSecondes],
  );
  useEffect(() => {
    if (!actif) return;
    // Écouteurs posés dès que le pinceau existe, pas à la pression : un clic rapide
    // (pression et relâchement dans la même trame) ne doit pas laisser une zone
    // ouverte qui suivrait ensuite la souris. Sans zone, ils ne font rien.
    // Relâché n'importe où (même hors du graphique) : on applique ce qui est tracé.
    const relacher = () => {
      if (!etatRef.current.zone) return;
      const plage = appliquer({ type: "relacher", maintenant: Date.now() });
      if (plage && gabarit) router.push(hrefPlage(gabarit, plage));
    };
    const echap = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") appliquer({ type: "echap" });
    };
    window.addEventListener("mouseup", relacher);
    window.addEventListener("keydown", echap);
    return () => {
      window.removeEventListener("mouseup", relacher);
      window.removeEventListener("keydown", echap);
    };
  }, [actif, gabarit, router, appliquer]);

  const debuter = useCallback(
    (etat: { activeLabel?: unknown } | null | undefined) => {
      if (actif && typeof etat?.activeLabel === "string") appliquer({ type: "presser", seau: etat.activeLabel });
      // Un nouveau geste : l'absorption d'un geste précédent (relâché hors du graphique) tombe.
      else etatRef.current = PINCEAU_REPOS;
    },
    [actif, appliquer],
  );
  const etendre = useCallback(
    (etat: { activeLabel?: unknown } | null | undefined) => {
      if (etatRef.current.zone && typeof etat?.activeLabel === "string") appliquer({ type: "glisser", seau: etat.activeLabel });
    },
    [appliquer],
  );
  const clicAbsorbe = useCallback(() => {
    const oui = etatRef.current.absorbe;
    etatRef.current = { ...etatRef.current, absorbe: false };
    return oui;
  }, []);
  // Une zone d'un seul seau est un clic en préparation : rien à dessiner.
  const trace = zone && zone.debut !== zone.fin ? zone : null;
  return { actif, trace, debuter, etendre, clicAbsorbe };
}

// ─────────────────────────────── Légende ───────────────────────────────

export function useEtatLegende() {
  const [etat, setEtat] = useState<EtatLegende>(LEGENDE_INITIALE);
  const basculer = useCallback((cle: string, masquer: boolean) => setEtat((e) => basculerLegende(e, cle, masquer)), []);
  const aspect = useCallback((cle: string): AspectSerie => aspectSerie(etat, cle), [etat]);
  return { etat, basculer, aspect };
}

/** Classe d'opacité d'une série estompée (35 %, `OPACITE_ESTOMPEE`). */
export function classeAspect(aspect: AspectSerie): string | undefined {
  return aspect === "estompee" ? "opacity-35 transition-opacity" : undefined;
}

/**
 * Entrée de légende cliquable : bouton à bascule (`aria-pressed` = série isolée).
 * Entrée / Espace isolent, Alt + Entrée / Espace masquent — géré au clavier plutôt
 * que laissé au clic synthétique, dont `altKey` n'est pas fiable d'un navigateur à
 * l'autre.
 */
export function BoutonLegende({
  cle,
  libelle,
  aspect,
  onBasculer,
  children,
}: {
  cle: string;
  libelle: string;
  aspect: AspectSerie;
  onBasculer: (cle: string, masquer: boolean) => void;
  children: ReactNode;
}) {
  const masquee = aspect === "masquee";
  return (
    <button
      type="button"
      aria-pressed={aspect === "isolee"}
      aria-label={`Isoler ${libelle}${masquee ? " (masquée)" : ""}`}
      title="Clic : isoler cette série (second clic : tout rétablir) · Alt-clic : la masquer"
      data-serie={cle}
      data-aspect={aspect}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        // Un clic produit par le clavier (detail = 0) a déjà été traité par onKeyDown.
        if (e.detail === 0) return;
        onBasculer(cle, e.altKey);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onBasculer(cle, e.altKey);
      }}
      className={`flex min-w-0 items-center gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
        aspect === "estompee" ? "opacity-50" : ""
      } ${masquee ? "line-through opacity-50" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * La valeur d'une série dans sa légende : au seau survolé (même sur un autre
 * graphique de la page), sinon la dernière connue. Composant à part : lui seul
 * s'abonne à l'instant survolé.
 */
export function ValeurLegende({
  lignes,
  cle,
  grille,
  seauSecondes,
  fuseau,
  format,
}: {
  lignes: readonly LignePreparee[];
  cle: string;
  grille: readonly string[];
  seauSecondes: number;
  fuseau: string;
  format: FormatId;
}) {
  const instant = useInstantSurvole();
  const index = useMemo(
    () => (instant === null ? null : indexSeauContenant(grille, seauSecondes, fuseau, instant)),
    [instant, grille, seauSecondes, fuseau],
  );
  // Survol hors de cette grille : on garde la dernière valeur plutôt qu'un « — ».
  const { valeur } = valeurLegende(lignes, cle, index !== null && index >= 0 ? index : null);
  return (
    <span className="shrink-0 tabular-nums text-ink" data-testid="legende-valeur" data-survol={index !== null && index >= 0 ? "" : undefined}>
      {formater(format, valeur)}
    </span>
  );
}
