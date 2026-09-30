// Liste /errors quand le regroupement v2 est actif (P5.5) : issues et groupes
// historiques qu'aucune issue ne reprend, sur la même population que la liste
// historique. Chaque occurrence est comptée dans UNE seule ligne. Rendu serveur :
// la page lit, ce composant présente.
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { InfoTip } from "@/components/InfoTip";
import { ErrorTypeBadge } from "@/components/errors/ErrorBadges";
import { ErrorNotices } from "@/components/errors/ErrorNotices";
import { Sparkline } from "@/components/charts/Sparkline";
import { ERROR_LINK } from "@/components/errors/ErrorOccurrences";
import { CELLULE_GROUPE, CelluleGroupe, echelleCommune, noteEchelle } from "@/components/errors/ListeErreurs";
import {
  GroupingBasisBadge,
  IssueOriginBadge,
  IssueStatusBadge,
  LegacyEntryBadge,
  ReappearedBadge,
} from "@/components/errors/IssueBadges";
import { errorGroupHref, errorsHref, fmtCount, issueHref, issueListHref } from "@/lib/error-view";
import { INPUT_CLASS } from "@/components/forms/Field";
import type { IssueEntry, IssueListFilters, IssueListResult } from "@/lib/error-issues";
import { ISSUE_STATUSES, ISSUE_STATUS_LABELS } from "@/lib/issues-libelles";
import { fmtDate, pluriel } from "@/lib/format";
import { ERROR_SOURCES, ERROR_SOURCE_LABELS } from "@/lib/erreurs-sources";
import type { ErrorFilters, ErrorTrendPoint } from "@/lib/queries-errors";

