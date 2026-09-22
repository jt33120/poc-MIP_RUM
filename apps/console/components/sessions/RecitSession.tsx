// Bloc « En bref » du détail de session (P*.9) : le récit composé de faits.
//
// Chaque phrase est un LIEN vers la ligne de chronologie qui la fonde : le récit
// ne demande pas qu'on le croie, il montre d'où il tient chaque mot. La mention
// fixe dit ses limites (ni interprétation, ni événement non collecté), et le rejeu
// absent est écrit, pas seulement constaté par un lecteur vide plus bas.
// Composant serveur : aucune interaction, les ancres sont de simples fragments.
import { MENTION_RECIT, mentionRejeu, type PhraseRecit, type Rejeu } from "@/lib/recit-session";

const LIEN =
  "rounded text-ink underline decoration-line decoration-1 underline-offset-2 hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

export function RecitSession({
  phrases,
  rejeu,
  lienBase = "",
}: {
  phrases: PhraseRecit[];
  /** `null` : présence du rejeu non lue (lecture en échec). */
  rejeu: Rejeu | null;
  /**
   * Adresse de la vue qui porte la chronologie, quand elle n'est pas celle
   * affichée (onglets autres que le Déroulé, F44) : l'ancre seule mènerait nulle part.
   */
  lienBase?: string;
}) {
  const rejeuTexte = mentionRejeu(rejeu);
  return (
    <section className="card mb-6 p-4" aria-labelledby="recit-titre" data-testid="recit-session">
      <h2 id="recit-titre" className="text-sm font-semibold">
        En bref
      </h2>
      {phrases.length ? (
        <ol className="mt-2 space-y-1 text-sm" data-testid="recit-phrases">
          {phrases.map((p, i) => (
            <li key={i} className="min-w-0 break-words">
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
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-ink-soft" data-testid="recit-vide">
          Aucun événement pour cette session : pas de récit.
        </p>
      )}
      {rejeuTexte && (
        <p className="mt-2 text-sm text-ink-soft" data-testid="recit-rejeu">
          {rejeuTexte}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-faint">{MENTION_RECIT}</p>
    </section>
  );
}
