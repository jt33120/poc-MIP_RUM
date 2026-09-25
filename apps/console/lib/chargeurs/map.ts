// LE CHARGEUR DE LA « Carte d'expérience » (C4) — `app/map/page.tsx`.
//
// Nœuds, arêtes, pages, couverture du tracing (lue par SA fonction : deux calculs
// du même chiffre finiraient par diverger), échantillonnage ; et, quand un
// panneau de NŒUD est ouvert (`panel=noeud:…`), sa série (B37) — lue avec
// l'écran, jamais sans panneau.
import { analyserFiltres } from "../filtres-ecran";
import { mapEdges, mapNodeSerie, mapNodes, mapPages } from "../queries-map";
import { samplingSessions } from "../queries-sessions";
import { traceCoverage } from "../queries-tracing";
import { paramReader } from "../query-contract";
import { lireEtatDeVue } from "../view-state";
import { section, type Chargeur } from "./commun";

export const chargerMap = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/map");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.filters;
  const { etat: vue } = lireEtatDeVue("/map", paramReader(sp));
  // Cet écran n'ouvre QUE des nœuds.
  const panneau = vue.panel?.type === "noeud" ? vue.panel : null;

  // Chaque section a son sort : une lecture en échec n'efface pas les autres (§ 3.8).
  const [noeuds, aretes, pages, couverture, echantillonnage, serieNoeud] = await Promise.all([
    section(() => mapNodes(f)),
    section(() => mapEdges(f)),
    section(() => mapPages(f)),
    section(() => traceCoverage(f)),
    section(() => samplingSessions(f, { avecSpans: true })),
    // B37 : la série du panneau n'est lue que si un panneau est ouvert.
    panneau ? section(() => mapNodeSerie(f, panneau.cote, panneau.route)) : Promise.resolve(null),
  ]);
  return {
    etat: "ok",
    query: ecran.query,
    label: ecran.label,
    bucketLabel: ecran.bucketLabel,
    noeuds,
    aretes,
    pages,
    couverture,
    echantillonnage,
    serieNoeud,
  } as const;
}) satisfies Chargeur<unknown>;
