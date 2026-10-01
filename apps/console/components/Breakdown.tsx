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
//
// BARRES COMPARABLES (recette du 26/09/2026) : chaque ligne est une grille aux
// colonnes FIXES (libellé, piste, valeur, détails). La piste était en `flex-1`, sa
// largeur dépendait du texte des colonnes voisines, et une barre plus longue ne
// voulait plus dire une valeur plus grande.
//
// PAS DE PHRASE AU-DESSUS DES BARRES (recette du 01/10/2026) : la notice et la précision
// passent dans la bulle du titre, la règle d'ordre, la référence et la troncature dans
// « Méthode », sous la liste — repliées, jamais retirées.
import Link from "next/link";
import type { ReactNode } from "react";
import { InfoTip } from "@/components/InfoTip";
import { TableDefilante } from "@/components/TableDefilante";
import type { BreakdownTab } from "@/lib/breakdowns";
import { accord } from "@/lib/format";
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
 * `aria-current`. Un ordre indisponible reste visible, GRISÉ (bordure pointillée,
 * texte pâle) avec sa raison en `title` ET en texte lu (un `title` seul n'est pas
 * annoncé partout). Jamais barré : la recette du 26/09/2026 a lu « Impact » barré
 * comme une option supprimée, pas comme une option à venir.
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
            className="cursor-help rounded-md border border-dashed border-line px-2 py-0.5 font-medium text-ink-faint"
          >
            {o.libelle}
            {o.raison && <span className="sr-only"> — indisponible : {o.raison}</span>}
          </span>
        ),
      )}
    </div>
  );
}

/**
 * Onglets de dimension : lien si disponible, grisé avec sa raison en infobulle sinon
 * (jamais barré). `className` remplace la marge par défaut (`mb-3`) : posés dans la
 * rangée d'un titre, ils n'en veulent pas. `compacts` : pastilles de la hauteur des
 * autres commandes de la rangée (bascule de tri), au lieu de boutons de 28 px.
 */
