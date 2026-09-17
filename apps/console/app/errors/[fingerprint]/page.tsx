import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ObservedTrend } from "@/components/charts/ObservedTrend";
import { ErrorSourceBadge, ErrorTypeBadge, HandledBadge } from "@/components/errors/ErrorBadges";
import { ErrorNotices } from "@/components/errors/ErrorNotices";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { ERROR_LINK, ErrorOccurrences } from "@/components/errors/ErrorOccurrences";
import { ErrorStackCard } from "@/components/errors/ErrorStackCard";
import { ErrorStat } from "@/components/errors/ErrorStat";
import { ErrorTriage } from "@/components/errors/ErrorTriage";
import { GroupingBasisBadge, IssueStatusBadge } from "@/components/errors/IssueBadges";
import {
  errorGroupHref,
  errorSearchParams,
  errorsHref,
  fmtCount,
  fmtCoverage,
  issueHref,
} from "@/components/errors/error-view";
import { getUser } from "@/lib/auth";
import { legacyIssueTargets, type LegacyIssueTarget } from "@/lib/error-issues";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { pageFilters } from "@/lib/page-filters";
import { authorizedScope } from "@/lib/query-contract";
import {
  errorGroupDetail,
  errorScopeFor,
  isFingerprintParam,
  parseErrorCursor,
  parseOccurrencesPage,
  resolveErrorGroup,
  scopeApps,
  type ErrorFilters,
  type ErrorGroupRef,
} from "@/lib/queries-errors";

export const dynamic = "force-dynamic";

