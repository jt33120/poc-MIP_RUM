// Pages `/pages` (plan § 5.2) — « Quelles pages font attendre, pour qui, et depuis quand ? »
//
// F14 : en-tête, vues préréglées et sélecteur de vital (zone 1), bandeau de
// troncature (2), trois tuiles (3), et UN classement des routes (4). Les trois
// listes d'avant — hero à huit barres sans lien, découpage « Web Vitals par
// dimension » et table « Par route » — racontaient la même chose trois fois, avec
// trois ordres différents : elles fusionnent dans le hero, classé par gravité sur
// le vital choisi (`vital=`, LCP par défaut).
//
// PAS DE `<Suspense>` AUTOUR DE L'ÉCRAN, ni de `loading.tsx` (F02) : une frontière
// au-dessus de la page bloque les navigations qui ne changent que la query
// (sélecteur de vital, période, comparaison). Les frontières restent par section.
import { Histogram, PercentileTable } from "@/components/Distribution";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";
import { PageHeader } from "@/components/PageHeader";
import { PresetBar } from "@/components/PresetBar";
import { LongtasksView } from "@/components/LongtasksView";
import { ResourcesView } from "@/components/ResourcesView";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { SelecteurVital } from "@/components/perf/SelecteurVital";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { BREAKDOWN_NOTICES, breakdownDrillHref, datasetAvailability, groupLabel } from "@/lib/breakdowns";
import {
  couverturePrecedente,
  sourcesSousFiltres,
  type CouverturePrecedente,
  type SourceComparaison,
} from "@/lib/comparaison";
import { HISTO_BUCKETS, VITAL_CAP } from "@/lib/distribution";
import { etatLectureEchantillonnage } from "@/lib/echantillonnage";
import type { Filters, SearchParams } from "@/lib/filters";
import { estVital, formatDuVital, formater, type VitalName } from "@/lib/fmt-ids";
import { classerParGravite, estFaible } from "@/lib/impact";
import { lire, type Lecture } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import {
  avecCondition,
  classementParRoute,
  ecartAEnsemblePages,
  ecartP75EntreReleases,
  joindreRoutesPages,
  p75DeLaRoute,
  referencePrecedentePages,
  tuileRoutesAuDelaDeBon,
  type RoutePages,
  type VitalClasseParRoute,
} from "@/lib/perf-domain";
import { choisirReleases, vuesProduit, type Entree, type LigneNavigateur, type LignePays } from "@/lib/presets";
import { dimensionSupport } from "@/lib/query-compiler";
import { hrefWithQuery, paramReader } from "@/lib/query-contract";
import { dimensionSchema } from "@/lib/query-schema";
import {
  ROUTES_MAX,
  pageviewSeries,
  samplingVitals,
  slowResourcesByRoute,
  slowRoutes,
  vitalHistogram,
  vitalPercentiles,
  vitalSeriesN,
  vitalsP75,
  type VitalAgg,
} from "@/lib/queries";
import { VITALS_BREAKDOWN_DATASETS, vitalsBreakdown, type BreakdownResult, type VitalsBreakdownRow } from "@/lib/queries-breakdowns";
import { comparaisonVersions, listDeploys } from "@/lib/queries-deploys";
import { longtaskSeries, worstLongtasks } from "@/lib/queries-longtasks";
import { resourcesVue } from "@/lib/queries-resources";
import { ecartP75, mesuresMinimales } from "@/lib/stats/incertitude";
import { ecrireVue, lireComparaison, lireEtatDeVue, lireTri } from "@/lib/view-state";

export const dynamic = "force-dynamic";

// Sources des tuiles comparées à la période précédente (§ 3.2) : un p75 n'est pas
// un compte (le retard d'ingestion ne le fausse pas), les pages vues si.
const SOURCE_VITAUX: SourceComparaison = { table: "rum_metric", colonneTemps: "ts", additive: false };
const SOURCE_VUES: SourceComparaison = { table: "rum_pageview", colonneTemps: "started_at", additive: true };

/** Ancre du classement : la tuile « Routes au-delà de Bon » y mène. */
const ANCRE_HERO = "hero-routes";

