// Détail d'une issue d'erreurs (P5.5) : son état, les groupes historiques qu'elle
// reprend avec leurs statuts et leurs notes, puis impact, tendance, stack et
// occurrences sur la fenêtre et les filtres — la même base que la liste.
//
// Workflow (P5.6) : triage, assignation et liens de ticket sous l'état, historique
// et commentaires en fin de page ; les formulaires ne sont rendus qu'à un admin hors
// démo, et l'API applique la même règle. L'URL reste valide après un retour arrière
// du regroupement v2, et quand le bug se tait sur la période.
//
// ALIGNÉE SUR LE DÉTAIL D'UN GROUPE (F21, plan § 5.3.3). Les blocs 2 à 7 sont ceux
// de `/errors/[fingerprint]`, rendus par LES MÊMES composants
// (`components/errors/DetailErreur.tsx`) : phrase d'impact et quatre tuiles,
// versions touchées, occurrences dans le temps en barres avec les déploiements, ce
// qu'ont en commun les sessions touchées (repli tant que B3 manque), pile du dernier
// exemplaire, occurrences. La rangée de sept tuiles `ErrorStat` et la courbe sans axe
// `ObservedTrend` disparaissent (§ 5.3.4). Du bloc 1, l'en-tête reprend « Voir le
// rejeu » (`BoutonRejeu`, revue de fin de vague 7). Reste propre à l'issue : son
// en-tête, son état, triage et assignation, tickets, activité.
//
// DEUX SOURCES PROPRES À L'ISSUE, dites à l'écran. La part des sessions touchées
// compte les lignes DE L'ISSUE (`partSessionsTouchees` sur une `IssueRef`, même
// rattachement qu'`issueDetail`) ; les versions touchées sont celles que l'issue
// persiste (`first_release`, `last_release`), que ni la fenêtre ni les filtres ne
// bornent.
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ErrorSourceBadge, ErrorTypeBadge, HandledBadge } from "@/components/errors/ErrorBadges";
import {
  BoutonRejeu,
  OccurrencesDansLeTemps,
  PhraseImpact,
  QuOntEnCommun,
  TuilesDetailErreur,
  VersionsTouchees,
  comptesTouches,
  porteeOccurrences,
  versionsDeLIssue,
  type PartGroupe,
} from "@/components/errors/DetailErreur";
import { ErrorNotices } from "@/components/errors/ErrorNotices";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { ERROR_LINK, ErrorOccurrences } from "@/components/errors/ErrorOccurrences";
import { ErrorStackCard } from "@/components/errors/ErrorStackCard";
import { GroupingBasisBadge, IssueOriginBadge, IssueStatusBadge, ReappearedBadge } from "@/components/errors/IssueBadges";
import { IssueActivitySection, IssueTriageCard } from "@/components/errors/IssueWorkflow";
import { IssueTicketCard } from "@/components/errors/IssueTickets";
import { errorGroupHref, errorSearchParams, errorsHref, issueHref } from "@/components/errors/error-view";
import { SectionErreur } from "@/components/states/SectionErreur";
import { annotationsDeploiements } from "@/lib/annotations";
import { getUser } from "@/lib/auth";
import { issueWorkflowView, listIssueActivity } from "@/lib/error-issue-workflow";
import { ISSUE_STATUS_LABELS, isIssueId, issueDetail, resolveIssue, type IssueDetailResult } from "@/lib/error-issues";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { lire } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { listDeploys } from "@/lib/queries-deploys";
import { UnsupportedFilterError } from "@/lib/query-compiler";
import { bucketStarts } from "@/lib/query-contract";
import { grilleIso } from "@/lib/series";
import { gabaritZoom } from "@/lib/view-state";
import {
  apercuTicket,
  integrationsUtilisables,
  livraisonsTicket,
  origineConsole,
} from "@/lib/queries-ticket-integrations";
import {
  errorScopeFor,
  parseErrorCursor,
  parseOccurrencesPage,
  partSessionsTouchees,
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
  const ecran = await pageFilters(sp, `/errors/issues/${id}`);
  if (!ecran.ok) return <FilterProblemNotice title="Erreurs JS" problem={ecran.problem} />;
  const f = ecran.deviceFilters;
  const { label, bucketLabel, query } = ecran;
  const { range } = query;
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
        <div role="alert" className="card border-bad/30 p-6 text-sm text-bad-ink">
          Curseur de pagination invalide : il ne provient pas de cette console.{" "}
          <Link href={issueHref(issue, f)} className={ERROR_LINK}>
            Revenir aux occurrences les plus récentes
          </Link>
        </div>
      </div>
    );
  }

  // CHAQUE LECTURE EST INDÉPENDANTE (§ 3.8), comme sur la page d'un groupe : la part
  // et les déploiements sont deux sections, lues avec le détail, et l'échec de l'une
  // n'efface pas les autres. La part divise par des sessions avec VUE : un filtre que
  // les pages vues ne portent pas (`service`) la refuse — un refus de contrat pour
  // CETTE phrase, pas une panne de l'écran (V10).
  const [detail, part, deploys] = await Promise.all([
    issueDetail(issue, f, { limit: parseOccurrencesPage(url).limit, cursor }),
    lire<PartGroupe>(async () => {
      try {
        return { lu: await partSessionsTouchees(f, { app_id: issue.app_id, issue_id: issue.id }) };
      } catch (e) {
        if (e instanceof UnsupportedFilterError) return { refus: e.message };
        throw e;
      }
    }),
    lire(() => listDeploys({ ...ecran.filters, app: issue.app_id }, 20)),
  ]);
  const { impact, trend, last_sample: last, occurrences, sampling, enrichment } = detail;
  // Ce que couvrent les occurrences affichées (blocs 1 et 5) : en paginant, ni « la
  // fenêtre » ni « les plus récentes » — cette page seulement.
  const portee = porteeOccurrences({ curseur: cursor !== null, suite: detail.next_cursor !== null });
  // Workflow P5.6 : null avant migration-v73. Un curseur d'historique illisible rend la page la plus récente.
  // Les adresses des comptes (acteurs, assignés) ne sont lues que pour un admin.
  const admin = user?.role === "admin" && !user.demo;
  const workflow = await issueWorkflowView(issue.id, issue.app_id, { emails: admin });
  const activiteCurseur = parseErrorCursor(url.get("activite")) ?? null;
  const activite = workflow
    ? await listIssueActivity(issue.id, scopeApps(errorScopeFor(user)), { limit: 20, cursor: activiteCurseur }, { emails: admin })
    : null;
  const pageExtra = url.has("limit") ? { limit: url.get("limit") ?? "" } : undefined;

  // Connecteur de tickets (P8.6). L'aperçu n'est composé que pour un admin qui a
  // au moins un connecteur utilisable : c'est un calcul inutile sinon, et la
  // carte ne serait de toute façon pas rendue.
  const integrationsTickets = admin ? await integrationsUtilisables(issue.app_id) : [];
  const livraisons = await livraisonsTicket(issue.id, scopeApps(errorScopeFor(user)));
  const apercuTickets =
    integrationsTickets.length > 0
      ? await apercuTicket(issue.id, scopeApps(errorScopeFor(user)), origineConsole(await headers()))
      : null;

  // Zoom sur un seau : la plage change, et rien d'autre (§ 3.3) ; la pagination des
  // occurrences repart du début (`cursor` est laissé derrière par `gabaritZoom`).
  const contratZoom = new URLSearchParams(issueHref(issue, f).split("?")[1]);
  contratZoom.delete("period");
  contratZoom.set("from", "{from}");
  contratZoom.set("to", "{to}");
  const zoomHref = gabaritZoom(`/errors/issues/${encodeURIComponent(issue.id)}?${contratZoom}`, sp);
  // Un déploiement mène à l'écran courant, releases comparées (§ 3.3), comme sur la page d'un groupe.
  const annotations = annotationsDeploiements(deploys.ok ? deploys.data : [], range, {
    lien: (relB, relA) => issueHref(issue, f, { cmp: "release", rel_b: relB, ...(relA ? { rel_a: relA } : {}) }),
  });

  return (
    <div className="animate-fade-up">
      <BackLink f={f} />
      <h1 className="mb-1 flex min-w-0 items-center gap-3 text-xl font-bold tracking-tight">
        <ErrorTypeBadge type={detail.error_type} large />
        <span className="min-w-0 truncate" title={detail.sample_message ?? ""}>
          {detail.sample_message ?? "(aucune occurrence sur cette période)"}
        </span>
      </h1>
      <div className="mb-6 flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-all font-mono text-xs text-ink-faint">
          issue {issue.id} · app {issue.app_id}
        </span>
        <IssueStatusBadge status={issue.status} testid="issue-status" />
        <ReappearedBadge reappeared={issue.reappeared} />
        <IssueOriginBadge origin={issue.origin} testid="issue-origin" />
        <GroupingBasisBadge basis={issue.grouping_basis} />
        <ErrorSourceBadge source={last?.error_source ?? null} />
        <HandledBadge handled={last?.handled ?? null} />
        {/* Le rejeu au premier niveau, comme sur la page d'un groupe (bloc 1, § 5.3.3) :
            une ancienne URL de groupe d'une app en regroupement v2 mène ICI, et sans
            ce bouton le rejeu ne s'ouvrait qu'occurrence par occurrence. */}
        <span className="basis-full sm:ml-auto sm:basis-auto">
          <BoutonRejeu occurrences={occurrences} appId={issue.app_id} portee={portee} />
        </span>
      </div>

      <IssueState detail={detail} f={f} />

      <IssueTriageCard
        issue={issue}
        workflow={workflow}
        canWrite={admin}
        alertHref={`/alerts?app=${encodeURIComponent(issue.app_id)}&issue=${issue.id}`}
      />

      <IssueTicketCard
        issue={issue}
        integrations={integrationsTickets}
        apercu={apercuTickets?.apercu ?? null}
        deliveries={livraisons.kind === "ok" ? livraisons.value.deliveries : []}
        canWrite={admin}
      />

      <ErrorNotices sampling={sampling} enrichment={enrichment} />

      {/* ── Bloc 2 : phrase d'impact, puis quatre tuiles ── */}
      <SectionErreur titre="Impact de cette issue">
        <PhraseImpact impact={impact} plage={label} part={part} hrefSessions={null} />
        <TuilesDetailErreur impact={impact} plage={label} prefixe="issue" />
        <p className="mb-6 text-xs text-ink-soft" data-testid="issue-vues">
          Première vue {fmtDate(issue.first_seen)} · Dernière vue {fmtDate(issue.last_seen)} — dates de l&apos;issue,
          depuis toujours, groupes historiques repris compris : elles ne suivent pas la fenêtre.
        </p>
      </SectionErreur>

      {/* ── Bloc 3 : versions touchées, celles que l'issue persiste ── */}
      <SectionErreur titre="Versions touchées">
        <VersionsTouchees issue={versionsDeLIssue(issue)} />
      </SectionErreur>

      {/* ── Bloc 4 : occurrences dans le temps ── */}
      <div className="mb-4">
        <SectionErreur titre="Occurrences dans le temps">
          <OccurrencesDansLeTemps
            trend={trend}
            grille={grilleIso(bucketStarts(range))}
            plage={label}
            bucketLabel={bucketLabel}
            seauSecondes={range.bucketSeconds}
            annotations={annotations.annotations}
            annotationsIndisponibles={
              deploys.ok ? (annotations.indisponible ?? undefined) : "marqueurs de déploiement non lus"
            }
            zoomHref={zoomHref}
          />
        </SectionErreur>
      </div>

      {/* ── Bloc 5 : ce que les sessions touchées ont en commun (repli tant que B3 manque) ── */}
      <div className="mb-4">
        <SectionErreur titre="Qu'ont en commun les sessions touchées ?">
          <QuOntEnCommun
            occurrences={occurrences}
            plage={label}
            touchees={comptesTouches(impact).sessions}
            hrefValeur={(cle, valeur) =>
              cle === "route"
                ? errorsHref("/errors", f, issue.app_id, { route: valeur })
                : cle === "release"
                  ? errorsHref("/errors", f, issue.app_id, { release: valeur })
                  : null
            }
            portee={portee}
          />
        </SectionErreur>
      </div>

      {/* ── Bloc 6 : pile du dernier exemplaire ── */}
      <ErrorStackCard appId={issue.app_id} last={last} admin={admin} />

      {/* ── Bloc 7 : occurrences ── */}
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
                    <Link
                      href={errorGroupHref({ app_id: issue.app_id, fingerprint: g.fingerprint }, f, { legacy: "1" })}
                      className={`break-all font-mono text-xs ${ERROR_LINK}`}
                    >
                      {g.fingerprint}
                    </Link>
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
