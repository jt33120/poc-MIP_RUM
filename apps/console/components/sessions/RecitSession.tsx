// Bloc « En bref » du détail de session (P*.9) : le récit composé de faits.
//
// Chaque phrase est un LIEN vers la ligne de chronologie qui la fonde : le récit
// ne demande pas qu'on le croie, il montre d'où il tient chaque mot. La mention
// fixe dit ses limites (ni interprétation, ni événement non collecté) : depuis la
// refonte du 30/09/2026, elle est dans la bulle du titre — une règle, pas un fait —,
// et reste dans la page. Le rejeu absent est écrit, pas seulement constaté par un
// lecteur vide plus bas. Composant serveur : les ancres sont de simples fragments.
import { InfoTip } from "@/components/InfoTip";
import { MENTION_RECIT, mentionRejeu, type PhraseRecit, type Rejeu } from "@/lib/recit-session";

const LIEN =
  "rounded text-ink underline decoration-line decoration-1 underline-offset-2 hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

export function RecitSession({
  phrases,
  rejeu,
  lienBase = "",
  className = "mb-4",
}: {
  phrases: PhraseRecit[];
  /** `null` : présence du rejeu non lue (lecture en échec). */
  rejeu: Rejeu | null;
  /**
   * Adresse de la vue qui porte la chronologie, quand elle n'est pas celle
   * affichée (onglets autres que le Déroulé, F44) : l'ancre seule mènerait nulle part.
   */
  lienBase?: string;
  /** Marges et hauteur imposées par la rangée qui l'accueille. */
  className?: string;
}) {
  const rejeuTexte = mentionRejeu(rejeu);
  return (
    <section className={`card min-w-0 px-3 py-2.5 ${className}`} aria-labelledby="recit-titre" data-testid="recit-session">
      <h2 id="recit-titre" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        En bref
        <InfoTip label="Comment ce récit est composé" align="start">
          {MENTION_RECIT}
        </InfoTip>
      </h2>
      {phrases.length ? (
        <ol className="mt-1.5 space-y-1 text-[13px] leading-snug" data-testid="recit-phrases">
          {phrases.map((p, i) => (
            <li key={i} className="flex min-w-0 gap-1.5 break-words">
              <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
              <span className="min-w-0">
                <a href={`${lienBase}#${p.ancre}`} className={LIEN} data-ancre={p.ancre}>
                  {p.texte}
                </a>
                {p.action && (
                  <>
                    {" "}
                    <a
                      href={`${lienBase}#${p.action.ancre}`}
                      className="rounded text-xs text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                      data-ancre={p.action.ancre}
                    >
                      voir {p.action.texte}
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-soft" data-testid="recit-vide">
          <span aria-hidden="true" className="text-ink-faint">
            ⊘
          </span>
          Aucun événement pour cette session : pas de récit.
        </p>
      )}
      {rejeuTexte && (
        <p className="mt-1.5 text-[11px] text-ink-soft" data-testid="recit-rejeu">
          {rejeuTexte}
        </p>
      )}
    </section>
  );
}
