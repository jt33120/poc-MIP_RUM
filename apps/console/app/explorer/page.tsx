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
import Link from "next/link";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { ModelesDepart } from "@/components/explorer/ModelesDepart";
import { QueryPills } from "@/components/explorer/QueryPills";
import { ObservedTrend } from "@/components/charts/ObservedTrend";
import { RankBar } from "@/components/charts/RankBar";
import { INPUT_CLASS } from "@/components/forms/Field";
import { CopyBlock } from "@/components/CopyBlock";
import { TabLink } from "@/components/sessions/TabLink";
import { getUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { type SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import {
  conditionsOf,
  paramReader,
  queryToSearchParams,
  DIMENSION_LABELS,
  DIMENSIONS,
  type AnalyticsQuery,
} from "@/lib/query-contract";
import { dimensionSupport } from "@/lib/query-compiler";
import { dimensionSchema } from "@/lib/query-schema";
import {
  EXPLORER_DATASET_IDS,
  VISUALIZATIONS,
  VISUALIZATION_LABELS,
  datasetDefinition,
  parseExplorerPlan,
  type ExplorerPlan,
  type Visualization,
} from "@/lib/analytics-schema";
import {
  EXPLORER_PARAMS,
  LIMITES,
  SERIES_MAX,
  datasetChoisi,
  explorerDatasetHref,
  explorerDemande,
  explorerHref,
  explorerOngletHref,
  explorerResetHref,
  explorerResume,
  explorerSource,
  libelleCle,
  limitePour,
  mesureDefaut,
  mesuresDe,
  pastillesRequete,
  representationDemandee,
} from "@/lib/explorer-page-params";
import { modelesDeDepart } from "@/lib/explorer-modeles";
import { exploreAnalytics, type ExplorerResult } from "@/lib/queries-explorer";
import { ExplorerBudgetError, UnsupportedExplorerDimension } from "@/lib/analytics-schema";
import { widgetConfigJson, widgetFromPlan } from "@/lib/dashboards";
import { canDashboardAction, dashboardPrincipal } from "@/lib/dashboard-access";
import { listDashboards, type DashboardRow } from "@/lib/queries-dashboards";
import { savedViewReader, savedViewsAvailable } from "@/lib/queries-saved-views";
import { SAVED_VIEW_NAME_MAX, canCreateSavedView } from "@/lib/saved-views";
import { VIEW_CONTEXT_PARAMS } from "@/lib/view-state";
import { saveAnalysisAction } from "@/app/dashboards/actions";
import { saveViewAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Libellés courts des onglets de représentation (§ 5.21.3, zone 5) : ils tiennent
 * sur une ligne à 390 px. Le libellé long (`VISUALIZATION_LABELS`) reste celui du
 * résumé et du titre du résultat.
 */
const ONGLETS: Record<Visualization, string> = {
  value: "Valeur",
  toplist: "Classement",
  timeseries: "Série",
  table: "Journal",
};

function nombre(valeur: number | null): string {
  return valeur === null ? "—" : valeur.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

export default async function ExplorerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/explorer");
  if (!ecran.ok) return <FilterProblemNotice title="Explorer" problem={ecran.problem} />;

  const reader = paramReader(sp);
  const dataset = datasetChoisi(reader);
  const definition = datasetDefinition(dataset);
  const schema = await dimensionSchema();
  const utilisateur = await getUser();
  // Les droits d'écriture sont résolus AVANT l'action : un bouton qui échouerait
  // n'est pas proposé, et son absence est expliquée.
  const principal = await dashboardPrincipal(utilisateur);
  const cibles = principal
    ? (await listDashboards(ecran.filters)).filter((d) => canDashboardAction(principal, d, "add_widget"))
    : [];
  const app = ecran.query.scope.requestedApp;
  const lecteurVues = utilisateur ? await savedViewReader(utilisateur) : null;
  const peutEnregistrerVue =
    app !== null && lecteurVues !== null && canCreateSavedView(lecteurVues, app) && (await savedViewsAvailable());

  const source = { ...explorerSource(reader), dataset };
  const plan = parseExplorerPlan(source, ecran.query);
  const demande = explorerDemande(reader);

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

  let resultat: ExplorerResult | null = null;
  let echec: { titre: string; message: string } | null = null;
  // CE6 (P14) : une série à plus de cinq groupes n'est pas lancée. Le contrôle du
  // formulaire ne la propose pas ; une URL qui l'impose est refusée, avec sa raison.
  const tropDeSeries = plan.ok && plan.value.visualization === "timeseries" && plan.value.limit > SERIES_MAX;
  if (demande && tropDeSeries) {
    echec = {
      titre: "Trop de séries demandées",
      message: `Une série temporelle superpose au plus ${SERIES_MAX} groupes : au-delà, les courbes cessent d'être lisibles. Choisir 1, 3 ou ${SERIES_MAX} dans « Nombre maximum », ou la représentation « Classement ».`,
    };
  } else if (demande && plan.ok) {
    try {
      resultat = await exploreAnalytics({ query: ecran.query, plan: plan.value });
    } catch (e) {
      if (e instanceof ExplorerBudgetError) {
        echec = {
          titre: "Budget de lecture dépassé",
          message: `${e.message}. Aucun chiffre n'est affiché : une série de zéros se lirait comme une absence de trafic.`,
        };
      } else if (e instanceof UnsupportedExplorerDimension) {
        echec = { titre: "Dimension non applicable", message: e.message };
      } else {
        throw e;
      }
    }
  }

  const mesures = mesuresDe(dataset);
  const mesureCourante = plan.ok ? `${plan.value.measure.field}:${plan.value.measure.aggregation}` : mesureDefaut(dataset);
  // Une requête refusée garde la représentation qu'elle demandait : la corriger
  // ne doit pas en changer la forme en silence.
  const vizCourante = plan.ok ? plan.value.visualization : representationDemandee(reader);
  // La liste des limites dépend de la représentation ACTUELLE : la valeur retenue
  // doit donc y figurer, sinon le contrôle afficherait autre chose que la requête.
  const limiteCourante = limitePour(vizCourante, plan.ok ? plan.value.limit : null);

  // Paramètres de vue qui suivent la navigation (§ 3.1, `cmp`…) : ils ne changent
  // pas la population, mais un onglet ou une pastille ne doit pas les perdre.
  const vue: Record<string, string | null> = Object.fromEntries(VIEW_CONTEXT_PARAMS.map((nom) => [nom, reader.get(nom)]));
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
  ].join("|");

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
      <nav aria-label="Représentation" data-testid="explorer-representation" className="mb-6 flex overflow-x-auto border-b border-line">
        {VISUALIZATIONS.map((viz) => (
          <TabLink key={viz} href={explorerOngletHref(ecran.query, reader, viz, vue)} active={viz === vizCourante}>
            {ONGLETS[viz]}
          </TabLink>
        ))}
      </nav>

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
          suivantHref={
            resultat.data.next_cursor
              ? explorerHref(ecran.query, plan.value, { ...vue, cursor: resultat.data.next_cursor })
              : null
          }
          cibles={cibles}
          peutEnregistrerVue={peutEnregistrerVue}
          contexte={queryToSearchParams(ecran.query).toString()}
          appDemandee={app}
          query={ecran.query}
        />
      )}
    </div>
  );
}