const TITRE = "Erreurs JS";
// « Groupe » pour l'utilisateur, comme la liste historique (recette du 26/09/2026) :
// le mot « issue » et le numéro de version du regroupement restent dans le code.
const SOUS_TITRE =
  "Une ligne = un problème identifié durablement. Les anciennes signatures qu'aucun groupe ne reprend restent listées, sans double compte.";

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
  bucketLabel,
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
  /** Largeur d'un seau des sparklines (« 1 h ») : l'échelle commune la nomme (F19). */
  bucketLabel?: string;
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
  // Échelle commune des sparklines de la page (F19, § 5.3.2) : une issue à 2
  // occurrences ne doit pas avoir la même hauteur qu'une issue à 500.
  const echelle = echelleCommune(issues);
  const noteTendances = noteEchelle(echelle, bucketLabel ?? null);

  return (
    <div className="animate-fade-up">
      <PageHeader title={TITRE} sub={sousTitre} />
      {avertissements}

      <ErrorNotices sampling={sampling} enrichment={enrichment} />
      {apercu}

      {/* L'en-tête de la liste sur UNE rangée (recette du 30/09/2026) : titre, mode
          d'emploi en bulle, filtres à droite — plus de sous-titre ni de carte de filtres. */}
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="groupes-erreurs" className="scroll-mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
          Groupes ({total.toLocaleString("fr-FR")})
        </h2>
        <div className="flex min-w-0 items-center gap-2 text-xs text-ink-soft" data-testid="ordre-liste">
          <span className="sr-only">Ordre : à revoir, réapparitions, ouverts, résolus, ignorés, puis par impact.</span>
          <InfoTip label="Comment lire cette liste" align="start">
            {SOUS_TITRE} Ordre : à revoir, réapparitions, ouverts, résolus, ignorés, puis par impact. « À revoir » : les
            anciennes signatures reprises portaient des statuts différents. « Regroupement approximatif » : aucune ligne
            de code de l&apos;application n&apos;a pu identifier l&apos;erreur. Tous les compteurs portent sur {label}, sauf
            « Première vue ». {noteTendances}
          </InfoTip>
        </div>

      <form method="get" action="/errors" className="flex min-w-0 flex-wrap items-end gap-2 sm:ml-auto" aria-label="Filtres des groupes">
        {cachees.map(([nom, valeur]) => (
          <input key={nom} type="hidden" name={nom} value={valeur} />
        ))}
        <label className="flex flex-col gap-0.5 text-[11px] font-medium text-ink-soft">
          Statut
          <select name="status" defaultValue={filtres.status ?? ""} className={`${INPUT_CLASS} h-7 text-xs`}>
            <option value="">Tous</option>
            {ISSUE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ISSUE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] font-medium text-ink-soft">
          Source
          <select name="source" defaultValue={filtres.source ?? ""} className={`${INPUT_CLASS} h-7 text-xs`}>
            <option value="">Toutes</option>
            {ERROR_SOURCES.map((source) => (
              <option key={source} value={source}>
                {ERROR_SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] font-medium text-ink-soft">
          Release exacte
          <input
            name="release"
            defaultValue={filtres.release ?? ""}
            maxLength={200}
            placeholder="1.4.2"
            className={`${INPUT_CLASS} h-7 w-28 text-xs`}
          />
        </label>
        <div className="flex items-end gap-2">
          <button className="btn-ghost px-2 py-1" type="submit">
            Filtrer
          </button>
          {filtre && (
            <Link href={errorsHref("/errors", f, f.app, vue)} className="rounded text-xs font-medium text-brand hover:underline">
              Réinitialiser
            </Link>
          )}
        </div>
      </form>
      </div>

      {coverage.occurrences_legacy > 0 && (
        // Une pastille chiffrée ; ce que sont ces anciennes signatures, en bulle.
        <p
          role="note"
          className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-panel2 px-2.5 py-0.5 text-[11px] text-ink-soft"
          data-testid="issue-coverage"
        >
          <span className="font-medium text-ink">
            {pluriel(coverage.occurrences_legacy, "occurrence reste", "occurrences restent")} dans d&apos;anciennes
            signatures
          </span>
          <span className="sr-only">
            {" "}
            qu&apos;aucun groupe ne reprend seul : antérieures au regroupement actuel, d&apos;une application où il
            n&apos;est pas actif, ou d&apos;une signature répartie sur plusieurs groupes.
          </span>
          <InfoTip label="Anciennes signatures" align="start">
            Qu&apos;aucun groupe ne reprend seul : antérieures au regroupement actuel, d&apos;une application où il
            n&apos;est pas actif, ou d&apos;une signature répartie sur plusieurs groupes.
          </InfoTip>
        </p>
      )}

      {/* Sous 640 px, la table devient une pile de cartes (F19, § 5.3.1) : à 390 px,
          occurrences et sessions se lisent sans défilement horizontal. Au-dessus, un
          tableau dense (§ 3.5), comme la liste historique. */}
      <div className="card relative min-w-0 sm:overflow-x-auto">
        <table className="block w-full text-sm sm:table sm:min-w-[56rem]">
          <caption className="sr-only">
            Groupes d&apos;erreurs sur {label}, triés par statut puis par impact. {noteTendances}
          </caption>
          <thead className="hidden bg-panel2 sm:table-header-group">
            <tr>
              <th scope="col" className="th px-3">Groupe</th>
              <th scope="col" className="th whitespace-nowrap px-3 text-right">Occurrences</th>
              <th scope="col" className="th whitespace-nowrap px-3 text-right">Sessions</th>
              <th scope="col" className="th whitespace-nowrap px-3 text-right">Visiteurs</th>
              <th scope="col" className="th whitespace-nowrap px-3">Tendance · {label}</th>
              <th scope="col" className="th whitespace-nowrap px-3 text-right">
                Première vue<span className="sr-only"> (depuis toujours)</span>
              </th>
              <th scope="col" className="th whitespace-nowrap px-3 text-right">Dernière vue</th>
            </tr>
          </thead>
          <tbody className="block sm:table-row-group">
            {issues.map((entry) => (
              <IssueRow key={entryKey(entry)} entry={entry} f={f} trend={trend} label={label} echelle={echelle} />
            ))}
            {!issues.length && (
              <tr className="block sm:table-row">
                <td colSpan={7} className="block px-4 py-3 text-xs text-ink-soft sm:table-cell">
                  {curseur ? (
                    <Link href={issueListHref(f, filtres, limite)} className={ERROR_LINK}>
                      Aucune entrée à cette position — revenir au début de la liste
                    </Link>
                  ) : filtre ? (
                    "Aucun groupe ne correspond à ces filtres sur cette période"
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
        <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pagination des groupes">
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

function IssueRow({
  entry,
  f,
  trend,
  label,
  echelle,
}: {
  entry: IssueEntry;
  f: ErrorFilters;
  trend: ErrorTrendPoint[];
  label: string;
  /** Haut d'échelle partagé par toutes les lignes de la page (F19). */
  echelle?: number;
}) {
  const message = entry.sample_message ?? "(sans message)";
  const attenuee = (entry.status === "resolved" || entry.status === "ignored") && !entry.reappeared;
  const href = entry.kind === "issue" ? issueHref(entry, f) : errorGroupHref(entry, f);
  return (
    <tr
      className={`block border-t border-line/60 px-4 py-2 align-top transition first:border-t-0 hover:bg-panel2/60 sm:table-row sm:p-0 ${
        attenuee ? "opacity-60" : ""
      }`}
      data-testid={entry.kind === "issue" ? `issue-entry-${entry.id}` : `legacy-entry-${entry.fingerprint}`}
      data-app-id={entry.app_id}
    >
      <td className={`block min-w-0 sm:max-w-md ${CELLULE_GROUPE}`}>
        {/* Un seul lien par ligne : une tabulation par entrée au clavier. Deux lignes
            (recette du 30/09/2026) : pastilles et message coupé, puis l'identifiant. */}
        <Link href={href} className="block min-w-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
          <span className="flex min-w-0 flex-wrap items-center gap-y-0.5 sm:flex-nowrap">
            <IssueStatusBadge status={entry.status} />
            <ReappearedBadge reappeared={entry.reappeared} />
            <ErrorTypeBadge type={entry.error_type} />
            {entry.kind === "issue" ? (
              <>
                <IssueOriginBadge origin={entry.origin} />
                {entry.grouping_basis === "low_confidence" && <GroupingBasisBadge basis={entry.grouping_basis} />}
              </>
            ) : (
              <LegacyEntryBadge />
            )}
            <span className="min-w-0 truncate font-medium text-ink" title={entry.sample_message ?? ""}>
              {message.slice(0, 120)}
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-faint">
            {entry.kind === "issue" ? `groupe ${entry.id.slice(0, 8)}` : `signature ${entry.fingerprint}`} · {entry.app_id}
          </span>
        </Link>
      </td>
      <CelluleGroupe libelle="Occurrences" className="sm:text-right sm:text-sm" testId="entry-occurrences">
        <span className="font-bold tabular-nums text-ink">{entry.occurrences.toLocaleString("fr-FR")}</span>
      </CelluleGroupe>
      <CelluleGroupe libelle="Sessions" className="sm:text-right sm:text-sm">
        <span className="tabular-nums">{fmtCount(entry.sessions_affected)}</span>
      </CelluleGroupe>
      <CelluleGroupe libelle="Visiteurs" className="sm:text-right sm:text-sm">
        <span className="tabular-nums">{fmtCount(entry.visitors_affected)}</span>
      </CelluleGroupe>
      <CelluleGroupe libelle="Tendance">
        <Sparkline
          valeurs={entry.series ?? trend.map(() => 0)}
          max={echelle}
          label={`${pluriel(entry.occurrences, "occurrence")} sur ${label}`}
        />
      </CelluleGroupe>
      <CelluleGroupe libelle="Première vue" className="text-ink-soft sm:whitespace-nowrap sm:text-right">
        {fmtDate(entry.first_seen)}
      </CelluleGroupe>
      <CelluleGroupe libelle="Dernière vue" className="text-ink-soft sm:whitespace-nowrap sm:text-right">
        {fmtDate(entry.last_seen)}
      </CelluleGroupe>
    </tr>
  );
}
