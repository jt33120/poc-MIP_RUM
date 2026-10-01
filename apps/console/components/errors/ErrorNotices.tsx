// Bandeaux partagés de la liste et du détail des erreurs : ce que les chiffres
// affichés ne disent pas d'eux-mêmes (échantillonnage, enrichissement partiel). Un
// périmètre vide est un refus de filtre (components/FilterProblemNotice.tsx). Rendu serveur.
//
// UNE PASTILLE PAR RÉSERVE (recette du 30/09/2026) : deux bandeaux ambrés de pleine
// largeur, en phrases, précédaient les cases. La réserve se nomme en deux mots ; sa
// phrase entière reste dans la page (lecteurs d'écran) et au survol.
import type { ErrorEnrichment, ErrorSampling } from "@/lib/queries-errors";

const PASTILLE =
  "inline-flex max-w-full items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[11px] text-ink-soft";

export function ErrorNotices({ sampling, enrichment }: { sampling: ErrorSampling; enrichment: ErrorEnrichment }) {
  const enrichissement = !enrichment.available && enrichment.diagnostic ? enrichment.diagnostic : null;
  if (!enrichissement && !sampling.message) return null;
  return (
    <div className="mb-3 flex min-w-0 flex-wrap gap-2">
      {enrichissement && (
        <p role="status" className={PASTILLE} title={enrichissement}>
          <span aria-hidden className="text-warn-ink">
            ▲
          </span>
          <span className="font-medium text-ink">Enrichissement partiel</span>
          <span className="sr-only"> — {enrichissement}</span>
        </p>
      )}
      {sampling.message && (
        <p role="note" className={PASTILLE} title={sampling.message}>
          <span aria-hidden className="text-warn-ink">
            ▲
          </span>
          <span className="font-medium text-ink">Échantillonné</span>
          <span className="sr-only"> — {sampling.message}</span>
        </p>
      )}
    </div>
  );
}
