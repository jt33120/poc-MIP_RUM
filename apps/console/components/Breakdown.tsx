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
// d'un groupe inconnu) vivent dans lib/breakdowns.ts, le classement dans
// lib/impact.ts (F05), où elles sont testées.
//
// F05 (plan § 4.1, P3) : bascule de tri « gravité / volume » (le classement est fait
// par l'appelant, la bascule n'est qu'un lien), colonne « écart à l'ensemble »,
// marque « échantillon faible », et `onglets` qui remplace la liste par défaut (un
// écran peut proposer une dimension hors `BREAKDOWN_DIMENSIONS`, comme le capteur
// de `/sessions`). `BasculeTri` et `OngletsDecoupage` servent aussi `ImpactTable`.
import Link from "next/link";
import type { ReactNode } from "react";
import type { BreakdownTab } from "@/lib/breakdowns";
import { SEUIL_ECHANTILLON_FAIBLE } from "@/lib/impact";

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
  /**
   * Longueur de la barre (même unité pour toutes les lignes du découpage). `null` :
   * valeur inconnue — AUCUNE barre, jamais une barre à zéro qui se lirait « le meilleur ».
   */
  value: number | null;
  /** Valeur affichée au bout de la barre. */
  display: string;
  /** Drill-down : même plage, mêmes filtres, plus la condition du groupe. */
  href: string;
  /** Libellé complet annoncé par le lien (alternative textuelle de la barre). */
  description: string;
  cells: BreakdownCell[];
  /** Écart à la référence « Ensemble », déjà formaté (« +1,2 s ») ; `null` : non calculable. */
  ecart?: string | null;
  /** Effectif sous le seuil (lib/impact.ts) : rangé en fin, marqué. */
  echantillonFaible?: boolean;
}

/** Un onglet de découpage ; la dimension peut sortir de `BREAKDOWN_DIMENSIONS` (capteur…). */
export type OngletDecoupage = Omit<BreakdownTab, "dimension"> & { dimension: string };

/** Un ordre proposé par une bascule de tri ; `href: null` = indisponible, avec sa raison. */
export interface OptionTri {
  id: string;
  libelle: string;
  href: string | null;
  raison?: string;
}

/**
 * Bascule de tri : des LIENS (l'ordre vit dans l'URL, `tri=`), l'ordre courant marqué
 * `aria-current`. Un ordre indisponible reste visible, barré, avec sa raison en
 * `title` ET en texte lu (un `title` seul n'est pas annoncé partout).
 */
export function BasculeTri({ courant, options }: { courant: string; options: OptionTri[] }) {
  return (
    <div role="group" aria-label="Ordre du classement" className="flex flex-wrap items-center gap-1 text-xs" data-testid="bascule-tri">
      <span className="mr-1 text-ink-soft">Classer par</span>
      {options.map((o) =>
        o.id === courant ? (
          <span
            key={o.id}
            aria-current="true"
            data-testid={`tri-${o.id}`}
            className="rounded-md border border-accent/50 bg-accent/10 px-2 py-0.5 font-medium text-accent-ink"
          >
            {o.libelle}
          </span>
        ) : o.href ? (
          <Link
            key={o.id}
            href={o.href}
            scroll={false}
            data-testid={`tri-${o.id}`}
            className="rounded-md border border-line bg-panel2 px-2 py-0.5 font-medium text-ink-soft transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
          >
            {o.libelle}
          </Link>
        ) : (
          <span
            key={o.id}
            aria-disabled="true"
            title={o.raison}
            data-testid={`tri-${o.id}`}
            className="cursor-not-allowed rounded-md border border-line/60 px-2 py-0.5 font-medium text-ink-soft line-through"
          >
            {o.libelle}
            {o.raison && <span className="sr-only"> — indisponible : {o.raison}</span>}
          </span>
        ),
      )}
    </div>
  );
}

/** Onglets de dimension : lien si disponible, barré avec sa raison sinon. */
export function OngletsDecoupage({ titre, onglets }: { titre: string; onglets: OngletDecoupage[] }) {
  return (
    <nav aria-label={`Découper ${titre.toLowerCase()} par`} className="mb-3 flex flex-wrap gap-1">
      {onglets.map((tab) =>
        tab.available && tab.href ? (
          <Link
            key={tab.dimension}
            href={tab.href}
            scroll={false}
            aria-current={tab.current ? "page" : undefined}
            data-testid={`breakdown-tab-${tab.dimension}`}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
              tab.current
                ? "border-accent/50 bg-accent/10 text-accent-ink"
                : "border-line bg-panel2 text-ink-soft hover:text-ink"
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
            className="cursor-not-allowed rounded-md border border-line/60 bg-panel2/50 px-2.5 py-1 text-xs font-medium text-ink-soft line-through"
          >
            {tab.label}
          </span>
        ),
      )}
    </nav>
  );
}

/** Marque d'un échantillon faible (P3) : texte, jamais une couleur seule. */
export function MarqueFaible() {
  return (
    <span className="rounded border border-line bg-panel2 px-1 py-px text-[10px] font-medium text-ink-soft">
      échantillon faible
    </span>
  );
}

export type TriDecoupage = "gravite" | "volume";

export const LIBELLES_TRI: Record<string, string> = {
  gravite: "Gravité",
  volume: "Volume",
  impact: "Impact",
};

