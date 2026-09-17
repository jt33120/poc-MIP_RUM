// Sélecteurs de valeurs de dimension (P6.1) — logique PURE, testée, sans accès base.
//
// Un sélecteur répond à « quelles valeurs de cette dimension existent pour CETTE
// app sur CETTE fenêtre ? », pour alimenter une liste de filtre. Trois garanties :
//
//   1. JAMAIS D'INVENTAIRE TRANSVERSE. Une requête vise exactement une app,
//      vérifiée contre les apps du principal signé AVANT tout SQL : `null` =
//      admin transverse, `[]` = aucun accès. « Toutes les apps » n'est pas une
//      portée de sélecteur : l'union des valeurs de plusieurs tenants révélerait
//      les releases et environnements des uns aux autres.
//   2. « INCONNU » N'EST PAS UNE VALEUR. Les lignes sans dimension sont comptées
//      à part (`unknown`), jamais sous une chaîne qui pourrait aussi être une
//      vraie valeur déclarée ; un filtre « Inconnu » se compile en `is null`.
//   3. BORNÉ. Au plus 100 valeurs, les plus fréquentes, et `truncated` le dit ;
//      la fenêtre est explicite en UTC et ne dépasse pas 30 jours (contrat P6 §2).
//
// Sûreté SQL : tables et colonnes viennent EXCLUSIVEMENT du registre ci-dessous ;
// l'app et les bornes sont des paramètres liés.

/** Qui est compté : des sessions (dimensions du terminal) ou des signaux (dimensions déclarées). */
export type DimensionPopulation = "sessions" | "signaux";

interface DimensionDefinition {
  label: string;
  population: DimensionPopulation;
  /** Colonne de rum_session (sessions) ou de rum_event_index et rum_error (signaux). */
  column: string;
  /** Signaux seulement : familles de la projection qui peuvent porter la dimension. */
  kinds?: readonly string[];
  /** Première migration qui porte la colonne. */
  migration: "v75" | null;
}

/** Registre fermé des dimensions filtrables du contrat P6 (`AnalyticsFilters`). */
export const DIMENSIONS = {
  device: { label: "Appareil", population: "sessions", column: "device_type", migration: null },
  browser: { label: "Navigateur", population: "sessions", column: "browser", migration: "v75" },
  os: { label: "Système", population: "sessions", column: "os", migration: "v75" },
  country: { label: "Pays estimé d'après le fuseau", population: "sessions", column: "geo_country", migration: null },
  env: { label: "Environnement", population: "signaux", column: "env", migration: "v75" },
  // Seuls les spans et les erreurs portent un service ; compter les vues parmi
  // les « services inconnus » noierait le chiffre qui compte.
  service: { label: "Service", population: "signaux", column: "service", kinds: ["error", "span"], migration: "v75" },
  release: { label: "Release", population: "signaux", column: "release", migration: "v75" },
  // Template déjà normalisé et plafonné à l'écriture (migration-v62), jamais l'URL brute.
  route: { label: "Route", population: "signaux", column: "route", migration: null },
} as const satisfies Record<string, DimensionDefinition>;

export type DimensionKey = keyof typeof DIMENSIONS;

export const DIMENSION_VALUES_CAP = 100;
export const DIMENSION_RANGE_MAX_DAYS = 30;

/** Horodatage UTC explicite, précision jusqu'à la microseconde que PostgreSQL conserve. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?Z$/;

/**
 * Instant en microsecondes depuis l'epoch (exact : sous 2^53 jusqu'en 2255), ou
 * null. `Date.parse` accepte un 30 février : la date relue doit être celle écrite.
 */
function microsecondes(iso: string): number | null {
  const m = ISO_UTC.exec(iso);
  const secondes = m ? Date.parse(`${iso.slice(0, 19)}Z`) : Number.NaN;
  if (!m || !Number.isFinite(secondes) || new Date(secondes).toISOString().slice(0, 19) !== iso.slice(0, 19)) return null;
  return secondes * 1000 + Number((m[1] ?? "").padEnd(6, "0"));
}

export interface DimensionValuesInput {
  dimension: string;
  app: string | null | undefined;
  /** Apps du principal signé, jamais transmises par le client : `null` = admin transverse, `[]` = aucun accès. */
  authorizedApps: string[] | null;
  /** Fenêtre `[from, to)` déjà résolue, bornes UTC explicites. */
  range: { from: string; to: string };
  includeBots?: boolean;
}

export interface DimensionValuesRequest {
  dimension: DimensionKey;
  app: string;
  from: string;
  to: string;
  includeBots: boolean;
}

export type DimensionValuesError = "unsupported_dimension" | "app_required" | "app_forbidden" | "invalid_range";

export type DimensionValuesParse =
  | { ok: true; request: DimensionValuesRequest }
  | { ok: false; error: DimensionValuesError };

export function isDimensionKey(value: string): value is DimensionKey {
  return Object.hasOwn(DIMENSIONS, value);
}

