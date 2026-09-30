"use client";
// Le champ de recherche PROPRE à un tableau d'administration (charte § 3.5 : « au-delà
// de 20 lignes, un champ de recherche propre au tableau ») — refonte du 01/10/2026.
//
// Il masque, dans le corps du tableau désigné (`cible` : l'`id` du <tbody>), les lignes
// dont le texte ne contient pas la saisie ; casse et accents ignorés. Rien n'est relu
// en base, rien ne quitte la page : les lignes sont déjà là, rendues par le serveur,
// et toutes restent dans le document (un test, un lecteur d'écran les atteignent
// toutes tant que le champ est vide).
import { useId, useState } from "react";
import { normaliserRecherche } from "./recherche";

export function FiltreLignes({ cible, libelle, total }: { cible: string; libelle: string; total: number }) {
  const id = useId();
  const [saisie, setSaisie] = useState("");
  const [visibles, setVisibles] = useState(total);

  function filtrer(texte: string) {
    setSaisie(texte);
    const q = normaliserRecherche(texte);
    let n = 0;
    const lignes = document.getElementById(cible)?.querySelectorAll<HTMLTableRowElement>(":scope > tr[data-ligne]") ?? [];
    for (const tr of lignes) {
      const garde = !q || normaliserRecherche(tr.textContent ?? "").includes(q);
      tr.hidden = !garde;
      if (garde) n += 1;
    }
    setVisibles(n);
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {libelle}
      </label>
      <input
        id={id}
        type="search"
        value={saisie}
        onChange={(e) => filtrer(e.currentTarget.value)}
        placeholder="Filtrer…"
        autoComplete="off"
        className="field w-44 max-w-full py-1 text-xs"
      />
      <span className="whitespace-nowrap text-[11px] tabular-nums text-ink-faint" aria-live="polite">
        {saisie ? `${visibles.toLocaleString("fr-FR")} sur ${total.toLocaleString("fr-FR")}` : ""}
      </span>
    </div>
  );
}