export function Breakdown({
  title,
  tabs,
  onglets,
  notice,
  items,
  columns,
  groups,
  truncated,
  emptyLabel,
  measureLabel,
  tri,
  triHref,
  avertissement,
  reference,
  ecartLibelle = "Écart à l'ensemble",
}: {
  title: string;
  /** Onglets par défaut (`breakdownTabs`). */
  tabs: BreakdownTab[];
  /** Remplace `tabs` : une liste propre à l'écran (dimension hors registre comprise). */
  onglets?: OngletDecoupage[];
  /** Ce que vaut la dimension choisie (provenance, limites). */
  notice: string;
  items: BreakdownItem[];
  /** En-têtes des colonnes additionnelles, dans l'ordre de `cells`. */
  columns: string[];
  /** Nombre réel de groupes sur la fenêtre. */
  groups: number;
  truncated: boolean;
  emptyLabel: string;
  /** En-tête de la colonne de la barre (« Mesures », « Occurrences », « LCP p75 »). */
  measureLabel: string;
  /** Ordre des lignes (P3), déjà appliqué par l'appelant ; absent : pas de bascule. */
  tri?: TriDecoupage;
  /** Liens de la bascule ; `null` = ordre indisponible. Requis avec `tri`. */
  triHref?: Record<TriDecoupage, string | null>;
  /** Réglage d'affichage ignoré (`tri` illisible…), dit en `role="note"`. */
  avertissement?: string | null;
  /** Référence de l'écart, en toutes lettres (« Ensemble : LCP p75 2,4 s, 5 608 mesures »). */
  reference?: string | null;
  /** En-tête de la colonne d'écart. */
  ecartLibelle?: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value ?? 0));
  const liste = onglets ?? tabs;
  const indisponibles = liste.filter((tab) => !tab.available && tab.reason);
  const avecEcart = items.some((item) => item.ecart !== undefined);
  const faibles = items.filter((item) => item.echantillonFaible).length;

  return (
    <section className="card mb-6 p-4" data-testid="breakdown" data-tri={tri}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{title}</h2>
        {tri && triHref && (
          <div className="sm:ml-auto">
            <BasculeTri
              courant={tri}
              options={(["gravite", "volume"] as const).map((id) => ({ id, libelle: LIBELLES_TRI[id], href: triHref[id] }))}
            />
          </div>
        )}
      </div>

      {avertissement && (
        <p role="note" className="mb-3 text-xs text-ink-soft" data-testid="breakdown-avertissement">
          {avertissement}
        </p>
      )}

      <OngletsDecoupage titre={title} onglets={liste} />

      <p className="mb-4 text-xs leading-relaxed text-ink-soft">{notice}</p>
      {tri === "gravite" && (
        <p className="-mt-2 mb-4 text-xs leading-relaxed text-ink-soft" data-testid="breakdown-regle-tri">
          Du plus dégradé au moins dégradé ; un groupe de moins de {SEUIL_ECHANTILLON_FAIBLE} mesures est rangé en fin,
          marqué « échantillon faible », quelle que soit sa valeur.
        </p>
      )}
      {reference && (
        <p className="-mt-2 mb-4 text-xs text-ink-soft" data-testid="breakdown-reference">
          {reference}
        </p>
      )}

      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-soft">{emptyLabel}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-label={`${item.description}${item.echantillonFaible ? ", échantillon faible" : ""} — ouvrir le détail`}
                  data-testid="breakdown-row"
                  data-faible={item.echantillonFaible ? "1" : undefined}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 transition hover:bg-panel2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                >
                  <span className="min-w-0 basis-full truncate font-mono text-xs text-ink sm:basis-44" title={item.label}>
                    {item.label}
                  </span>
                  <span className="relative h-5 min-w-24 flex-1 overflow-hidden rounded bg-panel2">
                    {item.value !== null && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 rounded bg-accent/70"
                        style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
                      />
                    )}
                    <span className="absolute inset-y-0 right-2 flex items-center text-xs font-semibold tabular-nums text-ink">
                      {item.display}
                    </span>
                  </span>
                  <span className="flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums text-ink-soft sm:basis-auto sm:shrink-0">
                    {item.cells.map((cell) => (
                      <span key={cell.label}>
                        <span className="text-ink-soft">{cell.label} </span>
                        {cell.value}
                      </span>
                    ))}
                    {item.ecart !== undefined && (
                      <span data-testid="breakdown-ecart">
                        <span className="text-ink-soft">écart </span>
                        {item.ecart ?? "—"}
                      </span>
                    )}
                    {item.echantillonFaible && <MarqueFaible />}
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
                  {tri ? `, classés par ${LIBELLES_TRI[tri].toLowerCase()}` : ""}
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
                    {avecEcart && (
                      <th scope="col" className="py-1 text-right font-medium">
                        {ecartLibelle}
                      </th>
                    )}
                    {faibles > 0 && (
                      <th scope="col" className="py-1 text-right font-medium">
                        Échantillon
                      </th>
                    )}
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
                      {avecEcart && <td className="py-1 text-right tabular-nums">{item.ecart ?? "—"}</td>}
                      {faibles > 0 && <td className="py-1 text-right">{item.echantillonFaible ? "faible" : ""}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {truncated && (
            <p className="mt-2 text-xs text-ink-soft" data-testid="breakdown-tronque">
              {groups.toLocaleString("fr-FR")} groupe(s) sur la fenêtre — les {items.length.toLocaleString("fr-FR")}{" "}
              plus fournis sont affichés{tri === "gravite" ? ", classés par gravité" : ""}. Les autres ne sont ni
              repliés dans un groupe « Autres », ni ajoutés : additionner des p75 n&apos;a pas de sens.
            </p>
          )}
        </>
      )}

      {indisponibles.length > 0 && (
        <ul className="mt-3 flex flex-col gap-0.5 text-[11px] text-ink-soft">
          {indisponibles.map((tab) => (
            <li key={tab.dimension}>{tab.reason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
