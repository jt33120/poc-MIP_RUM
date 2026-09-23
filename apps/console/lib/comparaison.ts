// Comparaison à la période précédente (F06, plan § 3.2) : la période de référence
// est-elle COMPLÈTE ? Calculé côté serveur, passé aux tuiles et aux séries.
//
// POURQUOI. Un delta « −38 % de pages vues » se lit comme une chute d'audience. Il
// peut tout aussi bien dire que la période précédente n'a été qu'à moitié mesurée :
// purgée par la rétention, antérieure au premier événement de l'app, ou encore en
// cours d'ingestion. Dans ces trois cas l'écart mesure la COLLECTE, pas le site —
// et on ne l'affiche pas. La tuile écrit à la place « période précédente
// incomplète : <raison> ».
//
// Règles, dans l'ordre ; la première qui s'applique gagne :
//   1. rétention      — la période précédente déborde la purge (plage de 30 jours) ;
//   2. début de collecte — le signal (ou sa colonne) commence après son début ;
//   3. retard d'ingestion — compte sur une heure qui se termine maintenant ;
//   4. début de collecte non lu — `inconnue`, jamais `complete` par défaut ;
//   5. sinon `complete`.
import { q } from "./db";
import { DEBUT_SAMPLE_RATE } from "./echantillonnage";
import { filtersOfQuery, type FiltersLike } from "./filters";
import { couvertureRetention, retentionDays } from "./queries-explorer";
import { SANS_RELEASE, type VersionRow } from "./queries-deploys";
import { DATASETS, DATASET_REGISTRY, compileScope } from "./query-compiler";
import { conditionsOf, previousRange, type AnalyticsQuery } from "./query-contract";
import { sqlContext } from "./query-sql";
import type { ModeComparaison } from "./view-state";

export type CouverturePrecedente = {
  etat: "complete" | "partielle" | "inconnue";
  raison: string | null; // obligatoire si etat !== "complete"
  n?: number | null; // effectif de la période précédente (règle d'échantillon faible)
};

/** D'où vient la mesure comparée. */
export interface SourceComparaison {
  table: string; // « rum_metric », « rum_session », « rum_event », « rum_error »…
  colonneTemps: string; // « ts », « started_at »
  colonneRequise?: string; // colonne ajoutée par une migration (ex. « browser », v75)
  additive: boolean; // compte (sensible au retard d'ingestion) ou non
}

/**
 * Tables et colonnes temporelles LISIBLES. Les noms entrent tels quels dans le SQL
 * (un identifiant ne se lie pas) : seule cette liste blanche les y autorise. Le
 * libellé nomme le signal dans la raison affichée.
 */
const SOURCES: Record<string, { colonnesTemps: readonly string[]; libelle: string }> = {
  rum_metric: { colonnesTemps: ["ts"], libelle: "mesures de performance collectées" },
  rum_pageview: { colonnesTemps: ["started_at"], libelle: "pages vues collectées" },
  rum_session: { colonnesTemps: ["started_at", "last_seen_at"], libelle: "sessions collectées" },
  rum_error: { colonnesTemps: ["ts"], libelle: "erreurs collectées" },
  rum_event: { colonnesTemps: ["ts"], libelle: "événements collectés" },
  rum_action: { colonnesTemps: ["ts"], libelle: "actions collectées" },
  // F60 : les tuiles de /tracing (appels API) se comparent à la période précédente.
  rum_span: { colonnesTemps: ["ts"], libelle: "appels tracés collectés" },
};
const IDENTIFIANT = /^[a-z_][a-z0-9_]{0,62}$/;

// `DEBUT_SAMPLE_RATE` vit dans lib/echantillonnage.ts (module pur, sans base) : la
// lecture d'échantillonnage des écrans d'usage (F40) en a besoin sans tirer les
// lectures de comparaison. Réexporté ici pour les appelants existants.
export { DEBUT_SAMPLE_RATE };

/** Un compte sur une fenêtre qui se termine à moins de 5 min d'ici attend encore des lignes. */
const RETARD_INGESTION_MS = 5 * 60_000;
const HEURE_MS = 3_600_000;

function verifierSource(source: SourceComparaison): void {
  const table = SOURCES[source.table];
  if (!table || !table.colonnesTemps.includes(source.colonneTemps)) {
    throw new Error(`source de comparaison non déclarée : ${source.table}.${source.colonneTemps}`);
  }
  if (source.colonneRequise !== undefined && !IDENTIFIANT.test(source.colonneRequise)) {
    throw new Error(`colonne requise invalide : ${source.colonneRequise}`);
  }
}

