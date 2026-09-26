import { SUBPROCESSORS } from "@/lib/legal";

// Le registre des sous-traitants, tel que le servent la politique de confidentialité
// et celle de l'extension — un seul rendu, lu dans lib/legal.ts.
//
// QUATRE COLONNES DÉCLARATIVES (recette du 26/09/2026) : société, rôle en une
// phrase, lieu de traitement, garanties. Les cellules faisaient 5 à 8 lignes, des
// notes d'exploitation s'y mêlaient, l'en-tête « Sous-traitant » se coupait et
// « aws-eu-central-1 » se cassait au tiret à 390 px. Les précisions de traitement
// passent en notes numérotées sous le tableau ; sous 640 px, chaque ligne s'empile
// en fiche, libellés compris, plutôt que de défiler.

const CELLULE = "block py-1 sm:table-cell sm:py-2 sm:pr-4 sm:align-top";
const LIBELLE_MOBILE = "font-semibold text-ink sm:hidden";

export function TableauSousTraitants() {
  // Numéro de note de chaque sous-traitant qui en porte une, dans l'ordre du tableau.
  const avecNote = SUBPROCESSORS.filter((s) => s.note);
  const renvoi = (nom: string) => avecNote.findIndex((s) => s.name === nom) + 1;

  return (
    <div>
      <table className="mt-1 w-full text-left text-xs" data-testid="legal-sous-traitants">
        <thead className="hidden text-ink-faint sm:table-header-group">
          <tr>
            <th scope="col" className="py-1 pr-4 font-semibold">Société</th>
            <th scope="col" className="py-1 pr-4 font-semibold">Rôle</th>
            <th scope="col" className="py-1 pr-4 font-semibold">Pays et région</th>
            <th scope="col" className="py-1 font-semibold">Garanties</th>
          </tr>
        </thead>
        <tbody className="text-ink-soft">
          {SUBPROCESSORS.map((s) => (
            <tr key={s.name} className="block border-t border-line py-2 sm:table-row sm:py-0">
              <th scope="row" className={`${CELLULE} font-semibold text-ink`}>
                {s.name}
                {s.note && (
                  <sup className="ml-0.5 font-normal text-ink-faint">
                    <a href={`#note-sous-traitant-${renvoi(s.name)}`} aria-label={`Note ${renvoi(s.name)}`}>
                      {renvoi(s.name)}
                    </a>
                  </sup>
                )}
                <span className="block font-normal text-ink-faint">{s.societe}</span>
              </th>
              <td className={CELLULE}>
                <span className={LIBELLE_MOBILE}>Rôle&nbsp;: </span>
                {s.role}
              </td>
              <td className={CELLULE}>
                <span className={LIBELLE_MOBILE}>Pays et région&nbsp;: </span>
                {s.traitement}
                {s.region && (
                  <>
                    {" "}
                    (région <span className="whitespace-nowrap font-mono">{s.region}</span>)
                  </>
                )}
              </td>
              <td className={`${CELLULE} sm:pr-0`}>
                <span className={LIBELLE_MOBILE}>Garanties&nbsp;: </span>
                {s.garanties}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {avecNote.length > 0 && (
        <ol className="mt-3 space-y-1 text-xs text-ink-faint">
          {avecNote.map((s, i) => (
            <li key={s.name} id={`note-sous-traitant-${i + 1}`}>
              <sup>{i + 1}</sup> {s.name}&nbsp;: {s.note}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
