// Un chemin (« /api/demo/items/:id ») qui ne se coupe qu'après une barre oblique.
// Rendu serveur.
//
// POURQUOI (recette du 26/09/2026). `break-all` coupait en plein mot à 390 px :
// « /partners/:i | d », « /recherch | e ». Un `<wbr>` après chaque « / » donne au
// navigateur des points de coupure qui gardent chaque segment entier ; un segment
// plus long que la colonne se coupe encore (`break-words`), en dernier recours.
import { Fragment } from "react";

export function CheminCoupable({ chemin, className = "" }: { chemin: string; className?: string }) {
  const morceaux = chemin.split("/");
  return (
    <span className={`min-w-0 break-words font-mono text-xs ${className}`} title={chemin}>
      {morceaux.map((m, i) => (
        <Fragment key={i}>
          {i > 0 && "/"}
          {/* Coupure permise APRÈS une barre, jamais juste après la barre initiale. */}
          {i > 1 && <wbr />}
          {m}
        </Fragment>
      ))}
    </span>
  );
}
