import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ErrorStatusBadges, ErrorTypeBadge } from "@/components/errors/ErrorBadges";
import { ErrorNotices } from "@/components/errors/ErrorNotices";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { Sparkline } from "@/components/charts/Sparkline";
import { IssueList, IssueListInvalid } from "@/components/errors/IssueList";
import {
  CELLULE_GROUPE,
  CelluleGroupe,
  FiltreStatut,
  STATUT_LABELS,
  echelleCommune,
  noteEchelle,
} from "@/components/errors/ListeErreurs";
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
    ["status", "source", "limit", "tri", "nouveaux", "statut"].flatMap((nom) =>
      url.get(nom) ? [[nom, url.get(nom) as string]] : [],
    ),
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
  // La liste des issues a SON filtre de statut (`status`, quatre valeurs dont « à
  // revoir »), posé par son propre formulaire : `statut` — celui de la liste
  // historique — n'y est pas appliqué, et le dire vaut mieux que le taire (V10).
  if (modeIssues && vue.statut) {
    avertissements.push(ligneIgnoree("statut", vue.statut, "la liste des issues filtre par son propre champ « Statut »"));
  }
  const tri: OrdreGroupes = !modeIssues && (vue.tri === "sessions" || vue.tri === "recent") ? vue.tri : "statut";
  const nouveauxSeuls = !modeIssues && vue.nouveaux;
  const statut = modeIssues ? null : vue.statut;

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
  // (paramètres d'écran), jamais la population. Ils ne portent PAS le filtre de
  // statut : une tuile compte toute la population, et mener à une liste filtrée
  // ferait mentir son nombre.
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
        bucketLabel={bucketLabel}
        sousTitre={QUESTION}
        avertissements={notes}
        apercu={apercu}
        decoupage={decoupage}
        vue={vueEcran}
      />
    );
  }

  const page = parseErrorListPage(url);
  const { groups, total, totalFiltre, trend, sampling, enrichment, unfingerprinted } = await listErrorGroups(f, page, {
    series: true,
    tri,
    nouveaux: nouveauxSeuls,
    statut: statut ?? undefined,
  });
  // Liste restreinte (groupes apparus, statut de triage) : elle se pagine sur LEUR
  // nombre, pas sur celui de tous les groupes (les totaux de l'écran, eux, ne
  // changent pas). Sous filtre de statut, la lecture rend le compte retenu ;
  // `null` (page vide) → ce que la page voit, pour ne pas inventer un total.
  const totalListe = statut
    ? (totalFiltre ?? page.offset + groups.length)
    : nouveauxSeuls
      ? nouveaux.ok
        ? nouveaux.data
        : groups.length + page.offset
      : total;
  // Réglages que la pagination, le tri et le formulaire de statut se repassent.
  const reglagesListe: Record<string, string> = {
    ...vueEcran,
    ...(tri !== "statut" ? { tri } : {}),
    ...(nouveauxSeuls ? { nouveaux: "1" } : {}),
  };
  const hrefSansStatut = `${errorsHref("/errors", f, f.app, reglagesListe)}#groupes-erreurs`;
  /** Un autre ordre, mêmes restrictions de liste (groupes apparus, statut). */
  const lienTri = (extra: Record<string, string>) =>
    `${errorsHref("/errors", f, f.app, {
      ...vueEcran,
      ...(nouveauxSeuls ? { nouveaux: "1" } : {}),
      ...(statut ? { statut } : {}),
      ...extra,
    })}#groupes-erreurs`;
  // Champs cachés du formulaire : tout ce qui n'est pas le statut lui-même, et
  // jamais l'`offset` — filtrer repart du premier groupe.
  const cachesFiltre = [...new URLSearchParams(errorsHref("/errors", f, f.app, reglagesListe).split("?")[1])];
  const pageHref = (offset: number) =>
    errorsHref("/errors", f, f.app, {
      ...reglagesListe,
      ...(statut ? { statut } : {}),
      offset: String(offset),
      limit: String(page.limit),
    });
  // Échelle commune des sparklines de la page (F03 `Sparkline.max`, § 5.3.2).
  const echelle = echelleCommune(groups);
  const noteTendances = noteEchelle(echelle, bucketLabel);
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
        {nouveauxSeuls ? " apparus sur la période" : ""}
        {statut ? ` ${STATUT_LABELS[statut].toLowerCase()}` : ""})
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
        {statut && (
          <>
            Liste restreinte aux groupes dont le triage est « {STATUT_LABELS[statut].toLowerCase()} » : les tuiles, le
            graphique et la répartition, eux, portent sur toute la population.{" "}
          </>
        )}
        Tous les compteurs portent sur {label} — sauf « Première vue », qui remonte à la première apparition connue.
        « Inconnu » : aucune occurrence du groupe n&apos;est rattachée à une session ou à un visiteur connu (une erreur
        backend sans session, par exemple) — ce n&apos;est pas zéro personne. {noteTendances}
      </p>
      <div className="mb-3">
        {/* Changer d'ordre GARDE le filtre de statut : trier n'est pas dé-filtrer
            (à la différence d'une tuile, qui repart de toute la population). */}
        <BasculeTri
          courant={tri}
          options={[
            { id: "statut", libelle: "Triage", href: lienTri({}) },
            { id: "sessions", libelle: "Sessions touchées", href: lienTri({ tri: "sessions" }) },
            { id: "recent", libelle: "Vus récemment", href: lienTri({ tri: "recent" }) },
          ]}
        />
      </div>

      <FiltreStatut caches={cachesFiltre} statut={statut} hrefSansFiltre={hrefSansStatut} />

      {/* `relative` : la légende sr-only (position absolue) se place dans CE conteneur
          défilant, pas dans la page qu'elle élargirait à 390 px (piège de la vague 5).
          Sous 640 px la table devient une pile de CARTES (`block`) : plus de défilement
          horizontal, occurrences et sessions lisibles à 390 px (§ 5.3.2). */}
      <div className="card relative min-w-0 sm:overflow-x-auto" data-testid="liste-groupes">
        <table className="block w-full text-sm sm:table sm:min-w-table">
          <caption className="sr-only">
            Groupes d&apos;erreurs sur {label}
            {statut ? `, triage « ${STATUT_LABELS[statut].toLowerCase()} »` : ""}, ordre : {ordreLu}. {noteTendances}
          </caption>
          <thead className="hidden bg-panel2 sm:table-header-group">
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
          <tbody className="block sm:table-row-group">
            {groups.map((g) => {
              const dim = g.status !== "open" && !g.regressed;
              const message = g.sample_message ?? "(sans message)";
              return (
                <tr
                  key={`${g.app_id}|${g.fingerprint}`}
                  className={`block border-t border-line/60 px-4 py-3 align-top transition first:border-t-0 hover:bg-panel2/60 sm:table-row sm:p-0 ${
                    dim ? "opacity-60" : ""
                  }`}
                  data-testid={`error-group-${g.fingerprint}`}
                  data-app-id={g.app_id}
                >
                  <td className={`block min-w-0 sm:max-w-md ${CELLULE_GROUPE}`}>
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
                  <CelluleGroupe libelle="Occurrences" className="sm:text-sm" testId="group-occurrences">
                    <span className="font-bold tabular-nums text-ink">{g.occurrences.toLocaleString("fr-FR")}</span>
                  </CelluleGroupe>
                  <CelluleGroupe libelle="Sessions" className="sm:text-sm">
                    <span className="tabular-nums">{fmtCount(g.sessions_affected)}</span>
                  </CelluleGroupe>
                  <CelluleGroupe libelle="Visiteurs" className="sm:text-sm">
                    <span className="tabular-nums">{fmtCount(g.visitors_affected)}</span>
                  </CelluleGroupe>
                  <CelluleGroupe libelle="Tendance">
                    <Sparkline
                      valeurs={g.series ?? trend.map(() => 0)}
                      max={echelle}
                      label={`${g.occurrences.toLocaleString("fr-FR")} occurrence(s) sur ${label}`}
                    />
                  </CelluleGroupe>
                  <CelluleGroupe libelle="Première vue" className="text-ink-soft sm:whitespace-nowrap">
                    {fmtDate(g.first_seen)}
                  </CelluleGroupe>
                  <CelluleGroupe libelle="Dernière vue" className="text-ink-soft sm:whitespace-nowrap">
                    {fmtDate(g.last_seen)}
                  </CelluleGroupe>
                </tr>
              );
            })}
            {!groups.length && (
              <tr className="block sm:table-row">
                <td colSpan={7} className="block px-4 py-8 text-center text-ink-faint sm:table-cell">
                  {totalListe > 0 ? (
                    // Offset au-delà de la population (lien ancien, erreurs résolues entre-temps).
                    <Link href={pageHref(0)} className="text-brand hover:underline">
                      Aucun groupe à cette position — revenir au début de la liste
                    </Link>
                  ) : statut ? (
                    `Aucun groupe « ${STATUT_LABELS[statut].toLowerCase()} » sur ${label}`
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
