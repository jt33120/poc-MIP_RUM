import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { HeroReading, HeroStat, SupervisionHero } from "@/components/SupervisionHero";
import { StackedBars } from "@/components/charts/StackedBars";
import { ErrorStatusBadges, ErrorTypeBadge } from "@/components/errors/ErrorBadges";
import { ErrorNotices } from "@/components/errors/ErrorNotices";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { GroupSparkline } from "@/components/errors/GroupSparkline";
import { IssueList, IssueListInvalid } from "@/components/errors/IssueList";
import {
  bucketTick,
  errorGroupHref,
  errorSearchParams,
  errorsHref,
  errorVolumeChart,
  fmtCount,
} from "@/components/errors/error-view";
import {
  groupingState,
  issueModeFor,
  listIssues,
  parseIssueCursor,
  parseIssueListPage,
  parseIssueRelease,
  parseIssueSource,
  parseIssueStatus,
} from "@/lib/error-issues";
import type { SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import { fmtDate } from "@/lib/format";
import {
  ERROR_LIST_MAX_OFFSET,
  listErrorGroups,
  parseErrorListPage,
  type ErrorTrendPoint,
} from "@/lib/queries-errors";

export const dynamic = "force-dynamic";

export default async function Errors({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le périmètre signé borne la lecture AVANT tout filtre d'URL (AD-16 : aucune app = aucun accès).
  const ecran = await pageFilters(sp, "/errors");
  if (!ecran.ok) return <FilterProblemNotice title="Erreurs JS" problem={ecran.problem} />;
  const f = ecran.deviceFilters;
  const { label, bucketLabel } = ecran;
  const { bucketSeconds } = ecran.query.range;
  const url = errorSearchParams(sp);

  // P5.5 : l'app choisie (ou une app du périmètre « toutes ») a activé le
  // regroupement v2 → la liste passe aux issues. Sinon, liste historique inchangée.
  const apps = ecran.query.scope.authorizedApps;
  if (issueModeFor(await groupingState(apps), f.app)) {
    const status = parseIssueStatus(url.get("status"));
    const source = parseIssueSource(url.get("source"));
    const release = parseIssueRelease(url.get("release"));
    const cursor = parseIssueCursor(url.get("cursor"));
    if (status === undefined || source === undefined || release === undefined) {
      return <IssueListInvalid f={f} raison="Filtre invalide : statut ou source inconnus, ou release de plus de 200 caractères." />;
    }
    if (cursor === undefined) {
      return <IssueListInvalid f={f} raison="Curseur de pagination invalide : il ne provient pas de cette console." />;
    }
    const filtres = { status, source, release };
    const result = await listIssues(f, filtres, { limit: parseIssueListPage(url).limit, cursor }, { apps, overview: true });
    return (
      <IssueList
        f={f}
        filtres={filtres}
        result={result}
        curseur={cursor !== null}
        limit={url.get("limit")}
        label={label}
        bucketLabel={bucketLabel}
      />
    );
  }

  const page = parseErrorListPage(url);
  const { groups, total, totals, trend, sampling, enrichment, unfingerprinted } = await listErrorGroups(f, page, {
    series: true,
  });
  const chart = errorVolumeChart(groups, trend, bucketSeconds);
  // Premier seau le plus chargé : la tuile nomme le moment, pas seulement la hauteur.
  const peak = trend.reduce<ErrorTrendPoint | null>(
    (best, point) => (point.occurrences > (best?.occurrences ?? 0) ? point : best),
    null,
  );
  const pageHref = (offset: number) =>
    errorsHref("/errors", f, f.app, { offset: String(offset), limit: String(page.limit) });
  const hasNext = total > page.offset + page.limit && page.offset + page.limit <= ERROR_LIST_MAX_OFFSET;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Erreurs JS"
        sub="Erreurs regroupées par signature (type + message + frame) dans chaque application — une ligne = une cause récurrente."
      />

      <ErrorNotices sampling={sampling} enrichment={enrichment} />

      <SupervisionHero
        chartTitle={`Volume d'erreurs par ${bucketLabel} (${label}) — par groupe`}
        chart={
          totals.occurrences > 0 ? (
            <>
              <StackedBars data={chart.data} xKey="h" series={chart.series} yUnit="" />
              <details className="mt-3 text-xs text-ink-soft">
                <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
                  Alternative textuelle de la série
                </summary>
                <table className="mt-2 w-full">
                  <thead>
                    <tr>
                      <th className="py-1 text-left">Période</th>
                      <th className="py-1 text-right">Occurrences</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((point) => (
                      <tr key={point.bucket.toISOString()} className="border-t border-line/60">
                        <td className="py-1">{fmtDate(point.bucket)}</td>
                        <td className="py-1 text-right tabular-nums">{point.occurrences.toLocaleString("fr-FR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <p className="py-12 text-center text-sm text-ink-faint">Aucune erreur sur cette période</p>
          )
        }
      >
        <HeroStat
          label={`Occurrences · ${label}`}
          value={totals.occurrences.toLocaleString("fr-FR")}
          tone={totals.occurrences > 0 ? "warn" : "good"}
        />
        <HeroStat label="Groupes distincts" value={total.toLocaleString("fr-FR")} />
        <HeroStat
          label={`Pic par ${bucketLabel}`}
          value={(peak?.occurrences ?? 0).toLocaleString("fr-FR")}
          hint={peak ? `à partir de ${bucketTick(peak.bucket, bucketSeconds)}` : undefined}
        />
        <HeroReading>
          Chaque colonne = {bucketLabel}, empilée par groupe d&apos;erreur dominant de la page (le reste de la
          population en gris). Une barre haute isolée = un pic à investiguer. Tous les compteurs de cet écran
          portent sur {label} — sauf « Première vue », qui remonte à la première apparition connue, par
          définition hors fenêtre. « Inconnu » : aucune occurrence du groupe n&apos;est rattachée à une session
          ou à un visiteur connu (une erreur backend sans session, par exemple) — ce n&apos;est pas zéro personne.
        </HeroReading>
      </SupervisionHero>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <caption className="sr-only">
            Groupes d&apos;erreurs sur {label}, triés par statut de triage puis par impact
          </caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className="th">Groupe</th>
              <th scope="col" className="th">Occurrences</th>
              <th scope="col" className="th">Sessions</th>
              <th scope="col" className="th">Visiteurs</th>
              <th scope="col" className="th">Tendance · {label}</th>
              <th
                scope="col"
                className="th"
                title="Première apparition connue, toutes fenêtres confondues — hors fenêtre, bornée seulement par la rétention."
              >
                Première vue <span className="font-normal text-ink-faint">(depuis toujours)</span>
              </th>
              <th scope="col" className="th">Dernière vue</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const dim = g.status !== "open" && !g.regressed;
              const message = g.sample_message ?? "(sans message)";
              return (
                <tr
                  key={`${g.app_id}|${g.fingerprint}`}
                  className={`border-t border-line/60 align-top transition hover:bg-panel2/60 ${dim ? "opacity-60" : ""}`}
                  data-testid={`error-group-${g.fingerprint}`}
                  data-app-id={g.app_id}
                >
                  <td className="max-w-md px-4 py-3">
                    {/* Un seul lien par ligne : une tabulation par groupe au clavier. */}
                    <Link
                      href={errorGroupHref(g, f)}
                      className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                    >
                      <ErrorTypeBadge type={g.error_type} />
                      <ErrorStatusBadges status={g.status} regressed={g.regressed} />
                      <span className="break-words font-medium text-ink" title={g.sample_message ?? ""}>
                        {message.slice(0, 120)}
                      </span>
                      <span className="mt-0.5 block break-all font-mono text-xs text-ink-faint">
                        {g.fingerprint} · {g.app_id}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-bold tabular-nums" data-testid="group-occurrences">
                    {g.occurrences.toLocaleString("fr-FR")}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{fmtCount(g.sessions_affected)}</td>
                  <td className="px-4 py-3 tabular-nums">{fmtCount(g.visitors_affected)}</td>
                  <td className="px-4 py-3">
                    <GroupSparkline
                      values={g.series ?? trend.map(() => 0)}
                      label={`${g.occurrences.toLocaleString("fr-FR")} occurrence(s) sur ${label}`}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">{fmtDate(g.first_seen)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">{fmtDate(g.last_seen)}</td>
                </tr>
              );
            })}
            {!groups.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-faint">
                  {total > 0 ? (
                    // Offset au-delà de la population (lien ancien, erreurs résolues entre-temps).
                    <Link href={pageHref(0)} className="text-brand hover:underline">
                      Aucun groupe à cette position — revenir au début de la liste
                    </Link>
                  ) : (
                    "Aucune erreur sur cette période"
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {groups.length > 0 && (page.offset > 0 || hasNext) && (
        <nav
          className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
          aria-label="Pagination des groupes d'erreurs"
        >
          <span className="text-xs text-ink-faint">
            Groupes {(page.offset + 1).toLocaleString("fr-FR")}–
            {(page.offset + groups.length).toLocaleString("fr-FR")} sur {total.toLocaleString("fr-FR")}
          </span>
          <span className="flex gap-4">
            {page.offset > 0 && (
              <Link href={pageHref(Math.max(0, page.offset - page.limit))} className="text-brand hover:underline">
                Groupes précédents
              </Link>
            )}
            {hasNext && (
              <Link href={pageHref(page.offset + page.limit)} className="text-brand hover:underline">
                Groupes suivants
              </Link>
            )}
          </span>
        </nav>
      )}

      {unfingerprinted > 0 && (
        <p className="mt-3 text-xs text-ink-faint">
          {unfingerprinted.toLocaleString("fr-FR")} occurrence(s) sans empreinte sur {label} (erreurs v0.1
          antérieures au regroupement) : non groupées, et hors des compteurs ci-dessus.
        </p>
      )}
    </div>
  );
}
