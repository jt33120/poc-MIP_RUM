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
import { libelleReference } from "@/lib/fmt-ids";
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
  /**
   * Variation en % (signe inclus) contre une référence NOMMÉE, écrite à côté du
   * chiffre (P4) ; null = masquée.
   */
  delta?: { pct: number; reference: string; lowerIsBetter?: boolean } | null;
  hint?: ReactNode;
  /** Accent de la valeur : good/warn/poor colore le chiffre (état d'un seuil). */
  tone?: "neutral" | "good" | "warn" | "poor";
}) {
  const toneClass = {
    neutral: "text-ink",
    good: "text-good-ink",
    warn: "text-warn-ink",
    poor: "text-bad-ink",
  }[tone];
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`text-2xl font-bold tabular-nums tracking-tight ${toneClass}`}>{value}</span>
        {delta && <DeltaBadge pct={delta.pct} reference={delta.reference} lowerIsBetter={delta.lowerIsBetter} />}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

/**
 * Badge de variation : flèche, écart, et la référence EN TOUTES LETTRES (« vs 24 h
 * précédentes »), visible — plus seulement dans un `title` qu'aucun écran tactile
 * n'affiche (P4). Sous ±2 %, « → » sans couleur. La couleur suit le sens du
 * meilleur : pour un vital, monter est une dégradation ; pour un volume (« neutre »),
 * ni l'un ni l'autre — la flèche reste sans couleur.
 */
export function DeltaBadge({
  pct,
  reference,
  lowerIsBetter = false,
  sensMeilleur,
}: {
  pct: number;
  /** La période ou la release de référence, avec ou sans son « vs ». */
  reference: string;
  /** Forme historique de `sensMeilleur` (tuiles `HeroStat`). */
  lowerIsBetter?: boolean;
  /** Prime sur `lowerIsBetter` quand il est fourni (`KpiTile`). */
  sensMeilleur?: "bas" | "haut" | "neutre";
}) {
  const sens = sensMeilleur ?? (lowerIsBetter ? "bas" : "haut");
  const arrondi = Math.round(pct);
  // « Stable » se décide sur l'écart AFFICHÉ : 1,5 % s'écrit « +2 % » comme 2,0 %,
  // les deux ont la même couleur.
  const flat = Math.abs(arrondi) < 2;
  const worse = sens === "bas" ? pct > 0 : pct < 0;
  const cls = flat || sens === "neutre" ? "text-ink-soft" : worse ? "text-bad-ink" : "text-good-ink";
  const arrow = flat ? "→" : pct > 0 ? "↑" : "↓";
  const libelle = libelleReference(reference);
  // `title` = la référence, identique au texte visible : les e2e qui repèrent un
  // écart par `[title="vs période précédente"]` (etat-de-vue) le trouvent toujours.
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs" data-testid="delta" title={libelle}>
      <span className={`font-semibold tabular-nums ${cls}`}>
        {arrow} {arrondi > 0 ? "+" : ""}
        {arrondi} %
      </span>
      <span className="min-w-0 break-words text-ink-soft">{libelle}</span>
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
