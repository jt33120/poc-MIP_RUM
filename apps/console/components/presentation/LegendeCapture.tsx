// Légende de la capture de la console, sous l'en-tête de la vitrine (plan § 8.2,
// PS0 ; lot P**.7). Texte exact du plan :
//
//   « Capture réelle de la console, prise le {date du manifeste}. Les chiffres
//     affichés viennent d'un jeu de démonstration, pas d'un client en production. »
//
// Le segment « , prise le {date} » n'existe que si le manifeste des captures date
// les deux images montrées (lib/portail-manifeste.ts, `dateDesCaptures`) : la date
// des captures d'avant P**.7 n'est pas établie, et on ne l'invente pas. La recette
// TP8 (tests/e2e/presentation.spec.ts) tient la règle dans les deux sens : une date
// si et seulement si public/portail/manifest.json existe.
import { dateAffichee } from "@/lib/portail-manifeste";

/** `date` : jour de prise AAAA-MM-JJ lu dans le manifeste, ou `null` s'il n'est pas établi. */
export function LegendeCapture({ date }: { date: string | null }) {
  return (
    <p className="mt-3 text-xs text-ink-soft">
      Capture réelle de la console
      {date && (
        <>
          , prise le <time dateTime={date}>{dateAffichee(date)}</time>
        </>
      )}
      . Les chiffres affichés viennent d&apos;un jeu de démonstration, pas d&apos;un client en
      production.
    </p>
  );
}
