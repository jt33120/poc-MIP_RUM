// Occurrences d'un groupe historique ou d'une issue : les plus récentes d'abord,
// chacune avec SES propres horodatage, release, source et liens vérifiés dans la
// même app, puis la pagination par curseur. Rendu serveur.
//
// Recette du 26/09/2026 : 55 lignes d'un coup (page de 11 000 px), une colonne
// « Message » qui répétait 55 fois le titre du groupe, et une pastille d'action
// écrasée sur cinq lignes. Les lignes se montrent par paquets de 20
// (`LignesParPaquets`), la colonne Message n'apparaît que si les messages diffèrent,
// et l'action tient sur une ligne, sans préfixe technique.
//
// UNE CARTE PAR OCCURRENCE SOUS 640 PX (contre-recette du 26/09/2026). À 390 px, le
// tableau de 1 120 px ne montrait que « Quand » et « ×N » : route, release, source
// et les liens Session / Rejeu / Trace restaient hors champ, même signalés. Chaque
// occurrence devient une carte, ses liens visibles sans défilement ; le tableau
// revient à partir de 640 px.
import Link from "next/link";
import { TableDefilante } from "@/components/TableDefilante";
import { LignesParPaquets } from "@/components/errors/LignesParPaquets";
import { occurrenceHrefs, type OccurrenceHrefs } from "@/lib/error-view";
import { fmtDate } from "@/lib/format";
import { libelleAction } from "@/lib/libelle-action";
import { ERROR_SOURCE_LABELS } from "@/lib/erreurs-sources";
import type { ErrorOccurrenceLinks, ErrorOccurrenceRow } from "@/lib/queries-errors";

/** Cellule secondaire : libellée dans la carte (sous 640 px), cellule simple au-delà. */
const CELLULE =
  "mr-4 mt-1 inline-flex items-baseline gap-1 text-xs text-ink-soft sm:mr-0 sm:mt-0 sm:table-cell sm:px-4 sm:py-2";

export const ERROR_LINK =
  "rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

