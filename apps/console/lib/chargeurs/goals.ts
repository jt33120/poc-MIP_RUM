// LE CHARGEUR DE L'ÉCRAN « Conversions » (C5) — `app/goals/page.tsx`.
//
// Les conversions de chaque objectif actif et leur répartition par appareil ; sous
// `cmp=prev`, la période précédente et la couverture de son dénominateur (les
// sessions avec vue). La GESTION des objectifs (G6) n'est lue que pour un
// administrateur — décidé par le principal du chargeur : le périmètre du
// principal, jamais l'app demandée seule. Les écritures restent des actions de la
// console (C6).
//
// LE NOM DES APPLICATIONS (recette du 26/09/2026) : la colonne « App » et le préfixe
// des objectifs écrivaient l'identifiant (« demo-app ») quand le sélecteur de projet
// dit « Mini-site de démo ». Les noms sont lus pour tout principal, bornés à son
// périmètre effectif ; la gestion (admin) reprend la même lecture.
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { analyserFiltres } from "../filtres-ecran";
import { listApps } from "../queries";
import { goalConversions, goalConversionsByDevice, listGoals } from "../queries-goals";
import { paramReader } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { lireComparaison } from "../view-state";
import { section, sansSection, type Chargeur } from "./commun";

const SOURCE_DENOMINATEUR: SourceComparaison = { table: "rum_pageview", colonneTemps: "started_at", additive: true };

export const chargerGoals = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/goals");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.deviceFilters;
  const query = ecran.query;
  const prev = lireComparaison("/goals", paramReader(sp)).valeur.mode === "prev";
  const isAdmin = principal?.role === "admin";
  // `listApps` ne lève pas (base indisponible : liste vide, l'identifiant s'affiche alors).
  const appsLues = listApps();
  const [lecture, lecturePrev, parAppareil, couvertures, schema, gestion, apps] = await Promise.all([
    section(() => goalConversions(f)),
    prev ? section(() => goalConversions(f, true)) : sansSection(null),
    section(() => goalConversionsByDevice(f)),
    prev
      ? Promise.all(sourcesSousFiltres(query, SOURCE_DENOMINATEUR).map((s) => couverturePrecedente(query, s)))
      : Promise.resolve<CouverturePrecedente[]>([]),
    dimensionSchema(),
    // Gestion (G6) : le périmètre du principal, jamais l'app demandée seule.
    isAdmin ? section(() => Promise.all([appsLues, listGoals(query.scope.effectiveApps)])) : sansSection(null),
    appsLues,
  ]);
  const effectives = query.scope.effectiveApps;
  const nomsApps: Record<string, string> = Object.fromEntries(
    apps.filter((a) => effectives === null || effectives.includes(a.app_id)).map((a) => [a.app_id, a.name || a.app_id]),
  );
  return {
    etat: "ok",
    query,
    label: ecran.label,
    app: f.app,
    isAdmin,
    lecture,
    lecturePrev,
    parAppareil,
    couvertures,
    schema: [...schema].sort(),
    gestion,
    nomsApps,
  } as const;
}) satisfies Chargeur<unknown>;
