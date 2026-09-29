"use client";
// Le catalogue de /presentation/open-source : une section par catégorie, un tableau
// par section, et un filtre qui ne fait que masquer des lignes déjà rendues.
//
// Client à cause du filtre seul : le premier rendu, côté serveur, montre tout, et
// une page lue sans JavaScript garde toutes ses lignes. À 390 px, chaque tableau
// défile dans son propre cadre (TableDefilante), jamais la page.
import { useId, useMemo, useState } from "react";
import { TableDefilante } from "@/components/TableDefilante";
import {
  CATEGORIES,
  COMPOSANTS,
  DEPOT_NON_DECLARE,
  INVENTAIRE,
  TYPE_LIBELLE,
  ancreCategorie,
  depotLisible,
  texteRecherche,
  vigilance,
  type Composant,
} from "./inventaire";

const CELLULE = "px-3 py-2.5 align-top sm:px-4";
const LIEN = "font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink";

function Licence({ licence }: { licence: string }) {
  const raison = vigilance(licence);
  if (!raison) return <span className="chip-mono whitespace-nowrap">{licence}</span>;
  return (
    <span className="inline-flex flex-col gap-1">
      <span
        className="inline-block w-fit whitespace-nowrap rounded bg-warn/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-warn-ink"
        data-testid="licence-a-surveiller"
      >
        {licence}
      </span>
      <span className="text-xs leading-snug text-ink-soft">{raison}</span>
    </span>
  );
}

function Ligne({ c }: { c: Composant }) {
  return (
    <tr className="border-b border-line/60 last:border-0" data-testid="composant">
      <th scope="row" className={`${CELLULE} min-w-[12rem] font-normal`}>
        <span className="block break-words font-medium text-ink">{c.nom}</span>
        <span className="block text-xs text-ink-soft">{TYPE_LIBELLE[c.type]}</span>
        {c.role && <span className="mt-1 block text-xs leading-snug text-ink-soft">{c.role}</span>}
        {c.note && <span className="mt-1 block text-xs leading-snug text-ink-soft">{c.note}</span>}
        {c.attribution && (
          <span className="mt-1 block text-xs font-medium leading-snug text-ink">Attribution : {c.attribution}</span>
        )}
      </th>
      <td className={`${CELLULE} whitespace-nowrap font-mono text-xs text-ink`}>{c.version}</td>
      <td className={CELLULE}>
        <Licence licence={c.licence} />
      </td>
      <td className={`${CELLULE} max-w-[18rem] break-words text-xs`}>
        {c.depot === DEPOT_NON_DECLARE ? (
          <span className="text-warn-ink">{DEPOT_NON_DECLARE}</span>
        ) : (
          <a href={c.depot} className={LIEN} rel="noopener noreferrer">
            {depotLisible(c.depot)}
          </a>
        )}
      </td>
      <td className={`${CELLULE} text-xs text-ink-soft`}>
        <ul className="flex flex-wrap gap-x-2 gap-y-1">
          {c.utilisePar.map((u) => (
            <li key={u.nom} className="whitespace-nowrap">
              {u.nom}
              {u.dev && <span title="Déclaré en dépendance de développement"> (dév.)</span>}
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

export function Catalogue() {
  const [filtre, setFiltre] = useState("");
  const champ = useId();
  const recherche = filtre.trim().toLowerCase();
  const visibles = useMemo(
    () => (recherche ? COMPOSANTS.filter((c) => texteRecherche(c).includes(recherche)) : COMPOSANTS),
    [recherche],
  );

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <label htmlFor={champ} className="block text-sm font-medium text-ink">
          Filtrer par nom, licence ou usage
        </label>
        <input
          id={champ}
          type="search"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          placeholder="ex. Apache-2.0, react, collector"
          autoComplete="off"
          className="field mt-1.5 w-full max-w-md"
          data-testid="open-source-filtre"
        />
        <p aria-live="polite" className="mt-2 text-xs text-ink-soft" data-testid="open-source-affiches">
          {recherche ? `${visibles.length} sur ${COMPOSANTS.length} composants affichés.` : `${COMPOSANTS.length} composants.`}
        </p>
      </div>

      {INVENTAIRE.categories.map((id) => {
        const lignes = visibles.filter((c) => c.categorie === id);
        if (!lignes.length) return null;
        const titreId = `${ancreCategorie(id)}-titre`;
        return (
          <section key={id} id={ancreCategorie(id)} aria-labelledby={titreId} className="mt-10 scroll-mt-6">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <h2 id={titreId} className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
                {CATEGORIES[id].titre}{" "}
                <span className="text-base font-medium text-ink-soft">({lignes.length})</span>
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">{CATEGORIES[id].chapeau}</p>
              <TableDefilante className="card mt-4" label={CATEGORIES[id].titre}>
                <table aria-labelledby={titreId} className="w-full min-w-[46rem] text-left text-[13px] sm:text-sm">
                  <thead className="border-b border-line bg-panel2/60">
                    <tr>
                      {["Composant", "Version", "Licence", "Dépôt source", "Utilisé par"].map((t) => (
                        <th
                          key={t}
                          scope="col"
                          className={`${CELLULE} text-[11px] font-semibold uppercase tracking-wider text-ink-soft`}
                        >
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((c) => (
                      <Ligne key={`${c.nom}@${c.version}`} c={c} />
                    ))}
                  </tbody>
                </table>
              </TableDefilante>
            </div>
          </section>
        );
      })}
      {!visibles.length && (
        <p className="mx-auto mt-8 max-w-6xl px-4 text-sm text-ink-soft sm:px-6">Aucun composant ne correspond à ce filtre.</p>
      )}
    </div>
  );
}
