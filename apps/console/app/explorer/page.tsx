// Explorer générique (P6.4) — rendu 100 % serveur.
//
// BOUTON EXPLICITE. Le builder est un `<form method="get">` : rien ne part tant
// que « Exécuter » n'est pas pressé. Aucune requête par frappe, et l'URL obtenue
// est partageable telle quelle. Le curseur n'est pas un champ du formulaire :
// toute modification le laisse donc derrière elle, et la pagination repart du
// début — jamais une page prélevée dans une population qui a changé.
//
// CHANGER DE JEU DE DONNÉES EST UN LIEN, pas une liste du formulaire : les
// mesures d'un jeu n'existent pas dans un autre, et un formulaire les aurait
// envoyées ensemble. Le lien repart du jeu choisi, filtres globaux conservés, et
// l'écran redemande « Exécuter » plutôt que de mesurer autre chose.
//
// F31 — LA REQUÊTE SE LIT AVANT LE RÉSULTAT (§ 5.21.3). De haut en bas : jeux de
// données ; requête appliquée en pastilles retirables (`QueryPills`) ; le
// formulaire, replié sous « Modifier la requête » dès qu'un résultat l'occupe ;
// la représentation en onglets-liens (elle n'est plus un champ du formulaire :
// en changer relit la même requête sous une autre forme, sans la recomposer) ;
// puis le résultat — ou, avant toute exécution, six analyses de départ qui ne
// lisent rien tant qu'on ne les ouvre pas (`ModelesDepart`, W-E1).
//
// F32 — LE RÉSULTAT DANS SA FIGURE (§ 5.21.3 zones 6-7, W-E3 à W-E6, W-E8, W-E9). Une
// seule traduction (`ResultatAnalyse`) choisit la forme selon l'additivité et le
// verdict selon R-V ; l'`<aside>` « Total observé », qui répétait le total, est fondu
// dans la tuile et dans la méta de la figure. `cmp=prev` relit la même analyse sur la
// période précédente pour une valeur ou une série sans groupe ; une série porte les
// déploiements de la fenêtre. L'onglet « Distribution » est visible, désactivé avec
// sa raison (B5).
//
// F33 — LE CONTEXTE DU RÉSULTAT (§ 5.21.3 zone 8, W-E2 et W-E7). Sous le résultat,
// deux lectures de plus disent sur QUOI il porte : le volume de la population seau
// par seau, et sa répartition selon la dimension de `split`. Elles comptent la MÊME
// population que la figure principale (`planDeVolume`, `planDeRepartition`) — ce
// n'est pas `dimensionValues`, qui compte autre chose (CE12). Trois règles :
//   - elles partent EN MÊME TEMPS que le résultat : un contexte ne le retarde pas ;
//   - leur budget est plus court (`BUDGET_CONTEXTE_MS`) : si la base est prise, le
//     contexte renonce le premier et le résultat garde le sien ;
//   - leur échec est LOCAL (`SectionErreur`, bandeau « Partiel ») : le résultat reste
//     affiché, et aucune barre à zéro ne remplace ce qui n'a pas été lu.
import Link from "next/link";
import type { ReactNode } from "react";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { ModelesDepart } from "@/components/explorer/ModelesDepart";
import { QueryPills } from "@/components/explorer/QueryPills";
import { ResultatAnalyse, type HrefsResultat, type PrecedentResultat } from "@/components/explorer/ResultatAnalyse";
// F33 — contexte du résultat (W-E2, W-E7).
import { RepartitionResultat, VolumeResultat, type OngletRepartition } from "@/components/explorer/ContexteResultat";
import { SectionErreur } from "@/components/states/SectionErreur";
import { BREAKDOWN_LABELS, BREAKDOWN_NOTICES, BREAKDOWN_PARAM, type BreakdownDimension } from "@/lib/breakdowns";
import { EtatSurface } from "@/components/states/EtatSurface";
import { INPUT_CLASS } from "@/components/forms/Field";
import { CopyBlock } from "@/components/CopyBlock";
import { TabLink } from "@/components/sessions/TabLink";
import { type SearchParams } from "@/lib/filters";
import { chargerExplorer, demandeExplorer } from "@/lib/chargeurs/explorer";
import { chargerEcran } from "@/lib/ecran-local";
import {
  conditionsOf,
  hrefWithQuery,
  queryToSearchParams,
  DIMENSION_LABELS,
  DIMENSIONS,
  type AnalyticsQuery,
} from "@/lib/query-contract";
import { dimensionSupport } from "@/lib/query-compiler";
import {
  EXPLORER_DATASET_IDS,
  VISUALIZATIONS,
  datasetDefinition,
  type ExplorerPlan,
  type Visualization,
} from "@/lib/analytics-schema";
import {
  EXPLORER_PARAMS,
  LIBELLES_REPRESENTATION,
  LIMITES,
  explorerDatasetHref,
  explorerHref,
  explorerOngletHref,
  explorerPlanParams,
  explorerResetHref,
  explorerResume,
  groupeHref,
  limitePour,
  mesureDefaut,
  mesuresDe,
  pastillesRequete,
  representationDemandee,
} from "@/lib/explorer-page-params";
// F33 — plans dérivés du contexte et filtre d'une valeur de la répartition.
import { LIMITE_REPARTITION, filtresDuGroupe, mesureDeVolume } from "@/lib/explorer-page-params";
import { modelesDeDepart } from "@/lib/explorer-modeles";
import { type ExplorerResult } from "@/lib/queries-explorer";
import { widgetConfigJson, widgetFromPlan } from "@/lib/dashboards";
import { type DashboardRow } from "@/lib/queries-dashboards";
import { SAVED_VIEW_NAME_MAX } from "@/lib/saved-views";
import { annotationsDeploiements } from "@/lib/annotations";
import type { Annotation } from "@/lib/series";
import { VIEW_CONTEXT_PARAMS, contextHref, gabaritZoom, lireComparaison, lireTri } from "@/lib/view-state";
// F33 — un `split` que le jeu ne porte pas est ignoré ET dit (§ 3.1).
import { ligneIgnoree } from "@/lib/view-state";
import { saveAnalysisAction } from "@/app/dashboards/actions";
import { saveViewAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Libellés courts des onglets de représentation (§ 5.21.3, zone 5) : ils tiennent
 * sur une ligne à 390 px. Le libellé long (`VISUALIZATION_LABELS`) reste celui du
 * résumé et du titre du résultat. Les mêmes mots résument une vue enregistrée (F34).
 */
const ONGLETS: Record<Visualization, string> = LIBELLES_REPRESENTATION;

/**
 * W-E9 — la représentation « Distribution » n'est pas exposée par l'Explorer : elle
 * manque au registre (`VISUALIZATIONS`, backend B5). L'onglet est MONTRÉ désactivé
 * avec sa raison, plutôt que caché : l'absence est une information.
 */
const RAISON_DISTRIBUTION =
  "représentation non disponible : la lecture en distribution n'est pas encore exposée par l'Explorer (B5)";

/** `tri` de l'écran (P3) : gravité par défaut, volume sur demande. */
function lienTri(query: AnalyticsQuery, plan: ExplorerPlan, vue: Record<string, string | null>): HrefsResultat["tri"] {
  return {
    gravite: explorerHref(query, plan, { ...vue, tri: null }),
    volume: explorerHref(query, plan, { ...vue, tri: "volume" }),
    impact: null,
    fourni: null,
  };
}

/**
 * W-E7 — les onglets de dimension : un lien par dimension que le jeu porte, la
 * raison écrite pour les autres. Un onglet garde TOUTE la requête (population,
 * mesure, représentation) et ne change que `split` : c'est un geste de lecture.
 */
function ongletsRepartition(
  query: AnalyticsQuery,
  plan: ExplorerPlan,
  dimensions: { dimension: BreakdownDimension; label: string; disponible: boolean; raison: string | null }[],
  courante: BreakdownDimension | null,
  vue: Record<string, string | null>,
): OngletRepartition[] {
  return dimensions.map((d) => ({
    dimension: d.dimension,
    label: d.label,
    courant: d.dimension === courante,
    href: d.disponible ? explorerHref(query, plan, { ...vue, [BREAKDOWN_PARAM]: d.dimension }) : null,
    raison: d.raison,
  }));
}

/**
 * Gabarit du zoom sur un seau (§ 3.3) : même analyse, exécutée, sur les bornes UTC
 * du seau ; `period` retiré, réglages de vue conservés (`gabaritZoom`).
 */
function gabaritZoomExplorer(query: AnalyticsQuery, plan: ExplorerPlan, sp: SearchParams): string {
  return gabaritZoom(
    hrefWithQuery("/explorer", query, { ...explorerPlanParams(plan), cursor: null, period: null, from: "{from}", to: "{to}" }),
    sp,
  );
}

export default async function ExplorerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/explorer.ts`) lit le schéma, les droits d'écriture,
  // le résultat et ses contextes ; la page relit l'URL par la même fonction que lui
  // (`demandeExplorer`), sur le même schéma.
  const d = await chargerEcran(chargerExplorer, sp);
  if (d.etat === "refus") return <FilterProblemNotice title="Explorer" problem={d.problem} />;
  const ecran = d;
  const schema = new Set(d.schema);
  const { reader, dataset, definition, plan, demande, dimensionsRepartition, splitDemande, splitConnu, dimensionRepartition } =
    demandeExplorer(ecran.query, sp, schema);
  const { cibles, peutEnregistrerVue, resultat, echec, planVolume, planRepartition, contexteVolume, contexteRepartition } = d;

  // Une mesure sans découpage temporel honnête (sessions actives) refuse la série :
  // l'onglet ne mène pas à un refus, il se dit indisponible avec sa raison.
  const [champId = ""] = (reader.get("measure")?.trim() || mesureDefaut(dataset)).split(":");
  const champMesure = Object.hasOwn(definition.fields, champId) ? definition.fields[champId] : undefined;
  const serieIndisponible =
    champMesure?.bucketable === false ? `« ${champMesure.label} » n'a pas de découpage temporel honnête` : null;

  // Dimensions du jeu choisi : une dimension sans objet ou non collectée est
  // proposée désactivée AVEC sa raison, jamais silencieusement absente.
  const dimensions = DIMENSIONS.map((dimension) => {
    const support = dimensionSupport(definition.dataset, dimension, schema);
    return {
      id: dimension,
      label: DIMENSION_LABELS[dimension],
      disponible: support.supported,
      raison: support.supported ? null : support.message,
    };
  });

  // Un `split` demandé mais non appliqué ne disparaît pas en silence (V10) : il est
  // ignoré ET dit, comme tout réglage d'affichage illisible.
  const splitIgnore =
    splitDemande !== null && splitDemande !== dimensionRepartition
      ? ligneIgnoree(
          BREAKDOWN_PARAM,
          splitDemande,
          splitConnu === null
            ? "dimension de découpage inconnue"
            : (dimensionsRepartition.find((x) => x.dimension === splitConnu)?.raison ??
              "dimension non portée par ce jeu de données"),
        )
      : null;

  const mesures = mesuresDe(dataset);
  const mesureCourante = plan.ok ? `${plan.value.measure.field}:${plan.value.measure.aggregation}` : mesureDefaut(dataset);
  // Une requête refusée garde la représentation qu'elle demandait : la corriger
  // ne doit pas en changer la forme en silence.
  const vizCourante = plan.ok ? plan.value.visualization : representationDemandee(reader);
  // La liste des limites dépend de la représentation ACTUELLE : la valeur retenue
  // doit donc y figurer, sinon le contrôle afficherait autre chose que la requête.
  const limiteCourante = limitePour(vizCourante, plan.ok ? plan.value.limit : null);

  // Paramètres de vue qui suivent la navigation (§ 3.1, `cmp`…) : ils ne changent
  // pas la population, mais un onglet ou une pastille ne doit pas les perdre. `split`
  // (F33) en fait partie : changer de représentation ou retirer une condition ne doit
  // pas ramener la répartition à la dimension par défaut.
  const vue: Record<string, string | null> = {
    ...Object.fromEntries(VIEW_CONTEXT_PARAMS.map((nom) => [nom, reader.get(nom)])),
    [BREAKDOWN_PARAM]: splitDemande,
  };

  // Réglages d'affichage (§ 3.1) : comparaison (défaut « aucune » hors Performance)
  // et ordre du classement. Une valeur illisible est ignorée ET dite.
  const comparaison = lireComparaison("/explorer", reader);
  const triLu = lireTri("/explorer", reader);
  const tri = triLu.tri === "volume" ? "volume" : "gravite";
  const reglagesIgnores = [
    ...comparaison.ignores,
    ...(triLu.ignore ? [triLu.ignore] : []),
    ...(splitIgnore ? [splitIgnore] : []),
  ];

  // cmp=prev (W-E3, W-E5) et déploiements d'une série (P9) : lus par le chargeur.
  const precedent = d.precedent;
  let annotations: { annotations: Annotation[]; indisponible: string | null } | null = null;
  if (resultat && plan.ok && d.deploys) {
    const p = plan.value;
    annotations = d.deploys.ok
      ? annotationsDeploiements(d.deploys.data, ecran.query.range, {
          lien: (relB, relA) => explorerHref(ecran.query, p, { ...vue, cmp: "release", rel_b: relB, rel_a: relA }),
        })
      : { annotations: [], indisponible: "déploiements non affichés : leur lecture a échoué" };
  }
  // Le formulaire se replie quand un résultat occupe l'écran ; sans résultat
  // (rien d'exécuté, requête refusée, lecture en échec), il est le seul geste utile.
  const formulaireOuvert = resultat === null;
  // Onglets, pastilles et modèles naviguent CÔTÉ CLIENT : sans clé, React garderait
  // le formulaire monté, et ses listes (`defaultValue`, lu au montage seulement)
  // afficheraient l'ANCIENNE requête — une pastille « Groupé par route » retirée
  // reviendrait au prochain « Exécuter ». La clé change avec l'URL : le formulaire
  // est remonté, et montre toujours la requête de l'adresse.
  const cleFormulaire = [
    queryToSearchParams(ecran.query).toString(),
    ...EXPLORER_PARAMS.map((nom) => reader.get(nom) ?? ""),
    ...VIEW_CONTEXT_PARAMS.map((nom) => reader.get(nom) ?? ""),
    splitDemande ?? "",
  ].join("|");

  // Zone 8 (W-E2, W-E7) : le contexte du résultat, en deux colonnes à partir de
  // 1024 px (volume 1/3, répartition 2/3) et l'une sous l'autre en dessous. Chaque
  // figure est derrière sa propre frontière : une panne de contexte ne coûte que le
  // contexte. (Aucun `<Suspense>` : une frontière au-dessus d'un écran suspend la
  // navigation par query — écart F02 validé, documenté dans `SectionErreur`.)
  const contexteResultat =
    plan.ok && resultat && (planVolume || planRepartition) ? (
      <div className="mb-6 grid min-w-0 gap-4 lg:grid-cols-3" data-testid="explorer-contexte">
        {planVolume && contexteVolume && (
          <div className="min-w-0">
            <SectionErreur titre="Volume du résultat">
              <VolumeResultat
                plan={planVolume}
                unite={mesureDeVolume(plan.value.dataset)?.unite ?? "lignes"}
                lecture={contexteVolume}
                zoomHref={gabaritZoomExplorer(ecran.query, plan.value, sp)}
              />
            </SectionErreur>
          </div>
        )}
        {planRepartition && contexteRepartition && dimensionRepartition && (
          <div className={`min-w-0 ${planVolume ? "lg:col-span-2" : "lg:col-span-3"}`}>
            <SectionErreur titre={`Répartition par ${BREAKDOWN_LABELS[dimensionRepartition].toLowerCase()}`}>
              <RepartitionResultat
                plan={planRepartition}
                dimensionLabel={BREAKDOWN_LABELS[dimensionRepartition]}
                unite={mesureDeVolume(plan.value.dataset)?.unite ?? "lignes"}
                notice={BREAKDOWN_NOTICES[dimensionRepartition]}
                onglets={ongletsRepartition(ecran.query, plan.value, dimensionsRepartition, dimensionRepartition, vue)}
                lecture={contexteRepartition}
                lienValeur={(valeur) =>
                  explorerHref(
                    {
                      ...ecran.query,
                      filters: filtresDuGroupe(ecran.query.filters, [dimensionRepartition], [valeur]),
                    },
                    plan.value,
                    { ...vue, [BREAKDOWN_PARAM]: dimensionRepartition },
                  )
                }
                limite={LIMITE_REPARTITION}
              />
            </SectionErreur>
          </div>
        )}
      </div>
    ) : null;

  return (
    <div data-testid="explorer-racine" className="animate-fade-up">
      <PageHeader
        title="Explorer"
        sub={`Composer une mesure bornée sur ${ecran.label}, puis l’exécuter. Aucune requête n’est lancée avant.`}
      />

      <nav aria-label="Jeu de données" className="mb-4 flex flex-wrap gap-2">
        {EXPLORER_DATASET_IDS.map((id) => {
          const actif = id === dataset;
          return (
            <Link
              key={id}
              href={explorerDatasetHref(ecran.query, id)}
              aria-current={actif ? "page" : undefined}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
                actif ? "border-perf bg-perf/10 text-perf" : "border-line text-ink-soft hover:border-perf/50 hover:text-ink"
              }`}
            >
              {datasetDefinition(id).label}
            </Link>
          );
        })}
      </nav>

      {/* Zone 3 : ce qui a été APPLIQUÉ. Sans exécution, rien ne l'a été. */}
      {demande && plan.ok && (
        <QueryPills
          pastilles={pastillesRequete(ecran.query, plan.value, vue)}
          resume={explorerResume(ecran.query, plan.value, ecran.label)}
        />
      )}

      <details key={cleFormulaire} open={formulaireOuvert} data-testid="explorer-composer" className="card mb-4">
        <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
          Modifier la requête
        </summary>
        <form
          method="get"
          aria-label="Constructeur de requête"
          className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {/* Le contexte global suit la requête : app, plage, appareil, dimensions, segment. */}
          {[...queryToSearchParams(ecran.query)].map(([nom, valeur]) => (
            <input key={nom} type="hidden" name={nom} value={valeur} />
          ))}
          {Object.entries(vue).map(([nom, valeur]) =>
            valeur === null ? null : <input key={nom} type="hidden" name={nom} value={valeur} />,
          )}
          <input type="hidden" name="dataset" value={dataset} />
          {/* La représentation se choisit par les onglets (zone 5) : le formulaire
              la transporte telle quelle, pour que « Exécuter » ne la change pas. */}
          <input type="hidden" name="viz" value={vizCourante} />

          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft lg:col-span-2">
            Mesure
            <select name="measure" defaultValue={mesureCourante} className={`${INPUT_CLASS} w-full`}>
              {mesures.map((mesure) => (
                <option key={mesure.valeur} value={mesure.valeur}>
                  {mesure.libelle}
                </option>
              ))}
            </select>
          </label>

          {mesures.some((mesure) => mesure.property) && (
            <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
              Propriété numérique
              <input
                name="prop"
                defaultValue={plan.ok ? (plan.value.measure.property ?? "") : ""}
                placeholder="amount"
                className={`${INPUT_CLASS} w-full`}
              />
            </label>
          )}

          {definition.variant && (
            <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
              {definition.variant.label}
              <select
                name="variant"
                defaultValue={plan.ok ? (plan.value.variant ?? "") : ""}
                className={`${INPUT_CLASS} w-full`}
              >
                {!definition.variant.required && <option value="">Toutes</option>}
                {definition.variant.values.map((valeur) => (
                  <option key={valeur} value={valeur}>
                    {valeur}
                  </option>
                ))}
              </select>
            </label>
          )}

          {([0, 1] as const).map((rang) => (
            <label key={rang} className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
              {rang === 0 ? "Grouper par" : "Puis par"}
              <select
                name={`g${rang}`}
                defaultValue={plan.ok ? (plan.value.groupBy[rang] ?? "") : ""}
                className={`${INPUT_CLASS} w-full`}
              >
                <option value="">Aucun regroupement</option>
                {dimensions.map((dimension) => (
                  <option key={dimension.id} value={dimension.id} disabled={!dimension.disponible} title={dimension.raison ?? undefined}>
                    {dimension.label}
                    {dimension.disponible ? "" : " — indisponible"}
                  </option>
                ))}
              </select>
            </label>
          ))}

          {vizCourante !== "value" && (
            <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
              Nombre maximum
              <select name="limit" defaultValue={String(limiteCourante)} className={`${INPUT_CLASS} w-full`}>
                {LIMITES[vizCourante].map((valeur) => (
                  <option key={valeur} value={valeur}>
                    {valeur}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button className="btn-accent" type="submit" name="run" value="1">
              Exécuter
            </button>
            <Link href={explorerResetHref(ecran.query)} className="btn-ghost">
              Réinitialiser
            </Link>
          </div>
        </form>
      </details>

      {/* Zone 5 : la forme du résultat. Un onglet relit la MÊME requête (population,
          mesure, regroupements) sous une autre forme ; il ne la recompose pas.
          À 390 px, la rangée défile plutôt que de pousser la page. */}
      {/* `relative` : les raisons `sr-only` des onglets désactivés sont en `position:
          absolute` ; sans ancêtre positionné, elles se plaçaient par rapport à la PAGE
          et l'élargissaient à 390 px (piège 16 du brief). */}
      <nav
        aria-label="Représentation"
        data-testid="explorer-representation"
        className="relative mb-6 flex overflow-x-auto border-b border-line"
      >
        {VISUALIZATIONS.map((viz) =>
          viz === "timeseries" && serieIndisponible && viz !== vizCourante ? (
            <span
              key={viz}
              aria-disabled="true"
              title={serieIndisponible}
              data-testid="onglet-indisponible"
              className="-mb-px shrink-0 cursor-not-allowed whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm font-medium text-ink-faint opacity-60"
            >
              {ONGLETS[viz]}
              <span className="sr-only"> — indisponible : {serieIndisponible}</span>
            </span>
          ) : (
            <TabLink key={viz} href={explorerOngletHref(ecran.query, reader, viz, vue)} active={viz === vizCourante}>
              {ONGLETS[viz]}
            </TabLink>
          ),
        )}
        {/* W-E9 : visible, désactivé, avec sa raison — lue au clavier (sr-only) et écrite sous la rangée. */}
        <span
          aria-disabled="true"
          title={RAISON_DISTRIBUTION}
          data-testid="onglet-distribution"
          className="-mb-px shrink-0 cursor-not-allowed whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm font-medium text-ink-faint opacity-60"
        >
          Distribution
          <span className="sr-only"> — indisponible : {RAISON_DISTRIBUTION}</span>
        </span>
      </nav>
      <p data-testid="distribution-indisponible" className="-mt-4 mb-6 text-xs text-ink-soft">
        Distribution : {RAISON_DISTRIBUTION}.
        {dataset === "vitals" && plan.ok && plan.value.variant !== null && (
          <>
            {" "}
            <Link
              href={hrefWithQuery("/pages", ecran.query, { ...vue, vital: plan.value.variant })}
              className="font-medium text-brand hover:underline"
            >
              Voir la distribution de {plan.value.variant} sur Pages
            </Link>
          </>
        )}
      </p>

      {/* Zone 6 : constats de lecture — ce qui borne ce que la figure peut affirmer. */}
      {reglagesIgnores.map((ligne) => (
        <p key={ligne} role="note" className="mb-4 text-xs text-ink-soft">
          {ligne}
        </p>
      ))}
      {resultat && comparaison.valeur.mode === "release" && (
        <p role="note" data-testid="explorer-cmp-release" className="mb-4 text-xs text-ink-soft">
          Comparaison release contre release : l’Explorer ne la calcule pas. Ajouter une condition de release à la
          requête, ou{" "}
          <Link href={contextHref("/", reader)} className="font-medium text-brand hover:underline">
            ouvrir la Vue d’ensemble sur cette comparaison
          </Link>
          .
        </p>
      )}
      {resultat && resultat.meta.coverage.status !== "complete" && (
        <div className="mb-4">
          <EtatSurface etat={{ kind: "partiel", raison: resultat.meta.coverage.reason ?? "couverture de la fenêtre non lue" }} />
        </div>
      )}
      {resultat && resultat.meta.truncated_groups && (
        <div className="mb-4" data-testid="explorer-tronque">
          <EtatSurface
            etat={{
              kind: "partiel",
              raison: `d’autres combinaisons existent au-delà des ${plan.ok ? plan.value.limit : ""} affichées. Le total, lui, porte sur toute la population.`,
            }}
          />
        </div>
      )}
      {resultat?.meta.warnings.map((avertissement) => (
        <p key={avertissement} role="note" className="mb-4 rounded-lg border border-line bg-panel2/60 px-4 py-3 text-sm text-ink-soft">
          {avertissement}
        </p>
      ))}

      {!plan.ok && (
        <div role="alert" data-testid="explorer-invalide" className="card mb-6 border-bad/30 p-6 text-sm">
          <p className="font-semibold text-bad-ink">Requête refusée</p>
          <p className="mt-1 text-ink-soft">{plan.error.message}</p>
          <p className="mt-2 text-xs text-ink-faint">Code : {plan.error.code}</p>
        </div>
      )}

      {/* Zone 10 : sans exécution, des analyses de départ plutôt qu'un écran vide.
          Des liens seulement — aucune ne lit quoi que ce soit avant d'être ouverte. */}
      {!demande && (
        <section aria-labelledby="modeles-depart-titre" data-testid="explorer-invite">
          <h2 id="modeles-depart-titre" className="text-sm font-semibold text-ink">
            Analyses de départ
          </h2>
          <p className="mb-3 mt-1 text-xs text-ink-soft">
            Rien n’a encore été lu. Composer la requête ci-dessus puis choisir « Exécuter », ou ouvrir l’une de ces
            analyses : elle s’exécute sur les filtres actuels ({ecran.label}).
          </p>
          <ModelesDepart modeles={modelesDeDepart(ecran.query, schema, vue)} />
        </section>
      )}

      {echec && (
        <div role="alert" data-testid="explorer-echec" className="card mb-6 border-bad/30 p-6 text-sm">
          <p className="font-semibold text-bad-ink">{echec.titre}</p>
          <p className="mt-1 text-ink-soft">{echec.message}</p>
        </div>
      )}

      {plan.ok && resultat && (
        <Resultat
          plan={plan.value}
          resultat={resultat}
          precedent={precedent}
          annotations={annotations}
          tri={tri}
          hrefs={{
            groupe: (key) => groupeHref(ecran.query, plan.value, key, vue),
            zoom: gabaritZoomExplorer(ecran.query, plan.value, sp),
            // Le panneau session (§ 3.3) n'existe pas encore (F43) : la ligne ouvre la
            // page de la session, destination de « Ouvrir en page ».
            session: (id) => hrefWithQuery(`/sessions/${encodeURIComponent(id)}`, ecran.query),
            tri: lienTri(ecran.query, plan.value, vue),
            suivant: resultat.data.next_cursor
              ? explorerHref(ecran.query, plan.value, { ...vue, cursor: resultat.data.next_cursor })
              : null,
          }}
          cibles={cibles}
          peutEnregistrerVue={peutEnregistrerVue}
          contexte={queryToSearchParams(ecran.query).toString()}
          appDemandee={ecran.query.scope.requestedApp}
          query={ecran.query}
          contexteResultat={contexteResultat}
        />
      )}
    </div>
  );
}

function Resultat({
  plan,
  resultat,
  precedent,
  annotations,
  tri,
  hrefs,
  cibles,
  peutEnregistrerVue,
  contexte,
  appDemandee,
  query,
  contexteResultat,
}: {
  plan: ExplorerPlan;
  resultat: ExplorerResult;
  /** `undefined` : pas de comparaison ; `null` : demandée, non calculée pour cette forme. */
  precedent: PrecedentResultat | null | undefined;
  /** Déploiements de la fenêtre (série seulement), ou la raison de leur absence. */
  annotations: { annotations: Annotation[]; indisponible: string | null } | null;
  tri: "gravite" | "volume";
  hrefs: HrefsResultat;
  /** Tableaux de bord sur lesquels la session peut réellement ajouter une carte. */
  /** Tableaux de bord où l'utilisateur peut ajouter un widget : ce que le formulaire en montre. */
  cibles: Pick<DashboardRow, "id" | "name" | "app_id" | "revision">[];
  peutEnregistrerVue: boolean;
  contexte: string;
  appDemandee: string | null;
  query: AnalyticsQuery;
  /** Zone 8 : volume et répartition (W-E2, W-E7), déjà lus par la page. */
  contexteResultat: ReactNode;
}) {
  const { meta, data } = resultat;
  const definition = datasetDefinition(plan.dataset);
  // La carte fige le QUOI et les filtres composés ici ; elle n'emporte ni l'app ni
  // la fenêtre, qui appartiennent au tableau de bord qui l'affichera.
  const carte = widgetFromPlan(plan, {
    conditions: conditionsOf(query.filters),
    includeBots: query.filters.includeBots,
    includeInternal: query.filters.includeInternal,
  });

  return (
    <>
      {/* Zone 7 : le hero « Résultat », une figure pleine largeur (W-E3 à W-E6, W-E8). */}
      <ResultatAnalyse
        plan={plan}
        meta={meta}
        data={data}
        precedent={precedent}
        hrefs={hrefs}
        annotations={annotations?.annotations}
        annotationsIndisponibles={annotations?.indisponible ?? undefined}
        taille="page"
        tri={tri}
      />

      {/* Zone 8 : sur quoi ce résultat porte — volume de la population et répartition. */}
      {contexteResultat}

      <section className="card mt-6 p-4">
        <h2 className="text-sm font-semibold text-ink">Enregistrer cette analyse</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Ce qui est enregistré est la requête canonique — l’AST seul, sans aucune donnée de résultat. Elle sera
          rejouée avec les droits de son lecteur, sur la fenêtre de l’écran qui l’affiche.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* ----- Carte de tableau de bord ----- */}
          <div className="min-w-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Comme carte d’un tableau de bord
            </h3>
            {cibles.length ? (
              <form action={saveAnalysisAction} className="mt-2 flex flex-col gap-2" data-testid="save-widget">
                <input type="hidden" name="ctx" value={contexte} />
                <input type="hidden" name="widget" value={JSON.stringify(widgetConfigJson(carte))} />
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                  Tableau de bord
                  <select name="id" className={`${INPUT_CLASS} w-full`}>
                    {cibles.map((cible) => (
                      <option key={cible.id} value={cible.id}>
                        {cible.name} — {cible.app_id ?? "toutes apps"}
                      </option>
                    ))}
                  </select>
                </label>
                {/* La révision de CHAQUE cible voyage avec elle : enregistrer sur un
                    tableau modifié entre-temps est refusé, jamais écrasé. */}
                {cibles.map((cible) => (
                  <input key={cible.id} type="hidden" name={`revision_${cible.id}`} value={cible.revision} />
                ))}
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                  Titre de la carte
                  <input
                    name="title"
                    maxLength={60}
                    placeholder={carte.title}
                    className={`${INPUT_CLASS} w-full`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                  Fenêtre de la carte
                  <select name="fenetre" className={`${INPUT_CLASS} w-full`}>
                    <option value="">Suivre la fenêtre du tableau de bord</option>
                    {/* Figer n'a de sens que pour une fenêtre PERSONNALISÉE : un
                        preset doit rester glissant, sinon la carte vieillit seule. */}
                    {query.range.preset === null && (
                      <option value="freeze">
                        Figer la fenêtre courante (du {query.range.from} au {query.range.to})
                      </option>
                    )}
                  </select>
                </label>
                <input
                  type="hidden"
                  name="range_override"
                  value={JSON.stringify({ from: query.range.from, to: query.range.to })}
                />
                <button type="submit" className="btn-accent self-start">
                  Ajouter au tableau de bord
                </button>
              </form>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">
                Aucun tableau de bord modifiable dans ce périmètre. En créer un depuis{" "}
                <Link href="/dashboards" className="text-accent hover:underline">
                  Tableaux de bord
                </Link>
                , ou copier la requête ci-dessous.
              </p>
            )}
          </div>

          {/* ----- Vue enregistrée ----- */}
          <div className="min-w-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Comme vue enregistrée (personnelle)
            </h3>
            {peutEnregistrerVue ? (
              <form action={saveViewAction} className="mt-2 flex flex-col gap-2" data-testid="save-view">
                <input type="hidden" name="ctx" value={contexte} />
                <input type="hidden" name="query" value={JSON.stringify(meta.query)} />
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                  Nom de la vue
                  <input
                    name="name"
                    required
                    maxLength={SAVED_VIEW_NAME_MAX}
                    placeholder="Erreurs Firefox par release"
                    className={`${INPUT_CLASS} w-full`}
                  />
                </label>
                <button type="submit" className="btn-ghost self-start">
                  Enregistrer la vue
                </button>
                <p className="text-xs text-ink-faint">
                  Une vue reste privée : elle n’est lisible que par vous et par un administrateur de son application.
                </p>
              </form>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">
                {appDemandee === null
                  ? "Une vue enregistrée nomme son application : choisir un projet dans les filtres avant d’enregistrer."
                  : "Enregistrer une vue demande une session de la console rattachée à un compte actif, sur une application de votre périmètre."}
              </p>
            )}
            <p className="mt-2 text-xs">
              <Link href="/explorer/views" className="text-accent hover:underline">
                Voir les vues enregistrées
              </Link>
            </p>
          </div>
        </div>

        <details className="mt-4 text-xs text-ink-soft">
          <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
            Requête canonique (JSON)
          </summary>
          <div className="mt-2">
            <CopyBlock code={JSON.stringify(meta.query, null, 2)} label="Copier la requête" />
          </div>
        </details>
      </section>

      <details className="mt-4 text-xs text-ink-soft">
        <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
          Colonnes disponibles pour {definition.label.toLowerCase()}
        </summary>
        <p className="mt-2">{definition.rows.map((colonne) => colonne.label).join(" · ")}</p>
      </details>
    </>
  );
}
