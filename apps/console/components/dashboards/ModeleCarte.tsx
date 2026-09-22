// ModeleCarte — un modèle de tableau de bord prêt à cloner (F35, W-D1, plan § 4.3).
// Rendu serveur, sans lecture de données.
//
// AUCUN APERÇU CHIFFRÉ. Une carte de modèle est du texte : titre, question, et la
// liste des cartes par section. Un aperçu chiffré coûterait jusqu'à 24 lectures pour
// une page de navigation — et un chiffre sans sa population se lirait comme celui
// du tableau qu'on n'a pas encore créé.
//
// CLONER DEMANDE UNE APP NOMMÉE. Le sélecteur ne propose que les apps où la session
// peut créer un tableau ; sans aucune, le bouton n'est pas rendu (V9) et la raison
// est écrite à sa place. L'action serveur refait la même vérification.
//
// À 390 PX, la liste des cartes se replie (titre + bouton restent visibles) : quatre
// modèles dépliés pousseraient la liste des tableaux trois écrans plus bas.
import Link from "next/link";
import type { ReactNode } from "react";
import { INPUT_CLASS } from "@/components/forms/Field";
import { cloneTemplateAction } from "@/app/dashboards/actions";

function Sections({ sections }: { sections: { titre: string; cartes: string[] }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {sections.map((s) => (
        <li key={s.titre} className="min-w-0">
          <p className="break-words text-xs font-medium text-ink">{s.titre}</p>
          <p className="break-words text-xs text-ink-soft">{s.cartes.join(" · ")}</p>
        </li>
      ))}
    </ul>
  );
}

export function ModeleCarte({
  cle,
  titre,
  question,
  sections,
  cloner,
  raisonSansClonage,
  limite,
  ctx,
  appParDefaut,
}: {
  /** Clé du modèle, envoyée à l'action de clonage. */
  cle: string;
  titre: string;
  question: string;
  sections: { titre: string; cartes: string[] }[];
  /** null → pas de bouton. */
  cloner: { apps: { id: string; libelle: string }[] } | null;
  raisonSansClonage?: string;
  /** Ce que le modèle ne sait pas dire, et où le lire. */
  limite?: { texte: string; libelle: string; href: string };
  /** Filtres de l'écran, repris par la redirection (paramètres du contrat seulement). */
  ctx?: string;
  /** App de l'écran : présélectionnée si le clonage y est permis. */
  appParDefaut?: string | null;
}): ReactNode {
  const nbCartes = sections.reduce((n, s) => n + s.cartes.length, 0);
  const defaut =
    cloner && appParDefaut && cloner.apps.some((a) => a.id === appParDefaut)
      ? appParDefaut
      : cloner?.apps.length === 1
        ? cloner.apps[0].id
        : "";
  return (
    <article
      data-testid="modele-carte"
      data-modele={cle}
      aria-labelledby={`modele-${cle}-titre`}
      className="card flex min-w-0 flex-col gap-3 p-4"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`modele-${cle}-titre`} className="text-sm font-semibold text-ink">
            {titre}
          </h3>
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft">
            {nbCartes} cartes
          </span>
        </div>
        <p className="mt-1 break-words text-xs text-ink-soft">{question}</p>
      </div>

      <div className="hidden sm:block">
        <Sections sections={sections} />
      </div>
      <details className="sm:hidden">
        <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">Voir les {nbCartes} cartes</summary>
        <div className="mt-2">
          <Sections sections={sections} />
        </div>
      </details>

      {limite && (
        <p className="break-words text-xs text-ink-soft" data-testid="modele-limite">
          {limite.texte}{" "}
          <Link href={limite.href} className="font-medium text-brand hover:underline">
            {limite.libelle}
          </Link>
        </p>
      )}

      <div className="mt-auto">
        {cloner ? (
          <form action={cloneTemplateAction} className="flex flex-wrap items-end gap-2" data-testid="cloner-modele">
            <input type="hidden" name="modele" value={cle} />
            {ctx !== undefined && <input type="hidden" name="ctx" value={ctx} />}
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-ink-soft">
              App du tableau
              <select name="app_id" required defaultValue={defaut} className={`${INPUT_CLASS} w-full`}>
                {defaut === "" && (
                  <option value="" disabled>
                    Choisir une app…
                  </option>
                )}
                {cloner.apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.libelle}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-accent" aria-label={`Cloner le modèle ${titre}`}>
              Cloner
            </button>
          </form>
        ) : (
          <p className="text-xs text-ink-soft" data-testid="cloner-indisponible">
            {raisonSansClonage ?? "Clonage non disponible pour cette session."}
          </p>
        )}
      </div>
    </article>
  );
}