/** Lecture non lancée (sans objet sous ce réglage) : jamais affichée comme une mesure. */
const sansLecture = <T,>(data: T): Promise<Lecture<T>> => Promise.resolve({ ok: true, data });

/**
 * Les mêmes filtres SANS condition de release : les releases comparées (§ 3.2) se
 * choisissent parmi toutes celles de la fenêtre — sous `release=B`, la lecture des
 * versions ne verrait que B, et « précédente » n'existerait plus.
 */
function sansRelease(f: Filters): Filters {
  if (!f.query) return f;
  const { release: _release, ...filtres } = f.query.filters;
  return {
    ...f,
    query: { ...f.query, filters: { ...filtres, segments: filtres.segments.filter((c) => c.dimension !== "release") } },
  };
}

/** La première couverture incomplète d'une rangée de sources, sinon « complète ». */
function couvertureDe(couvertures: readonly CouverturePrecedente[]): CouverturePrecedente {
  return couvertures.find((c) => c.etat !== "complete") ?? { etat: "complete", raison: null };
}

export default async function Pages({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/pages");
  if (!ecran.ok) return <FilterProblemNotice title="Pages" problem={ecran.problem} />;
  const f = ecran.filters;
  const period = { label: ecran.label };
  const lecteur = paramReader(sp);

  // État de vue (F06) : vital piloté, tri du classement, comparaison. Un réglage
  // illisible est ignoré et SIGNALÉ ; la comparaison l'est déjà par la barre de filtres.
  const etatVue = lireEtatDeVue("/pages", lecteur);
  const comparaison = lireComparaison("/pages", lecteur);
  const ignores = etatVue.ignores.filter((ligne) => !comparaison.ignores.includes(ligne));
  const vital: VitalName = etatVue.etat.vital && estVital(etatVue.etat.vital) ? etatVue.etat.vital : "LCP";
  const tri = lireTri("/pages", lecteur).tri === "volume" ? "volume" : "gravite";
  const classement = classementParRoute(vital);
  const mode = comparaison.valeur.mode;
  const prev = mode === "prev";

  const schema = await dimensionSchema();
  const dispo = datasetAvailability(VITALS_BREAKDOWN_DATASETS, schema);
  const dispoNavigateur = dispo("browser");
  const dispoPays = dispo("country");
  const fVersions = sansRelease(f);

  const couvertures = (source: SourceComparaison) =>
    Promise.all(sourcesSousFiltres(ecran.query, source).map((s) => couverturePrecedente(ecran.query, s)));

  // Chaque lecture est indépendante (F02, § 3.8) : `lire()` ne lève pas, une lecture
  // en échec ne rend « Lecture en échec » que dans SA section.
  const [
    decoupe,
    routes,
    ressourcesRoutes,
    vitaux,
    vitauxPrev,
    serieVital,
    vues,
    vuesPrev,
    echantillonnage,
    couvVitaux,
    couvVues,
    deploys,
    versions,
    navigateurs,
    pays,
    pcts,
    lcpH,
    inpH,
    clsH,
    ressources,
    blocages,
    pires,
  ] = await Promise.all([
    classement.disponible ? lire(() => vitalsBreakdown(f, "route", ROUTES_MAX)) : sansLecture<BreakdownResult<VitalsBreakdownRow> | null>(null),
    classement.disponible ? lire(() => slowRoutes(f)) : sansLecture([]),
    classement.disponible ? lire(() => slowResourcesByRoute(f)) : sansLecture(new Map()),
    lire(() => vitalsP75(f)),
    prev ? lire(() => vitalsP75(f, true)) : sansLecture<VitalAgg[]>([]),
    lire(() => vitalSeriesN(f, vital)),
    lire(() => pageviewSeries(f)),
    prev ? lire(() => pageviewSeries(f, true)) : sansLecture([]),
    lire(() => samplingVitals(f)),
    prev ? couvertures(SOURCE_VITAUX) : Promise.resolve<CouverturePrecedente[]>([]),
    prev ? couvertures(SOURCE_VUES) : Promise.resolve<CouverturePrecedente[]>([]),
    lire(() => listDeploys(f, 20)),
    lire(() => comparaisonVersions(fVersions)),
    dispoNavigateur.available ? lire(() => vitalsBreakdown(f, "browser", ROUTES_MAX)) : sansLecture(null),
    dispoPays.available ? lire(() => vitalsBreakdown(f, "country", ROUTES_MAX)) : sansLecture(null),
    lire(() => vitalPercentiles(f)),
    lire(() => vitalHistogram(f, "LCP", VITAL_CAP.LCP, HISTO_BUCKETS)),
    lire(() => vitalHistogram(f, "INP", VITAL_CAP.INP, HISTO_BUCKETS)),
    lire(() => vitalHistogram(f, "CLS", VITAL_CAP.CLS, HISTO_BUCKETS)),
    lire(() => resourcesVue(f)),
    lire(() => longtaskSeries(f)),
    lire(() => worstLongtasks(f)),
  ]);

  // ─── Vues préréglées (F08, § 3.6) : données lues ici, règles dans lib/presets.ts ───
  const choix = deploys.ok && versions.ok ? choisirReleases(deploys.data, versions.data.rows) : null;
  const entreeReleases: Entree<ReturnType<typeof choisirReleases>> = choix
    ? { valeur: choix }
    : { indisponible: "lecture des releases en échec" };
  const entreeNavigateurs: Entree<readonly LigneNavigateur[]> = !dispoNavigateur.available
    ? { indisponible: dispoNavigateur.reason ?? "navigateur non collecté" }
    : !navigateurs.ok || !navigateurs.data
      ? { indisponible: "lecture des navigateurs en échec" }
      : { valeur: navigateurs.data.rows.map((r) => ({ valeur: r.valeur, lcp_p75: r.lcp_p75, lcp_n: r.lcp_n })) };
  const entreePays: Entree<readonly LignePays[]> = !dispoPays.available
    ? { indisponible: dispoPays.reason ?? "pays estimé non collecté" }
    : !pays.ok || !pays.data
      ? { indisponible: "lecture des pays estimés en échec" }
      : { valeur: pays.data.rows.map((r) => ({ valeur: r.valeur, volume: r.samples })) };
  const vuesPrereglees = vuesProduit({ releases: entreeReleases, navigateurs: entreeNavigateurs, pays: entreePays });

  // ─── Comparaison de releases (§ 3.2) : B contre A, même fenêtre ───
  // Les releases de l'URL, sinon la règle du § 3.2 (dernier déploiement déclaré…).
  // La tuile p75 lit alors la release B et se compare à A ; si l'une manque, ou si la
  // dimension n'est pas collectée pour les mesures, la tuile n'a pas d'écart ET le dit.
  let releaseTuile: { relA: string; relB: string; regle: string } | null = null;
  let releaseIndisponible: string | null = null;
  if (mode === "release") {
    const relB = comparaison.valeur.relB ?? choix?.relB ?? null;
    const relA = comparaison.valeur.relA ?? choix?.relA ?? null;
    const support = dimensionSupport("vitals", "release", schema);
    if (!support.supported) releaseIndisponible = support.message;
    else if (!choix && (relA === null || relB === null)) releaseIndisponible = "lecture des releases en échec";
    else if (relA === null || relB === null || relA === relB) releaseIndisponible = choix?.indisponible ?? "moins de deux releases sur la fenêtre";
    else {
      const regle =
        comparaison.valeur.relA && comparaison.valeur.relB
          ? `${relB} contre ${relA}, choisies dans l'URL`
          : (choix?.regle ?? `${relB} contre ${relA}`);
      releaseTuile = { relA, relB, regle };
    }
  }
  const releases = releaseTuile;
  const [vitauxB, vitauxA, serieB] = releases
    ? await Promise.all([
        lire(() => vitalsP75(avecCondition(f, "release", releases.relB))),
        lire(() => vitalsP75(avecCondition(f, "release", releases.relA))),
        lire(() => vitalSeriesN(avecCondition(f, "release", releases.relB), vital)),
      ])
    : [null, null, null];

  const parNom = (l: Lecture<VitalAgg[]> | null) =>
    new Map((l?.ok ? l.data : []).map((v) => [v.name, v] as const));
  const ensemble = parNom(vitaux);
  const ensemblePrev = parNom(vitauxPrev);
  const fmtVital = formatDuVital(vital);
  const totalVues = vues.ok ? vues.data.reduce((s, p) => s + p.chargements + p.spa + p.inconnu, 0) : null;
  const totalVuesPrev = vuesPrev.ok && prev ? vuesPrev.data.reduce((s, p) => s + p.chargements + p.spa + p.inconnu, 0) : null;
  const reference = referencePrecedentePages(ecran.query.range);

  // Liens de l'écran : l'URL courante, un réglage changé — plage, filtres, vital et
  // comparaison restent. Un drill-down de route garde le vital et la comparaison.
  const hrefCourant = (changes: Record<string, string | null>, ancre = "") => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string") p.set(k, v);
      else if (Array.isArray(v)) for (const x of v) p.append(k, x);
    }
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    return `${qs ? `/pages?${qs}` : "/pages"}${ancre}`;
  };
  const drillRoute = (route: string | null) => {
    const [chemin, qs = ""] = breakdownDrillHref("/pages", ecran.query, "route", route, schema).split("?");
    const p = new URLSearchParams(qs);
    for (const nom of ["vital", "cmp", "rel_a", "rel_b"]) {
      const v = lecteur.get(nom);
      if (v) p.set(nom, v);
    }
    const texte = p.toString();
    return texte ? `${chemin}?${texte}` : chemin;
  };

  const lignesJointes: RoutePages[] | null =
    classement.disponible && decoupe.ok && decoupe.data
      ? joindreRoutesPages(decoupe.data.rows, routes.ok ? routes.data : null, ressourcesRoutes.ok ? ressourcesRoutes.data : null)
      : null;
  const etatEchantillon = etatLectureEchantillonnage(echantillonnage);

  return (
    <div className="animate-fade-up">
      <PageHeader title="Pages" sub="Quelles pages font attendre, pour qui, et depuis quand ?">
        <SelecteurVital vital={vital} />
      </PageHeader>

      <div className="-mt-3 mb-4 min-w-0">
        <PresetBar vues={vuesPrereglees} actif={etatVue.etat.vue ? ecrireVue(etatVue.etat.vue) : null} />
      </div>

      {ignores.map((ligne) => (
        <p key={ligne} role="note" className="mb-2 text-xs text-ink-soft" data-testid="reglage-ignore">
          {ligne}
        </p>
      ))}

      {/* LA LISTE EST PLAFONNÉE, ET ELLE LE DIT (finding 2.6, CP1). Le classement lit
          les 200 groupes les PLUS MESURÉS, puis les classe : une route lente et peu
          visitée au-delà n'y entre pas. Une liste coupée en silence ferait croire à
          un catalogue plus petit qu'il n'est. */}
      {decoupe.ok && decoupe.data?.truncated && (
        <div
          className="mb-6 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-ink"
          data-testid="routes-tronquees"
        >
          <p className="font-semibold">
            {decoupe.data.groups.toLocaleString("fr-FR")} routes distinctes mesurées sur {period.label} — les{" "}
            {ROUTES_MAX} plus mesurées sont classées ; {(decoupe.data.groups - ROUTES_MAX).toLocaleString("fr-FR")}{" "}
            autres, moins mesurées, ne le sont pas.
          </p>
          <p className="mt-1 text-xs">
            Au-delà de quelques centaines de routes, il y a une statistique par page, donc plus de
            statistique du tout. Une cardinalité qui grimpe ainsi vient presque toujours
            d&apos;identifiants non normalisés dans l&apos;URL — slugs, dates, numéros de dossier —
            que <code className="font-mono">normalizeRoute</code> ne reconnaît pas encore.
          </p>
        </div>
      )}

      <SectionErreur titre="Chiffres clés des pages">
        <section aria-label="Chiffres clés des pages" className="mb-6" data-testid="kpi-pages">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <TuileVital
              vital={vital}
              vitaux={vitaux}
              ensemble={ensemble.get(vital)}
              ensemblePrev={prev ? (vitauxPrev.ok ? ensemblePrev.get(vital) : undefined) : undefined}
              prevLu={!prev || vitauxPrev.ok}
              serie={serieVital.ok ? serieVital.data.map((p) => p.p75) : undefined}
              reference={prev ? reference : undefined}
              couverture={prev ? couvertureDe(couvVitaux) : undefined}
              release={
                releaseTuile && vitauxA && vitauxB && serieB
                  ? {
                      ...releaseTuile,
                      b: vitauxB.ok ? (parNom(vitauxB).get(vital) ?? null) : undefined,
                      a: vitauxA.ok ? (parNom(vitauxA).get(vital) ?? null) : undefined,
                      serie: serieB.ok ? serieB.data.map((p) => p.p75) : undefined,
                    }
                  : null
              }
              plage={period.label}
            />
            {!classement.disponible ? (
              <KpiTile
                label="Routes au-delà de « Bon »"
                valeur={null}
                format="count"
                raisonNull={classement.raison}
              />
            ) : !decoupe.ok || !decoupe.data ? (
              <div className="card p-4">
                <EchecLecture compact titre="Routes au-delà de « Bon »" />
              </div>
            ) : (
              (() => {
                const tuile = tuileRoutesAuDelaDeBon(decoupe.data.rows, classement.vital);
                const lecture = [
                  tuile.lecture,
                  ...(decoupe.data.truncated ? [`parmi les ${ROUTES_MAX} routes les plus mesurées`] : []),
                  // B12 : `vitalsBreakdown` ne lit pas la période précédente.
                  ...(prev ? ["sans référence : lecture de la période précédente non disponible"] : []),
                ].join(" · ");
                return (
                  <KpiTile
                    label="Routes au-delà de « Bon »"
                    valeur={tuile.valeur}
                    format="count"
                    raisonNull={tuile.raison ?? undefined}
                    sensMeilleur="bas"
                    lecture={lecture}
                    href={hrefCourant({ tri: null }, `#${ANCRE_HERO}`)}
                  />
                );
              })()
            )}
            {!vues.ok ? (
              <div className="card p-4">
                <EchecLecture compact titre="Pages vues" />
              </div>
            ) : (
              <KpiTile
                label="Pages vues"
                valeur={totalVues}
                format="count"
                sensMeilleur="neutre"
                serie={vues.data.map((p) => p.chargements + p.spa + p.inconnu)}
                {...(prev && vuesPrev.ok
                  ? { precedent: totalVuesPrev, reference, couverturePrecedente: couvertureDe(couvVues) }
                  : {})}
              />
            )}
          </div>

          <div className="mt-3 space-y-2">
            {prev && (!vitauxPrev.ok || !vuesPrev.ok) && (
              <EtatSurface
                compact
                etat={{ kind: "partiel", raison: "la période précédente n'a pas pu être lue : les tuiles concernées n'affichent aucune variation." }}
              />
            )}
            {mode === "release" && (
              <p role="note" className="text-xs text-ink-soft" data-testid="note-comparaison">
                {releaseTuile
                  ? `Comparaison de releases — ${releaseTuile.regle}. La tuile p75 lit la release ${releaseTuile.relB} contre ${releaseTuile.relA} : même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte. Les autres chiffres portent sur toute la population filtrée.`
                  : `Comparaison de releases indisponible : ${releaseIndisponible ?? "releases non lues"} ; aucune tuile n'a d'écart.`}
              </p>
            )}
            {etatEchantillon && <EtatSurface compact etat={etatEchantillon} />}
          </div>
        </section>
      </SectionErreur>

      <SectionErreur titre={`Routes classées par ${vital}`}>
        <div id={ANCRE_HERO} className="scroll-mt-4">
          {!classement.disponible ? (
            <Figure titre={`Routes classées par ${vital}`} id="classement-routes">
              <p role="note" className="text-sm text-ink-soft" data-testid="classement-indisponible" data-etat="indisponible">
                Non disponible, raison : {classement.raison}. Les tuiles et la distribution suivent {vital} ; le
                classement des routes se lit sous LCP, INP ou CLS.
              </p>
            </Figure>
          ) : !decoupe.ok || !decoupe.data ? (
            <Figure titre={`Routes classées par ${vital}`} id="classement-routes" etat={{ kind: "erreur", titre: `Routes classées par ${vital}` }} />
          ) : decoupe.data.rows.length === 0 || !lignesJointes ? (
            <Figure
              titre={`Routes classées par ${vital}`}
              id="classement-routes"
              etat={{ kind: "vide", population: "route avec mesure LCP, INP ou CLS", plage: period.label }}
            />
          ) : (
            <HeroRoutes
              vital={classement.vital}
              lignes={lignesJointes}
              tri={tri}
              triHref={{
                gravite: hrefCourant({ tri: null }),
                volume: hrefCourant({ tri: "volume" }),
                impact: null,
                fourni: null,
              }}
              ensemble={vitaux.ok ? ensemble : null}
              totalVues={totalVues}
              groupes={decoupe.data.groups}
              tronque={decoupe.data.truncated}
              plage={period.label}
              routesLues={routes.ok}
              ressourcesLues={ressourcesRoutes.ok}
              drill={drillRoute}
            />
          )}
        </div>
      </SectionErreur>

      {/* Distribution & percentiles (Lot 3) : ce que le p75 seul masque —
          longue traîne (p90/p95/p99) et forme de la distribution. Chaque figure
          a sa lecture : un histogramme en échec n'efface pas les deux autres. */}
      <section className="mb-6 space-y-4">
        <SectionErreur titre="Percentiles des Web Vitals">
          {pcts.ok ? <PercentileTable rows={pcts.data} /> : <EchecLecture titre="Percentiles des Web Vitals" />}
        </SectionErreur>
        <div className="grid gap-4 md:grid-cols-3">
          {(
            [
              ["LCP", lcpH],
              ["INP", inpH],
              ["CLS", clsH],
            ] as const
          ).map(([name, histo]) => (
            <SectionErreur key={name} titre={`Distribution ${name}`}>
              {histo.ok ? (
                <Histogram name={name} rows={histo.data} cap={VITAL_CAP[name]} />
              ) : (
                <div className="card p-4">
                  <EchecLecture compact titre={`Distribution ${name}`} />
                </div>
              )}
            </SectionErreur>
          ))}
        </div>
      </section>

      {/* Ressources (P6.3) : ce qui est téléchargé, d'où, à quel coût — avec son
          avertissement de collecte, et un partage première/tierce partie lu sur
          les seules origines déclarées de l'application. */}
      <SectionErreur titre="Ressources">
        {ressources.ok ? (
          <ResourcesView vue={ressources.data} periodLabel={period.label} />
        ) : (
          <div className="mt-6">
            <EchecLecture titre="Ressources" />
          </div>
        )}
      </SectionErreur>

      {/* Blocages du fil principal (P6.3) : la série, et le chemin vers la session.
          Série et pires cas forment UNE section : l'un sans l'autre se lirait
          comme un tableau complet. */}
      <SectionErreur titre="Blocages du fil principal">
        {blocages.ok && pires.ok ? (
          <LongtasksView
            series={blocages.data}
            worst={pires.data}
            bucketSeconds={ecran.query.range.bucketSeconds}
            bucketLabel={ecran.bucketLabel}
            periodLabel={period.label}
            sessionHref={(id) => hrefWithQuery(`/sessions/${encodeURIComponent(id)}`, ecran.query)}
          />
        ) : (
          <div className="mt-6">
            <EchecLecture titre="Blocages du fil principal" />
          </div>
        )}
      </SectionErreur>
    </div>
  );
}

