// Lecture des issues d'erreurs (P5.5, migration-v72). Même base filtrée et même
// photographie que les groupes historiques (queries-errors.ts) : une issue et le
// groupe qu'elle remplace ne peuvent pas afficher deux nombres pour les mêmes
// occurrences.
//
// UNE LIGNE, UNE ENTRÉE. Dans la liste, chaque occurrence compte une fois : dans
// son issue (rattachée à l'ingestion, ou par l'alias UNIQUE de son empreinte), ou
// dans son groupe historique quand aucune issue ne la reprend — lignes antérieures
// à l'activation, empreinte répartie sur plusieurs issues, app non activée.
//
// LECTURE SEULE. Statut, assignation, commentaires et liens se modifient en P5.6 ;
// ici la console et l'API lisent l'état initialisé à l'ingestion.
import { q } from "./db";
import { parsePagination } from "./api/pagination";
import { queryOf } from "./filters";
import { resourceScope } from "./query-contract";
import {
  IMPACT_SQL,
  enrichmentOf,
  errorBase,
  errorSchema,
  exemplarSql,
  occurrencesSql,
  samplingOf,
  snapshot,
  toOccurrenceRow,
  totalsSql,
  bucketSql,
  trendSql,
  encodeErrorCursor,
  type ErrorBase,
  type ErrorEnrichment,
  type ErrorExemplar,
  type ErrorFilters,
  type ErrorGroupRef,
  type ErrorImpact,
  type ErrorOccurrenceRow,
  type ErrorSampling,
  type ErrorSchema,
  type ErrorSource,
  type ErrorTotals,
  type ErrorTrendPoint,
  type OccurrenceSqlRow,
  type TotalsSqlRow,
  ERROR_SOURCES,
} from "./queries-errors";
import { ISSUE_STATUSES, type IssueStatus, type GroupingBasis, type IssueOrigin } from "./issues-libelles";
// Les taxonomies et leurs libellés vivent dans `issues-libelles.ts`, SANS la base ;
// réexportées ici pour les lectures et l'API.
export * from "./issues-libelles";

export const ISSUE_LIST_DEFAULT_LIMIT = 50;
export const ISSUE_LIST_MAX_LIMIT = 100;
const RELEASE_PARAM = /^[^\u0000-\u001f\u007f]{1,200}$/u;
const ISSUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REF_PARAM = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|legacy:[^\u0000-\u001f\u007f]{1,64})$/u;

// ───────────────────────────── Paramètres d'URL ──────────────────────────────

export function isIssueId(v: string): boolean {
  return ISSUE_ID.test(v);
}

/** `null` : pas de filtre ; `undefined` : valeur hors contrat, à refuser. */
export function parseIssueStatus(v: string | null): IssueStatus | null | undefined {
  if (v === null || v === "" || v === "all") return null;
  return ISSUE_STATUSES.find((s) => s === v);
}

export function parseIssueSource(v: string | null): ErrorSource | null | undefined {
  if (v === null || v === "" || v === "all") return null;
  return ERROR_SOURCES.find((s) => s === v);
}

export function parseIssueRelease(v: string | null): string | null | undefined {
  if (v === null || v === "") return null;
  return RELEASE_PARAM.test(v) ? v : undefined;
}

export function parseIssueListPage(sp: URLSearchParams): { limit: number } {
  const { limit } = parsePagination(sp, ISSUE_LIST_DEFAULT_LIMIT, ISSUE_LIST_MAX_LIMIT);
  return { limit: limit || ISSUE_LIST_DEFAULT_LIMIT };
}

/**
 * Curseur de la liste : la clé de tri complète de la dernière entrée lue, en
 * base64url d'un JSON. `last_seen_us` est l'entier de microsecondes calculé par
 * PostgreSQL et transporté en chaîne : un passage par `Date` perdrait les
 * microsecondes et ferait sauter ou répéter une entrée.
 */
export interface IssueCursor {
  rank: number;
  visitors: number;
  sessions: number;
  occurrences: number;
  last_seen_us: string;
  app_id: string;
  ref: string;
}

export function encodeIssueCursor(c: IssueCursor): string {
  return Buffer.from(
    JSON.stringify([c.rank, c.visitors, c.sessions, c.occurrences, c.last_seen_us, c.app_id, c.ref]),
    "utf8",
  ).toString("base64url");
}