export function ErrorOccurrences({
  appId,
  occurrences,
  caption,
  firstHref,
  nextHref,
}: {
  appId: string;
  occurrences: ErrorOccurrenceRow[];
  /** Légende accessible du tableau. */
  caption: string;
  /** Retour aux plus récentes, quand la page affichée suit un curseur. */
  firstHref: string | null;
  nextHref: string | null;
}) {
  // Un groupe historique a un seul message ; une issue peut en avoir plusieurs
  // (messages normalisés) : la colonne ne se montre que si elle apprend quelque chose.
  const messagesVaries = new Set(occurrences.map((o) => o.message ?? "")).size > 1;
  return (
    <section className="card overflow-hidden" aria-labelledby="occurrences-title">
      <h2
        id="occurrences-title"
        className="border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint"
      >
        Occurrences ({occurrences.length.toLocaleString("fr-FR")})
      </h2>
      {occurrences.length ? (
        // Cartes sous 640 px, défilement SIGNALÉ au-delà (voir l'en-tête du fichier).
        // Le nom de la zone ne commence pas par « Occurrences ( » : c'est la section
        // qui porte ce nom-là, et les recettes la visent par lui.
        <TableDefilante label="Tableau des occurrences">
          {/* Les lignes défilent sous un en-tête collant au-delà de 30 rem (recette du
              30/09/2026 : vingt occurrences faisaient un bloc de 1 000 px). */}
          <div className="max-h-[30rem] overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
          <LignesParPaquets
            // Largeur minimale sous celle de la carte à 1 440 px : à 70rem, le tableau
            // dépassait de 2 px et annonçait un défilement inutile.
            classeTable="block w-full text-sm sm:table sm:min-w-[60rem]"
            classeCorps="block sm:table-row-group"
            legende={caption}
            entete={
              <thead className="hidden bg-panel2 sm:table-header-group">
                <tr>
                  <th scope="col" className="th">Quand</th>
                  <th scope="col" className="th">
                    <span aria-hidden="true">×n</span>
                    <span className="sr-only">Répétitions</span>
                  </th>
                  <th scope="col" className="th">Route</th>
                  <th scope="col" className="th">Release</th>
                  <th scope="col" className="th">Source</th>
                  {messagesVaries && <th scope="col" className="th">Message</th>}
                  <th scope="col" className="th">Appareil</th>
                  <th scope="col" className="th">Liens</th>
                </tr>
              </thead>
            }
          >
              {occurrences.map((o) => {
                const href = occurrenceHrefs(appId, o);
                const quand = fmtDate(o.ts);
                return (
                  <tr
                    key={o.id}
                    data-testid="occurrence"
                    className="block border-t border-line/60 px-4 py-3 transition hover:bg-panel2/60 sm:table-row sm:p-0 sm:align-top"
                  >
                    <td className="mr-3 inline-block whitespace-nowrap text-xs text-ink-soft sm:mr-0 sm:table-cell sm:px-4 sm:py-2">
                      {quand}
                    </td>
                    <td className="inline-block text-xs font-semibold tabular-nums sm:table-cell sm:px-4 sm:py-2">
                      ×{o.occurrences.toLocaleString("fr-FR")}
                    </td>
                    <td className="mt-1 block min-w-0 sm:mt-0 sm:table-cell sm:px-4 sm:py-2">
                      <span className="chip-mono">{o.route ?? "—"}</span>
                      {/* Vue nommée par le SDK (mobile, routeur applicatif) : elle précise
                          la route sans la remplacer. Absente : rien n'est deviné. */}
                      {o.view_name && (
                        <span className="mt-0.5 block max-w-40 truncate text-[11px] text-ink-faint" title={o.view_name}>
                          vue {o.view_name}
                        </span>
                      )}
                    </td>
                    <td className={CELLULE}>
                      <span className="text-ink-faint sm:hidden">Release</span>
                      <span className="font-mono">{o.release ?? "—"}</span>
                    </td>
                    <td className={CELLULE}>
                      <span className="text-ink-faint sm:hidden">Source</span>
                      <span>
                        {o.error_source ? ERROR_SOURCE_LABELS[o.error_source] : "Inconnue"}
                        {o.handled !== null && (
                          <span className="ml-1 text-ink-faint sm:ml-0 sm:block">{o.handled ? "gérée" : "non gérée"}</span>
                        )}
                        {/* `is_fatal` est déclaré par l'émetteur : inconnu (null) n'est pas
                            « non fatale », et ne s'écrit donc pas. */}
                        {o.is_fatal === true && (
                          <span className="ml-1 font-semibold text-bad-ink sm:ml-0 sm:block" data-testid="occurrence-fatale">
                            fatale
                          </span>
                        )}
                      </span>
                    </td>
                    {messagesVaries && (
                      <td
                        className="mt-1 block max-w-full truncate text-xs text-ink-soft sm:mt-0 sm:table-cell sm:max-w-sm sm:px-4 sm:py-2"
                        title={o.message ?? ""}
                      >
                        {o.message ?? "—"}
                      </td>
                    )}
                    <td className={CELLULE}>
                      <span className="text-ink-faint sm:hidden">Appareil</span>
                      {o.device_type ?? "Inconnu"}
                    </td>
                    <td className="mt-2 block text-xs sm:mt-0 sm:table-cell sm:px-4 sm:py-2">
                      <OccurrenceLinks href={href} action={o.links.action} quand={quand} />
                    </td>
                  </tr>
                );
              })}
          </LignesParPaquets>
          </div>
        </TableDefilante>
      ) : (
        <p className="px-4 py-3 text-xs text-ink-soft">
          <span aria-hidden className="mr-1.5 text-ink-faint">
            ⊘
          </span>
          Aucune occurrence sur cette période avec ces filtres
        </p>
      )}
      {(firstHref || nextHref) && (
        <nav
          aria-label="Pagination des occurrences"
          className="flex flex-wrap justify-between gap-3 border-t border-line px-4 py-3 text-sm"
        >
          {firstHref ? (
            <Link href={firstHref} className={ERROR_LINK}>
              Occurrences les plus récentes
            </Link>
          ) : (
            <span />
          )}
          {nextHref && (
            <Link href={nextHref} className={ERROR_LINK}>
              Occurrences suivantes
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}

function OccurrenceLinks({
  href,
  action,
  quand,
}: {
  href: OccurrenceHrefs;
  action: ErrorOccurrenceLinks["action"];
  quand: string;
}) {
  if (!href.session && !href.replay && !href.trace && !action) return <span className="text-ink-faint">—</span>;
  // Le nom accessible précise l'occurrence : dix liens « Session » identiques ne
  // se distinguent pas dans la liste des liens d'un lecteur d'écran.
  const occurrence = <span className="sr-only"> de l&apos;occurrence du {quand}</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {href.session && (
        <Link href={href.session} className={ERROR_LINK}>
          Session{occurrence}
        </Link>
      )}
      {href.replay && (
        <Link href={href.replay} className={ERROR_LINK}>
          Rejeu{occurrence}
        </Link>
      )}
      {href.trace && (
        <Link href={href.trace} className={ERROR_LINK}>
          Trace{occurrence}
        </Link>
      )}
      {action && (
        // Une ligne, tronquée, le nom complet en infobulle : la pastille s'écrasait en
        // ovale de cinq lignes dans une colonne étroite.
        <span
          className="block max-w-[14rem] truncate whitespace-nowrap rounded-full border border-perf/30 bg-perf/10 px-2 py-0.5 text-[11px] font-medium text-ink"
          title={`Action : ${libelleAction(action.name ?? action.id)}`}
        >
          Action : {action.name ? libelleAction(action.name) : action.id.slice(0, 8)}
        </span>
      )}
    </div>
  );
}