export function OngletsDecoupage({
  titre,
  onglets,
  className = "mb-3",
  compacts = false,
}: {
  titre: string;
  onglets: OngletDecoupage[];
  className?: string;
  compacts?: boolean;
}) {
  // Compacts : UNE ligne, 11 px, qui défile de côté quand les six dimensions ne tiennent
  // pas (recette du 01/10/2026 : deux lignes d'onglets, 48 px, avant la première barre
  // d'une carte de 4 colonnes sur /errors).
  const taille = compacts ? "shrink-0 whitespace-nowrap px-1.5 py-px text-[11px]" : "px-2.5 py-1 text-xs";
  const rangee = compacts ? "flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:thin]" : "flex-wrap";
  return (
    <nav aria-label={`Découper ${titre.toLowerCase()} par`} className={`flex gap-1 ${rangee} ${className}`}>
      {onglets.map((tab) =>
        tab.available && tab.href ? (
          <Link
            key={tab.dimension}
            href={tab.href}
            scroll={false}
            aria-current={tab.current ? "page" : undefined}
            data-testid={`breakdown-tab-${tab.dimension}`}
            className={`rounded-md border ${taille} font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
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
            className={`cursor-help rounded-md border border-dashed border-line bg-panel2/50 ${taille} font-medium text-ink-faint`}
          >
            {tab.label}
            {/* Le `title` seul n'est pas annoncé partout : la raison est aussi lue. */}
            {tab.reason && <span className="sr-only"> — indisponible : {tab.reason}</span>}
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
  precision,
  pleineHauteur = false,
}: {
  title: string;
  /** Onglets par défaut (`breakdownTabs`). */
  tabs: BreakdownTab[];
  /** Remplace `tabs` : une liste propre à l'écran (dimension hors registre comprise). */
  onglets?: OngletDecoupage[];
  /**
   * Ce que vaut la dimension choisie (provenance, limites) : dans la bulle « ? » à côté
   * du titre, jamais en paragraphe au-dessus des barres (recette du 01/10/2026 : quatre
   * lignes de texte sur /errors avant la première barre).
   */
  notice?: string | null;
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
  /**
   * Ce que l'écran doit dire de la dimension EN PLUS de sa notice, chiffré pour
   * la population affichée (la part des pays tirés de l'adresse IP sous « Pays
   * estimé »). Dans la même bulle que la notice, et dans « Méthode ».
   */
  precision?: string | null;
  /**
   * La carte prend toute la hauteur de sa cellule (rangée de grille) : son bord bas
   * s'aligne sur celui de la figure voisine, sans marge sous elle.
   */
  pleineHauteur?: boolean;
}) {
  // Base 100 % : la plus grande valeur (plus « au moins 1 », qui écrasait les parts et les CLS).
  const max = Math.max(0, ...items.map((item) => item.value ?? 0)) || 1;
  const liste = onglets ?? tabs;
  const indisponibles = liste.filter((tab) => !tab.available && tab.reason);
  const avecEcart = items.some((item) => item.ecart !== undefined);
  const faibles = items.filter((item) => item.echantillonFaible).length;
  const bulle = [notice?.trim(), precision?.trim()].filter(Boolean) as string[];
  const avecMethode = bulle.length > 0 || tri === "gravite" || Boolean(reference) || (truncated && items.length > 0) || indisponibles.length > 0;

  return (
    <section className={`card p-4 ${pleineHauteur ? "h-full" : "mb-6"}`} data-testid="breakdown" data-tri={tri}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
          <span className="min-w-0">{title}</span>
          {bulle.length > 0 && (
            <InfoTip label={`Ce que vaut ce découpage : ${title}`} align="start">
              {bulle.map((phrase) => (
                <span key={phrase} className="mb-1 block last:mb-0">
                  {phrase}
                </span>
              ))}
            </InfoTip>
          )}
        </h2>
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
        <p role="note" className="mb-2 text-xs text-ink-soft" data-testid="breakdown-avertissement">
          {avertissement}
        </p>
      )}

      <OngletsDecoupage titre={title} onglets={liste} className="mb-2" compacts />

      {items.length === 0 ? (
        <p className="flex items-center gap-1.5 py-1 text-xs text-ink-soft">
          <span aria-hidden="true" className="text-ink-faint">
            ⊘
          </span>
          {emptyLabel}
        </p>
      ) : (
        <>
          {/* Conteneur de requêtes : les colonnes suivent la largeur de la liste (voir la ligne). */}
          <ul className="flex flex-col [container-type:inline-size]">
            {items.map((item) => (
              <li key={item.key}>
                {/* Colonnes BORNÉES (minmax), pas fixes (contre-recette du 26/09/2026) : les
                    bornes sont des longueurs, jamais le contenu — toutes les lignes gardent la
                    même piste, les barres restent comparables. Choisies par la largeur de la
                    LISTE (`@container`), pas de la fenêtre.
                    ÉTROITE (une carte de 4 colonnes, 390 px) : deux lignes de 36 px au lieu de
                    trois (recette du 01/10/2026) — libellé, détails et valeur sur la première,
                    la barre fine sur toute la largeur dessous. */}
                <Link
                  href={item.href}
                  aria-label={`${item.description}${item.echantillonFaible ? ", échantillon faible" : ""} — ouvrir le détail`}
                  data-testid="breakdown-row"
                  data-faible={item.echantillonFaible ? "1" : undefined}
                  className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-x-2 gap-y-1 rounded-md px-2 py-1 transition hover:bg-panel2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf [@container_(min-width:32rem)_and_(max-width:47.99rem)]:grid-cols-[minmax(6rem,10rem)_minmax(6rem,12rem)_4.5rem_minmax(7rem,1fr)] [@container_(min-width:48rem)]:grid-cols-[minmax(7rem,12rem)_minmax(7rem,16rem)_4.5rem_minmax(7rem,1fr)]"
                >
                  <span className="min-w-0 truncate font-mono text-xs text-ink" title={item.label}>
                    {item.label}
                  </span>
                  <span className="relative col-span-3 row-start-2 h-1.5 min-w-0 overflow-hidden rounded-full bg-panel2 [@container_(min-width:32rem)]:col-span-1 [@container_(min-width:32rem)]:col-start-2 [@container_(min-width:32rem)]:row-start-1 [@container_(min-width:32rem)]:h-3">
                    {item.value !== null && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 rounded-full bg-accent/70"
                        style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
                      />
                    )}
                  </span>
                  {/* La valeur à côté de la piste, pas dessus : elle ne cache plus le bout de la barre. */}
                  <span className="col-start-3 row-start-1 text-right text-xs font-semibold tabular-nums text-ink">
                    {item.display}
                  </span>
                  <span className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-x-2 whitespace-nowrap text-[11px] tabular-nums text-ink-soft [@container_(min-width:32rem)]:col-start-4 [@container_(min-width:32rem)]:justify-start [@container_(min-width:32rem)]:text-xs">
                    {item.cells.map((cell) => (
                      <span key={cell.label}>
                        <span className="text-ink-faint">{cell.label} </span>
                        {cell.value}
                      </span>
                    ))}
                    {item.ecart !== undefined && (
                      <span data-testid="breakdown-ecart">
                        <span className="text-ink-faint">écart </span>
                        {item.ecart ?? "—"}
                      </span>
                    )}
                    {item.echantillonFaible && <MarqueFaible />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Le pied, sur une ligne fermée : la méthode (provenance, règle d'ordre, référence,
          troncature, dimensions indisponibles) puis l'alternative textuelle. Ce sont des
          VÉRITÉS : elles se replient, elles ne disparaissent pas. */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-ink-soft [&>details[open]]:basis-full">
        {avecMethode && (
          <details className="min-w-0" data-testid="breakdown-methode">
            <summary className="cursor-pointer select-none font-medium hover:text-ink">Méthode</summary>
            <div className="mt-1 space-y-1 text-[11px] leading-relaxed">
              {notice?.trim() && <p>{notice}</p>}
              {precision && (
                <p className="text-ink" data-testid="breakdown-precision">
                  {precision}
                </p>
              )}
              {tri === "gravite" && (
                <p data-testid="breakdown-regle-tri">
                  Du plus dégradé au moins dégradé ; un groupe de moins de {SEUIL_ECHANTILLON_FAIBLE} mesures est rangé en fin,
                  marqué « échantillon faible », quelle que soit sa valeur.
                </p>
              )}
              {reference && <p data-testid="breakdown-reference">{reference}</p>}
              {truncated && items.length > 0 && (
                <p data-testid="breakdown-tronque">
                  {groups.toLocaleString("fr-FR")} {accord(groups, "groupe")} sur la fenêtre — les {items.length.toLocaleString("fr-FR")}{" "}
                  plus fournis sont affichés{tri === "gravite" ? ", classés par gravité" : ""}. Les autres ne sont ni
                  repliés dans un groupe « Autres », ni ajoutés : additionner des p75 n&apos;a pas de sens.
                </p>
              )}
              {indisponibles.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {indisponibles.map((tab) => (
                    <li key={tab.dimension}>{tab.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        )}

        {items.length > 0 && (
          <details className="min-w-0">
            <summary className="cursor-pointer rounded font-medium hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
              Alternative textuelle du découpage
            </summary>
            {/* Défilement signalé ; la zone reste `relative` pour la légende `sr-only`. */}
            <TableDefilante label="Alternative textuelle du découpage">
              <table className="mt-2 w-full">
                <caption className="sr-only">
                  {title} — {items.length.toLocaleString("fr-FR")} {accord(items.length, "groupe affiché", "groupes affichés")} sur{" "}
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
            </TableDefilante>
          </details>
        )}
      </div>
    </section>
  );
}
