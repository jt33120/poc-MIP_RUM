// Liste /errors quand le regroupement v2 est actif (P5.5) : issues et groupes
// historiques qu'aucune issue ne reprend, sur la même population que la liste
// historique. Chaque occurrence est comptée dans UNE seule ligne. Rendu serveur :
// la page lit, ce composant présente.
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorTypeBadge } from "@/components/errors/ErrorBadges";
import { ErrorNotices } from "@/components/errors/ErrorNotices";
import { ERROR_LINK } from "@/components/errors/ErrorOccurrences";
import { GroupSparkline } from "@/components/errors/GroupSparkline";
import {
  GroupingBasisBadge,
  IssueOriginBadge,
  IssueStatusBadge,
  LegacyEntryBadge,
  ReappearedBadge,
} from "@/components/errors/IssueBadges";
import { errorGroupHref, errorsHref, fmtCount, issueHref, issueListHref } from "@/components/errors/error-view";
import { INPUT_CLASS } from "@/components/forms/Field";
import {
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
  type IssueEntry,
  type IssueListFilters,
  type IssueListResult,
} from "@/lib/error-issues";
import { fmtDate } from "@/lib/format";
import { ERROR_SOURCES, ERROR_SOURCE_LABELS, type ErrorFilters, type ErrorTrendPoint } from "@/lib/queries-errors";

const TITRE = "Erreurs JS";
const SOUS_TITRE =
  "Issues : une ligne = un problème identifié durablement (regroupement v2). Les groupes historiques qu'aucune issue ne reprend restent listés, sans double compte.";

export function IssueListInvalid({ f, raison }: { f: ErrorFilters; raison: string }) {
  return (
    <div className="animate-fade-up">
      <PageHeader title={TITRE} sub={SOUS_TITRE} />
      <div role="alert" className="card border-bad/30 p-6 text-sm text-bad-ink">
        {raison}{" "}
        <Link href={errorsHref("/errors", f, f.app)} className={ERROR_LINK}>
          Revenir à la liste sans filtre
        </Link>
      </div>
    </div>
  );
}

