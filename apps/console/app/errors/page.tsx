import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ErrorStatusBadges, ErrorTypeBadge } from "@/components/errors/ErrorBadges";
import { ErrorNotices } from "@/components/errors/ErrorNotices";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { GroupSparkline } from "@/components/errors/GroupSparkline";
import { IssueList, IssueListInvalid } from "@/components/errors/IssueList";
import { GROUPES_DU_HERO, HeroGroupesErreurs, TuilesErreurs, type PartLue } from "@/components/errors/ApercuErreurs";
import { SectionErreur } from "@/components/states/SectionErreur";
import { errorGroupHref, errorSearchParams, errorsHref, fmtCount } from "@/components/errors/error-view";
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
import { BasculeTri, Breakdown } from "@/components/Breakdown";
import { ERRORS_BREAKDOWN_COLUMNS, errorsBreakdownItems } from "@/components/breakdown-view";
import {
  BREAKDOWN_NOTICES,
  BREAKDOWN_PARAM,
  availableBreakdowns,
  breakdownTabs,
  datasetAvailability,
  parseBreakdown,
} from "@/lib/breakdowns";
import { dimensionSchema } from "@/lib/query-schema";
import { ERRORS_BREAKDOWN_DATASETS, errorsBreakdown } from "@/lib/queries-breakdowns";
import {
  ERROR_LIST_MAX_OFFSET,
  listErrorGroups,
  nouveauxGroupes,
  parseErrorListPage,
  partSessionsTouchees,
  topGroupesSeries,
  totauxErreurs,
  type ErrorFilters,
  type OrdreGroupes,
} from "@/lib/queries-errors";
import { listDeploys } from "@/lib/queries-deploys";
import { annotationsDeploiements } from "@/lib/annotations";
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "@/lib/comparaison";
import { lire, type Lecture } from "@/lib/lecture";
import { referencePeriodePrecedente } from "@/lib/perf-domain";
import { UnsupportedFilterError } from "@/lib/query-compiler";
import { bucketStarts, paramReader, type AnalyticsQuery } from "@/lib/query-contract";
import { grilleIso } from "@/lib/series";
import { gabaritZoom, ligneIgnoree, lireComparaison, lireEtatDeVue } from "@/lib/view-state";

export const dynamic = "force-dynamic";

/** Question de l'écran (P1, § 5.3). */
const QUESTION = "Quelles erreurs touchent le plus de sessions, depuis quand, et après quelle release ?";

// Sources comparées à la période précédente (§ 3.2). Occurrences, sessions touchées
// et groupes apparus sont des comptes d'erreurs (additifs : la fin d'une fenêtre
// d'une heure attend encore des lignes) ; la part des sessions touchées divise par
// des sessions avec VUE : les pages vues doivent aussi être collectées sur toute la
// période précédente.
const SOURCES_ERREURS: SourceComparaison[] = [{ table: "rum_error", colonneTemps: "ts", additive: true }];
const SOURCES_PART: SourceComparaison[] = [
  { table: "rum_error", colonneTemps: "ts", additive: false },
  { table: "rum_pageview", colonneTemps: "started_at", additive: false },
];

/** Lecture non lancée (hors `cmp=prev`) : aucune valeur, jamais affichée comme mesure. */
const sansLecture = Promise.resolve(null);

/** Première couverture incomplète d'une rangée de sources, sinon « complète ». */
async function couvertureDe(query: AnalyticsQuery, sources: SourceComparaison[]): Promise<CouverturePrecedente> {
  const couvertures = await Promise.all(
    sources.flatMap((s) => sourcesSousFiltres(query, s)).map((s) => couverturePrecedente(query, s)),
  );
  return couvertures.find((c) => c.etat !== "complete") ?? { etat: "complete", raison: null };
}

/**
 * La part des sessions touchées divise par des sessions avec VUE : un filtre que les
 * pages vues ne portent pas (`service`, que seules les erreurs déclarent) la rend
 * incalculable. C'est un refus du contrat pour CETTE tuile — l'écran, lui, sait
 * filtrer ses erreurs : il reste affiché.
 */
async function partLue(f: ErrorFilters, shift: boolean): Promise<PartLue> {
  try {
    return { lu: await partSessionsTouchees(f, undefined, shift) };
  } catch (e) {
    if (e instanceof UnsupportedFilterError) return { refus: e.message };
    throw e;
  }
}

