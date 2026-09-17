// Bandeaux partagés de la liste et du détail des erreurs : ce que les chiffres
// affichés ne disent pas d'eux-mêmes (échantillonnage, enrichissement partiel), et
// l'absence de tout périmètre. Rendu serveur.
import { PageHeader } from "@/components/PageHeader";
import type { ErrorEnrichment, ErrorSampling } from "@/lib/queries-errors";

const NOTICE = "mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft";

export function ErrorNotices({ sampling, enrichment }: { sampling: ErrorSampling; enrichment: ErrorEnrichment }) {
  return (
    <>
      {!enrichment.available && enrichment.diagnostic && (
        <p role="status" className={NOTICE}>
          {enrichment.diagnostic}
        </p>
      )}
      {sampling.message && (
        <p role="note" className={NOTICE}>
          {sampling.message}
        </p>
      )}
    </>
  );
}

/**
 * Principal sans aucune app (AD-16 : une liste vide est un accès nul). On le dit,
 * plutôt qu'un écran vide qu'on lirait comme « aucune erreur ».
 */
export function ErrorAccessDenied() {
  return (
    <div className="animate-fade-up">
      <PageHeader title="Erreurs JS" />
      <div role="alert" className="card border-bad/30 p-6 text-sm text-bad">
        Aucune application autorisée : ce compte ne donne accès aux erreurs d&apos;aucune application.
      </div>
    </div>
  );
}