/**
 * Tuile « <vital> p75 (ensemble) » (§ 5.2.2) : valeur, verdict, intervalle (P*.1),
 * sparkline de la MÊME population, et l'écart du mode de comparaison courant.
 *
 *   - `cmp=prev` : la période précédente, si elle est complète (§ 3.2) ;
 *   - `cmp=release` : la tuile lit la release B (libellé changé en conséquence) et se
 *     compare à A, même fenêtre ; sparkline de B (R-P : même population que la valeur) ;
 *   - `cmp=none` : ni écart ni référence.
 */
function TuileVital({
  vital,
  vitaux,
  ensemble,
  ensemblePrev,
  prevLu,
  serie,
  reference,
  couverture,
  release,
  plage,
}: {
  vital: VitalName;
  vitaux: Lecture<VitalAgg[]>;
  ensemble: VitalAgg | undefined;
  ensemblePrev: VitalAgg | undefined;
  /** La période précédente a été lue (ou n'était pas demandée). */
  prevLu: boolean;
  serie: (number | null)[] | undefined;
  /** Référence `cmp=prev` ; absente hors de ce mode. */
  reference: string | undefined;
  couverture: CouverturePrecedente | undefined;
  release: {
    relA: string;
    relB: string;
    /** `undefined` : lecture en échec ; `null` : aucune mesure du vital sur cette release. */
    b: VitalAgg | null | undefined;
    a: VitalAgg | null | undefined;
    serie: (number | null)[] | undefined;
  } | null;
  plage: string;
}) {
  const fmt = formatDuVital(vital);
  const borne = (v: number) => formater(fmt, v);
  if (!vitaux.ok) {
    return (
      <div className="card p-4">
        <EchecLecture compact titre={`${vital} p75`} />
      </div>
    );
  }
  if (release) {
    if (release.b === undefined) {
      return (
        <div className="card p-4">
          <EchecLecture compact titre={`${vital} p75 · release ${release.relB}`} />
        </div>
      );
    }
    const b = release.b;
    return (
      <KpiTile
        label={`${vital} p75 · release ${release.relB}`}
        valeur={b?.p75 ?? null}
        raisonNull={`aucune mesure ${vital} de la release ${release.relB} sur ${plage}`}
        format={fmt}
        vital={vital}
        couverture={{ n: b?.n ?? 0, unite: "mesures", faibleSous: 100 }}
        intervalle={b?.intervalle}
        lecture={b && b.n < 100 ? `médiane ${formater(fmt, b.p50)}` : undefined}
        serie={release.serie}
        // Référence A illisible : aucun écart, plutôt qu'un « pas de mesure » faux.
        {...(release.a === undefined
          ? {}
          : {
              precedent: release.a?.p75 ?? null,
              reference: `vs release ${release.relA} (même fenêtre)`,
              ecart: ecartP75EntreReleases(b?.intervalle, release.a?.intervalle, release.relA, borne),
            })}
      />
    );
  }
  return (
    <KpiTile
      label={`${vital} p75 (ensemble)`}
      valeur={ensemble?.p75 ?? null}
      raisonNull={`aucune mesure ${vital} sur ${plage}`}
      format={fmt}
      vital={vital}
      couverture={{ n: ensemble?.n ?? 0, unite: "mesures", faibleSous: 100 }}
      intervalle={ensemble?.intervalle}
      lecture={ensemble && ensemble.n < 100 ? `médiane ${formater(fmt, ensemble.p50)}` : undefined}
      serie={serie}
      {...(reference && couverture && prevLu
        ? {
            precedent: ensemblePrev?.p75 ?? null,
            reference,
            couverturePrecedente: { ...couverture, n: ensemblePrev?.n ?? 0 },
            ecart: ecartP75(ensemble?.intervalle, ensemblePrev?.intervalle, borne),
          }
        : {})}
    />
  );
}