export function IssueList({
  f,
  filtres,
  result,
  curseur,
  limit,
  label,
  sousTitre,
  avertissements,
  apercu,
  decoupage,
  vue = {},
}: {
  f: ErrorFilters;
  filtres: IssueListFilters;
  result: IssueListResult;
  /** Plage lue (« 24 h », ou dates), dans le fuseau de l'app. */
  label: string;
  /** Question de l'écran (P1), la même que la liste historique. */
  sousTitre: string;
  /** Lignes « Réglage d'affichage ignoré », rendues sous l'en-tête. */
  avertissements?: ReactNode;
  /**
   * Tuiles et hero de l'écran (F18), rendus par la page : les deux listes montrent
   * les MÊMES chiffres de la population, que les filtres de statut et de source de
   * la liste des issues ne découpent pas.
   */
  apercu?: ReactNode;
  /** La page affichée suit un curseur. */
  curseur: boolean;
  /** Limite demandée explicitement, qui suit la pagination. */
  limit: string | null;
  /** Découpage par dimension (P6.3), rendu par la page — les deux listes le partagent. */
  decoupage?: ReactNode;
  /**
   * Paramètres de VUE de l'écran (onglet de découpage) : ils ne filtrent rien, mais
   * suivent la pagination et le formulaire — sans quoi paginer remettrait l'onglet
   * au défaut sous les yeux de l'utilisateur.
   */
  vue?: Record<string, string>;
}) {
  const { issues, total, coverage, sampling, enrichment } = result;
  const trend = result.trend ?? [];
  // La release est un champ visible du formulaire : la cacher aussi la répéterait, et le
  // contrat refuse un paramètre répété.
  const cachees = [...new URLSearchParams(errorsHref("/errors", f, f.app, vue).split("?")[1])].filter(
    ([nom]) => nom !== "release",
  );
  const limite: Record<string, string> = { ...vue, ...(limit ? { limit } : {}) };
  const filtre = Boolean(filtres.status || filtres.source || filtres.release);

  return (
    <div className="animate-fade-up">
      <PageHeader title={TITRE} sub={sousTitre} />
      {avertissements}

      <ErrorNotices sampling={sampling} enrichment={enrichment} />
      {apercu}

      <h2 id="groupes-erreurs" className="mb-2 text-sm font-semibold text-ink">
        Issues et groupes historiques ({total.toLocaleString("fr-FR")})
      </h2>
      <p className="mb-3 text-xs text-ink-soft">{SOUS_TITRE}</p>

      <form method="get" action="/errors" className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filtres des issues">
        {cachees.map(([nom, valeur]) => (
          <input key={nom} type="hidden" name={nom} value={valeur} />
        ))}
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Statut
          <select name="status" defaultValue={filtres.status ?? ""} className={INPUT_CLASS}>
            <option value="">Tous</option>
            {ISSUE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ISSUE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Source
          <select name="source" defaultValue={filtres.source ?? ""} className={INPUT_CLASS}>
            <option value="">Toutes</option>
            {ERROR_SOURCES.map((source) => (
              <option key={source} value={source}>
                {ERROR_SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Release exacte
          <input name="release" defaultValue={filtres.release ?? ""} maxLength={200} placeholder="1.4.2" className={INPUT_CLASS} />
        </label>
        <div className="flex items-end gap-2">
          <button className="btn-accent" type="submit">
            Filtrer
          </button>
          {filtre && (
            <Link href={errorsHref("/errors", f, f.app, vue)} className="btn-ghost">
              Réinitialiser
            </Link>
          )}
        </div>
      </form>

      {coverage.occurrences_legacy > 0 && (
        <p role="note" className="mb-6 rounded-lg border border-line bg-panel2 px-4 py-3 text-sm text-ink-soft" data-testid="issue-coverage">
          {coverage.occurrences_legacy.toLocaleString("fr-FR")} occurrence(s) restent dans des groupes historiques
          qu&apos;aucune issue ne reprend seule : antérieures au regroupement v2, d&apos;une application où il n&apos;est pas
          actif, ou d&apos;une signature répartie sur plusieurs issues.
        </p>
      )}

      {/* L'ordre de la liste, écrit (CP9) : il vivait dans la lecture de l'ancien hero. */}
      <p className="mb-3 text-xs leading-relaxed text-ink-soft" data-testid="ordre-liste">
        Triées pour le triage : à revoir, réapparitions, ouvertes, résolues, ignorées, puis par impact. « À revoir » :
        les groupes historiques repris portaient des statuts différents. « Faible confiance » : aucune frame
        applicative n&apos;a pu identifier l&apos;erreur. Tous les compteurs portent sur {label}, sauf « Première vue ».
      </p>

      <div className="card relative overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <caption className="sr-only">Issues et groupes historiques sur {label}, triés par statut puis par impact</caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className="th">Issue</th>
              <th scope="col" className="th">Occurrences</th>
              <th scope="col" className="th">Sessions</th>
              <th scope="col" className="th">Visiteurs</th>
              <th scope="col" className="th">Tendance · {label}</th>
              <th scope="col" className="th">
                Première vue <span className="font-normal text-ink-faint">(depuis toujours)</span>
              </th>
              <th scope="col" className="th">Dernière vue</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((entry) => (
              <IssueRow key={entryKey(entry)} entry={entry} f={f} trend={trend} label={label} />
            ))}
            {!issues.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-faint">
                  {curseur ? (
                    <Link href={issueListHref(f, filtres, limite)} className={ERROR_LINK}>
                      Aucune entrée à cette position — revenir au début de la liste
                    </Link>
                  ) : filtre ? (
                    "Aucune issue ne correspond à ces filtres sur cette période"
                  ) : (
                    "Aucune erreur sur cette période"
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(curseur || result.next_cursor) && (
        <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pagination des issues">
          {curseur ? (
            <Link href={issueListHref(f, filtres, limite)} className={ERROR_LINK}>
              Début de la liste
            </Link>
          ) : (
            <span />
          )}
          {result.next_cursor && (
            <Link href={issueListHref(f, filtres, { ...limite, cursor: result.next_cursor })} className={ERROR_LINK}>
              Entrées suivantes
            </Link>
          )}
        </nav>
      )}

      {/* Répartition après la liste (§ 5.3.1, zone 5). */}
      {decoupage && <div className="mt-6">{decoupage}</div>}
    </div>
  );
}

function entryKey(entry: IssueEntry): string {
  return entry.kind === "issue" ? entry.id : `legacy:${entry.app_id}:${entry.fingerprint}`;
}

function IssueRow({ entry, f, trend, label }: { entry: IssueEntry; f: ErrorFilters; trend: ErrorTrendPoint[]; label: string }) {
  const message = entry.sample_message ?? "(sans message)";
  const attenuee = (entry.status === "resolved" || entry.status === "ignored") && !entry.reappeared;
  const href = entry.kind === "issue" ? issueHref(entry, f) : errorGroupHref(entry, f);
  return (
    <tr
      className={`border-t border-line/60 align-top transition hover:bg-panel2/60 ${attenuee ? "opacity-60" : ""}`}
      data-testid={entry.kind === "issue" ? `issue-entry-${entry.id}` : `legacy-entry-${entry.fingerprint}`}
      data-app-id={entry.app_id}
    >
      <td className="max-w-md px-4 py-3">
        {/* Un seul lien par ligne : une tabulation par entrée au clavier. */}
        <Link href={href} className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
          <ErrorTypeBadge type={entry.error_type} />
          <IssueStatusBadge status={entry.status} />
          <ReappearedBadge reappeared={entry.reappeared} />
          {entry.kind === "issue" ? (
            <>
              <IssueOriginBadge origin={entry.origin} />
              {entry.grouping_basis === "low_confidence" && <GroupingBasisBadge basis={entry.grouping_basis} />}
            </>
          ) : (
            <LegacyEntryBadge />
          )}
          <span className="break-words font-medium text-ink" title={entry.sample_message ?? ""}>
            {message.slice(0, 120)}
          </span>
          <span className="mt-0.5 block break-all font-mono text-xs text-ink-faint">
            {entry.kind === "issue" ? `issue ${entry.id.slice(0, 8)}` : `fingerprint ${entry.fingerprint}`} · {entry.app_id}
          </span>
        </Link>
      </td>
      <td className="px-4 py-3 font-bold tabular-nums" data-testid="entry-occurrences">
        {entry.occurrences.toLocaleString("fr-FR")}
      </td>
      <td className="px-4 py-3 tabular-nums">{fmtCount(entry.sessions_affected)}</td>
      <td className="px-4 py-3 tabular-nums">{fmtCount(entry.visitors_affected)}</td>
      <td className="px-4 py-3">
        <GroupSparkline
          values={entry.series ?? trend.map(() => 0)}
          label={`${entry.occurrences.toLocaleString("fr-FR")} occurrence(s) sur ${label}`}
        />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">{fmtDate(entry.first_seen)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">{fmtDate(entry.last_seen)}</td>
    </tr>
  );
}
