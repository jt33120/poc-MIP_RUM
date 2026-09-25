// LE CHARGEUR DES « Tendances » (C4) — `app/forecast/page.tsx`.
//
// Quatorze jours COMPLETS dans le fuseau de l'app, aujourd'hui exclu : trafic et
// LCP par jour, et les marqueurs de déploiement (qui ne servent qu'à dire qu'un
// déploiement tombe le même jour qu'une rupture). Puis la couverture du jour de
// référence des tuiles (même jour, semaine précédente) : une collecte commencée ce
// jour-là ne donne pas « +1 900 % ».
//
// UN JOUR VOYAGE EN CLÉ « AAAA-MM-JJ ». La base rend un `date` ; node-postgres en
// fait une `Date` à minuit HEURE LOCALE du processus, que JSON écrirait en UTC —
// la veille, sur un poste à Paris. La clé est donc formée ICI, par le processus
// qui a lu la ligne (`cleJour`), et c'est elle qui voyage.
import { analyserFiltres } from "../filtres-ecran";
import { cleJour, joursComplets } from "../forecast";
import { SOURCES_TENDANCES, couvertureJour } from "../forecast-comparaison";
import { fuseauDe } from "../fuseau";
import { listDeploys } from "../queries-deploys";
import { GRID_DAYS, dailyLcpSeries, dailyTraffic } from "../queries-grid";
import { section, type Chargeur } from "./commun";

export const chargerForecast = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/forecast");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.filters;
  const query = ecran.query;
  const [fuseau, traficLu, lcpLu, deploysLu] = await Promise.all([
    fuseauDe(query.scope.requestedApp),
    section(async () => (await dailyTraffic(f, { exclureAujourdhui: true })).map((t) => ({ ...t, day: cleJour(t.day) }))),
    section(() => dailyLcpSeries(f, { exclureAujourdhui: true })),
    // P*.7 : les marqueurs servent UNIQUEMENT à dire qu'un déploiement tombe le
    // même jour qu'une rupture ; leur absence n'empêche pas la datation.
    section(() => listDeploys(f, 20)),
  ]);

  // L'AXE : les 14 jours complets rendus par la lecture (même expression SQL pour
  // les deux) ; sans aucune lecture, ceux du fuseau de l'app, calculés ici.
  const jours = lcpLu.ok
    ? lcpLu.data.map((r) => r.jour)
    : traficLu.ok
      ? traficLu.data.map((t) => t.day)
      : joursComplets(fuseau, Date.now(), GRID_DAYS);
  const semainePrecedente = jours.length - 1 - 7;
  const jourRef = jours[semainePrecedente];
  const mesureRef = (lcpLu.ok ? lcpLu.data.find((r) => r.jour === jourRef)?.n : 0) ?? 0;
  const vuesRef = Number((traficLu.ok ? traficLu.data.find((t) => t.day === jourRef)?.pageviews : 0) ?? 0);

  // Jour de référence des tuiles : sa couverture est LUE (§ 3.2).
  const [couvLcp, couvRatio, couvVues] = await Promise.all([
    jourRef && lcpLu.ok ? couvertureJour(query, SOURCES_TENDANCES.lcp, jourRef, fuseau, mesureRef) : null,
    jourRef && traficLu.ok ? couvertureJour(query, SOURCES_TENDANCES.ratio, jourRef, fuseau, vuesRef) : null,
    // Un compte de pages vues n'est pas un échantillon : pas de garde d'effectif, seulement la couverture.
    jourRef && traficLu.ok ? couvertureJour(query, SOURCES_TENDANCES.vues, jourRef, fuseau, null) : null,
  ]);

  return {
    etat: "ok",
    query,
    label: ecran.label,
    fuseau,
    jours,
    traficLu,
    lcpLu,
    deploysLu,
    couvLcp,
    couvRatio,
    couvVues,
    // Créer une alerte depuis la rupture : administrateur, hors démo.
    peutEcrire: principal?.role === "admin" && !principal.demo,
  } as const;
}) satisfies Chargeur<unknown>;
