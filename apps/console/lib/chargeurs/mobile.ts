// LE CHARGEUR DE L'ÉCRAN « Mobile » (C3) — `app/mobile/page.tsx`.
//
// Une sonde de schéma pour tout l'écran (en échec, chaque lecture sonde elle-même),
// puis les sections indépendantes (F02) : tuiles et série dans UNE photographie
// (la somme des seaux est la tuile), la période précédente sous `cmp=prev`, les
// déclarations de capacités sous un filtre de release, les marqueurs de déploiement.
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { filtersOfQuery } from "../filters";
import { analyserFiltres } from "../filtres-ecran";
import {
  RELEASES_AFFICHEES,
  mobileDeclarations,
  mobileDeploiements,
  mobileParRelease,
  mobileResumeEtSerie,
  mobileSchema,
  mobileSummary,
  valeurDe,
} from "../queries-mobile";
import { paramReader, previousRange, type AnalyticsQuery } from "../query-contract";
import { lireComparaison } from "../view-state";
import { mapSection, section, sansSection, type Chargeur } from "./commun";

/** Sessions de la cohorte : leur début de collecte est celui de la colonne `runtime` (v82). */
const SOURCE_SESSIONS: SourceComparaison = {
  table: "rum_session",
  colonneTemps: "started_at",
  colonneRequise: "runtime",
  additive: true,
};
/** Erreurs JS : distinguées par `error_source` (v69). */
const SOURCE_ERREURS: SourceComparaison = {
  table: "rum_error",
  colonneTemps: "ts",
  colonneRequise: "error_source",
  additive: true,
};

/** Couverture de la période précédente d'une source, filtres de colonnes récentes compris : la pire. */
async function couverture(query: AnalyticsQuery, source: SourceComparaison): Promise<CouverturePrecedente> {
  const toutes = await Promise.all(sourcesSousFiltres(query, source).map((s) => couverturePrecedente(query, s)));
  return toutes.find((c) => c.etat !== "complete") ?? toutes[0];
}

/** La requête sans aucune condition de release : pour lire TOUTES les déclarations (vue « Dernière release »). */
function sansRelease(query: AnalyticsQuery): AnalyticsQuery {
  return {
    ...query,
    filters: {
      ...query.filters,
      release: undefined,
      segments: query.filters.segments.filter((c) => c.dimension !== "release"),
    },
  };
}

export const chargerMobile = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/mobile");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const query = ecran.query;
  const f = filtersOfQuery(query);
  const prev = lireComparaison("/mobile", paramReader(sp)).valeur.mode === "prev";
  const precedente = prev ? previousRange(query.range) : null;
  const fPrecedent = precedente ? filtersOfQuery({ ...query, range: precedente }) : null;

  // Une sonde de schéma pour tout l'écran ; en échec, chaque lecture sonde elle-même.
  const schemaLu = await section(() => mobileSchema());
  const schema = schemaLu.ok ? schemaLu.data : undefined;
  const filtreRelease = query.filters.release !== undefined || query.filters.segments.some((c) => c.dimension === "release");

  // Les tuiles et la série « dans le temps » dans UNE photographie : la somme des
  // seaux est la tuile, même si des sessions arrivent pendant la lecture (revue de
  // fin de vague 8). Chaque partie garde sa section : F02 tient toujours.
  const photo = mobileResumeEtSerie(f, schema);
  const [resume, parRelease, resumePrec, parReleasePrec, couvSessions, couvErreurs, declarationsToutes, serieLue, deploysLus] =
    await Promise.all([
      section(async () => valeurDe((await photo).resume)),
      section(() => mobileParRelease(f, RELEASES_AFFICHEES, schema)),
      fPrecedent ? section(() => mobileSummary(fPrecedent, schema)) : sansSection(null),
      fPrecedent ? section(() => mobileParRelease(fPrecedent, RELEASES_AFFICHEES, schema)) : sansSection(null),
      prev ? couverture(query, SOURCE_SESSIONS) : Promise.resolve(null),
      prev ? couverture(query, SOURCE_ERREURS) : Promise.resolve(null),
      filtreRelease && schema?.capabilities !== false
        ? section(() => mobileDeclarations(sansRelease(query)))
        : sansSection(null),
      // F39 : la même cohorte, seau par seau ; les déploiements de la fenêtre en annotations.
      section(async () => valeurDe((await photo).serie)),
      // Les 20 derniers marqueurs du périmètre, chacun rattaché ou non à la cohorte (revue v8).
      section(() => mobileDeploiements(f, schema, 20)),
    ]);

  return {
    etat: "ok",
    query,
    label: ecran.label,
    // Le schéma sans son jeu de dimensions (un `Set` ne voyage pas) : l'écran n'en lit que les capacités.
    schema: mapSection(schemaLu, ({ runtime, capabilities, errorSource }) => ({ runtime, capabilities, errorSource })),
    resume,
    parRelease,
    resumePrec,
    parReleasePrec,
    couvSessions,
    couvErreurs,
    declarationsToutes,
    serieLue,
    deploysLus,
  } as const;
}) satisfies Chargeur<unknown>;
