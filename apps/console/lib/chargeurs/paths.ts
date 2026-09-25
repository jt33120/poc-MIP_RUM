// LE CHARGEUR DE L'ÉCRAN « Parcours » (C5) — `app/paths/page.tsx`.
//
// Transitions entre routes (ancrées sur `depuis` si demandé), pages d'entrée et de
// sortie et leur dénominateur (sessions avec vue, R-P), événements disponibles et
// entonnoir des étapes `s1..s4`, échantillonnage ; sous `cmp=prev`, les transitions
// de la période précédente et leur couverture. Puis, les bords connus, le LCP p75
// de leurs routes. Une lecture par section (§ 3.8).
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { analyserFiltres } from "../filtres-ecran";
import { sessionsAvecVue } from "../queries";
import { availableEvents, funnelReport } from "../queries-funnel";
import { entryExitRoutes, lcpDesRoutes, routeTransitions } from "../queries-paths";
import { samplingSessions } from "../queries-sessions";
import { paramReader } from "../query-contract";
import { lireComparaison, lireEtatDeVue } from "../view-state";
import { section, type Chargeur, type ParametresEcran } from "./commun";

/** Transitions lues au plus (le compte en est un minimum au plafond). */
export const TOP_TRANSITIONS = 50;
/** Pages d'entrée et de sortie lues au plus. */
export const TOP_BORDS = 15;

const SOURCE_VUES: SourceComparaison = { table: "rum_pageview", colonneTemps: "started_at", additive: true };

/** Lot 6c : étapes de l'entonnoir depuis `s1..s4` (formulaire GET), ordonnées, vides ignorées. */
export function etapesDeLEntonnoir(sp: ParametresEcran): string[] {
  return [1, 2, 3, 4].map((i) => (typeof sp[`s${i}`] === "string" ? (sp[`s${i}`] as string) : "")).filter(Boolean);
}

export const chargerPaths = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/paths");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.deviceFilters;
  const query = ecran.query;
  const lecteur = paramReader(sp);
  const depuis = lireEtatDeVue("/paths", lecteur).etat.depuis;
  const prev = lireComparaison("/paths", lecteur).valeur.mode === "prev";
  const steps = etapesDeLEntonnoir(sp);
  const [transitions, ancrees, bords, avecVue, events, funnel, echantillonnage, transitionsPrev, couvertures] = await Promise.all([
    section(() => routeTransitions(f, TOP_TRANSITIONS)),
    depuis ? section(() => routeTransitions(f, TOP_TRANSITIONS, { depuis })) : Promise.resolve(null),
    section(() => entryExitRoutes(f, TOP_BORDS)),
    // Le dénominateur des parts : UNE définition (R-P), sur la même plage que les bords.
    section(() => sessionsAvecVue(f)),
    section(() => availableEvents(f)),
    steps.length >= 2 ? section(() => funnelReport(f, steps)) : Promise.resolve(null),
    // S7 : sessions dont les vues sont lues par les transitions et les bords.
    section(() => samplingSessions(f, { population: { lecture: "vues" } })),
    prev ? section(() => routeTransitions(f, TOP_TRANSITIONS, { shift: true })) : Promise.resolve(null),
    prev
      ? Promise.all(sourcesSousFiltres(query, SOURCE_VUES).map((s) => couverturePrecedente(query, s)))
      : Promise.resolve<CouverturePrecedente[]>([]),
  ]);
  // LCP p75 des routes de bord : les routes ne sont connues qu'après la lecture des bords.
  const routesDeBord = bords.ok ? [...new Set([...bords.data.entries, ...bords.data.exits].map((r) => r.route))] : [];
  const lcp = bords.ok ? await section(() => lcpDesRoutes(f, routesDeBord)) : null;
  return {
    etat: "ok",
    query,
    label: ecran.label,
    transitions,
    ancrees,
    bords,
    avecVue,
    events,
    funnel,
    echantillonnage,
    transitionsPrev,
    couvertures,
    lcp,
  } as const;
}) satisfies Chargeur<unknown>;
