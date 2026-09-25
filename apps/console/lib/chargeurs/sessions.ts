// LE CHARGEUR DE L'ÉCRAN « Sessions » (C3) — `app/sessions/page.tsx`.
//
// Recherche et curseur relus AVANT toute lecture (une saisie refusée ne produit
// pas une liste qui l'ignore ; un curseur étranger n'est pas présenté à
// PostgreSQL) ; la composition de l'écran aussi — un bloc éteint ne lance pas sa
// lecture. Puis chaque bloc a SA section (F02) ; le panneau d'une session (F43),
// demandé par `panel=session:<id>`, est lu EN MÊME TEMPS, garde comprise.
import { BREAKDOWN_PARAM } from "../breakdowns";
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { analyserFiltres } from "../filtres-ecran";
import { listSessions, releaseRechercheParOccurrence, visitStats } from "../queries";
import { listDeploys } from "../queries-deploys";
import {
  engagementStats,
  erreursParSessionCommencee,
  observedVisitorsTrend,
  repartitionSessions,
  samplingSessions,
  visiteursDistincts,
} from "../queries-sessions";
import { paramReader } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { DIMENSIONS_REPARTITION, SOURCE_VISITEURS, disponibiliteRepartition, lireRepartition, type DimensionRepartition } from "../sessions-kpi";
import {
  SESSION_PAGE_SIZE,
  SESSION_SEARCH_FIELD_PARAM,
  SESSION_SEARCH_PARAM,
  SESSION_SEARCH_PROBLEMS,
  parseSessionCursor,
  parseSessionSearch,
  parseSessionSearchField,
} from "../sessions-search";
import { lireComparaison, lireEtatDeVue } from "../view-state";
import { blocsDe, section, sansSection, type Chargeur, type ParametresEcran } from "./commun";
import { lirePanneauSession } from "./panneau-session";

/** Paramètre de pagination : une clé opaque, jamais un numéro de page. */
export const CURSOR_PARAM = "cursor";

const SOURCE_SESSIONS: SourceComparaison = { table: "rum_session", colonneTemps: "started_at", additive: true };
const SOURCE_SESSIONS_TAUX: SourceComparaison = { table: "rum_session", colonneTemps: "started_at", additive: false };
const SOURCE_ERREURS: SourceComparaison = { table: "rum_error", colonneTemps: "ts", additive: false };

/**
 * Ce que l'URL de l'écran demande en plus du contexte commun : la recherche, le
 * curseur, la composition, le panneau. La MÊME fonction pour le chargeur (quoi
 * lire) et la page (quoi afficher).
 */
export function demandeDesSessions(sp: ParametresEcran) {
  const url = paramReader(sp);
  const champ = parseSessionSearchField(url.get(SESSION_SEARCH_FIELD_PARAM));
  const recherche = parseSessionSearch(champ, url.get(SESSION_SEARCH_PARAM));
  const curseur = parseSessionCursor(url.get(CURSOR_PARAM));
  const refus =
    recherche === undefined
      ? SESSION_SEARCH_PROBLEMS[champ]
      : curseur === undefined
        ? "Curseur de pagination invalide : il ne provient pas de cette console."
        : null;
  // La rangée de KPI et le bandeau d'échantillonnage ne sont pas des blocs : ils
  // qualifient tout l'écran.
  const blocs = blocsDe(sp, "/sessions");
  // Seul le panneau d'une SESSION s'ouvre ici (F43).
  const etatVue = lireEtatDeVue("/sessions", url).etat;
  const idPanneau = etatVue.panel?.type === "session" ? etatVue.panel.id : null;
  return { url, champ, recherche, curseur, refus, blocs, liste: blocs.liste && !refus, etatVue, idPanneau };
}

