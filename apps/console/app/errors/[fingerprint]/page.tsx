import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ECRANS } from "@mip/console-contract";
import { ErrorSourceBadge, ErrorTypeBadge, HandledBadge } from "@/components/errors/ErrorBadges";
import { ErrorNotices } from "@/components/errors/ErrorNotices";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { ERROR_LINK, ErrorOccurrences } from "@/components/errors/ErrorOccurrences";
import { ErrorStackCard } from "@/components/errors/ErrorStackCard";
import { ErrorTriage } from "@/components/errors/ErrorTriage";
import {
  BoutonRejeu,
  OccurrencesDansLeTemps,
  PhraseImpact,
  QuOntEnCommun,
  TuilesDetailErreur,
  VersionsTouchees,
  porteeOccurrences,
} from "@/components/errors/DetailErreur";
import { SectionErreur } from "@/components/states/SectionErreur";
import { GroupingBasisBadge, IssueStatusBadge } from "@/components/errors/IssueBadges";
import { errorGroupHref, errorSearchParams, errorsHref, issueHref } from "@/lib/error-view";
import { annotationsDeploiements } from "@/lib/annotations";
import { bucketStarts } from "@/lib/query-contract";
import { fenetresLues, grilleIso } from "@/lib/series";
import { gabaritZoom } from "@/lib/view-state";
import { type LegacyIssueTarget } from "@/lib/error-issues";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { chargerErreur } from "@/lib/chargeurs/erreur";
import { chargerEcran } from "@/lib/ecran";
import { type ErrorFilters, type ErrorGroupRef } from "@/lib/queries-errors";

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
  // Le chargeur (`lib/chargeurs/erreur.ts`) résout le groupe et rend une DÉCISION :
  // la page l'exécute (404, redirection vers l'issue, choix à proposer, détail).
  const d = await chargerEcran(ECRANS.erreur, chargerErreur, sp, { fingerprint });
  if (d.etat === "introuvable") notFound();
  if (d.etat === "refus") return <FilterProblemNotice title="Erreurs JS" problem={d.problem} />;
  const f = d.f;
  if (d.etat === "curseur_invalide") {
    return (
      <div className="animate-fade-up">
        <BackLink f={f} />
        <div role="alert" className="card border-bad/30 p-6 text-sm text-bad-ink">
          Curseur de pagination invalide : il ne provient pas de cette console.{" "}
          <Link href={errorsHref(`/errors/${encodeURIComponent(fingerprint)}`, f, f.app)} className={ERROR_LINK}>
            Revenir aux occurrences les plus récentes
          </Link>
        </div>
      </div>
    );
  }
  if (d.etat === "issue") redirect(issueHref(d.issue, f));
  if (d.etat === "choix_issues") return <IssueChooser groupRef={d.groupe} f={f} issues={d.issues} />;
  if (d.etat === "choix_app") return <GroupChooser fingerprint={d.fingerprint} f={f} absentFrom={d.absentFrom} choices={d.choices} />;

  const { ref, label, bucketLabel, query, cursor, historique, part, releases, deploys, pile, lectureSeule } = d;
  const { range } = query;
  const url = errorSearchParams(sp);
  const { group, last, occurrences, trend, page, sampling, enrichment } = d.detail;

  // La limite demandée suit la pagination ; le curseur ne suit jamais un changement de filtre.
  const pageExtra = {
    ...(url.has("limit") ? { limit: String(page.limit) } : {}),
    ...(historique ? { legacy: "1" } : {}),
  };
  // Zoom sur un seau : la plage change, et rien d'autre (§ 3.3) ; la pagination des
  // occurrences repart du début.
  const contratZoom = new URLSearchParams(errorGroupHref(group, f).split("?")[1]);
  contratZoom.delete("period");
  contratZoom.set("from", "{from}");
  contratZoom.set("to", "{to}");
  const { cursor: _curseur, ...spSansCurseur } = sp;
  const zoomHref = gabaritZoom(`/errors/${encodeURIComponent(group.fingerprint)}?${contratZoom}`, spSansCurseur);
  const annotations = annotationsDeploiements(deploys.ok ? deploys.data : [], range, {
    lien: (relB, relA) => errorGroupHref(group, f, { cmp: "release", rel_b: relB, ...(relA ? { rel_a: relA } : {}) }),
  });
  // Écriture : viewer et compte de démonstration sont en lecture seule (V9) — lu par le chargeur.
  // Ce que couvrent les occurrences affichées (blocs 1 et 5) : en paginant, ni « la
  // fenêtre » ni « les plus récentes » — cette page seulement.
  const portee = porteeOccurrences({ curseur: cursor !== null, suite: page.next_cursor !== null });

  return (
    <div className="animate-fade-up">
      <BackLink f={f} />

      {/* ── Bloc 1 : en-tête, triage et rejeu au premier niveau ── */}
      {/* Titre sur trois lignes au plus (recette du 26/09/2026 : tronqué à 390 px en
          « Uncaught TypeError: Can… », le message complet n'était que dans la pile). */}
      <h1 className="mb-1 flex min-w-0 items-start gap-3 text-xl font-bold tracking-tight">
        <ErrorTypeBadge type={group.error_type} large />
        <span className="line-clamp-3 min-w-0 break-words" title={group.sample_message ?? ""}>
          {group.sample_message ?? "(sans message)"}
        </span>
      </h1>
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-all font-mono text-xs text-ink-faint">
          empreinte {group.fingerprint} · application {group.app_id}
        </span>
        {/* Source et caractère géré sont ceux du dernier exemplaire, pas une moyenne du groupe. */}
        <ErrorSourceBadge source={last?.error_source ?? null} />
        <HandledBadge handled={last?.handled ?? null} />
        <span className="basis-full sm:ml-auto sm:basis-auto">
          <BoutonRejeu occurrences={occurrences} appId={group.app_id} portee={portee} />
        </span>
      </div>

      {/* Triage en tête, comme sur la page d'une issue (recette du 26/09/2026 : statut et
          boutons étaient sous les 55 lignes d'occurrences). */}
      <ErrorTriage
        appId={group.app_id}
        fingerprint={group.fingerprint}
        status={group.status}
        regressed={group.regressed}
        resolvedAt={group.resolved_at}
        lectureSeule={lectureSeule}
      />

      <ErrorNotices sampling={sampling} enrichment={enrichment} />

      {/* ── Bloc 2 : quatre tuiles, et la part des sessions touchées en pastille ── */}
      <SectionErreur titre="Impact de ce groupe">
        <TuilesDetailErreur impact={group} plage={label} />
        <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <PhraseImpact impact={group} plage={label} part={part} hrefSessions={null} />
          <p className="mb-2 text-[11px] text-ink-soft" data-testid="detail-vues">
            Première vue {fmtDate(group.first_seen)}
            <span className="text-ink-faint"> (depuis toujours, hors période)</span> · Dernière vue{" "}
            {fmtDate(group.last_seen)}
          </p>
        </div>
      </SectionErreur>

      {/* ── Blocs 3 et 4 : versions touchées (4/12) à côté des occurrences dans le temps
          (8/12) — deux étages pleins devenus une rangée (recette du 30/09/2026). ── */}
      <div className="mb-4 grid min-w-0 gap-2 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-4 lg:self-start [&>section]:mb-0">
          <SectionErreur titre="Versions touchées">
            <VersionsTouchees releases={releases} />
          </SectionErreur>
        </div>
        <div className="min-w-0 lg:col-span-8 [&>section]:h-full">
          <SectionErreur titre="Occurrences dans le temps">
            <OccurrencesDansLeTemps
              trend={trend}
              grille={grilleIso(bucketStarts(range))}
              plage={label}
              bucketLabel={bucketLabel}
              seauSecondes={range.bucketSeconds}
              annotations={annotations.annotations}
              annotationsIndisponibles={
                deploys.ok ? (annotations.indisponible ?? undefined) : "marqueurs de déploiement indisponibles"
              }
              zoomHref={zoomHref}
              fenetresCollecte={fenetresLues(d.fenetresCollecte)}
            />
          </SectionErreur>
        </div>
      </div>

      {/* ── Bloc 5 : où surviennent les occurrences affichées (repli tant que B3 manque) ── */}
      <div className="mb-4">
        <SectionErreur titre="Qu'ont en commun les sessions touchées ?">
          <QuOntEnCommun
            occurrences={occurrences}
            plage={label}
            touchees={group.occurrences === 0 ? 0 : group.sessions_affected}
            hrefValeur={(cle, valeur) =>
              cle === "route"
                ? errorsHref("/errors", f, ref.app_id, { route: valeur })
                : cle === "release"
                  ? errorsHref("/errors", f, ref.app_id, { release: valeur })
                  : null
            }
            portee={portee}
          />
        </SectionErreur>
      </div>

      {/* ── Bloc 6 : pile du dernier exemplaire ── */}
      <ErrorStackCard last={last} pile={pile} appId={group.app_id} admin={!lectureSeule} />

      {/* ── Bloc 7 : occurrences ── */}
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
        <p className="mt-1 break-all font-mono text-xs text-ink-faint">empreinte {fingerprint}</p>
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
          Cette signature est répartie sur plusieurs groupes
        </h1>
        <p className="mt-1 break-all font-mono text-xs text-ink-faint">
          empreinte {groupRef.fingerprint} · application {groupRef.app_id}
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          Le regroupement actuel distingue des erreurs que cette ancienne signature réunissait.
        </p>
        <ul className="mt-4 divide-y divide-line/60">
          {issues.map((issue) => (
            <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={issueHref({ id: issue.id, app_id: groupRef.app_id }, f)} className={`break-all font-mono text-sm ${ERROR_LINK}`}>
                groupe {issue.id}
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
            Voir le détail de l&apos;ancienne signature
          </Link>
        </p>
      </section>
    </div>
  );
}
