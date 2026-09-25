// LE CHARGEUR DE L'ÉCRAN « Satisfaction » (C5) — `app/experience/page.tsx`.
//
// Avis (CSAT, détracteurs), contexte de l'expérience, frustration pour 1 000
// sessions commencées, tendance, verbatims récents, satisfaction par page et LCP
// des mêmes routes, déploiements ; sous `cmp=prev`, la période précédente et la
// couverture de ses deux sources (une part, un compte). Chaque lecture est
// indépendante (§ 3.8 règle 1).
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { analyserFiltres } from "../filtres-ecran";
import { vitalsBreakdown } from "../queries-breakdowns";
import { listDeploys } from "../queries-deploys";
import {
  experienceContext,
  feedbackByRoute,
  feedbackStats,
  feedbackTrendContrat,
  frustrationSessionsCommencees,
  recentFeedback,
} from "../queries-experience";
import { paramReader } from "../query-contract";
import { lireComparaison } from "../view-state";
import { section, type Chargeur } from "./commun";

const CHEMIN = "/experience";
// Une part (non additive) et un compte (additif) : leurs couvertures se lisent à part (§ 3.2).
const SOURCE_PART: SourceComparaison = { table: "rum_event", colonneTemps: "ts", additive: false };
const SOURCE_COMPTE: SourceComparaison = { table: "rum_event", colonneTemps: "ts", additive: true };

export const chargerExperience = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, CHEMIN);
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.filters;
  const q = ecran.query;
  const prev = lireComparaison(CHEMIN, paramReader(sp)).valeur.mode === "prev";
  const couvertures = (source: SourceComparaison) =>
    Promise.all(sourcesSousFiltres(q, source).map((s) => couverturePrecedente(q, s)));
  const [stats, statsPrev, contexte, frustration, tendance, recents, parPage, lcpPages, deploys, couvPart, couvCompte] =
    await Promise.all([
      section(() => feedbackStats(f)),
      prev ? section(() => feedbackStats(f, true)) : Promise.resolve(null),
      section(() => experienceContext(f)),
      section(() => frustrationSessionsCommencees(f)),
      section(() => feedbackTrendContrat(f)),
      section(() => recentFeedback(f)),
      section(() => feedbackByRoute(f)),
      section(() => vitalsBreakdown(f, "route", 200)),
      section(() => listDeploys(f, 20)),
      prev ? couvertures(SOURCE_PART) : Promise.resolve<CouverturePrecedente[]>([]),
      prev ? couvertures(SOURCE_COMPTE) : Promise.resolve<CouverturePrecedente[]>([]),
    ]);
  return {
    etat: "ok",
    query: q,
    label: ecran.label,
    bucketLabel: ecran.bucketLabel,
    stats,
    statsPrev,
    contexte,
    frustration,
    tendance,
    recents,
    parPage,
    lcpPages,
    deploys,
    couvPart,
    couvCompte,
  } as const;
}) satisfies Chargeur<unknown>;