/**
 * Colonnes de filtre ajoutées par une migration (v75 : navigateur, système,
 * release, environnement, service ; v85 : provenance du pays). Les lignes plus
 * anciennes les portent à NULL : sous un filtre sur l'une d'elles, la période
 * précédente n'est mesurée que depuis que CETTE colonne est collectée.
 *
 * B8 : les dimensions de lecture de la session suivent la même règle — `runtime`
 * (v82), `browser_version` et `os_version` (v75), `net_type` (v53).
 */
const COLONNES_RECENTES: ReadonlySet<string> = new Set([
  "browser",
  "os",
  "release",
  "env",
  "service",
  "geo_source",
  "runtime",
  "browser_version",
  "os_version",
  "net_type",
]);

/**
 * Sources à évaluer pour une rangée sous les filtres actifs : la source elle-même,
 * plus une variante par colonne récente qu'un filtre exige (`colonneRequise`).
 * Sans elle, `debutCollecte` lisait `min(ts)` de toute la table et la période
 * précédente passait « complète » alors que le champ filtré n'y existait pas encore
 * (faux « +100 % »).
 *
 *   - `eq` et `neq` exigent la colonne (`<>` écarte aussi NULL) ; `is_null` non.
 *   - Colonne de la LIGNE : même table, `colonneRequise` = la colonne.
 *   - Colonne de la SESSION sous une table d'occurrences : `debutCollecte` ne joint
 *     pas la session ; on lit donc le début de collecte du champ sur `rum_session`
 *     (`started_at`) — une mesure d'une session n'est pas antérieure à son début.
 *   - Une dimension que la table ne porte pas n'ajoute rien : la lecture refuse ce
 *     filtre ailleurs (`UnsupportedFilterError`).
 *
 * PURE : l'appelant évalue chaque source (`couverturePrecedente`) et la rangée
 * n'a de delta que si toutes sont complètes (`deltasDeLaRangee`).
 */
