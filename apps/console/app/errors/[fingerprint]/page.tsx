import Link from "next/link";
import { notFound } from "next/navigation";
import { ObservedTrend } from "@/components/charts/ObservedTrend";
import { ErrorSourceBadge, ErrorTypeBadge, HandledBadge } from "@/components/errors/ErrorBadges";
import { ErrorAccessDenied, ErrorNotices } from "@/components/errors/ErrorNotices";
import { ErrorTriage } from "@/components/errors/ErrorTriage";
import {
  errorGroupHref,
  errorSearchParams,
  errorsHref,
  fmtCount,
  fmtCoverage,
  occurrenceHrefs,
  type OccurrenceHrefs,
} from "@/components/errors/error-view";
import { getUser } from "@/lib/auth";
import { adminCodeContext, exemplarSymbolication, type StackSymbolication } from "@/lib/error-symbolication";
import { PERIODS, type SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import {
  ERROR_SOURCE_LABELS,
  errorGroupDetail,
  errorPageFilters,
  errorScopeFor,
  isFingerprintParam,
  parseErrorCursor,
  parseOccurrencesPage,
  resolveErrorGroup,
  scopeApps,
  stackSymbolisable,
  type ErrorFilters,
  type ErrorGroupRef,
  type ErrorOccurrenceLinks,
} from "@/lib/queries-errors";
import type { CodeContext } from "@/lib/sourcemap";

export const dynamic = "force-dynamic";

const LINK = "rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

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
  const f = errorPageFilters(sp, user);
  if (!f) return <ErrorAccessDenied />;
  const url = errorSearchParams(sp);
  const cursor = parseErrorCursor(url.get("cursor"));
  if (cursor === undefined) {
    return (
      <div className="animate-fade-up">
        <BackLink f={f} />
        <div role="alert" className="card border-bad/30 p-6 text-sm text-bad">
          Curseur de pagination invalide : il ne provient pas de cette console.{" "}
          <Link href={errorsHref(`/errors/${encodeURIComponent(fingerprint)}`, f, f.app)} className={LINK}>
            Revenir aux occurrences les plus récentes
          </Link>
        </div>
      </div>
    );
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
    const recherche = await resolveErrorGroup(fingerprint, { ...f, app: null }, scopeApps(errorScopeFor(user)));
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

  const detail = await errorGroupDetail(ref, { ...f, app: ref.app_id }, {
    limit: parseOccurrencesPage(url).limit,
    cursor,
  });
  // Résolue puis disparue entre les deux lectures (rétention, purge) : introuvable.
  if (!detail) notFound();
  const { group, last, occurrences, trend, page, sampling, enrichment } = detail;
  const { label, bucketLabel } = PERIODS[f.period];

  // Stack source (P0 #3, P5.4) : écrite par l'ingestion, sinon symbolisée à la
  // lecture si une map est arrivée depuis. L'admin voit en plus le code autour de
  // la première frame résolue ; jamais le viewer, jamais l'API. Jamais sur une
  // stack backend (P5.3) : une map navigateur n'en décrit aucune frame.
  const admin = user?.role === "admin" && !user.demo;
  const symbolication = stackSymbolisable(last?.error_source ?? null)
    ? await exemplarSymbolication(group.app_id, last, { positions: admin })
    : null;
  const deminified = symbolication?.symbolication_status === "resolved" && !!symbolication.stack_symbolicated;
  const premiere = symbolication?.positions[0];
  const contexte =
    admin && deminified && premiere && last?.release ? await adminCodeContext(group.app_id, last.release, premiere) : null;

  // La limite demandée suit la pagination ; le curseur ne suit jamais un changement de filtre.
  const pageExtra = url.has("limit") ? { limit: String(page.limit) } : undefined;

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
        <Stat label={`Occurrences · ${label}`} value={group.occurrences.toLocaleString("fr-FR")} testid="detail-occurrences" />
        <Stat label="Sessions touchées" value={fmtCount(group.sessions_affected)} testid="detail-sessions" />
        <Stat label="Visiteurs touchés" value={fmtCount(group.visitors_affected)} testid="detail-users" />
        <Stat label="Utilisateurs identifiés" value={fmtCount(group.identified_users_affected)} />
        <Stat
          label="Couverture identité"
          value={fmtCoverage(group.identity_coverage)}
          hint="part des occurrences rattachées à un visiteur ou à une identité"
        />
        <Stat label="Première vue" value={fmtDate(group.first_seen)} hint="depuis toujours, hors fenêtre" />
        <Stat label="Dernière vue" value={fmtDate(group.last_seen)} />
      </div>

      <div className="mb-6">
        <ObservedTrend
          title={`Occurrences par ${bucketLabel} sur ${label}`}
          rows={trend.map((point) => ({ bucket: point.bucket, value: point.occurrences }))}
          valueLabel="Occurrences"
        />
      </div>

      <div className="card mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Stack du dernier exemplaire ({last ? fmtDate(last.ts) : "—"})
          {deminified && (
            <span
              data-testid="stack-deminified"
              className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
            >
              dé-minifié{last?.release ? ` · ${last.release}` : ""}
            </span>
          )}
          {!deminified && last?.release && (
            <span className="font-mono text-xs font-normal normal-case tracking-normal text-ink-faint">
              release {last.release}
            </span>
          )}
          {last?.env && (
            <span
              className="font-mono text-xs font-normal normal-case tracking-normal text-ink-faint"
              title="Environnement déclaré par l'émetteur (le SDK web vaut « dev » par défaut) : pas une vérité de déploiement."
            >
              env {last.env} (déclaré)
            </span>
          )}
          {last?.view_name && (
            <span className="font-mono text-xs font-normal normal-case tracking-normal text-ink-faint">
              vue {last.view_name}
            </span>
          )}
          {last?.source && (
            <span className="ml-auto break-all font-mono text-xs font-normal normal-case tracking-normal text-ink-faint">
              {last.source}
              {last.lineno != null && `:${last.lineno}`}
              {last.colno != null && `:${last.colno}`}
            </span>
          )}
        </div>
        <SymbolicationNotice symbolication={symbolication} release={last?.release ?? null} />
        {/* terminal navy permanent : lisible dans les deux thèmes */}
        <pre className="overflow-x-auto bg-navy-950 p-4 text-xs leading-relaxed text-slate-200">
          {(deminified ? symbolication?.stack_symbolicated : last?.stack) ?? last?.message ?? "(pas de stack capturée)"}
        </pre>
        {deminified && last?.stack && (
          <details className="border-t border-line">
            <summary className="cursor-pointer px-4 py-2 text-xs text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
              Stack brute (minifiée)
            </summary>
            <pre className="overflow-x-auto bg-navy-950 p-4 text-xs leading-relaxed text-slate-300">{last.stack}</pre>
          </details>
        )}
        {contexte && <CodeContextBlock context={contexte} />}
      </div>

      <section className="card overflow-hidden" aria-labelledby="occurrences-title">
        <h2
          id="occurrences-title"
          className="border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint"
        >
          Occurrences ({occurrences.length} affichées)
        </h2>
        {occurrences.length ? (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-table text-sm">
              <caption className="sr-only">
                Occurrences du groupe {group.fingerprint} dans {group.app_id} sur {label}, les plus récentes
                d&apos;abord
              </caption>
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
                  const href = occurrenceHrefs(group.app_id, o);
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
        {(cursor || page.next_cursor) && (
          <nav
            aria-label="Pagination des occurrences"
            className="flex flex-wrap justify-between gap-3 border-t border-line px-4 py-3 text-sm"
          >
            {cursor ? (
              // Ancres natives : même route, autre query (voir le choix d'application plus bas).
              <a href={errorGroupHref(group, f, pageExtra)} className={LINK}>
                Occurrences les plus récentes
              </a>
            ) : (
              <span />
            )}
            {page.next_cursor && (
              <a href={errorGroupHref(group, f, { ...pageExtra, cursor: page.next_cursor })} className={LINK}>
                Occurrences suivantes
              </a>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}

/**
 * Pourquoi la stack affichée n'est pas en positions source, dit explicitement :
 * une release sans map, une map inutilisable ou une symbolication différée ne se
 * confondent pas avec une stack réellement résolue.
 */
function SymbolicationNotice({
  symbolication,
  release,
}: {
  symbolication: StackSymbolication | null;
  release: string | null;
}) {
  const status = symbolication?.symbolication_status;
  if (!symbolication || !status) return null;
  if (status === "resolved") {
    return symbolication.origin === "lecture" ? (
      <p className="border-b border-line px-4 py-2 text-xs text-ink-soft">
        Symbolisée à l&apos;affichage : la source map de la release a été mise en ligne après l&apos;erreur.
      </p>
    ) : null;
  }
  const titre =
    status === "failed" ? "Source map inutilisable" : status === "pending" ? "Symbolication différée" : "Stack non symbolisée";
  // Une app sans source map n'est pas en défaut : seuls l'échec et le report alertent.
  const ton = status === "unavailable" ? "bg-panel2" : "bg-warn/10";
  return (
    <p role="status" data-testid="symbolication-status" className={`border-b border-line px-4 py-2 text-xs text-ink-soft ${ton}`}>
      <strong className="font-semibold text-ink">{titre}</strong>
      {" — "}
      {symbolication.reason ?? (release ? `aucune source map exploitable pour la release ${release}` : "release absente")}
    </p>
  );
}

/** ±3 lignes de code source autour de la première frame résolue (admin seulement). */
function CodeContextBlock({ context }: { context: CodeContext }) {
  return (
    <figure className="border-t border-line" data-testid="code-context">
      <figcaption className="break-all px-4 py-2 font-mono text-xs text-ink-soft">
        {context.source}:{context.line} <span className="font-sans text-ink-faint">· visible par les admins</span>
      </figcaption>
      <pre className="relative overflow-x-auto bg-navy-950 py-3 text-xs leading-relaxed text-slate-300">
        {context.lines.map((ligne, i) => {
          const numero = context.start + i;
          const courante = numero === context.line;
          return (
            <div key={numero} className={courante ? "bg-accent/20 px-4 text-slate-100" : "px-4"}>
              <span className="mr-4 inline-block w-10 select-none text-right text-slate-500" aria-hidden="true">
                {numero}
              </span>
              <span className="sr-only">{courante ? `ligne ${numero}, frame résolue : ` : `ligne ${numero} : `}</span>
              {ligne}
            </div>
          );
        })}
      </pre>
    </figure>
  );
}

function BackLink({ f }: { f: ErrorFilters }) {
  return (
    <Link href={errorsHref("/errors", f, f.app)} className={`mb-4 inline-block text-sm ${LINK}`}>
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
              {/* Ancre native : la navigation client vers la même route avec une autre query
                  reste bloquée dans cette console (suivi consigné dans delivery-p5.md). */}
              <a href={errorGroupHref({ app_id: choice.app_id, fingerprint }, f)} className={`font-mono text-sm ${LINK}`}>
                {choice.app_id}
              </a>
              {choice.detail && <span className="text-xs text-ink-faint">{choice.detail}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
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
        <Link href={href.session} className={LINK}>
          Session{occurrence}
        </Link>
      )}
      {href.replay && (
        <Link href={href.replay} className={LINK}>
          Replay{occurrence}
        </Link>
      )}
      {href.trace && (
        <Link href={href.trace} className={LINK}>
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

function Stat({ label, value, testid, hint }: { label: string; value: string; testid?: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-1.5 text-xl font-bold tabular-nums" data-testid={testid}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}