function Resultat({
  plan,
  resultat,
  suivantHref,
  cibles,
  peutEnregistrerVue,
  contexte,
  appDemandee,
  query,
}: {
  plan: ExplorerPlan;
  resultat: ExplorerResult;
  suivantHref: string | null;
  /** Tableaux de bord sur lesquels la session peut réellement ajouter une carte. */
  cibles: DashboardRow[];
  peutEnregistrerVue: boolean;
  contexte: string;
  appDemandee: string | null;
  query: AnalyticsQuery;
}) {
  const { meta, data } = resultat;
  const definition = datasetDefinition(plan.dataset);
  const vide = data.samples === 0;
  // La carte fige le QUOI et les filtres composés ici ; elle n'emporte ni l'app ni
  // la fenêtre, qui appartiennent au tableau de bord qui l'affichera.
  const carte = widgetFromPlan(plan, {
    conditions: conditionsOf(query.filters),
    includeBots: query.filters.includeBots,
    includeInternal: query.filters.includeInternal,
  });

  return (
    <>
      {meta.coverage.status !== "complete" && (
        <p role="note" className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          Résultat partiel : {meta.coverage.reason}
        </p>
      )}
      {meta.truncated_groups && (
        <p role="note" data-testid="explorer-tronque" className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          D’autres combinaisons existent au-delà des {plan.limit} affichées. Le total, lui, porte sur toute la population.
        </p>
      )}
      {meta.warnings.map((avertissement) => (
        <p key={avertissement} role="note" className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          {avertissement}
        </p>
      ))}

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <aside className="card min-w-0 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Total observé</div>
          <div data-testid="explorer-total" className="mt-1 text-3xl font-bold tabular-nums text-ink">
            {nombre(data.total)}
          </div>
          <div className="mt-1 text-xs text-ink-faint">
            {meta.unit} · {meta.counting}
            {meta.approximate && " · valeur approchée"}
          </div>
          <dl className="mt-4 space-y-1 text-xs text-ink-soft">
            <div className="flex justify-between gap-3">
              <dt>Lignes de population</dt>
              <dd className="tabular-nums">{data.samples.toLocaleString("fr-FR")}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Largeur de seau</dt>
              <dd className="tabular-nums">{meta.range.bucket_seconds} s</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Agrégation additive</dt>
              <dd>{meta.additive ? "oui" : "non"}</dd>
            </div>
            {/* D'où vient le chiffre : les lignes, ou un agrégat déjà consolidé
                complété par les lignes de la fin de fenêtre (P6.6). */}
            <div className="flex justify-between gap-3">
              <dt>Source</dt>
              <dd data-testid="explorer-source">{meta.source === "rollup+raw" ? "agrégat + lignes" : "lignes brutes"}</dd>
            </div>
          </dl>
        </aside>

        <section className="card min-w-0 p-4">
          <h2 className="text-sm font-semibold text-ink">{VISUALIZATION_LABELS[plan.visualization]}</h2>
          {vide ? (
            <p data-testid="explorer-vide" className="py-10 text-center text-sm text-ink-faint">
              Aucune ligne ne correspond à cette requête sur la fenêtre demandée. Ce n’est pas une erreur : la population est réellement vide.
            </p>
          ) : (
            <div className="mt-3">
              {plan.visualization === "value" && (
                <p className="text-sm text-ink-soft">
                  Cette représentation ne rend qu’un nombre : {nombre(data.total)} {meta.unit}.
                </p>
              )}
              {plan.visualization === "toplist" && (
                <RankBar
                  data={data.groups.map((groupe) => ({
                    label: libelleCle(groupe.key),
                    value: groupe.value ?? 0,
                    display: nombre(groupe.value),
                    sub: `${groupe.samples.toLocaleString("fr-FR")} lignes`,
                  }))}
                  emptyLabel="Aucun groupe sur la fenêtre."
                />
              )}
              {plan.visualization === "timeseries" && <Series resultat={resultat} />}
              {plan.visualization === "table" && <Journal plan={plan} resultat={resultat} />}
            </div>
          )}
        </section>
      </div>

      {plan.visualization === "table" && (
        <nav className="mt-4 flex justify-end text-sm" aria-label="Pagination du journal">
          {suivantHref && (
            <Link
              className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
              href={suivantHref}
            >
              Lignes suivantes
            </Link>
          )}
        </nav>
      )}

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

/** Une série par groupe du haut : les mêmes groupes dans tous les seaux. */
function Series({ resultat }: { resultat: ExplorerResult }) {
  const groupes = new Map<string, { key: Array<string | null>; points: Array<{ bucket: Date; value: number }> }>();
  for (const point of resultat.data.series) {
    const cle = JSON.stringify(point.key);
    if (!groupes.has(cle)) groupes.set(cle, { key: point.key, points: [] });
    // Un seau sans mesure vaut null pour une agrégation non additive : la barre
    // vaut alors zéro, mais l'alternative textuelle porte la valeur réelle.
    groupes.get(cle)!.points.push({ bucket: new Date(point.start), value: point.value ?? 0 });
  }
  return (
    <div className="grid gap-4">
      {[...groupes.values()].map((groupe) => (
        <ObservedTrend
          key={JSON.stringify(groupe.key)}
          title={libelleCle(groupe.key)}
          rows={groupe.points}
          valueLabel={resultat.meta.unit}
        />
      ))}
    </div>
  );
}

/** Journal paginé : la projection FERMÉE du jeu, jamais un `select *`. */
function Journal({ plan, resultat }: { plan: ExplorerPlan; resultat: ExplorerResult }) {
  const colonnes = datasetDefinition(plan.dataset).rows;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-table text-sm">
        <caption className="sr-only">Journal des lignes correspondant à la requête</caption>
        <thead className="bg-panel2">
          <tr>
            {colonnes.map((colonne) => (
              <th key={colonne.id} scope="col" className="th">
                {colonne.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resultat.data.rows.map((ligne, index) => (
            <tr key={index} className="border-t border-line/60 align-top hover:bg-panel2/60">
              {colonnes.map((colonne) => (
                <td key={colonne.id} className="px-4 py-2 text-xs text-ink-soft">
                  {cellule(ligne[colonne.id])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Une cellule de journal : jamais un objet brut, jamais une valeur inventée. */
function cellule(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "—";
  if (valeur instanceof Date) return fmtDate(valeur);
  if (typeof valeur === "number") return valeur.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return String(valeur);
}
