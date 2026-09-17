// Détail d'une issue d'erreurs (P5.5) : son état, les groupes historiques qu'elle
// reprend avec leurs statuts et leurs notes, puis impact, tendance, stack et
// occurrences sur la fenêtre et les filtres — la même base que la liste.
//
// Workflow (P5.6) : triage, assignation et liens de ticket sous l'état, historique
// et commentaires en fin de page ; les formulaires ne sont rendus qu'à un admin hors
// démo, et l'API applique la même règle. L'URL reste valide après un retour arrière
// du regroupement v2, et quand le bug se tait sur la période.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ObservedTrend } from "@/components/charts/ObservedTrend";
import { ErrorSourceBadge, ErrorTypeBadge, HandledBadge } from "@/components/errors/ErrorBadges";
import { ErrorAccessDenied, ErrorNotices } from "@/components/errors/ErrorNotices";
import { ERROR_LINK, ErrorOccurrences } from "@/components/errors/ErrorOccurrences";
import { ErrorStackCard } from "@/components/errors/ErrorStackCard";
import { ErrorStat } from "@/components/errors/ErrorStat";
import { GroupingBasisBadge, IssueOriginBadge, IssueStatusBadge, ReappearedBadge } from "@/components/errors/IssueBadges";
import { IssueActivitySection, IssueTriageCard } from "@/components/errors/IssueWorkflow";
import { errorGroupHref, errorSearchParams, errorsHref, fmtCount, fmtCoverage, issueHref } from "@/components/errors/error-view";
import { getUser } from "@/lib/auth";
import { issueWorkflowView, listIssueActivity } from "@/lib/error-issue-workflow";
import { ISSUE_STATUS_LABELS, isIssueId, issueDetail, resolveIssue, type IssueDetailResult } from "@/lib/error-issues";
import { PERIODS, type SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import {
  errorPageFilters,
  errorScopeFor,
  parseErrorCursor,
  parseOccurrencesPage,
  scopeApps,
  type ErrorFilters,
} from "@/lib/queries-errors";

export const dynamic = "force-dynamic";

const SOURCE_STATUT = {
  system: "statut initial d'une issue nouvelle, ou rouverte par une régression confirmée",
  migration: "hérité des groupes historiques repris",
  user: "décision de triage",
} as const;

export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isIssueId(id)) notFound();

  const user = await getUser();
  const f = errorPageFilters(sp, user);
  if (!f) return <ErrorAccessDenied />;
  const url = errorSearchParams(sp);
  const cursor = parseErrorCursor(url.get("cursor"));

  const issue = await resolveIssue(id, scopeApps(errorScopeFor(user)));
  if (!issue) notFound();
  // L'identifiant fait foi : une URL portant une autre app est ramenée à celle de
  // l'issue, filtres conservés, curseur abandonné.
  if (f.app !== issue.app_id) redirect(issueHref(issue, f));

  if (cursor === undefined) {
    return (
      <div className="animate-fade-up">
        <BackLink f={f} />
        <div role="alert" className="card border-bad/30 p-6 text-sm text-bad">
          Curseur de pagination invalide : il ne provient pas de cette console.{" "}
          <Link href={issueHref(issue, f)} className={ERROR_LINK}>
            Revenir aux occurrences les plus récentes
          </Link>
        </div>
      </div>
    );
  }

  const detail = await issueDetail(issue, f, { limit: parseOccurrencesPage(url).limit, cursor });
  const { impact, trend, last_sample: last, occurrences, sampling, enrichment } = detail;
  // Workflow P5.6 : null avant migration-v73. Un curseur d'historique illisible rend la page la plus récente.
  const workflow = await issueWorkflowView(issue.id, issue.app_id);
  const activiteCurseur = parseErrorCursor(url.get("activite")) ?? null;
  const activite = workflow
    ? await listIssueActivity(issue.id, scopeApps(errorScopeFor(user)), { limit: 20, cursor: activiteCurseur })
    : null;
  const admin = user?.role === "admin" && !user.demo;
  const { label, bucketLabel } = PERIODS[f.period];
  const pageExtra = url.has("limit") ? { limit: url.get("limit") ?? "" } : undefined;

  return (
    <div className="animate-fade-up">
      <BackLink f={f} />
      <h1 className="mb-1 flex min-w-0 items-center gap-3 text-xl font-bold tracking-tight">
        <ErrorTypeBadge type={detail.error_type} large />
        <span className="min-w-0 truncate" title={detail.sample_message ?? ""}>
          {detail.sample_message ?? "(aucune occurrence sur cette période)"}
        </span>
      </h1>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-xs text-ink-faint">
          issue {issue.id} · app {issue.app_id}
        </span>
        <IssueStatusBadge status={issue.status} testid="issue-status" />
        <ReappearedBadge reappeared={issue.reappeared} />
        <IssueOriginBadge origin={issue.origin} testid="issue-origin" />
        <GroupingBasisBadge basis={issue.grouping_basis} />
        <ErrorSourceBadge source={last?.error_source ?? null} />
        <HandledBadge handled={last?.handled ?? null} />
      </div>

      <IssueState detail={detail} f={f} />

      <IssueTriageCard
        issue={issue}
        workflow={workflow}
        canWrite={admin}
        alertHref={`/alerts?app=${encodeURIComponent(issue.app_id)}&issue=${issue.id}`}
      />

      <ErrorNotices sampling={sampling} enrichment={enrichment} />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        <ErrorStat label={`Occurrences · ${label}`} value={impact.occurrences.toLocaleString("fr-FR")} testid="issue-occurrences" />
        <ErrorStat label="Sessions touchées" value={fmtCount(impact.sessions_affected)} testid="issue-sessions" />
        <ErrorStat label="Visiteurs touchés" value={fmtCount(impact.visitors_affected)} />
        <ErrorStat label="Utilisateurs identifiés" value={fmtCount(impact.identified_users_affected)} />
        <ErrorStat
          label="Couverture identité"
          value={fmtCoverage(impact.identity_coverage)}
          hint="part des occurrences rattachées à un visiteur ou à une identité"
        />
        <ErrorStat
          label="Première vue"
          value={fmtDate(issue.first_seen)}
          hint={issue.first_release ? `release ${issue.first_release}` : "depuis toujours, groupes historiques compris"}
        />
        <ErrorStat
          label="Dernière vue"
          value={fmtDate(issue.last_seen)}
          hint={issue.last_release ? `release ${issue.last_release}` : undefined}
        />
      </div>

      <div className="mb-6">
        <ObservedTrend
          title={`Occurrences par ${bucketLabel} sur ${label}`}
          rows={trend.map((point) => ({ bucket: point.bucket, value: point.occurrences }))}
          valueLabel="Occurrences"
        />
      </div>

      <ErrorStackCard appId={issue.app_id} last={last} admin={admin} />

      <ErrorOccurrences
        appId={issue.app_id}
        occurrences={occurrences}
        caption={`Occurrences de l'issue ${issue.id} dans ${issue.app_id} sur ${label}, les plus récentes d'abord`}
        firstHref={cursor ? issueHref(issue, f, pageExtra) : null}
        nextHref={detail.next_cursor ? issueHref(issue, f, { ...pageExtra, cursor: detail.next_cursor }) : null}
      />

      <IssueActivitySection
        issue={issue}
        activities={activite?.kind === "ok" ? activite.value.activities : null}
        canWrite={admin}
        olderHref={
          activite?.kind === "ok" && activite.value.next_cursor
            ? `${issueHref(issue, f, { activite: activite.value.next_cursor })}#activite`
            : null
        }
        newestHref={activiteCurseur ? `${issueHref(issue, f)}#activite` : null}
      />
    </div>
  );
}

