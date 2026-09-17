// Découpage par dimension (P6.3) — onglets, barres cliquables et tableau
// équivalent. Rendu 100 % serveur, sans JS client, comme RankBar et ObservedTrend.
//
// ACCESSIBILITÉ. Un seul arrêt de tabulation par groupe : la barre EST le lien,
// avec son anneau de focus visible. Les rectangles colorés sont décoratifs
// (`aria-hidden`) ; la lecture non visuelle passe par le libellé du lien, qui
// porte la valeur en toutes lettres, et par le tableau replié « Alternative
// textuelle », qui donne chaque colonne. Aucun chiffre n'est visible dans les
// barres sans être retrouvable dans le tableau.
//
// Le composant est bête : il reçoit des lignes déjà triées, déjà liées et déjà
// formatées. Les décisions (disponibilité d'un onglet, cible d'un lien, libellé
// d'un groupe inconnu) vivent dans lib/breakdowns.ts, où elles sont testées.
import Link from "next/link";
import type { ReactNode } from "react";
import { GlossaryTip } from "@/components/GlossaryTip";
import type { BreakdownTab } from "@/lib/breakdowns";

export interface BreakdownCell {
  label: string;
  value: ReactNode;
  /** Valeur en toutes lettres pour l'alternative textuelle (défaut : `value`). */
  texte?: string;
}

export interface BreakdownItem {
  /** Clé de rendu ; « Inconnu » a la sienne, distincte de toute valeur réelle. */
  key: string;
  label: string;
  /** Longueur de la barre (même unité pour toutes les lignes du découpage). */
  value: number;
  /** Valeur affichée au bout de la barre. */
  display: string;
  /** Drill-down : même plage, mêmes filtres, plus la condition du groupe. */
  href: string;
  /** Libellé complet annoncé par le lien (alternative textuelle de la barre). */
  description: string;
  cells: BreakdownCell[];
}

export function Breakdown({
  title,
  tabs,
  notice,
  items,
  columns,
  groups,
  truncated,
  emptyLabel,
  measureLabel,
}: {
  title: string;
  tabs: BreakdownTab[];
  /** Ce que vaut la dimension choisie (provenance, limites). */
  notice: string;
  items: BreakdownItem[];
  /** En-têtes des colonnes additionnelles, dans l'ordre de `cells`. */
  columns: string[];
  /** Nombre réel de groupes sur la fenêtre. */
  groups: number;
  truncated: boolean;
  emptyLabel: string;
  /** En-tête de la colonne de mesure (« Mesures », « Occurrences »). */
  measureLabel: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  const indisponibles = tabs.filter((tab) => !tab.available && tab.reason);

  return (
    <section className="card mb-6 p-4" data-testid="breakdown">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {title}
          <GlossaryTip id="decoupage" />
        </h2>
      </div>

      <nav aria-label={`Découper ${title.toLowerCase()} par`} className="mb-3 flex flex-wrap gap-1">
        {tabs.map((tab) =>
          tab.available && tab.href ? (
            <Link
              key={tab.dimension}
              href={tab.href}
              scroll={false}
              aria-current={tab.current ? "page" : undefined}
              data-testid={`breakdown-tab-${tab.dimension}`}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
                tab.current
                  ? "border-accent/50 bg-accent/10 text-accent-deep dark:text-accent-soft"
                  : "border-line bg-panel2 text-ink-faint hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
          ) : (
            <span
              key={tab.dimension}
              data-testid={`breakdown-tab-${tab.dimension}`}
              aria-disabled="true"
              title={tab.reason ?? undefined}
              className="cursor-not-allowed rounded-md border border-line/60 bg-panel2/50 px-2.5 py-1 text-xs font-medium text-ink-faint/60 line-through"
            >
              {tab.label}
            </span>
          ),
        )}
      </nav>

      <p className="mb-4 text-xs leading-relaxed text-ink-faint">{notice}</p>

      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-faint">{emptyLabel}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-label={`${item.description} — ouvrir le détail`}
                  data-testid="breakdown-row"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 transition hover:bg-panel2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                >
                  <span className="min-w-0 basis-full truncate font-mono text-xs text-ink sm:basis-44" title={item.label}>
                    {item.label}
                  </span>
                  <span className="relative h-5 min-w-24 flex-1 overflow-hidden rounded bg-panel2">
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 rounded bg-accent/70"
                      style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
                    />
                    <span className="absolute inset-y-0 right-2 flex items-center text-xs font-semibold tabular-nums text-ink">
                      {item.display}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap gap-x-3 text-xs tabular-nums text-ink-soft">
                    {item.cells.map((cell) => (
                      <span key={cell.label}>
                        <span className="text-ink-faint">{cell.label} </span>
                        {cell.value}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <details className="mt-3 text-xs text-ink-soft">
            <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
              Alternative textuelle du découpage
            </summary>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full">
                <caption className="sr-only">
                  {title} — {items.length.toLocaleString("fr-FR")} groupe(s) affiché(s) sur{" "}
                  {groups.toLocaleString("fr-FR")}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="py-1 text-left font-medium">
                      Groupe
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      {measureLabel}
                    </th>
                    {columns.map((column) => (
                      <th key={column} scope="col" className="py-1 text-right font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.key} className="border-t border-line/60">
                      <th scope="row" className="py-1 text-left font-normal">
                        <Link href={item.href} className="text-brand hover:underline">
                          {item.label}
                        </Link>
                      </th>
                      <td className="py-1 text-right tabular-nums">{item.display}</td>
                      {item.cells.map((cell) => (
                        <td key={cell.label} className="py-1 text-right tabular-nums">
                          {cell.texte ?? cell.value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {truncated && (
            <p className="mt-2 text-xs text-ink-faint" data-testid="breakdown-tronque">
              {groups.toLocaleString("fr-FR")} groupe(s) sur la fenêtre — les {items.length.toLocaleString("fr-FR")}{" "}
              plus fournis sont affichés. Les autres ne sont ni repliés dans un groupe « Autres », ni ajoutés :
              additionner des p75 n&apos;a pas de sens.
            </p>
          )}
        </>
      )}

      {indisponibles.length > 0 && (
        <ul className="mt-3 flex flex-col gap-0.5 text-[11px] text-ink-faint">
          {indisponibles.map((tab) => (
            <li key={tab.dimension}>{tab.reason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
