// Sélecteur « Route affichée » du hero de /correlation (F58, plan § 5.7 CR7-a).
// Rendu serveur, sans JavaScript : un formulaire GET natif.
//
// POURQUOI UN <select> ET PAS SEULEMENT DES PUCES. L'écran d'avant n'affichait que
// six puces : les autres couples (app, route) étaient inatteignables. Le <select>
// liste TOUTES les options ; les puces ne sont qu'un raccourci vers les couples qui
// ont le plus d'heures en angle mort.
//
// LE FORMULAIRE GARDE LE CONTEXTE. Un GET remplace toute la query : sans champs
// cachés, choisir une route ferait perdre la plage, la population et la
// comparaison. Les paramètres du contrat (déjà canoniques) et ceux de la vue
// (`cmp`, `rel_a`, `rel_b`) sont donc reposés tels quels ; `serie` vient du champ.
import Link from "next/link";
import { INPUT_CLASS } from "@/components/forms/Field";

export interface OptionSerie {
  /** Valeur du paramètre `serie` (`ecrireSerie`). */
  valeur: string;
  libelle: string;
}

export function SelecteurSerie({
  action,
  conserves,
  options,
  choisie,
  puces,
}: {
  /** Chemin de l'écran (« /correlation »). */
  action: string;
  /** Paramètres reposés en champs cachés : contrat + contexte de vue, sans `serie`. */
  conserves: [string, string][];
  options: OptionSerie[];
  /** Valeur de l'option affichée. */
  choisie: string;
  /** Raccourcis : couples aux angles morts les plus nombreux. */
  puces: { href: string; libelle: string; heures: number; active: boolean }[];
}) {
  return (
    <div className="mb-3 flex min-w-0 flex-col gap-2" data-testid="selecteur-serie">
      <form method="get" action={action} className="flex min-w-0 flex-wrap items-end gap-2">
        {conserves.map(([nom, valeur], i) => (
          <input key={`${nom}-${i}`} type="hidden" name={nom} value={valeur} />
        ))}
        <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-xs font-medium text-ink-soft">
          Route affichée
          <select name="serie" defaultValue={choisie} className={`${INPUT_CLASS} min-w-0 max-w-full font-mono`}>
            {options.map((o) => (
              <option key={o.valeur} value={o.valeur}>
                {o.libelle}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-accent shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Afficher
        </button>
      </form>
      {puces.length > 0 && (
        <ul className="flex min-w-0 flex-wrap gap-1" aria-label="Couples aux angles morts les plus nombreux">
          {puces.map((p) => (
            <li key={p.href} className="min-w-0 max-w-full">
              <Link
                href={p.href}
                aria-current={p.active ? "true" : undefined}
                className={`block max-w-full truncate rounded-full px-2.5 py-0.5 font-mono text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
                  p.active ? "bg-accent font-semibold text-navy-950 shadow-sm" : "bg-panel2 text-ink-soft hover:bg-line/60"
                }`}
              >
                {p.libelle} · {p.heures.toLocaleString("fr-FR")}&nbsp;h en angle mort
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-relaxed text-ink-soft">
        Par défaut : la route du filtre « route » si elle est posée ; sinon le couple qui a le plus d&apos;heures en
        angle mort ; sinon le premier par ordre de route puis d&apos;app.
      </p>
    </div>
  );
}
