"use client";
// Les lignes d'un tableau déjà lu, montrées par paquets (recette du 26/09/2026).
//
// POURQUOI. La page d'un groupe lit ses 100 occurrences les plus récentes : le
// bouton « Voir le rejeu » et « Qu'ont en commun les sessions touchées ? » en ont
// besoin. Les 100 lignes affichées d'un coup faisaient une page de 11 000 px. Le
// tableau en montre donc 20, et « Afficher les 20 suivantes » révèle les autres —
// sans nouvelle lecture ; au-delà, la pagination par curseur du serveur prend le
// relais. Les lignes sont rendues par le serveur et passées telles quelles.
//
// Sans JavaScript, seul le premier paquet est visible : le lien du serveur vers les
// occurrences suivantes reste, lui, utilisable.
import { Children, useState, type ReactNode } from "react";

export function LignesParPaquets({
  entete,
  legende,
  classeTable,
  parPaquet = 20,
  children,
}: {
  /** `<thead>` du tableau. */
  entete: ReactNode;
  /** Légende accessible (`<caption>`, masquée). */
  legende: string;
  classeTable: string;
  parPaquet?: number;
  /** Les `<tr>` du corps, dans l'ordre. */
  children: ReactNode;
}) {
  const lignes = Children.toArray(children);
  const [visibles, setVisibles] = useState(parPaquet);
  const montrees = lignes.slice(0, visibles);
  const reste = lignes.length - montrees.length;
  const prochain = Math.min(parPaquet, reste);
  return (
    <>
      <table className={classeTable}>
        <caption className="sr-only">{legende}</caption>
        {entete}
        <tbody>{montrees}</tbody>
      </table>
      {reste > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-xs text-ink-soft">
          <span>
            {montrees.length.toLocaleString("fr-FR")} sur {lignes.length.toLocaleString("fr-FR")} affichées
          </span>
          <button
            type="button"
            onClick={() => setVisibles((v) => v + parPaquet)}
            className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            data-testid="lignes-suivantes"
          >
            {prochain > 1 ? `Afficher les ${prochain} suivantes` : "Afficher la suivante"}
          </button>
        </p>
      )}
    </>
  );
}
