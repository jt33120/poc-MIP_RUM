// Occurrences d'un groupe historique ou d'une issue : les plus récentes d'abord,
// chacune avec SES propres horodatage, release, source et liens vérifiés dans la
// même app, puis la pagination par curseur. Rendu serveur.
import Link from "next/link";
import { occurrenceHrefs, type OccurrenceHrefs } from "@/components/errors/error-view";
import { fmtDate } from "@/lib/format";
import { ERROR_SOURCE_LABELS, type ErrorOccurrenceLinks, type ErrorOccurrenceRow } from "@/lib/queries-errors";

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
  return (
    <section className="card overflow-hidden" aria-labelledby="occurrences-title">
      <h2
        id="occurrences-title"
        className="border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint"
      >
        Occurrences ({occurrences.length} affichées)
      </h2>
      {occurrences.length ? (
        // `relative` : sans ancêtre positionné, un `.sr-only` échappe au défilement et élargit la page.
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-table text-sm">
            <caption className="sr-only">{caption}</caption>
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
                <th scope="col" className="th">Message</th>
                <th scope="col" className="th">Appareil</th>
                <th scope="col" className="th">Liens</th>
              </tr>
            </thead>
            <tbody>
              {occurrences.map((o) => {
                const href = occurrenceHrefs(appId, o);
                const quand = fmtDate(o.ts);
                return (
                  <tr key={o.id} className="border-t border-line/60 align-top transition hover:bg-panel2/60">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft">{quand}</td>
                    <td className="px-4 py-2 text-xs font-semibold tabular-nums">×{o.occurrences.toLocaleString("fr-FR")}</td>
                    <td className="px-4 py-2">
                      <span className="chip-mono">{o.route ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{o.release ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink-soft">
                      {o.error_source ? ERROR_SOURCE_LABELS[o.error_source] : "Inconnue"}
                      {o.handled !== null && (
                        <span className="block text-ink-faint">{o.handled ? "gérée" : "non gérée"}</span>
                      )}
                    </td>
                    <td className="max-w-sm truncate px-4 py-2 text-xs text-ink-soft" title={o.message ?? ""}>
                      {o.message ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-soft">{o.device_type ?? "Inconnu"}</td>
                    <td className="px-4 py-2 text-xs">
                      <OccurrenceLinks href={href} action={o.links.action} quand={quand} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
          Replay{occurrence}
        </Link>
      )}
      {href.trace && (
        <Link href={href.trace} className={ERROR_LINK}>
          Trace{occurrence}
        </Link>
      )}
      {action && (
        <span className="rounded-full border border-perf/30 bg-perf/10 px-2 py-0.5 text-[11px] font-medium text-ink">
          Action « {action.name ?? action.id.slice(0, 8)} »
        </span>
      )}
    </div>
  );
}
