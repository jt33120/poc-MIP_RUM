// Écran Tracing (§ 5.8, F60) : « Quand un appel est lent, le temps part-il dans le
// serveur ou dans le trajet (réseau, proxy) ? »
//
// CE QUE L'ÉCRAN NE CALCULE PLUS (DF2). L'ancien hero coupait chaque barre en
// « serveur = p75 serveur » et « réseau = p75 navigateur − p75 serveur ». Cette
// différence n'est le p75 de rien : les deux percentiles ne tombent pas sur le même
// appel, et le second ne porte que sur les appels suivis. Désormais :
//   - une barre = UNE longueur, le p75 vu du navigateur ;
//   - la part serveur est une proportion mesurée appel par appel (médiane de
//     serveur / navigateur), sur sa propre échelle 0-100 %, jamais en ms ;
//   - le trajet, quand il s'affiche (table), est un p75 de différences calculées
//     TRACE PAR TRACE (`apiCallsDecomposition`).
//
// AUCUNE COULEUR DE VERDICT sur une durée d'API : aucun seuil n'est publié (R-S).
//
// CHAQUE SECTION LIT POUR ELLE-MÊME (F02, § 3.8) : une lecture en échec rend l'état
// « erreur » de sa section, les autres restent affichées. Aucune frontière Suspense
// au-dessus de l'écran (elles cassent la navigation par query).
import Link from "next/link";
import type { ReactNode } from "react";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar } from "@/components/charts/RankBar";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { CadreEtat, EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { DeployPanel } from "@/components/tracing/DeployPanel";
import { SlowRow } from "@/components/tracing/SlowRow";
import { TableAppels } from "@/components/tracing/TableAppels";
import { parseExplorerPlan } from "@/lib/analytics-schema";
import { annotationsDeploiements } from "@/lib/annotations";
import {
  couverturePrecedente,
  sourcesSousFiltres,
  type CouverturePrecedente,
  type SourceComparaison,
} from "@/lib/comparaison";
import { explorerHref } from "@/lib/explorer-page-params";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { lire, type Lecture } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { latestDeployImpact, listDeploys } from "@/lib/queries-deploys";
import {
  apiCallsDecomposition,
  backRoutes,
  slowTraces,
  spanLatencySeries,
  traceCoverage,
  type TraceCoverage,
} from "@/lib/queries-tracing";
import { bucketStarts, hrefWithQuery, paramReader, previousRange, type AnalyticsQuery } from "@/lib/query-contract";
import { grilleIso, libelleSeauComplet, type PointSerie } from "@/lib/series";
import { ancreAppel, lireAppel, type Appel } from "@/lib/tracing-ancres";
import { APPELS_HERO, fragmentVers, libelleAppel, lignesHero, texteDecomposition } from "@/lib/tracing-hero";
import { gabaritZoom, ligneIgnoree, lireComparaison } from "@/lib/view-state";

export const dynamic = "force-dynamic";

/** Au-delà, `apiCallsDecomposition` tronque (`limit 50`) : la table le dit. */
const APPELS_MAX = 50;

// Période précédente (`cmp=prev`) : un compte d'appels est sensible au retard
// d'ingestion, une durée ou une part ne l'est pas (§ 3.2, règle 3).
const SOURCE_APPELS: SourceComparaison = { table: "rum_span", colonneTemps: "ts", additive: true };
const SOURCE_DUREES: SourceComparaison = { table: "rum_span", colonneTemps: "ts", additive: false };

const JJMM_HHMM_UTC = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** « vs période précédente (20/09 14:00 → 21/09 14:00 UTC) » : la référence écrite en toutes lettres (P4). */
function referencePrecedente(query: AnalyticsQuery): string {
  const p = previousRange(query.range);
  return `vs période précédente (${JJMM_HHMM_UTC.format(new Date(p.from))} → ${JJMM_HHMM_UTC.format(new Date(p.to))} UTC)`;
}

/** La couverture d'une tuile : la première source incomplète gagne ; `n` = effectif de la période précédente. */
function couvertureDe(couvertures: readonly CouverturePrecedente[], n: number | null): CouverturePrecedente {
  const incomplete = couvertures.find((c) => c.etat !== "complete");
  return incomplete ? { ...incomplete, n } : { etat: "complete", raison: null, n };
}

/**
 * Lien vers CET écran, paramètres courants gardés tels quels (contrat, comparaison,
 * `appel`…), certains remplacés (`null` retire), ancre éventuelle.
 */
function lienEcran(sp: SearchParams, extra: Record<string, string | null> = {}, fragment = ""): string {
  const p = new URLSearchParams();
  for (const [nom, valeur] of Object.entries(sp)) {
    if (valeur === undefined || nom in extra) continue;
    for (const v of Array.isArray(valeur) ? valeur : [valeur]) p.append(nom, v);
  }
  for (const [nom, valeur] of Object.entries(extra)) if (valeur !== null) p.set(nom, valeur);
  const qs = p.toString();
  return `/tracing${qs ? `?${qs}` : ""}${fragment}`;
}

/** « Aucun appel… » : `EtatSurface{vide}` accorde au féminin (« Aucune … »), un appel est masculin. */
function Vide({ children }: { children: ReactNode }) {
  return (
    <CadreEtat ton="neutre" role="status" testId="etat-vide" etat="vide" className="text-center">
      <p>{children}</p>
    </CadreEtat>
  );
}

/** Section en tableau : titre `h2`, méta, table défilante (première colonne collante). */
function SectionTable({
  id,
  titre,
  meta,
  lecture,
  explorer,
  children,
}: {
  id: string;
  titre: ReactNode;
  meta?: ReactNode;
  lecture?: ReactNode;
  explorer?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="card mb-6 min-w-0 scroll-mt-20 p-4 sm:p-5" data-testid={`section-${id}`}>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="min-w-0 break-words text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{titre}</h2>
        {explorer && (
          <Link href={explorer} className="ml-auto shrink-0 text-xs text-perf underline-offset-2 hover:underline">
            Ouvrir dans l&apos;Explorer
          </Link>
        )}
      </div>
      {meta && <div className="mb-3 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft">{meta}</div>}
      {children}
      {lecture && <p className="mt-3 text-xs leading-relaxed text-ink-soft">{lecture}</p>}
    </section>
  );
}

export default async function Tracing({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/tracing");
  if (!ecran.ok) return <FilterProblemNotice title="Tracing" problem={ecran.problem} />;
  const f = ecran.filters;
  const query = ecran.query;
  const plage = ecran.label;

  // Réglages d'écran : comparaison (défaut « aucune » hors Performance) et filtre
  // `appel` de « Traces les plus lentes ». Illisibles : ignorés et DITS, jamais un refus.
  const lecteur = paramReader(sp);
  const comparaison = lireComparaison("/tracing", lecteur);
  const reglagesIgnores = [...comparaison.ignores];
  const appelBrut = lecteur.get("appel");
  const appel: Appel | null = lireAppel(sp);
  if (appelBrut !== null && appelBrut !== "" && appel === null) {
    reglagesIgnores.push(ligneIgnoree("appel", appelBrut, "forme attendue « <méthode> <chemin> »"));
  }
  if (comparaison.valeur.mode === "release") {
    reglagesIgnores.push(
      "Comparaison par release non proposée sur cet écran : les chiffres clés se comparent à la période précédente (cmp=prev).",
    );
  }
  const prev = comparaison.valeur.mode === "prev";
  const fPrec = { ...f, query: { ...query, range: previousRange(query.range) } };
  const reference = referencePrecedente(query);

  const couvertures = (source: SourceComparaison) =>
    Promise.all(sourcesSousFiltres(query, source).map((s) => couverturePrecedente(query, s)));
  const sansLecture = <T,>(data: T): Promise<Lecture<T>> => Promise.resolve({ ok: true, data });

  const [cov, covPrec, couvAppels, couvDurees, appels, serie, seriePrec, routes, lentes, deploys, impact] =
    await Promise.all([
      lire(() => traceCoverage(f)),
      prev ? lire(() => traceCoverage(fPrec)) : sansLecture<TraceCoverage | null>(null),
      prev ? couvertures(SOURCE_APPELS) : Promise.resolve<CouverturePrecedente[]>([]),
      prev ? couvertures(SOURCE_DUREES) : Promise.resolve<CouverturePrecedente[]>([]),
      lire(() => apiCallsDecomposition(f)),
      lire(() => spanLatencySeries(f)),
      prev ? lire(() => spanLatencySeries(fPrec)) : sansLecture(null),
      lire(() => backRoutes(f)),
      lire(() => slowTraces(f, appel ? { appel } : undefined)),
      lire(() => listDeploys(f, 20)),
      lire(() => latestDeployImpact(f)),
    ]);

  // ─────────────── Liens ───────────────
  const hrefAppel = (a: Appel) => lienEcran(sp, {}, fragmentVers(ancreAppel(a.method, a.url)));
  const hrefTraces = (a: Appel) => lienEcran(sp, { appel: `${a.method} ${a.url}` }, "#traces");
  const sansFiltreAppel = lienEcran(sp, { appel: null }, "#traces");
  const lienVersion = (version: string) => hrefWithQuery("/", query, { cmp: "release", rel_b: version });

  // ─────────────── Chiffres clés (T1-T5) ───────────────
  const c = cov.ok ? cov.data : null;
  const p = prev && covPrec.ok ? covPrec.data : null;
  // Une période précédente illisible n'est pas « sans mesure » : sa couverture le dit.
  const couvPrecEchec: CouverturePrecedente = { etat: "inconnue", raison: "période précédente non lue (lecture en échec)" };
  const couvT = (sources: CouverturePrecedente[], n: number | null) =>
    prev ? (covPrec.ok ? couvertureDe(sources, n) : couvPrecEchec) : undefined;
  const precedent = (v: number | null | undefined) => (prev ? (v ?? null) : undefined);
  const refTuile = prev ? reference : undefined;
  const part = (num: number, den: number) => (den > 0 ? num / den : null);

  // ─────────────── Hero (T6) ───────────────
  const lignesAppels = appels.ok ? appels.data : [];
  const hero = lignesHero(lignesAppels, {
    hrefAppel,
    hrefTraces,
    ensemble: c ? { front_p75: c.front_p75, back_p75: c.back_p75, correlated: c.correlated } : null,
  });
  const topHero = lignesAppels.slice(0, APPELS_HERO).filter((a) => a.front_p75 != null);

  // ─────────────── Série (T7) ───────────────
  const debuts = bucketStarts(query.range);
  const grille = grilleIso(debuts);
  const precParRang = seriePrec.ok && seriePrec.data ? seriePrec.data : null;
  // Période précédente alignée PAR RANG de seau (§ 3.2) : même largeur, même nombre.
  const points: PointSerie[] = serie.ok
    ? serie.data.map((s, i) => ({
        t: s.t,
        front_p75: s.front_p75,
        back_p75: s.back_p75,
        n: s.n,
        ...(precParRang ? { front_prec: precParRang[i]?.front_p75 ?? null } : {}),
      }))
    : [];
  const seriesT7 = [
    { cle: "front_p75", libelle: "Navigateur · p75", role: "principale" as const, effectifCle: "n" },
    { cle: "back_p75", libelle: "Serveur · p75 (appels suivis)", role: "categorie" as const, categorieIndex: 0 },
    ...(precParRang ? [{ cle: "front_prec", libelle: "Navigateur · p75, période précédente", role: "reference" as const }] : []),
  ];
  const annot = deploys.ok
    ? annotationsDeploiements(deploys.data, query.range, {
        lien: (relB, relA) => hrefWithQuery("/", query, { cmp: "release", rel_b: relB, rel_a: relA }),
        lienListe: "#deploiements",
      })
    : null;
  const zoom = gabaritZoom(hrefWithQuery("/tracing", query, { period: null, from: "{from}", to: "{to}" }), sp);
  const planSerie = parseExplorerPlan(
    { dataset: "spans", measure: { field: "duration_ms", aggregation: "p75" }, variant: "front", visualization: "timeseries" },
    query,
  );
  const planRoutes = parseExplorerPlan(
    { dataset: "spans", measure: { field: "duration_ms", aggregation: "p75" }, variant: "back", visualization: "toplist", groupBy: ["route"] },
    query,
  );
  const appelsLus = serie.ok ? serie.data.reduce((s, x) => s + x.n, 0) : 0;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tracing"
        domain="robot"
        help="tracing"
        sub="Quand un appel est lent, le temps part-il dans le serveur ou dans le trajet (réseau, proxy) ?"
      />

      {reglagesIgnores.map((l) => (
        <p key={l} role="note" data-testid="reglage-ignore" className="-mt-2 mb-4 text-xs text-ink-soft">
          {l}
        </p>
      ))}

      {/* 2 — Chiffres clés : débit, couverture, durée, erreurs (RED). */}
      <section aria-label="Chiffres clés des appels API" className="mb-6">
        {!c ? (
          <EchecLecture titre="Chiffres clés des appels API" />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiTile
              label="Appels API vus du navigateur"
              valeur={c.total}
              format="count"
              sensMeilleur="neutre"
              href={lienEcran(sp, {}, "#appels")}
              precedent={precedent(p?.total)}
              reference={refTuile}
              couverturePrecedente={couvT(couvAppels, p?.total ?? null)}
            />
            <KpiTile
              label="Appels suivis jusqu'au serveur"
              valeur={part(c.correlated, c.total)}
              format="pct"
              raisonNull="aucun appel API sur la plage"
              couverture={{ n: c.total, unite: "appels" }}
              lecture="Un appel sans jumeau serveur n'a pas pu être décomposé : middleware absent ou appel vers un tiers."
            />
            <KpiTile
              label="Durée p75 vue du navigateur"
              valeur={c.front_p75}
              format="ms"
              sensMeilleur="bas"
              raisonNull="aucun appel API sur la plage"
              couverture={{ n: c.total, unite: "appels" }}
              href={lienEcran(sp, {}, "#hero-traces")}
              precedent={precedent(p?.front_p75)}
              reference={refTuile}
              couverturePrecedente={couvT(couvDurees, p?.total ?? null)}
            />
            <KpiTile
              label="Durée p75 côté serveur (appels suivis)"
              valeur={c.back_p75}
              format="ms"
              sensMeilleur="bas"
              raisonNull="aucun appel suivi jusqu'au serveur sur la plage"
              couverture={{ n: c.correlated, unite: "appels suivis" }}
              lecture="Porte sur les seuls appels suivis : ce n'est pas la même population que la durée vue du navigateur."
              precedent={precedent(p?.back_p75)}
              reference={refTuile}
              couverturePrecedente={couvT(couvDurees, p?.correlated ?? null)}
            />
            <KpiTile
              label="Appels en échec"
              valeur={part(c.err, c.total)}
              format="pct"
              sensMeilleur="bas"
              raisonNull="aucun appel API sur la plage"
              couverture={{ n: c.total, unite: "appels" }}
              lecture="Échec : statut ≥ 400, ou 0 (coupure réseau, requête annulée)."
              href={lienEcran(sp, {}, "#appels")}
              precedent={prev ? (p ? part(p.err, p.total) : null) : undefined}
              reference={refTuile}
              couverturePrecedente={couvT(couvDurees, p?.total ?? null)}
            />
          </div>
        )}
      </section>

      {/* 3 — Hero : classement (3/5) et série (2/5), côte à côte à partir de 1280 px. */}
      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <SectionErreur titre="Appels API les plus lents">
            <Figure
              titre="Appels API les plus lents, et la part médiane du serveur"
              id="hero-traces"
              aide="tracing"
              etat={
                !appels.ok
                  ? { kind: "erreur", titre: "Appels API les plus lents" }
                  : undefined
              }
              meta={
                appels.ok && hero.lignes.length > 0 ? (
                  <>
                    <span>{plage}</span>
                    <span>
                      {formater("count", topHero.length)} appel{topHero.length > 1 ? "s" : ""} classé{topHero.length > 1 ? "s" : ""} sur{" "}
                      {formater("count", lignesAppels.length)}
                    </span>
                    <span>ordre : au moins 30 appels d&apos;abord, puis p75 décroissant</span>
                    {hero.exclues > 0 && (
                      <span>
                        {hero.exclues} appel{hero.exclues > 1 ? "s" : ""} sans durée, non classé{hero.exclues > 1 ? "s" : ""}
                      </span>
                    )}
                  </>
                ) : undefined
              }
              lecture="Barre = durée p75 vue du navigateur. Part serveur = médiane, appel par appel, de la durée serveur rapportée à la durée navigateur, sur les appels suivis."
              alternative={
                hero.lignes.length > 0
                  ? {
                      legende: "Appels API les plus lents : p75 navigateur et part serveur médiane",
                      colonnes: ["Appel", "p75 navigateur", "Appels", "Part serveur"],
                      lignes: [
                        ...(c && c.front_p75 != null
                          ? [["Ensemble", formater("ms", c.front_p75), c.total, `serveur : p75 ${formater("ms", c.back_p75)} sur ${formater("count", c.correlated)} appels suivis`]]
                          : []),
                        ...topHero.map((a) => [libelleAppel(a), formater("ms", a.front_p75), a.n, texteDecomposition(a)]),
                      ],
                    }
                  : undefined
              }
            >
              {hero.lignes.length > 0 ? (
                <RankBar data={hero.lignes} labelWidth="15rem" alternative={false} legende="Appels API les plus lents" />
              ) : (
                <Vide>Aucun appel API instrumenté sur {plage}.</Vide>
              )}
            </Figure>
          </SectionErreur>
        </div>

        <div className="min-w-0 xl:col-span-2">
          <SectionErreur titre="Latence des appels dans le temps">
            <Figure
              titre="Latence des appels dans le temps"
              id="latence-appels"
              etat={!serie.ok ? { kind: "erreur", titre: "Latence des appels dans le temps" } : undefined}
              explorer={planSerie.ok ? explorerHref(query, planSerie.value) : undefined}
              meta={
                serie.ok ? (
                  <>
                    <span>{plage}</span>
                    <span>seau de {ecran.bucketLabel} (UTC)</span>
                    <span>{formater("count", appelsLus)} appels</span>
                    {prev && !precParRang && <span>période précédente non lue</span>}
                  </>
                ) : undefined
              }
              lecture="Aucune bande : aucun seuil n'est publié pour une durée d'API. Les deux séries ne s'additionnent pas : le serveur ne porte que sur les appels suivis."
              alternative={
                serie.ok && appelsLus > 0
                  ? {
                      legende: "p75 navigateur et p75 serveur (appels suivis) par seau",
                      colonnes: ["Seau", "Navigateur · p75", "Serveur · p75", "Appels", ...(precParRang ? ["Période précédente"] : [])],
                      lignes: serie.data.map((s, i) => [
                        libelleSeauComplet(grille[i] ?? s.t, query.range.bucketSeconds, "UTC"),
                        formater("ms", s.front_p75),
                        formater("ms", s.back_p75),
                        s.n,
                        ...(precParRang ? [formater("ms", precParRang[i]?.front_p75 ?? null)] : []),
                      ]),
                    }
                  : undefined
              }
            >
              {appelsLus > 0 ? (
                <ThresholdSeries
                  grille={grille}
                  points={points}
                  series={seriesT7}
                  format="ms"
                  faibleSous={30}
                  annotations={annot?.annotations ?? []}
                  annotationsIndisponibles={
                    annot ? (annot.indisponible ?? undefined) : "lecture des déploiements en échec"
                  }
                  seauSecondes={query.range.bucketSeconds}
                  fuseau="UTC"
                  zoomHref={zoom}
                  ariaLabel={`Latence p75 des appels API par seau de ${ecran.bucketLabel}, navigateur et serveur, ${plage}`}
                />
              ) : (
                <Vide>Aucun appel API instrumenté sur {plage}.</Vide>
              )}
            </Figure>
          </SectionErreur>
        </div>
      </div>

      {/* 4 — Traces les plus lentes (T9), filtrables par appel. */}
      <SectionTable
        id="traces"
        titre={appel ? `Traces les plus lentes — ${libelleAppel(appel)}` : "Traces les plus lentes"}
        meta={
          <>
            <span>20 appels les plus longs de la plage ({plage})</span>
            <span>serveur et trajet calculés trace par trace</span>
            {appel && (
              <Link href={sansFiltreAppel} className="text-perf underline-offset-2 hover:underline" data-testid="retirer-appel">
                Retirer ce filtre
              </Link>
            )}
          </>
        }
      >
        {!lentes.ok ? (
          <EchecLecture titre="Traces les plus lentes" />
        ) : lentes.data.length === 0 ? (
          <Vide>
            {appel ? `Aucune trace de ${libelleAppel(appel)} sur la plage.` : "Aucune trace sur la plage."}
          </Vide>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm" data-testid="traces-lentes">
              <thead className="bg-panel2">
                <tr>
                  <th scope="col" className="th sticky left-0 z-10 whitespace-nowrap bg-panel2">Heure (UTC)</th>
                  <th scope="col" className="th">Appel</th>
                  <th scope="col" className="th">Statut</th>
                  <th scope="col" className="th">Navigateur</th>
                  <th scope="col" className="th">Serveur</th>
                  <th scope="col" className="th">Trajet</th>
                  <th scope="col" className="th">Session</th>
                </tr>
              </thead>
              <tbody>
                {lentes.data.map((t) => (
                  <SlowRow key={t.span_id} t={t} query={query} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionTable>

      {/* 5 — Tous les appels API (T8) : même ordre que le hero. */}
      <SectionTable
        id="appels"
        titre="Tous les appels API"
        meta={
          appels.ok && lignesAppels.length > 0 ? (
            <>
              <span>{plage}</span>
              <span>
                {formater("count", lignesAppels.length)} appel{lignesAppels.length > 1 ? "s" : ""} distinct{lignesAppels.length > 1 ? "s" : ""}
              </span>
              <span>même ordre que le classement</span>
            </>
          ) : undefined
        }
        lecture="Serveur et trajet sont deux p75 distincts, calculés sur les appels suivis ; leur somme n'est pas le p75 navigateur. Trajet = durée navigateur moins durée serveur, trace par trace (réseau, proxy, TLS)."
      >
        {!appels.ok ? (
          <EchecLecture titre="Tous les appels API" />
        ) : (
          <div className="flex flex-col gap-3">
            {lignesAppels.length >= APPELS_MAX && (
              <EtatSurface etat={{ kind: "partiel", raison: `${APPELS_MAX} appels les plus lents affichés` }} compact />
            )}
            <TableAppels
              appels={lignesAppels}
              visibles={APPELS_HERO}
              hrefTraces={hrefTraces}
              vide={<Vide>Aucun appel API instrumenté sur {plage}.</Vide>}
            />
          </div>
        )}
      </SectionTable>

      {/* 6 — Routes serveur (T10). */}
      <SectionTable
        id="routes-serveur"
        titre="Routes serveur"
        explorer={planRoutes.ok ? explorerHref(query, planRoutes.value) : undefined}
        meta={
          <>
            <span>tout trafic serveur rattaché à une session, y compris hors navigateur</span>
            <span>erreurs = statuts 5xx</span>
            <Link href={hrefWithQuery("/map", query)} className="text-perf underline-offset-2 hover:underline">
              Carte
            </Link>
          </>
        }
      >
        {!routes.ok ? (
          <EchecLecture titre="Routes serveur" />
        ) : routes.data.length === 0 ? (
          <Vide>Aucun span serveur reçu : middleware non déployé ou trafic nul.</Vide>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm" data-testid="back-routes">
              <thead className="bg-panel2">
                <tr>
                  <th scope="col" className="th sticky left-0 z-10 bg-panel2">Route serveur</th>
                  <th scope="col" className="th">Appels</th>
                  <th scope="col" className="th">p75</th>
                  <th scope="col" className="th">p95</th>
                  <th scope="col" className="th">Erreurs 5xx</th>
                  <th scope="col" className="th">Taux 5xx</th>
                </tr>
              </thead>
              <tbody>
                {routes.data.map((r) => (
                  <tr key={r.route} className="border-t border-line/60">
                    <th scope="row" className="sticky left-0 z-10 max-w-[16rem] bg-panel px-4 py-3 text-left font-mono text-xs font-normal">
                      {r.route !== "—" && planRoutes.ok ? (
                        <Link
                          href={explorerHref(query, planRoutes.value, { route: r.route })}
                          className="block truncate text-ink hover:text-brand hover:underline"
                          title={`${r.route} — ouvrir dans l'Explorer`}
                        >
                          {r.route}
                        </Link>
                      ) : (
                        <span className="block truncate text-ink">{r.route}</span>
                      )}
                    </th>
                    <td className="px-4 py-3 tabular-nums">{formater("count", r.n)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums">{formater("ms", r.p75)}</td>
                    <td className="px-4 py-3 tabular-nums">{formater("ms", r.p95)}</td>
                    <td className="px-4 py-3 tabular-nums">{formater("count", r.err)}</td>
                    <td className="px-4 py-3 tabular-nums">{formater("pct", r.n > 0 ? r.err / r.n : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionTable>

      {/* 7 — Dernier déploiement (T11) : ne disparaît plus, dit comment en recevoir. */}
      <SectionTable id="deploiements" titre="Dernier déploiement : avant / après">
        {!deploys.ok || !impact.ok ? (
          <EchecLecture titre="Dernier déploiement" />
        ) : (
          <DeployPanel deploys={deploys.data} impact={impact.data} lienVersion={lienVersion} />
        )}
      </SectionTable>
    </div>
  );
}
