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
import Link from "next/link";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { ObservedTrend } from "@/components/charts/ObservedTrend";
import { RankBar } from "@/components/charts/RankBar";
import { INPUT_CLASS } from "@/components/forms/Field";
import { CopyBlock } from "@/components/CopyBlock";
import { getUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { type SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import { paramReader, queryToSearchParams, DIMENSION_LABELS, DIMENSIONS } from "@/lib/query-contract";
import { dimensionSupport } from "@/lib/query-compiler";
import { dimensionSchema } from "@/lib/query-schema";
import {
  EXPLORER_DATASET_IDS,
  MAX_GROUPS,
  VISUALIZATIONS,
  VISUALIZATION_LABELS,
  datasetDefinition,
  parseExplorerPlan,
  type ExplorerPlan,
} from "@/lib/analytics-schema";
import {
  datasetChoisi,
  explorerDatasetHref,
  explorerDemande,
  explorerHref,
  explorerResetHref,
  explorerResume,
  explorerSource,
  libelleCle,
  mesureDefaut,
  mesuresDe,
} from "@/lib/explorer-page-params";
import { exploreAnalytics, type ExplorerResult } from "@/lib/queries-explorer";
import { ExplorerBudgetError, UnsupportedExplorerDimension } from "@/lib/analytics-schema";

export const dynamic = "force-dynamic";

/**
 * Limites proposées par représentation. Elles restent dans les bornes du contrat
 * (50 combinaisons, 200 lignes) et sont resserrées là où l'affichage l'exige :
 * une série par groupe au-delà de dix cesserait d'être lisible. Une valeur hors
 * de ces listes reste refusée par le registre, pas rabattue.
 */
const LIMITES = { toplist: [5, 10, 20, MAX_GROUPS], timeseries: [1, 3, 5, 10], table: [25, 50, 100, 200] } as const;

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
  // Le droit d'écriture est annoncé AVANT l'action : un bouton qui échouerait
  // n'est pas proposé, et son absence est expliquée.
  const peutEnregistrer = utilisateur?.role === "admin";

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
  if (demande && plan.ok) {
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
  const vizCourante = plan.ok ? plan.value.visualization : "value";
  // La liste des limites dépend de la représentation ACTUELLE : la valeur retenue
  // doit donc y figurer, sinon le contrôle afficherait autre chose que la requête.
  const limites: readonly number[] = vizCourante === "value" ? [] : LIMITES[vizCourante];
  const limiteCourante = plan.ok && limites.includes(plan.value.limit) ? plan.value.limit : limites[0];

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

      <form
        method="get"
        aria-label="Constructeur de requête"
        className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {/* Le contexte global suit la requête : app, plage, appareil, dimensions, segment. */}
        {[...queryToSearchParams(ecran.query)].map(([nom, valeur]) => (
          <input key={nom} type="hidden" name={nom} value={valeur} />
        ))}
        <input type="hidden" name="dataset" value={dataset} />

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

        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
          Représentation
          <select name="viz" defaultValue={vizCourante} className={`${INPUT_CLASS} w-full`}>
            {VISUALIZATIONS.map((viz) => (
              <option key={viz} value={viz}>
                {VISUALIZATION_LABELS[viz]}
              </option>
            ))}
          </select>
        </label>

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

      {!plan.ok && (
        <div role="alert" data-testid="explorer-invalide" className="card mb-6 border-bad/30 p-6 text-sm">
          <p className="font-semibold text-bad">Requête refusée</p>
          <p className="mt-1 text-ink-soft">{plan.error.message}</p>
          <p className="mt-2 text-xs text-ink-faint">Code : {plan.error.code}</p>
        </div>
      )}

      {plan.ok && !demande && (
        <div data-testid="explorer-invite" className="card px-4 py-10 text-center text-sm text-ink-faint">
          Rien n’a encore été mesuré. Composez la requête ci-dessus puis choisissez « Exécuter ».
        </div>
      )}

      {echec && (
        <div role="alert" data-testid="explorer-echec" className="card mb-6 border-bad/30 p-6 text-sm">
          <p className="font-semibold text-bad">{echec.titre}</p>
          <p className="mt-1 text-ink-soft">{echec.message}</p>
        </div>
      )}

      {plan.ok && resultat && (
        <Resultat
          plan={plan.value}
          resultat={resultat}
          resume={explorerResume(ecran.query, plan.value, ecran.label)}
          suivantHref={
            resultat.data.next_cursor
              ? explorerHref(ecran.query, plan.value, { cursor: resultat.data.next_cursor })
              : null
          }
          peutEnregistrer={peutEnregistrer}
        />
      )}
    </div>
  );
}

function Resultat({
  plan,
  resultat,
  resume,
  suivantHref,
  peutEnregistrer,
}: {
  plan: ExplorerPlan;
  resultat: ExplorerResult;
  resume: string;
  suivantHref: string | null;
  peutEnregistrer: boolean;
}) {
  const { meta, data } = resultat;
  const definition = datasetDefinition(plan.dataset);
  const vide = data.samples === 0;

  return (
    <>
      <p data-testid="explorer-resume" className="mb-4 break-words rounded-lg border border-line bg-panel2 px-4 py-3 text-sm text-ink-soft">
        <span className="font-semibold text-ink">Requête appliquée — </span>
        {resume}
      </p>

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
        <h2 className="text-sm font-semibold text-ink">Enregistrer dans un tableau de bord</h2>
        {peutEnregistrer ? (
          <>
            <p className="mt-1 text-sm text-ink-soft">
              Voici la requête canonique — l’AST seul, sans aucune donnée de résultat. C’est exactement ce qu’un widget
              enregistrera, et il la rejouera avec les droits de son lecteur. Le stockage des vues arrive avec P6.5.
            </p>
            <div className="mt-3">
              <CopyBlock code={JSON.stringify(meta.query, null, 2)} label="Copier la requête" />
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">
            Enregistrer une analyse demande un droit d’écriture sur les tableaux de bord. Votre compte est en lecture
            seule sur ce périmètre : la requête reste partageable par son URL.
          </p>
        )}
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
