// Occurrences d'un groupe historique ou d'une issue : les plus récentes d'abord,
// chacune avec SES propres horodatage, release, source et liens vérifiés dans la
// même app, puis la pagination par curseur. Rendu serveur.
//
// Recette du 26/09/2026 : 55 lignes d'un coup (page de 11 000 px), une colonne
// « Message » qui répétait 55 fois le titre du groupe, et une pastille d'action
// écrasée sur cinq lignes. Les lignes se montrent par paquets de 20
// (`LignesParPaquets`), la colonne Message n'apparaît que si les messages diffèrent,
// et l'action tient sur une ligne, sans préfixe technique.
import Link from "next/link";
import { TableDefilante } from "@/components/TableDefilante";
import { LignesParPaquets } from "@/components/errors/LignesParPaquets";
import { occurrenceHrefs, type OccurrenceHrefs } from "@/lib/error-view";
import { fmtDate, pluriel } from "@/lib/format";
import { libelleAction } from "@/lib/libelle-action";
import { ERROR_SOURCE_LABELS } from "@/lib/erreurs-sources";
import type { ErrorOccurrenceLinks, ErrorOccurrenceRow } from "@/lib/queries-errors";

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
        // Défilement SIGNALÉ : à 390 px, le tableau s'arrêtait après « Route » et les
        // liens Session / Rejeu / Trace restaient hors champ sans indice (recette 26/09).
        // Le nom de la zone ne commence pas par « Occurrences ( » : c'est la section
        // qui porte ce nom-là, et les recettes la visent par lui.
        <TableDefilante label="Tableau des occurrences">
          <LignesParPaquets
            classeTable="w-full min-w-table text-sm"
            legende={caption}
            entete={
              <thead className="bg-panel2">
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
                  <tr key={o.id} className="border-t border-line/60 align-top transition hover:bg-panel2/60">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft">{quand}</td>
                    <td className="px-4 py-2 text-xs font-semibold tabular-nums">×{o.occurrences.toLocaleString("fr-FR")}</td>
                    <td className="px-4 py-2">
                      <span className="chip-mono">{o.route ?? "—"}</span>
                      {/* Vue nommée par le SDK (mobile, routeur applicatif) : elle précise
                          la route sans la remplacer. Absente : rien n'est deviné. */}
                      {o.view_name && (
                        <span className="mt-0.5 block max-w-40 truncate text-[11px] text-ink-faint" title={o.view_name}>
                          vue {o.view_name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{o.release ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink-soft">
                      {o.error_source ? ERROR_SOURCE_LABELS[o.error_source] : "Inconnue"}
                      {o.handled !== null && (
                        <span className="block text-ink-faint">{o.handled ? "gérée" : "non gérée"}</span>
                      )}
                      {/* `is_fatal` est déclaré par l'émetteur : inconnu (null) n'est pas
                          « non fatale », et ne s'écrit donc pas. */}
                      {o.is_fatal === true && (
                        <span className="block font-semibold text-bad-ink" data-testid="occurrence-fatale">
                          fatale
                        </span>
                      )}
                    </td>
                    {messagesVaries && (
                      <td className="max-w-sm truncate px-4 py-2 text-xs text-ink-soft" title={o.message ?? ""}>
                        {o.message ?? "—"}
                      </td>
                    )}
                    <td className="px-4 py-2 text-xs text-ink-soft">{o.device_type ?? "Inconnu"}</td>
                    <td className="px-4 py-2 text-xs">
                      <OccurrenceLinks href={href} action={o.links.action} quand={quand} />
                    </td>
                  </tr>
                );
              })}
          </LignesParPaquets>
        </TableDefilante>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-ink-faint">
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
