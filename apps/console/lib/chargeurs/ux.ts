// LE CHARGEUR DE L'ÉCRAN « Interactions », onglet Frustration (C4) — `app/ux/page.tsx`.
//
// Signaux de frustration (totaux, par route, sous le filtre `type`), INP (p75,
// série, pires cibles), scripts bloquants, marqueurs de déploiement ; et, sous
// `cmp=prev`, la période précédente et sa couverture. Chaque lecture est
// indépendante (F02) : une section en échec le dit, jamais par un « 0 ».
import type { SourceComparaison } from "../comparaison";
import { analyserFiltres } from "../filtres-ecran";
import { vitalSeriesN, vitalsP75 } from "../queries";
import { listDeploys } from "../queries-deploys";
import { frustrationParRoute, frustrationTotaux, inpOffenders, scriptsBloquants } from "../queries-frustration";
import { paramReader } from "../query-contract";
import { lireEtatDeVue } from "../view-state";
import { couvertureDesSources, section, type Chargeur } from "./commun";

// Sources comparées à la période précédente (§ 3.2) : des signaux (comptes, additifs)
// et des mesures INP (non additives).
const SOURCES_SIGNAUX: SourceComparaison[] = [{ table: "rum_event", colonneTemps: "ts", additive: true }];
const SOURCES_INP: SourceComparaison[] = [{ table: "rum_metric", colonneTemps: "ts", additive: false }];

export const chargerUx = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/ux");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.filters;
  const { query, label } = ecran;
  // `type` filtre le hero ; `cmp=prev` relit la période précédente.
  const { etat: vue } = lireEtatDeVue("/ux", paramReader(sp));
  const prev = vue.cmp === "prev";

  const [totaux, totauxPrec, routes, vitaux, vitauxPrec, serieInp, inp, scripts, deploys, couvSignaux, couvInp] =
    await Promise.all([
      section(() => frustrationTotaux(f)),
      prev ? section(() => frustrationTotaux(f, true)) : Promise.resolve(null),
      section(() => frustrationParRoute(f, vue.type)),
      section(() => vitalsP75(f)),
      prev ? section(() => vitalsP75(f, true)) : Promise.resolve(null),
      section(() => vitalSeriesN(f, "INP")),
      section(() => inpOffenders(f)),
      section(() => scriptsBloquants(f)),
      section(() => listDeploys(f, 20)),
      prev ? couvertureDesSources(query, SOURCES_SIGNAUX) : Promise.resolve(null),
      prev ? couvertureDesSources(query, SOURCES_INP) : Promise.resolve(null),
    ]);
  return {
    etat: "ok",
    query,
    label,
    bucketLabel: ecran.bucketLabel,
    totaux,
    totauxPrec,
    routes,
    vitaux,
    vitauxPrec,
    serieInp,
    inp,
    scripts,
    deploys,
    couvSignaux,
    couvInp,
  } as const;
}) satisfies Chargeur<unknown>;
