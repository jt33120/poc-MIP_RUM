// PopulationBar — la population lue, écrite au-dessus d'une grille de cartes
// (F36, plan § 4.2, W-B1). Rendu serveur : du texte et des liens, rien d'autre.
//
// POURQUOI ELLE EST TOUJOURS LÀ. Chaque carte hérite de cette population. Trois
// chiffres côte à côte ne veulent rien dire tant qu'on ne sait pas sur quoi ils
// portent : la barre reste donc visible Y COMPRIS à « toutes les apps », où la
// tentation serait de ne rien écrire (Datadog garde sa barre de variables à
// l'écran en permanence).
//
// RETIRER EST UN GESTE, PAS UN EFFET DE BORD. Une puce de condition porte le lien
// de la MÊME page sans elle ; une puce qui ne se retire pas n'est pas un lien —
// elle ne fait pas croire à un geste qui n'existe pas.
import Link from "next/link";

export function PopulationBar({
  puces,
  plage,
  fuseau,
}: {
  /** Chaque condition de population ; `retirerHref` seulement si elle se retire. */
  puces: { libelle: string; retirerHref?: string }[];
  /** Plage résolue, en toutes lettres (« 24 h », « du 17/09 10:00 au 17/09 12:00 »). */
  plage: string;
  /** Fuseau des axes de figure — « UTC » pour les seaux du contrat (V6). */
  fuseau: string;
}) {
  return (
    <section
      data-testid="population-bar"
      aria-label="Population lue"
      className="card mb-6 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-xs text-ink-soft"
    >
      <span className="shrink-0 font-semibold text-ink">Population lue</span>
      <span className="shrink-0 text-ink-faint" aria-hidden="true">
        ·
      </span>
      <span className="shrink-0" data-testid="population-plage">
        {plage}
      </span>
      <span className="shrink-0 text-ink-faint" aria-hidden="true">
        ·
      </span>
      <span className="shrink-0" data-testid="population-fuseau">
        axes en {fuseau}
      </span>
      {puces.map(({ libelle, retirerHref }) => (
        <span key={libelle} className="flex min-w-0 items-center">
          <span className="mr-2 shrink-0 text-ink-faint" aria-hidden="true">
            ·
          </span>
          {retirerHref ? (
            <Link
              href={retirerHref}
              data-testid="population-puce"
              className="min-w-0 max-w-full truncate rounded-full border border-line px-2 py-0.5 text-ink transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
              title={`Retirer : ${libelle}`}
            >
              {libelle} ✕
            </Link>
          ) : (
            <span data-testid="population-puce" className="min-w-0 max-w-full truncate">
              {libelle}
            </span>
          )}
        </span>
      ))}
    </section>
  );
}
