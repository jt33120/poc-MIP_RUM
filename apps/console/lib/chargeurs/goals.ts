// LE CHARGEUR DE L'ÉCRAN « Conversions » (C5) — `app/goals/page.tsx`.
//
// Les conversions de chaque objectif actif et leur répartition par appareil ; sous
// `cmp=prev`, la période précédente et la couverture de son dénominateur (les
// sessions avec vue). La GESTION des objectifs (G6) n'est lue que pour un
// administrateur — décidé par le principal du chargeur : le périmètre du
// principal, jamais l'app demandée seule. Les écritures restent des actions de la
// console (C6).
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
  const [lecture, lecturePrev, parAppareil, couvertures, schema, gestion] = await Promise.all([
    section(() => goalConversions(f)),
    prev ? section(() => goalConversions(f, true)) : sansSection(null),
    section(() => goalConversionsByDevice(f)),
    prev
      ? Promise.all(sourcesSousFiltres(query, SOURCE_DENOMINATEUR).map((s) => couverturePrecedente(query, s)))
      : Promise.resolve<CouverturePrecedente[]>([]),
    dimensionSchema(),
    // Gestion (G6) : le périmètre du principal, jamais l'app demandée seule.
    isAdmin ? section(() => Promise.all([listApps(), listGoals(query.scope.effectiveApps)])) : sansSection(null),
  ]);
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
  } as const;
}) satisfies Chargeur<unknown>;