/** Valide une demande de sélecteur ; la portée est vérifiée ici, avant toute lecture. */
export function dimensionValuesRequest(input: DimensionValuesInput): DimensionValuesParse {
  if (!isDimensionKey(input.dimension)) return { ok: false, error: "unsupported_dimension" };
  const app = typeof input.app === "string" ? input.app.trim() : "";
  if (!app) return { ok: false, error: "app_required" };
  if (input.authorizedApps !== null && !input.authorizedApps.includes(app)) return { ok: false, error: "app_forbidden" };
  const { from, to } = input.range;
  const debut = typeof from === "string" ? microsecondes(from) : null;
  const fin = typeof to === "string" ? microsecondes(to) : null;
  if (debut === null || fin === null || debut >= fin || fin - debut > DIMENSION_RANGE_MAX_DAYS * 86_400_000_000) {
    return { ok: false, error: "invalid_range" };
  }
  return { ok: true, request: { dimension: input.dimension, app, from, to, includeBots: input.includeBots === true } };
}

/**
 * SQL d'un sélecteur : $1 = app, $2 = début inclus, $3 = fin exclue.
 *
 * Les valeurs connues sont classées par fréquence puis par valeur, et lues une
 * de plus que le plafond pour savoir si la liste est tronquée ; les inconnues
 * forment une seule ligne à part. Signaux : la projection rum_event_index, plus
 * les exceptions dérivées d'un span ou d'un log (P5.3), qu'elle n'indexe pas —
 * les deux ensembles sont disjoints. Une session d'une autre app ne peut ni
 * exclure ni prêter son statut de robot : la recherche est scopée par app.
 *
 * Aucun index dédié : mesuré sur 1,2 M de signaux par app et 7 jours, la lecture
 * passe par (app_id, ts) et un index (app_id, release, ts) n'est pas choisi.
 */
export function dimensionValuesSql(r: DimensionValuesRequest): { text: string; params: unknown[] } {
  const d: DimensionDefinition = DIMENSIONS[r.dimension];
  const kinds = d.kinds ? ` and i.kind in (${d.kinds.map((kind) => `'${kind}'`).join(", ")})` : "";
  const signaux = `select i.app_id, i.session_id, i.${d.column} as valeur
      from rum_event_index i
     where i.app_id = $1 and i.ts >= $2::timestamptz and i.ts < $3::timestamptz${kinds}
    union all
    select e.app_id, e.session_id, e.${d.column}
      from rum_error e
     where e.app_id = $1 and e.ts >= $2::timestamptz and e.ts < $3::timestamptz and e.origin_signal is not null`;
  const observations = d.population === "sessions"
    ? `select s.${d.column} as valeur
         from rum_session s
        where s.app_id = $1 and s.last_seen_at >= $2::timestamptz and s.started_at < $3::timestamptz${r.includeBots ? "" : " and not s.is_bot"}`
    : r.includeBots
      ? `select o.valeur from (${signaux}) o`
      // Anti-jointure sur les seules sessions robots de l'app (index partiel
      // idx_session_is_bot) : un signal sans session (backend) reste compté.
      : `select o.valeur from (${signaux}) o
          where not exists (select 1 from rum_session s where s.app_id = $1 and s.is_bot and s.session_id = o.session_id)`;
  return {
    text: `with valeurs as (
      select valeur, count(*)::float8 as n from (${observations}) obs group by valeur
    )
    (select valeur, n from valeurs where valeur is not null order by n desc, valeur limit ${DIMENSION_VALUES_CAP + 1})
    union all
    (select null, n from valeurs where valeur is null)`,
    params: [r.app, r.from, r.to],
  };
}

export interface DimensionValue {
  value: string;
  count: number;
}

export interface DimensionValues {
  dimension: DimensionKey;
  label: string;
  population: DimensionPopulation;
  /** Colonnes absentes (migration non appliquée) : liste vide, sans erreur. */
  available: boolean;
  /** Au plus DIMENSION_VALUES_CAP valeurs connues, les plus fréquentes d'abord. */
  values: DimensionValue[];
  /** Sessions ou signaux de la fenêtre sans cette dimension. */
  unknown: number;
  truncated: boolean;
}

/** Met en forme les lignes du SQL : plafond, troncature et inconnues séparées. */
export function dimensionValuesFrom(
  r: DimensionValuesRequest,
  rows: Array<{ valeur: string | null; n: number }>,
  available = true,
): DimensionValues {
  const connues = rows.filter((row) => row.valeur !== null);
  const d = DIMENSIONS[r.dimension];
  return {
    dimension: r.dimension,
    label: d.label,
    population: d.population,
    available,
    values: connues.slice(0, DIMENSION_VALUES_CAP).map((row) => ({ value: row.valeur as string, count: Number(row.n) })),
    unknown: Number(rows.find((row) => row.valeur === null)?.n ?? 0),
    truncated: connues.length > DIMENSION_VALUES_CAP,
  };
}
