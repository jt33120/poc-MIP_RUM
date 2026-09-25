// LE CHARGEUR DE L'ÉCRAN « Erreurs JS » (C4) — `app/errors/page.tsx`.
//
// Le découpage (P6.3), puis la BIFURCATION P5.5 : l'app choisie (ou une app du
// périmètre « toutes ») a activé le regroupement v2 → la liste des ISSUES ; sinon
// la liste historique des groupes, et le PANNEAU d'un groupe (`panel=error:…`, F20)
// lu pour le groupe ouvert. Les tuiles et le hero sont des sections indépendantes
// (§ 3.8) ; la période précédente n'est lue qu'en `cmp=prev`, avec sa couverture.
import type { PartLue } from "@/components/errors/ApercuErreurs";
import type { SourceComparaison } from "../comparaison";
import { BREAKDOWN_PARAM, availableBreakdowns, datasetAvailability, parseBreakdown } from "../breakdowns";
import {
  groupingState,
  issueModeFor,
  listIssues,
  parseIssueCursor,
  parseIssueListPage,
  parseIssueRelease,
  parseIssueSource,
  parseIssueStatus,
} from "../error-issues";
import { GROUPES_DU_HERO, errorSearchParams } from "../error-view";
import { analyserFiltres } from "../filtres-ecran";
import { ERRORS_BREAKDOWN_DATASETS, errorsBreakdown } from "../queries-breakdowns";
import { listDeploys } from "../queries-deploys";
import {
  listErrorGroups,
  nouveauxGroupes,
  parseErrorListPage,
  partSessionsTouchees,
  topGroupesSeries,
  totauxErreurs,
  type ErrorFilters,
  type ErrorGroupRef,
  type OrdreGroupes,
} from "../queries-errors";
import { UnsupportedFilterError } from "../query-compiler";
import { paramReader } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { lireEtatDeVue } from "../view-state";
import { couvertureDesSources, section, type Chargeur } from "./commun";
import { lirePanneauErreur } from "./panneau-erreur";

const SOURCES_ERREURS: SourceComparaison[] = [{ table: "rum_error", colonneTemps: "ts", additive: true }];
const SOURCES_PART: SourceComparaison[] = [
  { table: "rum_error", colonneTemps: "ts", additive: false },
  { table: "rum_pageview", colonneTemps: "started_at", additive: false },
];

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

export const chargerErrors = (async (principal, sp) => {
  // Le périmètre signé borne la lecture AVANT tout filtre d'URL (AD-16 : aucune app = aucun accès).
  const ecran = await analyserFiltres(principal, sp, "/errors");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.deviceFilters;
  const { label, bucketLabel, query } = ecran;
  const url = errorSearchParams(sp);
  const { etat: vue } = lireEtatDeVue("/errors", paramReader(sp));

  // Découpage (P6.3) : les dimensions que les occurrences d'erreurs portent réellement.
  const schema = await dimensionSchema();
  const dimension = parseBreakdown(url.get(BREAKDOWN_PARAM), availableBreakdowns(datasetAvailability(ERRORS_BREAKDOWN_DATASETS, schema)));
  // P5.5 : l'app choisie (ou une app du périmètre « toutes ») a activé le regroupement v2.
  const apps = query.scope.authorizedApps;
  const [decoupe, grouping] = await Promise.all([
    dimension ? errorsBreakdown(f, dimension) : Promise.resolve(null),
    groupingState(apps),
  ]);
  const modeIssues = issueModeFor(grouping, f.app);

  // Tuiles et hero (F18) : CHAQUE LECTURE EST INDÉPENDANTE (§ 3.8).
  const prev = vue.cmp === "prev";
  const [totaux, totauxPrec, part, partPrec, nouveaux, nouveauxPrec, top, deploys, couvErreurs, couvPart] =
    await Promise.all([
      section(() => totauxErreurs(f)),
      prev ? section(() => totauxErreurs(f, true)) : Promise.resolve(null),
      section(() => partLue(f, false)),
      prev ? section(() => partLue(f, true)) : Promise.resolve(null),
      section(() => nouveauxGroupes(f)),
      prev ? section(() => nouveauxGroupes(f, true)) : Promise.resolve(null),
      section(() => topGroupesSeries(f, GROUPES_DU_HERO)),
      section(() => listDeploys(ecran.filters, 20)),
      prev ? couvertureDesSources(query, SOURCES_ERREURS) : Promise.resolve(null),
      prev ? couvertureDesSources(query, SOURCES_PART) : Promise.resolve(null),
    ]);
  const commun = {
    query,
    label,
    bucketLabel,
    f,
    schema: [...schema].sort(),
    dimension,
    decoupe,
    modeIssues,
    totaux,
    totauxPrec,
    part,
    partPrec,
    nouveaux,
    nouveauxPrec,
    top,
    deploys,
    couvErreurs,
    couvPart,
  };

  if (modeIssues) {
    const status = parseIssueStatus(url.get("status"));
    const source = parseIssueSource(url.get("source"));
    const release = parseIssueRelease(url.get("release"));
    const cursor = parseIssueCursor(url.get("cursor"));
    if (status === undefined || source === undefined || release === undefined) {
      return { etat: "issues_invalides", ...commun, raison: "Filtre invalide : statut ou source inconnus, ou release de plus de 200 caractères." } as const;
    }
    if (cursor === undefined) {
      return { etat: "issues_invalides", ...commun, raison: "Curseur de pagination invalide : il ne provient pas de cette console." } as const;
    }
    const filtres = { status, source, release };
    const result = await listIssues(f, filtres, { limit: parseIssueListPage(url).limit, cursor }, { apps, overview: true });
    return { etat: "issues", ...commun, filtres, curseur: cursor !== null, result } as const;
  }

  // Liste historique : ordre, restrictions et panneau (F19, F20).
  const tri: OrdreGroupes = vue.tri === "sessions" || vue.tri === "recent" ? vue.tri : "statut";
  const page = parseErrorListPage(url);
  const liste = await listErrorGroups(f, page, {
    series: true,
    tri,
    nouveaux: vue.nouveaux,
    statut: vue.statut ?? undefined,
  });
  // Le groupe de la page affichée donne SON app. Hors de cette page (lien partagé,
  // clic sur un segment du hero), l'app de l'écran suffit ; sans app explicite, une
  // empreinte peut désigner deux groupes : on ne tire pas au sort.
  const panneau = vue.panel?.type === "error" ? vue.panel.id : null;
  const dansLaPage = panneau === null ? undefined : liste.groups.find((g) => g.fingerprint === panneau);
  const ouvert: ErrorGroupRef | null = dansLaPage
    ? { app_id: dansLaPage.app_id, fingerprint: dansLaPage.fingerprint }
    : panneau !== null && f.app
      ? { app_id: f.app, fingerprint: panneau }
      : null;
  const panneauLu = ouvert ? { groupe: ouvert, lecture: await lirePanneauErreur(ouvert, f, ecran.filters) } : null;
  return { etat: "groupes", ...commun, page, liste, panneau: panneauLu } as const;
}) satisfies Chargeur<unknown>;