export default async function Errors({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le périmètre signé borne la lecture AVANT tout filtre d'URL (AD-16 : aucune app = aucun accès).
  const ecran = await pageFilters(sp, "/errors");
  if (!ecran.ok) return <FilterProblemNotice title="Erreurs JS" problem={ecran.problem} />;
  const f = ecran.deviceFilters;
  const { label, bucketLabel, query } = ecran;
  const { range } = query;
  const url = errorSearchParams(sp);
  const lecteur = paramReader(sp);

  // Réglages d'affichage (§ 3.1) : `tri` et `nouveaux` règlent la liste historique.
  // Les lignes de la comparaison sont déjà dites par la barre de filtres.
  const { etat: vue, ignores } = lireEtatDeVue("/errors", lecteur);
  const dejaDites = new Set(lireComparaison("/errors", lecteur).ignores);
  const avertissements = ignores.filter((ligne) => !dejaDites.has(ligne));
  if (vue.statut) {
    avertissements.push(ligneIgnoree("statut", vue.statut, "le filtre de statut de la liste historique n'est pas encore disponible"));
  }

  // Découpage (P6.3) : les MÊMES onglets que l'accueil et `/pages`, limités aux
  // dimensions que les occurrences d'erreurs portent réellement. Calculé avant la
  // bifurcation P5.5 : les deux listes — issues et groupes historiques — montrent
  // le même découpage, sur la même population.
  const schema = await dimensionSchema();
  const dispoDecoupage = datasetAvailability(ERRORS_BREAKDOWN_DATASETS, schema);
  const dimension = parseBreakdown(url.get(BREAKDOWN_PARAM), availableBreakdowns(dispoDecoupage));
  const decoupe = dimension ? await errorsBreakdown(f, dimension) : null;
  // Les filtres propres à l'écran suivent l'onglet, et réciproquement : changer de
  // découpage ne doit pas effacer un triage en cours, ni paginer remettre l'onglet
  // au défaut. La pagination, elle, repart du début — la population a changé.
  const vueEcran: Record<string, string> = dimension ? { [BREAKDOWN_PARAM]: dimension } : {};
  const filtresEcran = Object.fromEntries(
    ["status", "source", "limit", "tri", "nouveaux"].flatMap((nom) => (url.get(nom) ? [[nom, url.get(nom) as string]] : [])),
  );
  const decoupage =
    dimension && decoupe ? (
      <Breakdown
        title="Répartition des occurrences"
        tabs={breakdownTabs("/errors", ecran.query, dimension, dispoDecoupage, filtresEcran)}
        notice={`${BREAKDOWN_NOTICES[dimension]} Ce classement porte sur TOUTES les occurrences de la fenêtre : le statut de triage et la source, qui filtrent la liste ci-dessus, ne le découpent pas.`}
        items={errorsBreakdownItems({ pathname: "/errors", query: ecran.query, schema, dimension }, decoupe.rows)}
        columns={ERRORS_BREAKDOWN_COLUMNS}
        groups={decoupe.groups}
        truncated={decoupe.truncated}
        measureLabel="Occurrences"
        emptyLabel={`Aucune occurrence d'erreur sur ${label}.`}
      />
    ) : null;

  // P5.5 : l'app choisie (ou une app du périmètre « toutes ») a activé le
  // regroupement v2 → la liste passe aux issues. Sinon, liste historique.
  const apps = ecran.query.scope.authorizedApps;
  const modeIssues = issueModeFor(await groupingState(apps), f.app);
  if (modeIssues && vue.tri !== null && vue.tri !== "statut") {
    avertissements.push(ligneIgnoree("tri", vue.tri, "la liste des issues garde son ordre de triage"));
  }
  if (modeIssues && vue.nouveaux) {
    avertissements.push(ligneIgnoree("nouveaux", "1", "la liste des issues ne se restreint pas encore aux groupes apparus"));
  }
  const tri: OrdreGroupes = !modeIssues && (vue.tri === "sessions" || vue.tri === "recent") ? vue.tri : "statut";
  const nouveauxSeuls = !modeIssues && vue.nouveaux;

  // ── Tuiles et hero (F18) ─────────────────────────────────────────────────
  // CHAQUE LECTURE EST INDÉPENDANTE (§ 3.8) : une tuile en échec dit « lecture en
  // échec », les autres restent. La période précédente n'est lue qu'en `cmp=prev`
  // (défaut de l'écran) ; sa couverture décide si un delta a le droit d'exister.
  const prev = vue.cmp === "prev";
  const [totaux, totauxPrec, part, partPrec, nouveaux, nouveauxPrec, top, deploys, couvErreurs, couvPart] =
    await Promise.all([
      lire(() => totauxErreurs(f)),
      prev ? lire(() => totauxErreurs(f, true)) : sansLecture,
      lire(() => partLue(f, false)),
      prev ? lire(() => partLue(f, true)) : sansLecture,
      lire(() => nouveauxGroupes(f)),
      prev ? lire(() => nouveauxGroupes(f, true)) : sansLecture,
      lire(() => topGroupesSeries(f, GROUPES_DU_HERO)),
      lire(() => listDeploys(ecran.filters, 20)),
      prev ? couvertureDe(query, SOURCES_ERREURS) : Promise.resolve(undefined),
      prev ? couvertureDe(query, SOURCES_PART) : Promise.resolve(undefined),
    ]);

  // Liens de l'écran vers lui-même : l'app TOUJOURS explicite (`errorsHref`, « all »
  // sous toutes les apps), sans quoi la porte projet substituerait l'app du cookie.
  // Les liens des tuiles ne changent que l'ordre ou la restriction de la LISTE
  // (paramètres d'écran), jamais la population.
  const lienListe = (extra: Record<string, string>) => `${errorsHref("/errors", f, f.app, { ...vueEcran, ...extra })}#groupes-erreurs`;
  // Zoom sur un seau : la plage change, et rien d'autre (§ 3.3) ; la position dans la
  // liste repart du début.
  const contratZoom = new URLSearchParams(errorsHref("/errors", f, f.app).split("?")[1]);
  contratZoom.delete("period");
  contratZoom.set("from", "{from}");
  contratZoom.set("to", "{to}");
  const { offset: _offset, ...spSansOffset } = sp;
  const zoomHref = gabaritZoom(`/errors?${contratZoom}`, spSansOffset);
  const annotations = annotationsDeploiements(deploys.ok ? deploys.data : [], range, {
    lien: (relB, relA) =>
      errorsHref("/errors", f, f.app, { ...vueEcran, cmp: "release", rel_b: relB, ...(relA ? { rel_a: relA } : {}) }),
  });

  const apercu = (
    <>
      {vue.cmp === "release" && (
        <p role="note" className="mb-2 text-xs text-ink-soft" data-testid="note-cmp-release">
          Comparaison de releases : les tuiles d&apos;erreurs ne comparent que la période précédente ; aucun écart n&apos;est
          affiché ici.
        </p>
      )}
      <SectionErreur titre="Chiffres clés des erreurs">
        <TuilesErreurs
          plage={label}
          totaux={totaux}
          totauxPrec={totauxPrec}
          part={part}
          partPrec={partPrec}
          nouveaux={nouveaux}
          nouveauxPrec={nouveauxPrec}
          reference={prev ? referencePeriodePrecedente(range) : null}
          couvErreurs={couvErreurs}
          couvPart={couvPart}
          hrefSessions={modeIssues ? null : lienListe({ tri: "sessions" })}
          hrefNouveaux={modeIssues ? null : lienListe({ nouveaux: "1", ...(tri !== "statut" ? { tri } : {}) })}
        />
      </SectionErreur>
      <SectionErreur titre="Occurrences dans le temps, par groupe">
        <HeroGroupesErreurs
          plage={label}
          bucketLabel={bucketLabel}
          seauSecondes={range.bucketSeconds}
          grille={grilleIso(bucketStarts(range))}
          totaux={totaux}
          top={top}
          // Le panneau `panel=error:` arrive avec F20 : d'ici là, la page du groupe.
          hrefGroupe={(g) => errorGroupHref(g.ref, f)}
          plusieursApps={query.scope.requestedApp === null}
          annotations={annotations.annotations}
          annotationsIndisponibles={deploys.ok ? annotations.indisponible : "marqueurs de déploiement non lus"}
          zoomHref={zoomHref}
        />
      </SectionErreur>
    </>
  );
  const notes =
    avertissements.length > 0 ? (
      <div className="mb-4 space-y-1" data-testid="reglages-ignores">
        {avertissements.map((ligne) => (
          <p key={ligne} role="note" className="text-xs text-ink-soft">
            {ligne}
          </p>
        ))}
      </div>
    ) : null;

  if (modeIssues) {
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
        sousTitre={QUESTION}
        avertissements={notes}
        apercu={apercu}
        decoupage={decoupage}
        vue={vueEcran}
      />
    );
  }

  const page = parseErrorListPage(url);
  const { groups, total, trend, sampling, enrichment, unfingerprinted } = await listErrorGroups(f, page, {
    series: true,
    tri,
    nouveaux: nouveauxSeuls,
  });
  // Liste restreinte aux groupes apparus : elle se pagine sur LEUR nombre, pas sur
  // celui de tous les groupes (les totaux de l'écran, eux, ne changent pas).
  const totalListe = nouveauxSeuls ? (nouveaux.ok ? nouveaux.data : groups.length + page.offset) : total;
  const reglagesListe: Record<string, string> = {
    ...vueEcran,
    ...(tri !== "statut" ? { tri } : {}),
    ...(nouveauxSeuls ? { nouveaux: "1" } : {}),
  };
  const pageHref = (offset: number) =>
    errorsHref("/errors", f, f.app, { ...reglagesListe, offset: String(offset), limit: String(page.limit) });
  const hasNext = totalListe > page.offset + page.limit && page.offset + page.limit <= ERROR_LIST_MAX_OFFSET;
  const ordreLu =
    tri === "sessions"
      ? "par sessions touchées (inconnues en dernier), puis visiteurs, puis occurrences"
      : tri === "recent"
        ? "par dernière vue, la plus récente d'abord"
        : "régressées, puis ouvertes, puis résolues, puis ignorées ; puis par visiteurs touchés, sessions et occurrences";

  return (
    <div className="animate-fade-up">
      <PageHeader title="Erreurs JS" sub={QUESTION} />
      {notes}

      <ErrorNotices sampling={sampling} enrichment={enrichment} />

      {apercu}

      <h2 id="groupes-erreurs" className="mb-2 text-sm font-semibold text-ink">
        Groupes ({totalListe.toLocaleString("fr-FR")}
        {nouveauxSeuls ? " apparus sur la période" : ""})
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-ink-soft" data-testid="ordre-liste">
        Une ligne = une cause récurrente (type + message + frame, dans son application). Ordre : {ordreLu}.
        {nouveauxSeuls && (
          <>
            {" "}
            Liste restreinte aux groupes apparus sur {label}.{" "}
            <Link href={lienListe(tri !== "statut" ? { tri } : {})} className="text-brand hover:underline">
              Tous les groupes
            </Link>
          </>
        )}{" "}
        Tous les compteurs portent sur {label} — sauf « Première vue », qui remonte à la première apparition connue.
        « Inconnu » : aucune occurrence du groupe n&apos;est rattachée à une session ou à un visiteur connu (une erreur
        backend sans session, par exemple) — ce n&apos;est pas zéro personne.
      </p>
      <div className="mb-3">
        <BasculeTri
          courant={tri}
          options={[
            { id: "statut", libelle: "Triage", href: lienListe(nouveauxSeuls ? { nouveaux: "1" } : {}) },
            { id: "sessions", libelle: "Sessions touchées", href: lienListe({ tri: "sessions", ...(nouveauxSeuls ? { nouveaux: "1" } : {}) }) },
            { id: "recent", libelle: "Vus récemment", href: lienListe({ tri: "recent", ...(nouveauxSeuls ? { nouveaux: "1" } : {}) }) },
          ]}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <caption className="sr-only">
            Groupes d&apos;erreurs sur {label}, ordre : {ordreLu}
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
                  {totalListe > 0 ? (
                    // Offset au-delà de la population (lien ancien, erreurs résolues entre-temps).
                    <Link href={pageHref(0)} className="text-brand hover:underline">
                      Aucun groupe à cette position — revenir au début de la liste
                    </Link>
                  ) : nouveauxSeuls ? (
                    `Aucun groupe apparu sur ${label}`
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
            {(page.offset + groups.length).toLocaleString("fr-FR")} sur {totalListe.toLocaleString("fr-FR")}
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

      {/* Répartition après la liste (§ 5.3.1, zone 5). */}
      {decoupage && <div className="mt-6">{decoupage}</div>}
    </div>
  );
}
