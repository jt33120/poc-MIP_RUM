// LE CHARGEUR DE « Corrélation synthétique ↔ RUM » (C4) — `app/correlation/page.tsx`.
//
// En deux temps, comme la page : d'abord les lectures de l'écran (cartes, couples,
// concordance, angles morts, fraîcheur du robot, déploiements, alertes, lecture
// quotidienne) ; puis, le COUPLE du hero choisi (l'URL `serie=`, sinon le couple par
// défaut, qui dépend des couples et des angles morts lus), sa série — et celle de
// la période précédente sous `cmp=prev`. Sans aucun passage du robot, la série
// n'est pas lue : les zones robot disent « Non collecté ».
import { couverturePrecedente } from "../comparaison";
import { dernierPassage } from "../correlation";
import { lireSerie, serieParDefaut } from "../correlation-serie";
import { analyserFiltres } from "../filtres-ecran";
import { listDeploys } from "../queries-deploys";
import {
  alertEvents,
  blindSpots,
  correlationCards,
  correlationConcordance,
  correlationQuotidienne,
  correlationRoutes,
  correlationSeries,
  syntheticFreshness,
  type CorrSeriesRow,
} from "../queries-v2";
import { paramReader, previousRange } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { lireComparaison } from "../view-state";
import { section, sansSection, type Chargeur } from "./commun";

export const chargerCorrelation = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/correlation");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.filters;
  const query = ecran.query;
  const lecteur = paramReader(sp);
  const prev = lireComparaison("/correlation", lecteur).valeur.mode === "prev";
  const fPrec = { ...f, query: { ...query, range: previousRange(query.range) } };

  const [schema, cartes, couples, concordance, concordancePrec, couverturePrec, spots, fraicheurs, deploys, alertes, quotidien] =
    await Promise.all([
      // Colonnes présentes : ce que `/sessions` sait appliquer (lien « Sessions de cette heure »).
      dimensionSchema(),
      section(() => correlationCards(f)),
      section(() => correlationRoutes(f)),
      section(() => correlationConcordance(f)),
      prev ? section(() => correlationConcordance(fPrec)) : sansSection(null),
      prev ? couverturePrecedente(query, { table: "rum_metric", colonneTemps: "ts", additive: false }) : Promise.resolve(null),
      section(() => blindSpots(f)),
      section(() => syntheticFreshness(f)),
      section(() => listDeploys(f, 20)),
      // Annotations d'alerte (F67) : les 100 derniers déclenchements du périmètre ;
      // la fenêtre et le couple app × route sont appliqués par `annotationsAlertes`.
      section(() => alertEvents(f)),
      // P*.8 : une seule lecture quotidienne pour TOUS les couples (≤ 30 jours par
      // couple, plage bornée par le contrat) ; le ρ de chaque route s'en déduit.
      section(() => correlationQuotidienne(null, null, f)),
    ]);

  // Robot présent ? Sans AUCUN passage sur le périmètre, la série n'est pas lue.
  const robotAbsent = fraicheurs.ok && dernierPassage(fraicheurs.data) === null;
  // Le couple du hero (CR7-a).
  const options = couples.ok ? couples.data : [];
  const anglesMortsParRoute = concordance.ok ? concordance.data.anglesMortsParRoute : [];
  const choisi =
    lireSerie(lecteur.get("serie"), options) ??
    serieParDefaut(options, { route: query.filters.route ?? null, anglesMorts: anglesMortsParRoute });
  const [serie, seriePrec] = await Promise.all([
    choisi && !robotAbsent ? section(() => correlationSeries(choisi.app_id, choisi.route, f)) : sansSection<CorrSeriesRow[]>([]),
    choisi && !robotAbsent && prev
      ? section(() => correlationSeries(choisi.app_id, choisi.route, fPrec))
      : sansSection<CorrSeriesRow[]>([]),
  ]);

  return {
    etat: "ok",
    query,
    label: ecran.label,
    bucketLabel: ecran.bucketLabel,
    schema: [...schema].sort(),
    admin: principal?.role === "admin",
    cartes,
    couples,
    concordance,
    concordancePrec,
    couverturePrec,
    spots,
    fraicheurs,
    deploys,
    alertes,
    quotidien,
    choisi,
    serie,
    seriePrec,
  } as const;
}) satisfies Chargeur<unknown>;
