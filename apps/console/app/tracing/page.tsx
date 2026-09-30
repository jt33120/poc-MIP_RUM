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
import { ECRANS } from "@mip/console-contract";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar } from "@/components/charts/RankBar";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { CadreEtat, EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { Methode as MethodeRepliee } from "@/components/perf/Methode";
import { TableDefilante } from "@/components/TableDefilante";
import { DeployPanel } from "@/components/tracing/DeployPanel";
import { SlowRow } from "@/components/tracing/SlowRow";
import { TableAppels } from "@/components/tracing/TableAppels";
import { parseExplorerPlan } from "@/lib/analytics-schema";
import { annotationsDeploiements } from "@/lib/annotations";
import { annotationsAlertes, fusionnerAnnotations, raisonsAnnotations } from "@/lib/annotations";
import { type CouverturePrecedente } from "@/lib/comparaison";
import { explorerHref } from "@/lib/explorer-page-params";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { chargerTracing } from "@/lib/chargeurs/tracing";
import { chargerEcran } from "@/lib/ecran";
import { bucketStarts, hrefWithQuery, paramReader, previousRange, type AnalyticsQuery } from "@/lib/query-contract";
import { fenetresLues, grilleIso, libelleSeauComplet, type PointSerie } from "@/lib/series";
import { TRACES_PAR_APPEL, ancreAppel, lireAppel, type Appel } from "@/lib/tracing-ancres";
import { APPELS_HERO, REGLE_HERO, fragmentVers, libelleAppel, lignesHero, texteDecomposition, tracesParAppel } from "@/lib/tracing-hero";
import { gabaritZoom, ligneIgnoree, lireComparaison } from "@/lib/view-state";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import { fmtPlage } from "@/lib/format";
import { RangeeKpi } from "@/components/charts/RangeeKpi";

export const dynamic = "force-dynamic";

/** Au-delà, `apiCallsDecomposition` tronque (`limit 50`) : la table le dit. */
const APPELS_MAX = 50;

/** D'où viennent les chiffres des cases, écrit dans leur fenêtre. */
const SOURCE_APPELS = "SDK MIP RUM : appels fetch et XMLHttpRequest vus du navigateur (durée, statut), un segment par appel.";
const SOURCE_TRACES =
  "Traces OpenTelemetry : segment serveur rattaché à l'appel navigateur par son identifiant de trace (agent officiel du langage).";

// Période précédente (`cmp=prev`) : un compte d'appels est sensible au retard
// d'ingestion, une durée ou une part ne l'est pas (§ 3.2, règle 3).

/** « vs période précédente (20/09 14:00 → 21/09 14:00) », heure de Paris : la référence écrite en toutes lettres (P4). */
function referencePrecedente(query: AnalyticsQuery): string {
  const p = previousRange(query.range);
  return `vs période précédente (${fmtPlage(p.from, p.to)})`;
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

/**
 * « Aucun appel… » en UNE ligne (recette du 30/09/2026), pictogramme en tête, dans le
 * panneau qui garde sa place. Le texte est écrit ici : « Aucun » s'accorde au masculin.
 */
function Vide({ children }: { children: ReactNode }) {
  return (
    <CadreEtat ton="neutre" role="status" testId="etat-vide" etat="vide" enLigne>
      <p className="flex items-center gap-1.5">
        <span aria-hidden className="text-ink-faint">
          ⊘
        </span>
        <span>{children}</span>
      </p>
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
    <section id={id} className="card mb-4 min-w-0 scroll-mt-20 p-3 sm:p-4" data-testid={`section-${id}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="min-w-0 break-words text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{titre}</h2>
        {explorer && (
          <Link href={explorer} className="ml-auto shrink-0 text-xs text-perf underline-offset-2 hover:underline">
            Ouvrir dans l&apos;Explorer
          </Link>
        )}
      </div>
      {/* La méta en petit, comme sous le titre d'une figure ; la lecture repliée en « Méthode ». */}
      {meta && <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">{meta}</div>}
      {children}
      {lecture && (
        <MethodeRepliee className="mt-2">
          <p>{lecture}</p>
        </MethodeRepliee>
      )}
    </section>
  );
}

export default async function Tracing({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/tracing.ts`) lit filtres et sections.
  const ecran = await chargerEcran(ECRANS.tracing, chargerTracing, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title="Tracing" problem={ecran.problem} />;
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
  const reference = referencePrecedente(query);
  const { cov, covPrec, couvAppels, couvDurees, appels, serie, seriePrec, routes, lentes, deploys, impact, alertes } = ecran;

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
  // Déclenchements d'alerte du périmètre (F67, § 3.7) : la série T7 ne porte pas
  // sur une route, toutes les alertes de l'app y ont leur place. Chaque trait mène
  // à SON événement (`/alerts?evt=<id>`, § 3.1), jamais à `fired=`.
  const lienAlertes = hrefWithQuery("/alerts", query);
  const annotAlertes = annotationsAlertes(alertes.ok ? alertes.data : [], query.range, {
    lien: (id) => `${hrefWithQuery("/alerts", query, { evt: String(id) })}#evt-${id}`,
    lienListe: lienAlertes,
  });
  const famillesT7 = [
    ...(annot ? [{ ...annot, lienListe: "#deploiements" }] : []),
    { ...annotAlertes, lienListe: lienAlertes },
  ];
  const annotationsT7 = fusionnerAnnotations(famillesT7);
  const raisonFamillesT7 = raisonsAnnotations(famillesT7);
  const annotationsAbsentesT7 =
    [
      ...(annot ? [] : ["lecture des déploiements en échec"]),
      ...(alertes.ok ? [] : ["lecture des alertes en échec"]),
      ...(raisonFamillesT7 ? [raisonFamillesT7] : []),
    ].join(" ; ") || undefined;
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
  // Échelle commune des mini-cascades : la trace la plus longue du tableau.
  const maxLentes = lentes.ok ? Math.max(0, ...lentes.data.map((t) => t.front_ms ?? 0)) : 0;

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
      <section aria-label="Chiffres clés des appels API" className="mb-4">
        {!c ? (
          <EchecLecture titre="Chiffres clés des appels API" />
        ) : (
          <RangeeKpi
            couvertures={[couvT(couvAppels, p?.total ?? null), couvT(couvDurees, p?.total ?? null)]}
            className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5"
          >
            <KpiTile
              label="Appels API vus du navigateur"
              libelleCase="Appels API"
              categorie="Navigateur · appels"
              source={SOURCE_APPELS}
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
              libelleCase="Suivis jusqu'au serveur"
              categorie="Navigateur → serveur"
              source={SOURCE_TRACES}
              valeur={part(c.correlated, c.total)}
              format="pct"
              raisonNull="aucun appel API sur la plage"
              couverture={{ n: c.total, unite: "appels" }}
              methode="Un appel sans jumeau serveur n'a pas pu être décomposé : middleware absent ou appel vers un tiers."
            />
            <KpiTile
              label="Durée p75 vue du navigateur"
              libelleCase="Durée p75 · navigateur"
              categorie="Navigateur · appels"
              source={SOURCE_APPELS}
              valeur={c.front_p75}
              format="ms"
              sensMeilleur="bas"
              {...(c.front_p75 != null
                ? { noteMip: { mesure: "API", valeur: c.front_p75, texte: `p75 ${formater("ms", c.front_p75)}` } }
                : {})}
              raisonNull="aucun appel API sur la plage"
              couverture={{ n: c.total, unite: "appels" }}
              href={lienEcran(sp, {}, "#hero-traces")}
              precedent={precedent(p?.front_p75)}
              reference={refTuile}
              couverturePrecedente={couvT(couvDurees, p?.total ?? null)}
            />
            <KpiTile
              label="Durée p75 côté serveur (appels suivis)"
              libelleCase="Durée p75 · serveur"
              categorie="Serveur · appels suivis"
              source={SOURCE_TRACES}
              valeur={c.back_p75}
              format="ms"
              sensMeilleur="bas"
              raisonNull="aucun appel suivi jusqu'au serveur sur la plage"
              couverture={{ n: c.correlated, unite: "appels suivis" }}
              // Dit sous le chiffre, pas seulement derrière « ? » : un p75 serveur au-dessus
              // du p75 navigateur semblait impossible (recette du 26/09/2026).
              lecture="autre population que la tuile navigateur : il peut la dépasser"
              methode="Porte sur les seuls appels suivis jusqu'au serveur : ce n'est pas la même population que la durée vue du navigateur, qui compte aussi les appels sans réponse serveur retrouvée (tiers, middleware absent)."
              precedent={precedent(p?.back_p75)}
              reference={refTuile}
              couverturePrecedente={couvT(couvDurees, p?.correlated ?? null)}
            />
            <KpiTile
              label="Appels en échec"
              categorie="Navigateur · appels"
              source={SOURCE_APPELS}
              valeur={part(c.err, c.total)}
              format="pct"
              sensMeilleur="bas"
              raisonNull="aucun appel API sur la plage"
              couverture={{ n: c.total, unite: "appels" }}
              methode="Échec : statut ≥ 400, ou 0 (coupure réseau, requête annulée)."
              href={lienEcran(sp, {}, "#appels")}
              precedent={prev ? (p ? part(p.err, p.total) : null) : undefined}
              reference={refTuile}
              couverturePrecedente={couvT(couvDurees, p?.total ?? null)}
            />
          </RangeeKpi>
        )}
        {/* Des requêtes serveur sans aucun appel navigateur (robots, sondes, scanners) :
            les tuiles comptent le NAVIGATEUR et affichent 0 — la recette UTI du 28/09/2026
            y a lu « rien reçu » un jour de 59 800 requêtes serveur. Le compte est déjà lu
            (`back_total`) : il est dit, avec le chemin vers « Routes serveur ». */}
        {c && c.total === 0 && c.back_total > 0 && (
          <p role="note" data-testid="serveur-sans-navigateur" className="mt-2 text-xs text-ink-soft">
            Aucun appel vu du navigateur sur {plage}, mais {formater("count", c.back_total)}{" "}
            {c.back_total > 1 ? "requêtes serveur tracées" : "requête serveur tracée"} sans visite (robots, sondes, appels
            entre services) : elles se lisent dans{" "}
            <a href="#routes-serveur" className="text-perf underline-offset-2 hover:underline">
              Routes serveur
            </a>
            .
          </p>
        )}
      </section>

      {/* 3 — Hero : classement (3/5) et série (2/5), côte à côte à partir de 1280 px. */}
      <div className="mb-4 grid grid-cols-1 gap-2 xl:grid-cols-5">
        {/* Les deux figures prennent la hauteur de la rangée : bords bas alignés. */}
        <div className="min-w-0 xl:col-span-3 xl:[&>section]:h-full">
          <SectionErreur titre="Appels API les plus lents">
            <Figure
              titre="Appels API les plus lents, et la part médiane du serveur"
              id="hero-traces"
              aide="tracing"
              etat={
                !appels.ok
                  ? { kind: "erreur", titre: "Appels API les plus lents" }
                  : hero.lignes.length === 0
                    ? { kind: "vide", population: "appel API instrumenté", masculin: true, plage }
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
                    {/* Règle écrite à côté des valeurs colorées (amendement de R-S, 29/09/2026). */}
                    <span data-regle-mip="API" className="[overflow-wrap:anywhere]">{REGLE_HERO}</span>
                    {hero.exclues > 0 && (
                      <span>
                        {hero.exclues} appel{hero.exclues > 1 ? "s" : ""} sans durée, non classé{hero.exclues > 1 ? "s" : ""}
                      </span>
                    )}
                  </>
                ) : undefined
              }
              lecture="Barre = durée p75 vue du navigateur, colorée par la règle MIP des appels API (un ordre de grandeur de terrain, pas un seuil publié ; ● bon, ▲ à améliorer, ■ mauvais). Part serveur = médiane, appel par appel, de la durée serveur rapportée à la durée navigateur, sur les appels suivis."
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

        <div className="min-w-0 xl:col-span-2 xl:[&>section]:h-full">
          <SectionErreur titre="Latence des appels dans le temps">
            <Figure
              titre="Latence des appels dans le temps"
              id="latence-appels"
              etat={
                !serie.ok
                  ? { kind: "erreur", titre: "Latence des appels dans le temps" }
                  : appelsLus === 0
                    ? { kind: "vide", population: "appel API instrumenté", masculin: true, plage }
                    : undefined
              }
              explorer={planSerie.ok ? explorerHref(query, planSerie.value) : undefined}
              meta={
                serie.ok ? (
                  <>
                    <span>{plage}</span>
                    <span>par tranche de {ecran.bucketLabel}</span>
                    <span>{formater("count", appelsLus)} appels</span>
                    {prev && !precParRang && <span>période précédente non lue</span>}
                  </>
                ) : undefined
              }
              lecture="Aucune bande : aucun seuil n'est publié pour une durée d'API. Les deux séries ne s'additionnent pas : le serveur ne porte que sur les appels suivis."
              alternative={
                serie.ok && appelsLus > 0
                  ? {
                      legende: "p75 navigateur et p75 serveur (appels suivis) par tranche de temps",
                      colonnes: ["Période", "Navigateur · p75", "Serveur · p75", "Appels", ...(precParRang ? ["Période précédente"] : [])],
                      lignes: serie.data.map((s, i) => [
                        libelleSeauComplet(grille[i] ?? s.t, query.range.bucketSeconds, FUSEAU_AFFICHAGE),
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
                  annotations={annotationsT7}
                  annotationsIndisponibles={annotationsAbsentesT7}
                  seauSecondes={query.range.bucketSeconds}
                  fuseau={FUSEAU_AFFICHAGE}
                  zoomHref={zoom}
                  fenetresCollecte={fenetresLues(ecran.fenetresCollecte)}
                  ariaLabel={`Latence p75 des appels API par tranche de ${ecran.bucketLabel}, navigateur et serveur, ${plage}`}
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
            {!appel && <span>{TRACES_PAR_APPEL} traces au plus par appel</span>}
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
          // Sous 640 px, une carte par trace (SlowRow) : à 390 px, les durées étaient
          // hors champ. Au-delà, le défilement reste signalé.
          <TableDefilante label="Traces les plus lentes">
            <table className="block w-full text-sm sm:table" data-testid="traces-lentes">
              <thead className="hidden bg-panel2 sm:table-header-group">
                <tr>
                  <th scope="col" className="th sticky left-0 z-10 whitespace-nowrap bg-panel2">Heure</th>
                  <th scope="col" className="th">Appel</th>
                  <th scope="col" className="th text-right">Statut</th>
                  <th scope="col" className="th">
                    Serveur <span aria-hidden className="inline-block h-2 w-2 rounded-sm bg-ink-soft align-middle" /> puis trajet{" "}
                    <span aria-hidden className="inline-block h-2 w-2 rounded-sm bg-ink-faint/50 align-middle" />
                  </th>
                  <th scope="col" className="th text-right">Navigateur</th>
                  <th scope="col" className="th text-right">Serveur</th>
                  <th scope="col" className="th text-right">Trajet</th>
                  <th scope="col" className="th">Session</th>
                </tr>
              </thead>
              <tbody className="block sm:table-row-group">
                {tracesParAppel(lentes.data, appel ? Infinity : TRACES_PAR_APPEL).map((l) =>
                  l.kind === "trace" ? (
                    <SlowRow key={l.trace.span_id} t={l.trace} query={query} maxMs={maxLentes} />
                  ) : (
                    <tr
                      key={`reste-${l.appel.method} ${l.appel.url}`}
                      className="block border-t border-line/60 sm:table-row"
                      data-testid="traces-repliees"
                    >
                      <td colSpan={8} className="block px-3 py-1.5 text-xs text-ink-soft sm:table-cell">
                        {/* Le reste est compté sur TOUTE la plage (`traces_appel`, lu en SQL), plus
                            seulement parmi les 20 lues. */}
                        {l.n === 1 ? "Une autre trace" : `${formater("count", l.n)} autres traces`} de{" "}
                        <span className="font-mono">{libelleAppel(l.appel)}</span> sur la période :{" "}
                        <Link href={hrefTraces(l.appel)} className="font-medium text-perf underline-offset-2 hover:underline">
                          voir ses traces les plus lentes
                        </Link>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </TableDefilante>
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
            {/* `backRoutes` ne demande pas de session (jointure externe) : robots, sondes et
                scanners y sont, et la phrase le dit au lieu de promettre une visite. */}
            <span>tout trafic serveur reçu, avec ou sans visite navigateur (robots et sondes compris)</span>
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
          <TableDefilante label="Routes serveur">
            <table className="w-full text-sm" data-testid="back-routes">
              <thead className="bg-panel2">
                <tr>
                  <th scope="col" className="th sticky left-0 z-10 bg-panel2">Route serveur</th>
                  <th scope="col" className="th text-right">Appels</th>
                  <th scope="col" className="th text-right">p75</th>
                  <th scope="col" className="th text-right">p95</th>
                  <th scope="col" className="th text-right">Erreurs 5xx</th>
                  <th scope="col" className="th text-right">Taux 5xx</th>
                </tr>
              </thead>
              <tbody>
                {routes.data.map((r) => (
                  <tr key={r.route} className="border-t border-line/60">
                    <th scope="row" className="sticky left-0 z-10 max-w-[16rem] bg-panel px-3 py-1.5 text-left font-mono text-xs font-normal">
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
                    <td className="px-3 py-1.5 text-right tabular-nums">{formater("count", r.n)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formater("ms", r.p75)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formater("ms", r.p95)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formater("count", r.err)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formater("pct", r.n > 0 ? r.err / r.n : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableDefilante>
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