/** `null` : pas de curseur ; `undefined` : curseur invalide, à refuser. */
export function parseIssueCursor(v: string | null): IssueCursor | null | undefined {
  if (v === null || v === "") return null;
  if (v.length > 512) return undefined;
  try {
    const brut: unknown = JSON.parse(Buffer.from(v, "base64url").toString("utf8"));
    if (!Array.isArray(brut) || brut.length !== 7) return undefined;
    const [rank, visitors, sessions, occurrences, lastSeenUs, appId, ref] = brut;
    const entier = (n: unknown, min: number) => Number.isSafeInteger(n) && (n as number) >= min;
    if (!entier(rank, 0) || (rank as number) > 4 || !entier(visitors, -1) || !entier(sessions, -1) || !entier(occurrences, 0)) return undefined;
    if (typeof lastSeenUs !== "string" || !/^-?\d{1,19}$/.test(lastSeenUs)) return undefined;
    if (typeof appId !== "string" || !appId || appId.length > 200 || /[\u0000-\u001f\u007f]/.test(appId)) return undefined;
    if (typeof ref !== "string" || !REF_PARAM.test(ref)) return undefined;
    return { rank, visitors, sessions, occurrences, last_seen_us: lastSeenUs, app_id: appId, ref } as IssueCursor;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────── Activation ──────────────────────────────────

export interface GroupingState {
  /** migration-v72 appliquée. */
  available: boolean;
  /** Apps du périmètre dont les nouvelles occurrences sont rattachées à une issue. */
  active_apps: string[];
}

/**
 * Où le regroupement v2 est-il actif ? Relu à chaque écran, comme la sonde de
 * schéma : une activation ou un retour arrière se voient sans redémarrage.
 * `apps` borne la lecture au périmètre du principal (`[]` = aucun accès) ; `schema`
 * évite de rejouer une sonde que l'appelant vient de faire.
 */
export async function groupingState(apps: string[] | null, schema?: ErrorSchema): Promise<GroupingState> {
  if (apps?.length === 0) return { available: false, active_apps: [] };
  const { v72 } = schema ?? (await errorSchema());
  if (!v72) return { available: false, active_apps: [] };
  const rows = await q<{ app_id: string }>(
    `select app_id from error_grouping_config
      where active_version = 2 and ($1::text[] is null or app_id = any($1::text[]))
      order by app_id`,
    [apps],
  );
  return { available: true, active_apps: rows.map((r) => r.app_id) };
}

/** La liste /errors passe aux issues quand l'app choisie — ou une app du périmètre « toutes » — est activée. */
export function issueModeFor(state: GroupingState, app: string | null): boolean {
  return state.available && (app ? state.active_apps.includes(app) : state.active_apps.length > 0);
}

// ────────────────────────────────── Liste ────────────────────────────────────

export interface IssueListFilters {
  status: IssueStatus | null;
  release: string | null;
  source: ErrorSource | null;
}

interface IssueEntryCommon extends ErrorImpact {
  app_id: string;
  error_type: string | null;
  sample_message: string | null;
  status: IssueStatus;
  /** Résolue puis revue depuis : réapparition à vérifier, jamais une régression confirmée. */
  reappeared: boolean;
  resolved_at: Date | null;
  /** Issue : première vue persistée ; groupe historique : première apparition connue. */
  first_seen: Date;
  last_seen: Date;
  /** Avec `opts.overview` : occurrences par seau, mêmes seaux que `trend`. */
  series?: number[];
}

export interface IssueEntryIssue extends IssueEntryCommon {
  kind: "issue";
  id: string;
  origin: IssueOrigin;
  grouping_basis: GroupingBasis;
  first_release: string | null;
  last_release: string | null;
  /** bigint PostgreSQL sérialisé en chaîne. */
  revision: string;
}

export interface IssueEntryLegacy extends IssueEntryCommon {
  kind: "legacy";
  fingerprint: string;
}

export type IssueEntry = IssueEntryIssue | IssueEntryLegacy;

export interface IssueCoverage {
  grouping_version: 2;
  /** migration-v72 appliquée ; sans elle, toutes les entrées sont des groupes historiques. */
  available: boolean;
  active_apps: string[];
  issues: number;
  legacy_groups: number;
  occurrences_in_issues: number;
  occurrences_legacy: number;
  occurrences_low_confidence: number;
  /** Part des occurrences rattachées à une issue ; null sans occurrence. */
  issue_share: number | null;
}

export interface IssueListResult {
  issues: IssueEntry[];
  total: number;
  next_cursor: string | null;
  sampling: ErrorSampling;
  coverage: IssueCoverage;
  enrichment: ErrorEnrichment;
  /** Avec `opts.overview` (écran) : totaux de population et tendance. */
  totals?: ErrorTotals;
  trend?: ErrorTrendPoint[];
}

interface EntrySqlRow extends ErrorImpact {
  app_id: string;
  issue_ref: string | null;
  legacy_fingerprint: string | null;
  error_type: string | null;
  sample_message: string | null;
  origin: IssueOrigin | null;
  grouping_basis: GroupingBasis | null;
  first_release: string | null;
  last_release: string | null;
  revision: string | null;
  first_seen: Date;
  last_seen: Date;
  status: IssueStatus;
  resolved_at: Date | null;
  reappeared: boolean;
  rank: number;
  ref: string;
  last_seen_us: string;
}

/**
 * Entrées de la population : une par issue et une par groupe historique non
 * attribué, avec leur statut. `k` porte la clé de tri complète ; le filtre de
 * statut s'applique à l'entrée, jamais aux lignes (il ne change pas les nombres
 * d'une issue affichée). Sans migration-v72, la table des issues n'existe pas :
 * ses colonnes sont des NULL typés et chaque entrée est un groupe historique.
 */
function entriesSql(base: ErrorBase, status: IssueStatus | null, v72: boolean): string {
  const statut = base.bind(status);
  const issue = v72
    ? {
        colonnes: "i.id as issue_id, i.origin, i.grouping_basis, i.first_release, i.last_release, i.revision::text as revision, i.first_seen as issue_first_seen, i.last_seen as issue_last_seen, i.status as issue_status, i.resolved_at as issue_resolved_at",
        jointure: "left join error_issue i on i.app_id = g.app_id and i.id = g.issue_ref",
      }
    : {
        colonnes: "null::uuid as issue_id, null::text as origin, null::text as grouping_basis, null::text as first_release, null::text as last_release, null::text as revision, null::timestamptz as issue_first_seen, null::timestamptz as issue_last_seen, null::text as issue_status, null::timestamptz as issue_resolved_at",
        jointure: "",
      };
  return `${base.sql}, g as (
    select app_id, issue_ref,
           case when issue_ref is null then fingerprint end as legacy_fingerprint,
           max(error_type) as error_type, max(message) as sample_message,
           ${IMPACT_SQL},
           min(ts) as window_first_seen, max(ts) as window_last_seen,
           min(inclusion_probability) as min_inclusion_probability,
           coalesce(sum(occurrences) filter (where grouping_basis = 'low_confidence'), 0)::float8 as low_confidence_occurrences
      from filtered_errors
     where issue_ref is not null or fingerprint is not null
     group by 1, 2, 3
  ), ${base.origine}, gi as (
    select g.*, ${issue.colonnes}
      from g
      ${issue.jointure}
  ), e as (
    select gi.*,
           coalesce(gi.issue_first_seen, o.first_seen, gi.window_first_seen) as first_seen,
           coalesce(gi.issue_last_seen, gi.window_last_seen) as last_seen,
           coalesce(gi.issue_status, case when st.status in ('resolved', 'ignored') then st.status else 'open' end) as status,
           case when gi.issue_id is not null then gi.issue_resolved_at else st.resolved_at end as resolved_at
      from gi
      left join origine o on gi.issue_ref is null and o.app_id = gi.app_id and o.fingerprint = gi.legacy_fingerprint
      left join error_status st on gi.issue_ref is null and st.app_id = gi.app_id and st.fingerprint = gi.legacy_fingerprint
  ), k as (
    select e.*,
           coalesce(e.status = 'resolved' and e.last_seen > e.resolved_at, false) as reappeared,
           case when e.status = 'for_review' then 0
                when e.status = 'resolved' and e.last_seen > e.resolved_at then 1
                when e.status = 'open' then 2
                when e.status = 'resolved' then 3
                else 4 end as rank,
           coalesce(e.issue_ref::text, 'legacy:' || e.legacy_fingerprint) as ref,
           (extract(epoch from e.last_seen) * 1000000)::bigint::text as last_seen_us
      from e
     where (${statut}::text is null or e.status = ${statut}::text)
  )`;
}

/**
 * Tri de triage : à revoir, réapparitions, ouvertes, résolues, ignorées ; puis
 * impact (visiteurs, sessions, occurrences) et récence. Un impact inconnu passe
 * après un impact mesuré. Le départage (app, référence) rend l'ordre total, donc
 * le curseur exact.
 */
const TRI = `rank, -coalesce(visitors_affected, -1), -coalesce(sessions_affected, -1), -occurrences,
             -(last_seen_us::bigint), app_id, ref`;

function toEntry(row: EntrySqlRow): IssueEntry {
  const commun = {
    app_id: row.app_id,
    error_type: row.error_type,
    sample_message: row.sample_message,
    occurrences: row.occurrences,
    sessions_affected: row.sessions_affected,
    visitors_affected: row.visitors_affected,
    identified_users_affected: row.identified_users_affected,
    session_coverage: row.session_coverage,
    identity_coverage: row.identity_coverage,
    status: row.status,
    reappeared: row.reappeared,
    resolved_at: row.resolved_at,
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  };
  return row.issue_ref
    ? {
        kind: "issue",
        id: row.issue_ref,
        ...commun,
        origin: row.origin ?? "new",
        grouping_basis: row.grouping_basis ?? "low_confidence",
        first_release: row.first_release,
        last_release: row.last_release,
        revision: row.revision ?? "1",
      }
    : { kind: "legacy", fingerprint: row.legacy_fingerprint ?? "", ...commun };
}

interface SummarySqlRow {
  total: number;
  issues: number;
  legacy_groups: number;
  occurrences_in_issues: number;
  occurrences_legacy: number;
  occurrences_low_confidence: number;
  min_inclusion_probability: number | null;
}

interface EntrySeriesSqlRow {
  ref: string;
  bucket: Date;
  occurrences: number;
}

/**
 * Issues et groupes historiques de la fenêtre, triés pour le triage, paginés par
 * curseur. `opts.apps` borne au périmètre d'un principal scopé ; `opts.overview`
 * ajoute totaux, tendance et séries par entrée pour l'écran.
 */
export async function listIssues(
  f: ErrorFilters,
  filters: IssueListFilters,
  page: { limit: number; cursor: IssueCursor | null },
  opts: { apps?: string[] | null; overview?: boolean } = {},
): Promise<IssueListResult> {
  const schema = await errorSchema();
  const { v69, v72 } = schema;
  // Requête résolue UNE fois : entrées, synthèse, totaux et tendance partagent le même `to`.
  const query = queryOf(f);
  const { range, scope } = query;
  f = { ...f, query };
  const state = await groupingState(opts.apps ?? null, schema);
  const restriction = { apps: opts.apps ?? null, release: filters.release, source: filters.source, issues: { v72 } };
  return snapshot(async (lire) => {
    const entriesBase = errorBase(f, schema, restriction);
    const curseur = page.cursor
      ? ` where (${TRI}) > (${entriesBase.bind(page.cursor.rank)}::int, ${entriesBase.bind(-page.cursor.visitors)}::float8,
                    ${entriesBase.bind(-page.cursor.sessions)}::float8, ${entriesBase.bind(-page.cursor.occurrences)}::float8,
                    -(${entriesBase.bind(page.cursor.last_seen_us)}::bigint), ${entriesBase.bind(page.cursor.app_id)}::text,
                    ${entriesBase.bind(page.cursor.ref)}::text)`
      : "";
    const rows = await lire<EntrySqlRow>(
      `${entriesSql(entriesBase, filters.status, v72)}
       select * from k${curseur}
        order by ${TRI}
        limit ${entriesBase.bind(page.limit)}`,
      entriesBase.params,
    );

    const summaryBase = errorBase(f, schema, restriction);
    const [summary] = await lire<SummarySqlRow>(
      `${entriesSql(summaryBase, null, v72)}
       select count(*) filter (where ${summaryBase.bind(filters.status)}::text is null or status = ${summaryBase.bind(filters.status)}::text)::float8 as total,
              count(*) filter (where issue_ref is not null)::float8 as issues,
              count(*) filter (where issue_ref is null)::float8 as legacy_groups,
              coalesce(sum(occurrences) filter (where issue_ref is not null), 0)::float8 as occurrences_in_issues,
              coalesce(sum(occurrences) filter (where issue_ref is null), 0)::float8 as occurrences_legacy,
              coalesce(sum(low_confidence_occurrences), 0)::float8 as occurrences_low_confidence,
              min(min_inclusion_probability) as min_inclusion_probability
         from k`,
      summaryBase.params,
    );

    let issues = rows.map(toEntry);
    let totals: ErrorTotals | undefined;
    let trend: ErrorTrendPoint[] | undefined;
    if (opts.overview) {
      const totalsBase = errorBase(f, schema, restriction);
      const totalsRows = await lire<TotalsSqlRow>(totalsSql(totalsBase), totalsBase.params);
      const trendBase = errorBase(f, schema, restriction);
      trend = await lire<ErrorTrendPoint>(trendSql(trendBase, range), trendBase.params);
      const population = totalsRows.find((row) => !row.unfingerprinted_rows);
      totals = {
        occurrences: population?.occurrences ?? 0,
        sessions_affected: population?.sessions_affected ?? null,
        visitors_affected: population?.visitors_affected ?? null,
        identified_users_affected: population?.identified_users_affected ?? null,
        session_coverage: population?.session_coverage ?? null,
        identity_coverage: population?.identity_coverage ?? null,
        groups: (summary?.issues ?? 0) + (summary?.legacy_groups ?? 0),
        unfingerprinted: totalsRows.find((row) => row.unfingerprinted_rows)?.occurrences ?? 0,
      };
      if (rows.length) {
        const seriesBase = errorBase(f, schema, restriction);
        const refs = seriesBase.bind(rows.map((r) => r.ref));
        const points = await lire<EntrySeriesSqlRow>(
          `${seriesBase.sql}
           select coalesce(issue_ref::text, 'legacy:' || fingerprint) as ref,
                  ${bucketSql(range, "ts")} as bucket, sum(occurrences)::float8 as occurrences
             from filtered_errors
            where coalesce(issue_ref::text, 'legacy:' || fingerprint) = any(${refs}::text[])
            group by 1, 2`,
          seriesBase.params,
        );
        issues = withEntrySeries(issues, rows, trend, points);
      }
    }

    const occurrences = (summary?.occurrences_in_issues ?? 0) + (summary?.occurrences_legacy ?? 0);
    const derniere = rows.length === page.limit ? rows.at(-1) : undefined;
    return {
      issues,
      total: summary?.total ?? 0,
      next_cursor: derniere ? encodeIssueCursor(cursorOf(derniere)) : null,
      sampling: samplingOf(summary?.min_inclusion_probability),
      coverage: {
        grouping_version: 2,
        available: state.available,
        // Une app demandée ne rend compte que d'elle-même.
        active_apps: scope.requestedApp
          ? state.active_apps.filter((app) => app === scope.requestedApp)
          : state.active_apps,
        issues: summary?.issues ?? 0,
        legacy_groups: summary?.legacy_groups ?? 0,
        occurrences_in_issues: summary?.occurrences_in_issues ?? 0,
        occurrences_legacy: summary?.occurrences_legacy ?? 0,
        occurrences_low_confidence: summary?.occurrences_low_confidence ?? 0,
        issue_share: occurrences > 0 ? (summary?.occurrences_in_issues ?? 0) / occurrences : null,
      },
      enrichment: enrichmentOf(v69),
      ...(opts.overview ? { totals, trend } : {}),
    };
  });
}

function cursorOf(row: EntrySqlRow): IssueCursor {
  return {
    rank: row.rank,
    visitors: row.visitors_affected ?? -1,
    sessions: row.sessions_affected ?? -1,
    occurrences: row.occurrences,
    last_seen_us: row.last_seen_us,
    app_id: row.app_id,
    ref: row.ref,
  };
}

function withEntrySeries(
  entries: IssueEntry[],
  rows: EntrySqlRow[],
  trend: ErrorTrendPoint[],
  points: EntrySeriesSqlRow[],
): IssueEntry[] {
  const position = new Map(trend.map((point, i) => [point.bucket.getTime(), i]));
  const series = new Map(rows.map((row) => [row.ref, new Array<number>(trend.length).fill(0)]));
  for (const point of points) {
    const values = series.get(point.ref);
    const i = position.get(point.bucket.getTime());
    if (values && i !== undefined) values[i] += point.occurrences;
  }
  return entries.map((entry, i) => ({ ...entry, series: series.get(rows[i].ref) }));
}

// ────────────────────────────────── Détail ───────────────────────────────────

export interface IssueRecord {
  id: string;
  app_id: string;
  grouping_version: 2;
  grouping_basis: GroupingBasis;
  origin: IssueOrigin;
  status: IssueStatus;
  status_source: "system" | "migration" | "user";
  first_seen: Date;
  last_seen: Date;
  first_release: string | null;
  last_release: string | null;
  resolved_at: Date | null;
  resolved_release: string | null;
  resolved_env: string | null;
  reappeared: boolean;
  /** bigint PostgreSQL sérialisé en chaîne. */
  revision: string;
  created_at: Date;
  updated_at: Date;
}

/** Groupe historique repris par l'issue : son statut au rattachement et aujourd'hui. */
export interface IssueLegacyGroup {
  fingerprint: string;
  /** Statut du groupe au rattachement ; null si l'empreinte n'avait aucune occurrence antérieure. */
  legacy_status: "open" | "resolved" | "ignored" | null;
  legacy_resolved_at: Date | null;
  current_status: "open" | "resolved" | "ignored";
  /** Note de triage historique, relue telle quelle : jamais perdue au basculement. */
  note: string | null;
  /** Issues reprenant la même empreinte (plus d'une : empreinte répartie). */
  issues: number;
  attached_at: Date;
}

export interface IssueDetailResult {
  issue: IssueRecord;
  error_type: string | null;
  sample_message: string | null;
  impact: ErrorImpact;
  trend: ErrorTrendPoint[];
  last_sample: ErrorExemplar | null;
  occurrences: ErrorOccurrenceRow[];
  next_cursor: string | null;
  sampling: ErrorSampling;
  enrichment: ErrorEnrichment;
  legacy_groups: IssueLegacyGroup[];
  /** Le regroupement v2 est-il encore actif pour l'app ? (false après un retour arrière). */
  grouping_active: boolean;
}

const ISSUE_COLUMNS = `id, app_id, grouping_version, grouping_basis, origin, status, status_source,
  first_seen, last_seen, first_release, last_release, resolved_at, resolved_release, resolved_env,
  coalesce(status = 'resolved' and last_seen > resolved_at, false) as reappeared,
  revision::text as revision, created_at, updated_at`;

/**
 * L'issue `id`, si elle appartient au périmètre (`apps` null = tous, `[]` = aucun).
 * L'identifiant est un UUID global : l'app de l'issue fait foi, pas celle de l'URL.
 */
export async function resolveIssue(id: string, apps: string[] | null): Promise<IssueRecord | null> {
  if (apps?.length === 0 || !isIssueId(id)) return null;
  if (!(await errorSchema()).v72) return null;
  const [row] = await q<IssueRecord>(
    `select ${ISSUE_COLUMNS} from error_issue where id = $1 and ($2::text[] is null or app_id = any($2::text[]))`,
    [id, apps],
  );
  return row ?? null;
}

interface ImpactSqlRow extends ErrorImpact {
  error_type: string | null;
  sample_message: string | null;
  min_inclusion_probability: number | null;
}

/**
 * Détail d'une issue résolue : impact, tendance, dernier exemplaire et occurrences
 * sur la fenêtre et les filtres, dans une photographie. Une issue sans occurrence
 * sur la fenêtre reste lisible — son URL ne casse pas quand le bug se tait.
 */
export async function issueDetail(
  issue: IssueRecord,
  f: ErrorFilters,
  page: { limit: number; cursor: { ts: string; id: string } | null },
): Promise<IssueDetailResult> {
  const schema = await errorSchema();
  const { v69 } = schema;
  // L'identifiant fait foi : les chiffres viennent de l'app de l'issue, dans les apps autorisées.
  const query = resourceScope(queryOf(f), issue.app_id);
  const scoped: ErrorFilters = { ...f, app: issue.app_id, query };
  const restriction = { issues: { v72: true }, issueId: issue.id };
  return snapshot(async (lire) => {
    const [actif] = await lire<{ active: boolean }>(
      "select exists(select 1 from error_grouping_config where app_id = $1 and active_version = 2) as active",
      [issue.app_id],
    );
    const legacy = await lire<IssueLegacyGroup>(
      `select a.legacy_fingerprint as fingerprint, a.legacy_status, a.legacy_resolved_at, a.created_at as attached_at,
              case when st.status in ('resolved', 'ignored') then st.status else 'open' end as current_status,
              st.note,
              (select count(*) from error_issue_alias b
                where b.app_id = a.app_id and b.legacy_fingerprint = a.legacy_fingerprint)::int as issues
         from error_issue_alias a
         left join error_status st on st.app_id = a.app_id and st.fingerprint = a.legacy_fingerprint
        where a.app_id = $1 and a.issue_id = $2
        order by a.created_at, a.legacy_fingerprint
        limit 50`,
      [issue.app_id, issue.id],
    );
    const impactBase = errorBase(scoped, schema, restriction);
    const [impact] = await lire<ImpactSqlRow>(
      `${impactBase.sql}
       select max(error_type) as error_type, max(message) as sample_message, ${IMPACT_SQL},
              min(inclusion_probability) as min_inclusion_probability
         from filtered_errors`,
      impactBase.params,
    );
    const trendBase = errorBase(scoped, schema, restriction);
    const trend = await lire<ErrorTrendPoint>(trendSql(trendBase, query.range), trendBase.params);
    const exemplarBase = errorBase(scoped, schema, restriction);
    const [last] = await lire<ErrorExemplar>(exemplarSql(exemplarBase), exemplarBase.params);
    const occurrencesBase = errorBase(scoped, schema, { ...restriction, cursor: page.cursor });
    const rows = await lire<OccurrenceSqlRow>(
      `${occurrencesSql(occurrencesBase)}
       limit ${occurrencesBase.bind(page.limit)}`,
      occurrencesBase.params,
    );
    const derniere = rows.length === page.limit ? rows.at(-1) : undefined;
    return {
      issue,
      error_type: impact?.error_type ?? null,
      sample_message: impact?.sample_message ?? null,
      impact: {
        occurrences: impact?.occurrences ?? 0,
        sessions_affected: impact?.sessions_affected ?? null,
        visitors_affected: impact?.visitors_affected ?? null,
        identified_users_affected: impact?.identified_users_affected ?? null,
        session_coverage: impact?.session_coverage ?? null,
        identity_coverage: impact?.identity_coverage ?? null,
      },
      trend,
      last_sample: last ?? null,
      occurrences: rows.map(toOccurrenceRow),
      next_cursor: derniere ? encodeErrorCursor(derniere) : null,
      sampling: samplingOf(impact?.min_inclusion_probability),
      enrichment: enrichmentOf(v69),
      legacy_groups: legacy,
      grouping_active: actif?.active === true,
    };
  });
}

// ─────────────────────────── Anciennes URL de groupe ─────────────────────────

export interface LegacyIssueTarget {
  id: string;
  status: IssueStatus;
  grouping_basis: GroupingBasis;
  last_seen: Date;
}

/**
 * Issues qui reprennent un groupe historique, quand le regroupement v2 est ACTIF
 * pour son app ; `null` sinon (schéma antérieur, app non activée ou retour
 * arrière) : l'ancienne URL garde alors son détail historique. Une seule issue :
 * redirection ; plusieurs : choix explicite, jamais un tirage.
 */
export async function legacyIssueTargets(ref: ErrorGroupRef): Promise<LegacyIssueTarget[] | null> {
  if (!(await errorSchema()).v72) return null;
  const rows = await q<LegacyIssueTarget & { active: boolean }>(
    `select c.active_version = 2 as active, i.id, i.status, i.grouping_basis, i.last_seen
       from error_grouping_config c
       left join error_issue_alias a on a.app_id = c.app_id and a.legacy_fingerprint = $2
       left join error_issue i on i.app_id = a.app_id and i.id = a.issue_id
      where c.app_id = $1
      order by i.last_seen desc nulls last, i.id
      limit 20`,
    [ref.app_id, ref.fingerprint],
  );
  if (!rows[0]?.active) return null;
  return rows.filter((r) => r.id).map(({ active: _active, ...target }) => target);
}
