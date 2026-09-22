// Layout de supervision uniforme (chantier dataviz) — chaque page de supervision
// s'ouvre sur le MÊME bandeau : une colonne de contexte (chiffres-clés + lecture
// en une phrase) à gauche, et le GRAPHE PRINCIPAL, dominant, à droite. But :
// qu'on lise l'état de la page « au-dessus du pli » d'un coup d'œil, avant les
// tables de détail. Composant de mise en page pur (SSR) : le graphe et les
// chiffres sont passés en props, la brique n'impose aucune source de données.
import Link from "next/link";
import type { ReactNode } from "react";
import { GlossaryTip } from "./GlossaryTip";
import { ICON_PATHS, Icon } from "./icons";
import { EtatSurface, type Etat } from "./states/EtatSurface";
import { EchecLecture } from "./states/SectionErreur";
import type { GlossaryId } from "@/lib/glossary";

export function SupervisionHero({
  chartTitle,
  chartHelp,
  chartMeta,
  chart,
  state,
  explorer,
  children,
  layout = "split",
}: {
  /** Titre du graphe principal (au-dessus de la zone graphe). */
  chartTitle: ReactNode;
  /** Clé de glossaire : bulle « ? » à côté du titre du graphe. */
  chartHelp?: GlossaryId;
  /** Zone à droite du titre du graphe (toggle, légende, période…). */
  chartMeta?: ReactNode;
  /** Le graphe principal (n'importe quelle représentation : SVG, recharts…). */
  chart?: ReactNode;
  /**
   * État de la zone graphe (F02, § 3.8) : s'il est présent, il est rendu À LA
   * PLACE du graphe — une lecture en échec ne dessine jamais un axe vide, qui se
   * lirait comme une période calme. `erreur` porte son bouton « Réessayer ».
   */
  state?: Etat;
  /** Lien « Ouvrir dans l'Explorer », calculé côté serveur (§ 3.4). */
  explorer?: string;
  /** Colonne de contexte : tuiles HeroStat + une phrase de lecture. */
  children: ReactNode;
  /**
   * "split" (défaut) : contexte à gauche, graphe dominant à droite.
   * "wide" : tuiles de contexte en rangée au-dessus, graphe pleine largeur —
   * pour les graphes larges (Sankey, carte node-link, heatmap calendaire).
   */
  layout?: "split" | "wide";
}) {
  const title = (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {chartTitle}
        {chartHelp && <GlossaryTip id={chartHelp} />}
      </h2>
      {(chartMeta || explorer) && (
        <div className="ml-auto flex items-center gap-2">
          {chartMeta}
          {explorer && (
            <Link
              href={explorer}
              title="Ouvrir dans l'Explorer"
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-panel2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            >
              <Icon paths={ICON_PATHS.compass} className="h-4 w-4" />
              <span className="sr-only">Ouvrir dans l&apos;Explorer</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
  const zone = !state ? (
    chart
  ) : state.kind === "erreur" ? (
    <EchecLecture titre={state.titre} digest={state.digest} />
  ) : (
    <EtatSurface etat={state} />
  );

  if (layout === "wide") {
    return (
      <section className="card mb-6 p-5">
        <div className="mb-4 flex flex-wrap items-start gap-x-8 gap-y-3">{children}</div>
        {title}
        <div className="min-w-0">{zone}</div>
      </section>
    );
  }

  return (
    <section className="card mb-6 overflow-hidden">
      {/* filet de séparation via gap-px sur fond `line` : deux panneaux jointifs */}
      <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <div className="flex flex-col gap-4 bg-panel p-5">{children}</div>
        <div className="flex min-w-0 flex-col bg-panel p-5">
          {title}
          <div className="min-w-0 flex-1">{zone}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * Tuile chiffre-clé harmonisée pour la colonne de contexte du hero. Un intitulé,
 * une valeur, et — optionnels — une tendance vs période précédente et une ligne
 * de sous-texte. Remplace les variantes Stat/Kpi/AiKpi éparpillées dans les pages
 * pour un rendu identique partout.
 */
export function HeroStat({
  label,
  value,
  delta,
  hint,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  /** Variation vs période précédente en % (signe inclus) ; null = masquée. */
  delta?: { pct: number; lowerIsBetter?: boolean } | null;
  hint?: ReactNode;
  /** Accent de la valeur : good/warn/poor colore le chiffre (état d'un seuil). */
  tone?: "neutral" | "good" | "warn" | "poor";
}) {
  const toneClass = {
    neutral: "text-ink",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    poor: "text-red-600 dark:text-red-400",
  }[tone];
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums tracking-tight ${toneClass}`}>{value}</span>
        {delta && <DeltaBadge pct={delta.pct} lowerIsBetter={delta.lowerIsBetter} />}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

/** Badge de variation coloré (vert = amélioration, rouge = dégradation). */
export function DeltaBadge({ pct, lowerIsBetter = false }: { pct: number; lowerIsBetter?: boolean }) {
  const flat = Math.abs(pct) < 2;
  const worse = lowerIsBetter ? pct > 0 : pct < 0;
  const cls = flat
    ? "text-ink-faint"
    : worse
      ? "text-red-600 dark:text-red-400"
      : "text-emerald-600 dark:text-emerald-400";
  const arrow = flat ? "→" : pct > 0 ? "↑" : "↓";
  return (
    <span className={`text-xs font-semibold tabular-nums ${cls}`} title="vs période précédente">
      {arrow} {pct > 0 ? "+" : ""}
      {pct.toFixed(0)} %
    </span>
  );
}

/** Phrase de « lecture » du hero : ce qu'il faut retenir, en clair. `basis-full`
 * -> ligne pleine dans la rangée du layout "wide", bas de colonne en "split". */
export function HeroReading({ children }: { children: ReactNode }) {
  return (
    <p className="mt-auto basis-full border-t border-line pt-3 text-xs leading-relaxed text-ink-soft">
      {children}
    </p>
  );
}
