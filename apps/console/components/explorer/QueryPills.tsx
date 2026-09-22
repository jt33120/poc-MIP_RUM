// QueryPills — la requête appliquée, en pastilles (F31, plan § 4.3). Rendu serveur.
//
// POURQUOI. Le résumé « Requête appliquée » était une phrase : exacte, mais on ne
// retire pas un filtre d'une phrase. Chaque élément devient une pastille
// (référence : la requête en pastilles du RUM Explorer de Datadog), et chaque
// pastille retirable est un LIEN vers la même analyse sans elle — rendu serveur,
// fonctionnel sans JavaScript, partageable.
//
// LA PHRASE RESTE : elle nomme le groupe (`aria-label`). Un lecteur d'écran
// entend d'abord la requête complète — fenêtre et périmètre compris, qui n'ont
// pas de pastille puisqu'ils se règlent dans les filtres globaux —, puis chaque
// élément.
//
// CE QUI NE SE RETIRE PAS LE DIT. Un jeu, une mesure, une variante obligatoire
// n'ont pas d'« absence » : pas de bouton, et la raison est dans le texte de la
// pastille (lue par un lecteur d'écran), pas seulement dans une bulle `title`.
import Link from "next/link";
import type { Pastille } from "@/lib/explorer-page-params";

export function QueryPills({ pastilles, resume }: { pastilles: Pastille[]; resume: string }) {
  return (
    <div role="group" aria-label={resume} data-testid="requete-pastilles" className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
      <span aria-hidden="true" className="text-xs font-semibold text-ink-soft">
        Requête appliquée
      </span>
      <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {pastilles.map((p) => (
          <li
            key={p.cle}
            data-pastille={p.cle}
            title={p.retirerHref === null && p.raison ? `${p.libelle} — ${p.raison}` : p.libelle}
            className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border text-xs ${
              p.retirerHref === null ? "border-line bg-panel2 py-1 pl-2.5 pr-2.5 text-ink-soft" : "border-perf/40 bg-perf/10 py-0.5 pl-2.5 pr-0.5 text-ink"
            }`}
          >
            {/* Une valeur de condition peut faire 500 caractères : la pastille se
                tronque, le texte entier reste dans `title` et dans le résumé. */}
            <span className="min-w-0 truncate sm:max-w-[18rem]">{p.libelle}</span>
            {p.retirerHref === null ? (
              p.raison && <span className="sr-only"> — non retirable : {p.raison}</span>
            ) : (
              <Link
                href={p.retirerHref}
                prefetch={false}
                aria-label={`Retirer « ${p.libelle} »`}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-perf/20 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