export default async function ErrorGroup({
  params,
  searchParams,
}: {
  params: Promise<{ fingerprint: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ fingerprint: raw }, sp] = await Promise.all([params, searchParams]);
  let fingerprint = raw;
  try {
    fingerprint = decodeURIComponent(raw);
  } catch {
    /* valeur brute conservée */
  }
  if (!isFingerprintParam(fingerprint)) notFound();

  const user = await getUser();
  const ecran = await pageFilters(sp, `/errors/${encodeURIComponent(fingerprint)}`);
  if (!ecran.ok) return <FilterProblemNotice title="Erreurs JS" problem={ecran.problem} />;
  const f = ecran.deviceFilters;
  const { label, bucketLabel } = ecran;
  const url = errorSearchParams(sp);
  // `legacy=1` : le détail historique lui-même, même quand des issues le reprennent.
  const historique = url.get("legacy") === "1";
  const cursor = parseErrorCursor(url.get("cursor"));
  if (cursor === undefined) {
    return (
      <div className="animate-fade-up">
        <BackLink f={f} />
        <div role="alert" className="card border-bad/30 p-6 text-sm text-bad">
          Curseur de pagination invalide : il ne provient pas de cette console.{" "}
          <Link href={errorsHref(`/errors/${encodeURIComponent(fingerprint)}`, f, f.app)} className={ERROR_LINK}>
            Revenir aux occurrences les plus récentes
          </Link>
        </div>
      </div>
    );
  }

  // ANCIENNES URL (P5.5). Quand le regroupement v2 est actif pour l'app, une issue
  // qui reprend seule ce groupe prend le relais ; plusieurs issues se choisissent
  // explicitement. Avec une app nommée, avant toute lecture de la fenêtre : une
  // issue dont le bug se tait garde son URL. Le détail historique reste à `legacy=1`.
  const relais = async (groupe: ErrorGroupRef) => {
    if (historique) return null;
    const issues = await legacyIssueTargets(groupe);
    if (issues?.length === 1) redirect(issueHref({ id: issues[0].id, app_id: groupe.app_id }, f));
    return issues && issues.length > 1 ? <IssueChooser groupRef={groupe} f={f} issues={issues} /> : null;
  };
  if (f.app) {
    const choix = await relais({ app_id: f.app, fingerprint });
    if (choix) return choix;
  }

  // RÉSOLUTION. Une empreinte n'identifie pas un groupe : deux apps peuvent la
  // partager, et l'ancien détail en retenait une au hasard (`limit 1`). L'app
  // demandée d'abord — une empreinte présente dans A et B s'ouvre sur A si l'URL le
  // dit. Sinon (« all », ou absente de l'app demandée sur cette fenêtre), on
  // cherche dans le périmètre signé ; plusieurs candidates → on fait choisir.
  const explicite = f.app ? await resolveErrorGroup(fingerprint, f, null) : null;
  let ref: ErrorGroupRef;
  if (explicite?.kind === "found") {
    ref = explicite.ref;
  } else {
    const recherche = await resolveErrorGroup(
      fingerprint,
      { ...f, app: null, query: authorizedScope(ecran.query) },
      scopeApps(errorScopeFor(user)),
    );
    if (recherche.kind === "not_found") notFound();
    if (recherche.kind === "ambiguous" || f.app) {
      const choices =
        recherche.kind === "ambiguous"
          ? recherche.candidates.map((c) => ({
              app_id: c.app_id,
              detail: `${c.occurrences.toLocaleString("fr-FR")} occurrence(s) · dernière vue ${fmtDate(c.last_seen)}`,
            }))
          : [{ app_id: recherche.ref.app_id, detail: null }];
      return <GroupChooser fingerprint={fingerprint} f={f} absentFrom={f.app} choices={choices} />;
    }
    ref = recherche.ref;
  }

  // Groupe trouvé dans une autre app que celle de l'URL : ses issues, s'il en a.
  if (ref.app_id !== f.app) {
    const choix = await relais(ref);
    if (choix) return choix;
  }

  const detail = await errorGroupDetail(ref, { ...f, app: ref.app_id }, {
    limit: parseOccurrencesPage(url).limit,
    cursor,
  });
  // Résolue puis disparue entre les deux lectures (rétention, purge) : introuvable.
  if (!detail) notFound();
  const { group, last, occurrences, trend, page, sampling, enrichment } = detail;

  // La limite demandée suit la pagination ; le curseur ne suit jamais un changement de filtre.
  const pageExtra = {
    ...(url.has("limit") ? { limit: String(page.limit) } : {}),
    ...(historique ? { legacy: "1" } : {}),
  };

  return (
    <div className="animate-fade-up">
      <BackLink f={f} />
      <h1 className="mb-1 flex min-w-0 items-center gap-3 text-xl font-bold tracking-tight">
        <ErrorTypeBadge type={group.error_type} large />
        <span className="min-w-0 truncate" title={group.sample_message ?? ""}>
          {group.sample_message ?? "(sans message)"}
        </span>
      </h1>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-xs text-ink-faint">
          fingerprint {group.fingerprint} · app {group.app_id}
        </span>
        {/* Source et caractère géré sont ceux du dernier exemplaire, pas une moyenne du groupe. */}
        <ErrorSourceBadge source={last?.error_source ?? null} />
        <HandledBadge handled={last?.handled ?? null} />
      </div>

      <ErrorTriage
        appId={group.app_id}
        fingerprint={group.fingerprint}
        status={group.status}
        regressed={group.regressed}
      />

      <ErrorNotices sampling={sampling} enrichment={enrichment} />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        <ErrorStat label={`Occurrences · ${label}`} value={group.occurrences.toLocaleString("fr-FR")} testid="detail-occurrences" />
        <ErrorStat label="Sessions touchées" value={fmtCount(group.sessions_affected)} testid="detail-sessions" />
        <ErrorStat label="Visiteurs touchés" value={fmtCount(group.visitors_affected)} testid="detail-users" />
        <ErrorStat label="Utilisateurs identifiés" value={fmtCount(group.identified_users_affected)} />
        <ErrorStat
          label="Couverture identité"
          value={fmtCoverage(group.identity_coverage)}
          hint="part des occurrences rattachées à un visiteur ou à une identité"
        />
        <ErrorStat label="Première vue" value={fmtDate(group.first_seen)} hint="depuis toujours, hors fenêtre" />
        <ErrorStat label="Dernière vue" value={fmtDate(group.last_seen)} />
      </div>

      <div className="mb-6">
        <ObservedTrend
          title={`Occurrences par ${bucketLabel} sur ${label}`}
          rows={trend.map((point) => ({ bucket: point.bucket, value: point.occurrences }))}
          valueLabel="Occurrences"
        />
      </div>

      <ErrorStackCard appId={group.app_id} last={last} admin={user?.role === "admin" && !user.demo} />

      <ErrorOccurrences
        appId={group.app_id}
        occurrences={occurrences}
        caption={`Occurrences du groupe ${group.fingerprint} dans ${group.app_id} sur ${label}, les plus récentes d'abord`}
        firstHref={cursor ? errorGroupHref(group, f, pageExtra) : null}
        nextHref={page.next_cursor ? errorGroupHref(group, f, { ...pageExtra, cursor: page.next_cursor }) : null}
      />
    </div>
  );
}

