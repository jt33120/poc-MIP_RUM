// Écran d'un filtre refusé (P6.2) : périmètre vide, app hors périmètre, plage ou
// dimension invalide ou non applicable. Toujours récupérable — le message dit
// pourquoi, le lien reprend le même écran sans le filtre fautif. Rendu serveur.
//
// État « refusé » du vocabulaire commun (§ 3.8) : même texte qu'avant F02, rendu
// dans le cadre des états (`CadreEtat`, teinte d'erreur, rôle `alert`).
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { CadreEtat } from "@/components/states/EtatSurface";
import type { FilterProblem } from "@/lib/page-filters";

export function FilterProblemNotice({ title, problem }: { title: string; problem: FilterProblem }) {
  return (
    <div className="animate-fade-up">
      <PageHeader title={title} />
      <CadreEtat ton="erreur" role="alert" testId="filter-problem" etat="refuse">
        <p className="font-semibold text-bad-ink">
          {problem.code === "no_app_access" || problem.code === "forbidden_app"
            ? "Accès refusé"
            : "Filtres non appliqués"}
        </p>
        <p className="mt-1 text-ink-soft">{problem.message}</p>
        <Link href={problem.resetHref} className="btn-accent mt-4 inline-block" data-testid="filter-problem-reset">
          {problem.resetLabel}
        </Link>
      </CadreEtat>
    </div>
  );
}

/** Écran de configuration : les filtres de l'URL restent dans le lien mais ne s'appliquent pas ici. */
export function FiltersNotAppliedNote({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <p
      role="note"
      data-testid="filters-not-applied"
      className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft"
    >
      Filtres non appliqués sur cet écran. {note}
    </p>
  );
}