function BackLink({ f }: { f: ErrorFilters }) {
  return (
    <Link href={errorsHref("/errors", f, f.app)} className={`mb-4 inline-block text-sm ${ERROR_LINK}`}>
      ← Toutes les issues
    </Link>
  );
}

/**
 * État de l'issue et ce qui l'explique : d'où vient le statut, si le regroupement
 * v2 rattache encore les nouvelles occurrences, et les groupes historiques repris
 * avec leur statut au rattachement, leur statut actuel et leur note.
 */
function IssueState({ detail, f }: { detail: IssueDetailResult; f: ErrorFilters }) {
  const { issue, legacy_groups: groupes, grouping_active: actif } = detail;
  return (
    <section className="card mb-6 p-4" aria-labelledby="issue-state-title" data-testid="issue-state">
      <h2 id="issue-state-title" className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        État de l&apos;issue
      </h2>
      <p className="mt-2 text-sm text-ink-soft">
        {ISSUE_STATUS_LABELS[issue.status]} — {SOURCE_STATUT[issue.status_source]}.
        {issue.status === "for_review" &&
          issue.status_source === "migration" &&
          " Les groupes historiques repris portaient des statuts différents : la décision reste à prendre."}
      </p>
      {!actif && (
        <p role="status" className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink-soft">
          Regroupement v2 désactivé pour cette application : l&apos;issue reste lisible, ses nouvelles occurrences ne
          lui sont plus rattachées.
        </p>
      )}
      {groupes.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-table text-sm" data-testid="issue-legacy-groups">
            <caption className="mb-2 text-left text-xs text-ink-faint">
              Groupes historiques repris ({groupes.length})
            </caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th">Signature</th>
                <th scope="col" className="th">Statut au rattachement</th>
                <th scope="col" className="th">Statut actuel</th>
                <th scope="col" className="th">Note de triage</th>
              </tr>
            </thead>
            <tbody>
              {groupes.map((g) => (
                <tr key={g.fingerprint} className="border-t border-line/60 align-top">
                  <td className="px-4 py-2">
                    {/* Ancre native : la navigation client vers la même route avec une autre query
                        reste bloquée dans cette console (suivi consigné dans delivery-p5.md). */}
                    <a
                      href={errorGroupHref({ app_id: issue.app_id, fingerprint: g.fingerprint }, f, { legacy: "1" })}
                      className={`break-all font-mono text-xs ${ERROR_LINK}`}
                    >
                      {g.fingerprint}
                    </a>
                    {g.issues > 1 && (
                      <span className="block text-xs text-ink-faint">répartie sur {g.issues} issues</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    {g.legacy_status ? ISSUE_STATUS_LABELS[g.legacy_status] : "Jamais vue avant"}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{ISSUE_STATUS_LABELS[g.current_status]}</td>
                  <td className="max-w-sm break-words px-4 py-2 text-xs text-ink-soft">{g.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
