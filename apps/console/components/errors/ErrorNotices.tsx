// Bandeaux partagés de la liste et du détail des erreurs : ce que les chiffres
// affichés ne disent pas d'eux-mêmes (échantillonnage, enrichissement partiel). Un
// périmètre vide est un refus de filtre (components/FilterProblemNotice.tsx). Rendu serveur.
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
