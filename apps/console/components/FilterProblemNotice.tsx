// Écran d'un filtre refusé (P6.2) : périmètre vide, app hors périmètre, plage ou
// dimension invalide ou non applicable. Toujours récupérable — le message dit
// pourquoi, le lien reprend le même écran sans le filtre fautif. Rendu serveur.
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import type { FilterProblem } from "@/lib/page-filters";

export function FilterProblemNotice({ title, problem }: { title: string; problem: FilterProblem }) {
  return (
    <div className="animate-fade-up">
      <PageHeader title={title} />
      <div role="alert" data-testid="filter-problem" className="card border-bad/30 p-6 text-sm">
        <p className="font-semibold text-bad">
          {problem.code === "no_app_access" || problem.code === "forbidden_app"
            ? "Accès refusé"
            : "Filtres non appliqués"}
        </p>
        <p className="mt-1 text-ink-soft">{problem.message}</p>
        <Link href={problem.resetHref} className="btn-accent mt-4 inline-block" data-testid="filter-problem-reset">
          {problem.resetLabel}
        </Link>
      </div>
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