/**
 * Hero « Routes classées par <vital> » (§ 5.2.2) : `ImpactTable`, un classement est un
 * classement (P14). Pilote = p75 du vital, volume = ses mesures ; colonnes LCP, INP,
 * CLS p75 (verdict écrit, seulement à partir de 13 mesures, P*.1), vues, tâches
 * longues, ressources bloquantes ; écart au p75 de l'ensemble ; ligne « Ensemble » en
 * tête, non classée. 12 lignes visibles, les suivantes défilent dans la liste : la
 * page ne s'allonge pas de 200 lignes.
 */
function HeroRoutes({
  vital,
  lignes,
  tri,
  triHref,
  ensemble,
  totalVues,
  groupes,
  tronque,
  plage,
  routesLues,
  ressourcesLues,
  drill,
}: {
  vital: VitalClasseParRoute;
  lignes: RoutePages[];
  tri: "gravite" | "volume";
  triHref: Record<"gravite" | "volume" | "impact" | "fourni", string | null>;
  /** `null` : `vitalsP75` en échec — pas de ligne « Ensemble », pas d'écart. */
  ensemble: Map<string, VitalAgg> | null;
  totalVues: number | null;
  groupes: number;
  tronque: boolean;
  plage: string;
  routesLues: boolean;
  ressourcesLues: boolean;
  drill: (route: string | null) => string;
}) {
  const fmt = formatDuVital(vital);
  const minimumVerdict = mesuresMinimales();
  const ref = ensemble?.get(vital) ?? null;
  const { lignes: classees } = classerParGravite(lignes, {
    tri,
    pilote: (l) => p75DeLaRoute(l, vital).p75,
    effectif: (l) => p75DeLaRoute(l, vital).n,
  });
  const mesureVital = (cle: string, v: "LCP" | "INP" | "CLS", valeur: number | null, n: number) => ({
    cle,
    valeur,
    affichage: formater(formatDuVital(v), valeur),
    // Verdict écrit seulement quand la p75 a un intervalle (P*.1 : 13 mesures au moins).
    ...(n >= minimumVerdict ? { vital: v } : {}),
    n,
  });
  const impact: ImpactLigne[] = classees.map((l) => {
    const { p75, n } = p75DeLaRoute(l, vital);
    const libelle = groupLabel(l.valeur);
    return {
      cle: l.valeur === null ? " inconnu" : `r:${l.valeur}`,
      libelle,
      href: drill(l.valeur),
      description: `Route ${libelle} — ${vital} p75 ${formater(fmt, p75)}, ${formater("count", n)} mesures ${vital}`,
      pilote: p75,
      volume: n,
      mesures: [
        mesureVital("lcp", "LCP", l.lcp_p75, l.lcp_n),
        mesureVital("inp", "INP", l.inp_p75, l.inp_n),
        mesureVital("cls", "CLS", l.cls_p75, l.cls_n),
        { cle: "vues", valeur: l.vues, affichage: formater("count", l.vues) },
        { cle: "taches", valeur: l.tachesLongues, affichage: formater("count", l.tachesLongues) },
        { cle: "bloquantes", valeur: l.bloquantes, affichage: formater("count", l.bloquantes) },
      ],
      ...(ensemble ? { ecart: ecartAEnsemblePages(p75, ref?.p75 ?? null, vital) } : {}),
      echantillonFaible: estFaible(n),
    };
  });

  const avertissements = [
    ...(!routesLues ? ["vues et tâches longues par route non lues : « — »"] : []),
    ...(!ressourcesLues ? ["ressources par route non lues : « — »"] : []),
  ];
  const notice = [
    BREAKDOWN_NOTICES.route,
    `Plage : ${plage}.`,
    tronque
      ? `Les ${ROUTES_MAX} routes les plus mesurées sont classées ; ${(groupes - ROUTES_MAX).toLocaleString("fr-FR")} autres, moins mesurées, ne le sont pas.`
      : null,
    "Vues et tâches longues : lecture à part, sur les 200 routes au LCP le plus lent (« — » au-delà). « Bloquantes » : ressources bloquant le rendu parmi les 3 plus lentes de la route.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="min-w-0 [&_ol]:max-h-[28rem] [&_ol]:overflow-y-auto" data-testid="hero-routes" data-vital={vital}>
      {avertissements.length > 0 && (
        <div className="mb-2">
          <EtatSurface compact etat={{ kind: "partiel", raison: `${avertissements.join(" ; ")}.` }} />
        </div>
      )}
      <ImpactTable
        titre={`Routes classées par ${vital}`}
        tri={tri}
        triHref={triHref}
        reference={
          ref
            ? {
                libelle: "Ensemble",
                valeurs: {
                  pilote: formater(fmt, ref.p75),
                  volume: formater("count", ref.n),
                  lcp: formater("ms", ensemble?.get("LCP")?.p75 ?? null),
                  inp: formater("ms", ensemble?.get("INP")?.p75 ?? null),
                  cls: formater("cls", ensemble?.get("CLS")?.p75 ?? null),
                  vues: formater("count", totalVues),
                },
              }
            : null
        }
        referenceRaison={
          ensemble ? `aucune mesure ${vital} sur ${plage} pour l'ensemble` : "le p75 de l'ensemble n'a pas pu être lu"
        }
        lignes={impact}
        colonnes={["LCP p75", "INP p75", "CLS p75", "Vues", "Tâches longues", "Bloquantes"]}
        unitePilote={fmt}
        volumeLibelle={`Mesures ${vital}`}
        groupes={groupes}
        tronque={tronque}
        notice={notice}
      />
    </div>
  );
}