function BackLink({ f }: { f: ErrorFilters }) {
  return (
    <Link href={errorsHref("/errors", f, f.app)} className={`mb-4 inline-block text-sm ${ERROR_LINK}`}>
      ← Tous les groupes
    </Link>
  );
}

/**
 * Choix explicite de l'app, jamais un tirage : l'empreinte existe dans plusieurs
 * apps du périmètre, ou n'existe plus dans celle demandée mais dans une autre.
 * Les liens gardent période, appareil, segment et bots, pas la pagination.
 */
function GroupChooser({
  fingerprint,
  f,
  absentFrom,
  choices,
}: {
  fingerprint: string;
  f: ErrorFilters;
  absentFrom: string | null;
  choices: { app_id: string; detail: string | null }[];
}) {
  return (
    <div className="animate-fade-up">
      <BackLink f={f} />
      <section className="card max-w-2xl p-6" data-testid="error-group-chooser" aria-labelledby="chooser-title">
        <h1 id="chooser-title" className="text-lg font-bold tracking-tight">
          {choices.length > 1
            ? "Cette signature existe dans plusieurs applications"
            : "Cette signature existe dans une autre application"}
        </h1>
        <p className="mt-1 break-all font-mono text-xs text-ink-faint">fingerprint {fingerprint}</p>
        {absentFrom && (
          <p className="mt-3 text-sm text-ink-soft">
            Absente de <span className="font-mono">{absentFrom}</span> sur cette période.
          </p>
        )}
        <ul className="mt-4 divide-y divide-line/60">
          {choices.map((choice) => (
            <li key={choice.app_id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <Link href={errorGroupHref({ app_id: choice.app_id, fingerprint }, f)} className={`font-mono text-sm ${ERROR_LINK}`}>
                {choice.app_id}
              </Link>
              {choice.detail && <span className="text-xs text-ink-faint">{choice.detail}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * L'ancien groupe est réparti sur plusieurs issues (P5.5) : le regroupement v2
 * distingue des occurrences qu'il confondait. On fait choisir, dans l'app du groupe,
 * et le détail historique reste à un lien.
 */
function IssueChooser({ groupRef, f, issues }: { groupRef: ErrorGroupRef; f: ErrorFilters; issues: LegacyIssueTarget[] }) {
  return (
    <div className="animate-fade-up">
      <BackLink f={f} />
      <section className="card max-w-2xl p-6" data-testid="error-issue-chooser" aria-labelledby="issue-chooser-title">
        <h1 id="issue-chooser-title" className="text-lg font-bold tracking-tight">
          Ce groupe est réparti sur plusieurs issues
        </h1>
        <p className="mt-1 break-all font-mono text-xs text-ink-faint">
          fingerprint {groupRef.fingerprint} · app {groupRef.app_id}
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          Le regroupement v2 distingue des erreurs que cette signature historique réunissait.
        </p>
        <ul className="mt-4 divide-y divide-line/60">
          {issues.map((issue) => (
            <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={issueHref({ id: issue.id, app_id: groupRef.app_id }, f)} className={`break-all font-mono text-sm ${ERROR_LINK}`}>
                issue {issue.id}
              </Link>
              <span className="flex flex-wrap items-center gap-1 text-xs text-ink-faint">
                <IssueStatusBadge status={issue.status} />
                <GroupingBasisBadge basis={issue.grouping_basis} />
                dernière vue {fmtDate(issue.last_seen)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm">
          <Link href={errorGroupHref(groupRef, f, { legacy: "1" })} className={ERROR_LINK}>
            Voir le détail historique de la signature
          </Link>
        </p>
      </section>
    </div>
  );
}