export const chargerSessions = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/sessions");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const { filters: f, query } = ecran;
  const { url, recherche, curseur, blocs, liste, idPanneau } = demandeDesSessions(sp);

  // Comparaison (F06) : aucune par défaut sur un écran d'usage ; `cmp=prev` relit
  // la période précédente, et ses écarts ne s'affichent que si elle est COMPLÈTE.
  const prev = lireComparaison("/sessions", url).valeur.mode === "prev";
  const couvertures = (source: SourceComparaison) =>
    Promise.all(sourcesSousFiltres(query, source).map((s) => couverturePrecedente(query, s)));
  const aucuneCouverture = Promise.resolve<CouverturePrecedente[]>([]);

  const schema = await dimensionSchema();
  const disponibles = DIMENSIONS_REPARTITION.filter((d) => disponibiliteRepartition(d, schema).available);
  const dimension: DimensionRepartition | null = blocs.repartition ? lireRepartition(url.get(BREAKDOWN_PARAM), disponibles) : null;

  // Chaque bloc a SA section (F02, § 3.8) : un bloc en échec dit « Lecture en
  // échec » et les autres restent affichés.
  const [
    rows,
    vs,
    tendance,
    tendancePrec,
    engagementLu,
    engagementPrec,
    visiteursLu,
    visiteursPrec,
    erreursLu,
    erreursPrec,
    repartition,
    deploys,
    releaseParOccurrence,
    echantillonnage,
    couvSessions,
    couvTaux,
    couvErreurs,
    couvVisiteurs,
    panneauLu,
  ] = await Promise.all([
    // Une ligne de plus que la page : c'est ainsi qu'on sait s'il en reste, sans
    // compter toute la population à chaque affichage.
    liste
      ? section(() => listSessions(f, { limit: SESSION_PAGE_SIZE + 1, cursor: curseur ?? null, search: recherche ?? null }))
      : sansSection([]),
    blocs.resume ? section(() => visitStats(f)) : sansSection(null),
    // Sparkline de la tuile, sessions sans identifiant et panneaux du volume : une lecture.
    section(() => observedVisitorsTrend(f)),
    blocs.visiteurs && prev ? section(() => observedVisitorsTrend(f, true)) : sansSection(null),
    section(() => engagementStats(f)),
    prev ? section(() => engagementStats(f, true)) : sansSection(null),
    section(() => visiteursDistincts(query)),
    prev ? section(() => visiteursDistincts(query, true)) : sansSection(null),
    section(() => erreursParSessionCommencee(f)),
    prev ? section(() => erreursParSessionCommencee(f, true)) : sansSection(null),
    dimension ? section(() => repartitionSessions(query, dimension)) : sansSection(null),
    blocs.visiteurs ? section(() => listDeploys(f, 20)) : sansSection([]),
    releaseRechercheParOccurrence(),
    // S7 : la population de l'écran (sessions commencées OU actives) est-elle un
    // échantillon ? Lue quel que soit le choix de blocs : elle qualifie tous.
    section(() => samplingSessions(f)),
    prev ? couvertures(SOURCE_SESSIONS) : aucuneCouverture,
    prev ? couvertures(SOURCE_SESSIONS_TAUX) : aucuneCouverture,
    prev ? couvertures(SOURCE_ERREURS) : aucuneCouverture,
    prev ? couvertures(SOURCE_VISITEURS) : aucuneCouverture,
    // Panneau (F43) : lu en même temps que l'écran, garde comprise — rien de la
    // session n'est lu si son app n'est pas dans ce que l'écran lit.
    idPanneau ? lirePanneauSession(idPanneau, query.scope.effectiveApps) : Promise.resolve(null),
  ]);

  return {
    etat: "ok",
    query,
    label: ecran.label,
    prev,
    schema: [...schema].sort(),
    rows,
    vs,
    tendance,
    tendancePrec,
    engagementLu,
    engagementPrec,
    visiteursLu,
    visiteursPrec,
    erreursLu,
    erreursPrec,
    repartition,
    deploys,
    releaseParOccurrence,
    echantillonnage,
    couvSessions,
    couvTaux,
    couvErreurs,
    couvVisiteurs,
    panneauLu,
  } as const;
}) satisfies Chargeur<unknown>;