export function sourcesSousFiltres(query: AnalyticsQuery, source: SourceComparaison): SourceComparaison[] {
  const dataset = DATASETS.find((d) => DATASET_REGISTRY[d].table === source.table);
  const sorties: SourceComparaison[] = [source];
  const vues = new Set<string>();
  for (const condition of conditionsOf(query.filters)) {
    if (condition.operator === "is_null") continue;
    const colonne = dataset ? DATASET_REGISTRY[dataset].dimensions[condition.dimension] : undefined;
    if (!colonne || !COLONNES_RECENTES.has(colonne.column)) continue;
    const derivee: SourceComparaison =
      colonne.on === "row" || source.table === "rum_session"
        ? { ...source, colonneRequise: colonne.column }
        : { table: "rum_session", colonneTemps: "started_at", colonneRequise: colonne.column, additive: source.additive };
    const cle = `${derivee.table}.${derivee.colonneTemps}.${derivee.colonneRequise}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    sorties.push(derivee);
  }
  return sorties;
}

/** Nom du signal dans une raison : la colonne requise quand il y en a une. */
function libelleSignal(source: SourceComparaison): string {
  return source.colonneRequise ? `champ « ${source.colonneRequise} » collecté` : SOURCES[source.table].libelle;
}

const FORMAT_UTC = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Début de collecte d'un signal : `min(colonneTemps)` de la table sur les apps du
 * périmètre (et `colonneRequise is not null` si fournie). Le PÉRIMÈTRE seul, pas les
 * filtres de population : la question est « depuis quand ce signal arrive-t-il »,
 * pas « depuis quand ce segment existe-t-il ». `null` : aucune ligne.
 */
export async function debutCollecte(f: FiltersLike, source: SourceComparaison): Promise<Date | null> {
  verifierSource(source);
  // Un contexte PAR instruction : ses paramètres liés n'appartiennent qu'à elle.
  const sql = await sqlContext(f);
  const perimetre = compileScope(sql.query, "t.app_id", sql.bind);
  const requise = source.colonneRequise ? ` and t.${source.colonneRequise} is not null` : "";
  const [ligne] = await q<{ debut: Date | null }>(
    `select min(t.${source.colonneTemps}) as debut from ${source.table} t where true${perimetre}${requise}`,
    sql.params,
  );
  const debut = ligne?.debut ? new Date(ligne.debut) : null;
  if (debut && source.table === "rum_session" && source.colonneRequise === "sample_rate") {
    const v58 = new Date(DEBUT_SAMPLE_RATE);
    return debut < v58 ? v58 : debut;
  }
  return debut;
}

export interface EntreeCouverture {
  query: AnalyticsQuery;
  source: SourceComparaison;
  /** Résultat de `debutCollecte` ; `"echec"` si la lecture a levé une exception. */
  debut: Date | null | "echec";
  nowMs: number;
  retentionJours: number;
}

/** Règle 1 seule : elle ne demande aucune lecture, et en dispense quand elle s'applique. */
function regleRetention(query: AnalyticsQuery, retentionJours: number, nowMs: number): CouverturePrecedente | null {
  // Les deux périodes bout à bout, rapportées à la purge. Celle-ci compte depuis
  // MAINTENANT, pas depuis la fin de la plage : ancrée sur `range.to`, une plage
  // passée dont la précédente déborde la purge passait la règle, et la règle 2
  // affichait la date de la purge comme un « début de collecte ».
  const deuxPeriodes = { ...query, range: { ...query.range, from: previousRange(query.range).from } };
  if (couvertureRetention(deuxPeriodes, retentionJours, nowMs).status === "complete") return null;
  return {
    etat: "partielle",
    raison: `période précédente hors rétention (${retentionJours} jours) : les données les plus anciennes ont été purgées`,
  };
}

/** Les cinq règles du § 3.2, PURES : testées sans base. */
export function evaluerCouverture({ query, source, debut, nowMs, retentionJours }: EntreeCouverture): CouverturePrecedente {
  const retention = regleRetention(query, retentionJours, nowMs);
  if (retention) return retention;

  const precedente = previousRange(query.range);
  if (debut === null) {
    return { etat: "partielle", raison: "aucune donnée collectée sur le périmètre" };
  }
  if (debut !== "echec" && debut.getTime() > Date.parse(precedente.from)) {
    return { etat: "partielle", raison: `${libelleSignal(source)} depuis le ${FORMAT_UTC.format(debut)} UTC seulement` };
  }

  const to = Date.parse(query.range.to);
  const duree = to - Date.parse(query.range.from);
  if (source.additive && nowMs - to < RETARD_INGESTION_MS && duree <= HEURE_MS) {
    return {
      etat: "partielle",
      raison: "période en cours : les derniers événements arrivent encore ; un delta serait faussement négatif",
    };
  }

  if (debut === "echec") return { etat: "inconnue", raison: "début de collecte non lu" };
  return { etat: "complete", raison: null };
}

/**
 * Couverture de la période précédente d'une requête, pour une source. `options`
 * ne sert qu'aux tests (horloge, rétention) : en production, l'heure du serveur et
 * `RETENTION_DAYS`.
 */
export async function couverturePrecedente(
  query: AnalyticsQuery,
  source: SourceComparaison,
  options: { nowMs?: number; retentionJours?: number } = {},
): Promise<CouverturePrecedente> {
  verifierSource(source);
  const retentionJours = options.retentionJours ?? retentionDays();
  const nowMs = options.nowMs ?? Date.now();
  // Hors rétention, inutile de lire quoi que ce soit : la réponse est connue.
  const retention = regleRetention(query, retentionJours, nowMs);
  if (retention) return retention;
  let debut: Date | null | "echec";
  try {
    debut = await debutCollecte(filtersOfQuery(query), source);
  } catch {
    debut = "echec";
  }
  return evaluerCouverture({ query, source, debut, nowMs, retentionJours });
}

/**
 * Deltas d'une rangée de tuiles : seulement en `cmp=prev`, et seulement si TOUTES
 * les couvertures de la rangée sont complètes. Sinon la raison, telle que la tuile
 * l'écrit (§ 4.2, `KpiTile`) ; hors `prev`, ni delta ni raison.
 */
export function deltasDeLaRangee(
  mode: ModeComparaison,
  couvertures: readonly CouverturePrecedente[],
): { deltas: boolean; note: string | null } {
  if (mode !== "prev") return { deltas: false, note: null };
  const incomplete = couvertures.find((c) => c.etat !== "complete");
  if (!incomplete) return { deltas: true, note: null };
  return { deltas: false, note: `période précédente incomplète : ${incomplete.raison ?? "raison non lue"}` };
}

/**
 * Releases qu'on peut comparer : celles qui portent un libellé. Le groupe « (non
 * renseignée) » agrège les mesures SANS release — ce n'est pas une release, et
 * `release=(non renseignée)` filtrerait un libellé que personne n'a déclaré.
 */
export function releasesComparables(rows: readonly Pick<VersionRow, "version">[]): string[] {
  return [...new Set(rows.map((r) => r.version).filter((v) => v !== SANS_RELEASE))];
}
