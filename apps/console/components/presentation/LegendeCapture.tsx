// Légende des captures de la présentation (sous « Ce que la console montre »).
//
//   « Captures réelles de la console, prises le {date du manifeste}. Les chiffres
//     affichés viennent d'un jeu de démonstration, pas d'un client en production. »
//
// Le segment « , prises le {date} » n'existe que si le manifeste des captures date
// TOUTES les images montrées, du même jour (lib/portail-manifeste.ts,
// `dateDesCaptures`) : une date qu'on ne peut pas établir ne s'invente pas. La recette
// TP8 (tests/e2e/presentation.spec.ts) tient la règle dans les deux sens : une date
// si et seulement si public/portail/manifest.json existe.
import { dateAffichee } from "@/lib/portail-manifeste";

/** `date` : jour de prise AAAA-MM-JJ lu dans le manifeste, ou `null` s'il n'est pas établi. */
export function LegendeCapture({ date }: { date: string | null }) {
  return (
    <p className="mt-6 text-xs text-ink-soft">
      Captures réelles de la console
      {date && (
        <>
          , prises le <time dateTime={date}>{dateAffichee(date)}</time>
        </>
      )}
      . Les chiffres affichés viennent d&apos;un jeu de démonstration, pas d&apos;un client en
      production.
    </p>
  );
}
