// Contrat unique de lecture des erreurs (P5.1). Liste, totaux, tendance, séries,
// détail, exemplaire et occurrences partagent UNE base filtrée — app, fenêtre
// [from,to), appareil (tablette comprise), segment, bots, apps internes — et UNE
// photographie PostgreSQL. Avant ce module, la liste, le détail et ses
// occurrences appliquaient chacun leurs propres prédicats : ouvrir une ligne
// pouvait afficher un autre nombre que celui qu'on venait de cliquer.
//
// Les valeurs utilisateur restent des paramètres liés ; seules les périodes et
// largeurs de seau issues de PERIODS sont interpolées dans le SQL.
import { parsePagination } from "./api/pagination";
import type { SessionUser } from "./auth";
import { q, tx } from "./db";
import { PERIODS, parseFilters, type Filters, type PeriodKey, type SearchParams } from "./filters";
import { internalClause } from "./queries";
import { parseEventCursor } from "./queries-events";
import type { ErrorStatus } from "./queries-v2";
import { buildSegment } from "./segments";

export type ErrorDevice = "desktop" | "mobile" | "tablet";
/** Filtres globaux de lib/filters, plus la tablette que le modèle historique ignore. */
export type ErrorFilters = Omit<Filters, "device"> & { device: ErrorDevice | null };

export const ERROR_LIST_DEFAULT_LIMIT = 100;
export const ERROR_LIST_MAX_LIMIT = 200;
export const ERROR_LIST_MAX_OFFSET = 10_000;
export const ERROR_OCCURRENCES_DEFAULT_LIMIT = 100;
export const ERROR_OCCURRENCES_MAX_LIMIT = 100;

// Copie de l'énumération d'ingestion (`ERROR_SOURCES` d'otlp.mjs), même ordre :
// la console ne peut pas typer proprement un module .mjs. Deux listes finissent
// par diverger ; tests/unit/queries-errors.test.ts compare donc les deux.
export const ERROR_SOURCES = [
  "browser_js",
  "browser_console",
  "browser_resource",
  "browser_csp",
  "browser_network",
  "node",
  "python",
  "react_native_js",
  "native",
  "otel",
] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

export const ERROR_SOURCE_LABELS: Record<ErrorSource, string> = {
  browser_js: "JavaScript navigateur",
  browser_console: "Console navigateur",
  browser_resource: "Ressource navigateur",
  browser_csp: "CSP navigateur",
  browser_network: "Réseau navigateur",
  node: "Node.js",
  python: "Python",
  react_native_js: "JavaScript React Native",
  native: "Natif mobile",
  otel: "OpenTelemetry",
};

// ───────────────────────────── Paramètres d'URL ──────────────────────────────

const ERROR_DEVICES: readonly ErrorDevice[] = ["desktop", "mobile", "tablet"];
const FINGERPRINT_PARAM = /^[^\u0000-\u001f\u007f]{1,64}$/u;
// La forme exacte que produit `to_char(… 'US')` : six chiffres de fraction. Une
// valeur à la milliseconde ne vient pas de ce serveur, et l'accepter réintroduirait
// la perte des microsecondes que le curseur existe pour éviter. L'année 0000
// passe `Date.parse` mais PostgreSQL la refuse : une erreur 500 pour un curseur forgé.
const CURSOR_TS = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

// `parsePagination` tronque `limit=0.5` en 0 : une page vide n'est jamais voulue,
// on retombe sur le défaut.
export function parseErrorListPage(sp: URLSearchParams): { limit: number; offset: number } {
  const page = parsePagination(sp, ERROR_LIST_DEFAULT_LIMIT, ERROR_LIST_MAX_LIMIT);
  return {
    limit: page.limit || ERROR_LIST_DEFAULT_LIMIT,
    // Au-delà, l'offset fait trier puis sauter toute la population à chaque page.
    offset: Math.min(page.offset, ERROR_LIST_MAX_OFFSET),
  };
}

export function parseOccurrencesPage(sp: URLSearchParams): { limit: number } {
  const { limit } = parsePagination(sp, ERROR_OCCURRENCES_DEFAULT_LIMIT, ERROR_OCCURRENCES_MAX_LIMIT);
  return { limit: limit || ERROR_OCCURRENCES_DEFAULT_LIMIT };
}

/** Même codec que le curseur d'événements P4 : base64url d'un JSON `[ts, id]`. */
export function encodeErrorCursor(row: { cursor_ts: string; cursor_id: string }): string {
  return Buffer.from(JSON.stringify([row.cursor_ts, row.cursor_id]), "utf8").toString("base64url");
}

/** `null` : pas de curseur ; `undefined` : curseur invalide, à refuser. */
export function parseErrorCursor(v: string | null): { ts: string; id: string } | null | undefined {
  const cursor = parseEventCursor(v);
  if (!cursor) return cursor;
  if (!CURSOR_TS.test(cursor.ts)) return undefined;
  // `Date.parse` accepte un 30 février (reporté au 2 mars) que PostgreSQL rejette :
  // on exige que la date relue soit celle qui a été écrite, à la seconde près.
  const seconde = cursor.ts.slice(0, 19);
  return new Date(`${seconde}Z`).toISOString().startsWith(seconde) ? cursor : undefined;
}

export function isFingerprintParam(v: string): boolean {
  return FINGERPRINT_PARAM.test(v);
}

export function errorDeviceFrom(raw: string | null | undefined): ErrorDevice | null {
  return ERROR_DEVICES.find((device) => device === raw) ?? null;
}

// ─────────────────────────────── Périmètre ───────────────────────────────────

export type ErrorScope = { kind: "all" } | { kind: "apps"; apps: string[] } | { kind: "none" };

export function errorScopeFor(
  principal: { role: "admin" | "viewer"; apps: string[] | null } | null,
): ErrorScope {
  if (!principal) return { kind: "none" };
  if (principal.role === "admin" || principal.apps === null) return { kind: "all" };
  // AD-16 : une liste vide est un accès NUL. `parseFilters(sp, [])` la traiterait
  // comme « sans restriction » et ouvrirait toutes les apps.
  return principal.apps.length ? { kind: "apps", apps: principal.apps } : { kind: "none" };
}

export function scopeApps(scope: ErrorScope): string[] | null {
  if (scope.kind === "all") return null;
  return scope.kind === "apps" ? scope.apps : [];
}

/** Filtres des pages Erreurs, intersectés avec le principal signé ; `null` = aucun accès. */
export function errorPageFilters(sp: SearchParams, user: SessionUser | null): ErrorFilters | null {
  const scope = errorScopeFor(user);
  if (scope.kind === "none") return null;
  const device = Array.isArray(sp.device) ? sp.device[0] : sp.device;
  return { ...parseFilters(sp, scopeApps(scope)), device: errorDeviceFrom(device) };
}

// ─────────────────────── Qui est touché, et qui l'ignore ──────────────────────
//
// Trois populations DISTINCTES, jamais additionnées : sessions, visiteurs
// (identifiant aléatoire du SDK, migration-v57) et utilisateurs identifiés (HMAC
// app-scopé de l'identité métier, P2). Une erreur backend sans session n'a pas
// « zéro utilisateur touché » : elle n'en a AUCUN CONNU. Un compte vaut donc
// NULL quand aucune ligne ne porte l'identifiant, et les couvertures disent quelle
// part des occurrences y est rattachée — 0 quand aucune ne l'est, NULL seulement
// sans occurrence. L'ancienne empreinte de classe d'appareil de rum_session ne
// compte personne : plusieurs visiteurs d'un parc homogène la partagent.
export interface ErrorImpact {
  occurrences: number;
  sessions_affected: number | null;
  visitors_affected: number | null;
  identified_users_affected: number | null;
  session_coverage: number | null;
  identity_coverage: number | null;
}

export interface ErrorGroupRow extends ErrorImpact {
  app_id: string;
  fingerprint: string;
  error_type: string | null;
  sample_message: string | null;
  /** Historique : `sessions_affected`, 0 si inconnu. */
  sessions: number;
  /** Historique : `visitors_affected`, 0 si inconnu (visiteurs distincts, pas identités). */
  users_affected: number;
  first_seen: Date;
  last_seen: Date;
  status: ErrorStatus;
  resolved_at: Date | null;
  /** Une erreur marquée « résolue » réapparaît (last_seen > resolved_at) ; jamais NULL. */
  regressed: boolean;
  /** Avec `opts.series` : occurrences par seau, mêmes seaux et même ordre que `trend`. */
  series?: number[];
}

export interface ErrorTrendPoint {
  bucket: Date;
  occurrences: number;
}

export interface ErrorTotals extends ErrorImpact {
  groups: number;
  unfingerprinted: number;
}

export interface ErrorSampling {
  min_inclusion_probability: number | null;
  message: string | null;
}

export interface ErrorEnrichment {
  available: boolean;
  diagnostic: string | null;
}

export interface ErrorListResult {
  groups: ErrorGroupRow[];
  unfingerprinted: number;
  page: { limit: number; offset: number };
  total: number;
  totals: ErrorTotals;
  trend: ErrorTrendPoint[];
  sampling: ErrorSampling;
  enrichment: ErrorEnrichment;
}

export type ErrorGroupRef = { app_id: string; fingerprint: string };

export interface ErrorGroupCandidate {
  app_id: string;
  occurrences: number;
  last_seen: Date;
}

export type ErrorGroupResolution =
  | { kind: "found"; ref: ErrorGroupRef }
  | { kind: "ambiguous"; candidates: ErrorGroupCandidate[] }
  | { kind: "not_found" };

export interface ErrorExemplar {
  id: number;
  ts: Date;
  message: string | null;
  error_type: string | null;
  kind: string | null;
  stack: string | null;
  source: string | null;
  lineno: number | null;
  colno: number | null;
  route: string | null;
  session_id: string | null;
  release: string | null;
  occurrences: number;
  trace_id: string | null;
  source_parent_span_id: string | null;
  error_source: ErrorSource | null;
  handled: boolean | null;
  is_fatal: boolean | null;
  view_name: string | null;
  env: string | null;
  service: string | null;
  action_id: string | null;
}

export interface ErrorOccurrenceLinks {
  session: boolean;
  replay: boolean;
  trace: boolean;
  parent_span: boolean;
  action: { id: string; name: string | null; type: string | null } | null;
}

export interface ErrorOccurrenceRow {
  id: number;
  ts: Date;
  route: string | null;
  /** Tel qu'émis, même quand aucune session de la même app ne lui correspond. */
  session_id: string | null;
  kind: string | null;
  message: string | null;
  device_type: string | null;
  occurrences: number;
  release: string | null;
  error_source: ErrorSource | null;
  handled: boolean | null;
  is_fatal: boolean | null;
  view_name: string | null;
  env: string | null;
  service: string | null;
  trace_id: string | null;
  source_parent_span_id: string | null;
  links: ErrorOccurrenceLinks;
}

export interface ErrorGroupDetailResult {
  group: ErrorGroupRow;
  last: ErrorExemplar | null;
  occurrences: ErrorOccurrenceRow[];
  trend: ErrorTrendPoint[];
  page: { limit: number; next_cursor: string | null };
  sampling: ErrorSampling;
  enrichment: ErrorEnrichment;
}

// ════════════ Les compteurs d'un groupe d'erreurs, BORNÉS PAR LA FENÊTRE ═══════
//
// CE QUI ÉTAIT FAUX (finding 1.1 de docs/AUDIT_RUM_EXTERNE.md). La liste lisait
// `v_error_group_ext`, une vue SANS AUCUNE BORNE TEMPORELLE. La tuile de l'écran
// annonçait « Occurrences · 1 h » et affichait le total depuis la première
// ingestion. Un exploitant qui basculait 7 j → 24 h → 1 h voyait LE MÊME NOMBRE
// et en concluait que rien ne se calmait. Le tri, sur ce même total cumulé,
// plaçait un bug corrigé il y a deux semaines devant la régression du jour.
//
// ─────────── POURQUOI PAS L'AGRÉGAT HORAIRE QUE PROPOSAIT L'AUDIT ─────────────
//
// Le plan recommandait une table `error_group_hourly (app_id, fingerprint, hour,
// occurrences, sessions, visitors)`, « sommable sur n'importe quelle fenêtre ».
// Elle ne l'est pas. `occurrences` est une somme, donc sommable ; `sessions` et
// `visitors` sont des comptages de DISTINCTS, et une session à cheval sur deux
// heures apparaît dans les deux seaux. Mesuré sur une base réelle — une personne,
// une session, un bug rencontré trois fois en trois heures :
//
//     somme des seaux horaires : 3 occurrences, 3 sessions, 3 visiteurs
//     vérité sur la fenêtre    : 3 occurrences, 1 session,  1 visiteur
//
// On aurait remplacé un sur-comptage DANS LE TEMPS par un sur-comptage DES
// DISTINCTS — et précisément sur la mesure dont l'audit veut faire le critère de
// tri (« impact réel »). Trier sur un impact gonflé serait pire que trier sur le
// volume. On retient donc l'autre option du même rapport : une source paramétrée
// par la fenêtre, exacte pour tous les compteurs. Les totaux de population sont
// calculés de même, sur les lignes, jamais en additionnant les groupes : un
// visiteur touché par deux groupes reste un visiteur.
//
// ────────────────────────── CE QUE ÇA COÛTE, MESURÉ ──────────────────────────
//
// Mesuré quand cette source a été bornée, sur 500 000 erreurs / 2 000 signatures
// / 40 000 sessions réparties sur 30 jours — bien au-delà du volume réel —,
// médiane de cinq exécutions :
//
//     1 h             52 ms
//     24 h (défaut)   99 ms
//     7 j (maximum)  194 ms
//
// `PERIODS` (lib/filters.ts) n'expose QUE ces trois fenêtres : il n'existe pas
// de cas plus large à optimiser. AUCUN INDEX N'A ÉTÉ AJOUTÉ — un candidat
// `(app_id, fingerprint, ts)` a été construit et mesuré, le planificateur ne
// l'a jamais choisi (0 scan) et les temps étaient identiques à 5 ms près. Un
// index inutile se paie à chaque écriture sur la table la plus chaude du
// système.
//
// LE VRAI PIÈGE EST LA MATÉRIALISATION DES CTE. Tant que `origine` référençait
// `fenetre` (la population bornée, aujourd'hui `filtered_errors`), PostgreSQL
// matérialisait cette dernière — et une CTE matérialisée perd le parallélisme :
// 24 h passait de 99 ms à 287 ms. Les CTE sont donc délibérément INDÉPENDANTES,
// jointes seulement à la fin. C'est la raison pour laquelle `origine` refait son
// propre filtre plutôt que de se restreindre aux groupes déjà retenus, ce qui
// paraîtrait pourtant plus économe. La même cause interdit de citer deux fois
// `filtered_errors` dans une instruction : PostgreSQL matérialise toute CTE
// référencée plus d'une fois. Groupes, totaux, tendance, séries, exemplaire et
// occurrences sont donc des instructions SÉPARÉES, dans une même transaction.

const DIAGNOSTIC_PRE_V69 =
  "migration v69 absente : corrélation trace/identité indisponible, compteurs historiques conservés";

/** Colonnes d'enveloppe v69, remplacées par des NULL typés sur un schéma antérieur. */
const ENVELOPPE_V69 = [
  ["trace_id", "text"],
  ["source_parent_span_id", "text"],
  ["error_source", "text"],
  ["handled", "boolean"],
  ["is_fatal", "boolean"],
  ["view_name", "text"],
  ["env", "text"],
  ["service", "text"],
] as const;

/**
 * v69 est-elle appliquée ? Vercel publie la console AVANT que la migration ne
 * tourne sur Railway : pendant cette fenêtre, lire `e.trace_id` ferait échouer
 * tout l'écran. La sonde est rejouée à chaque lecture — jamais mémorisée par le
 * module — pour basculer dès le passage de la migration, sans redémarrage. Elle
 * précède la transaction : le texte SQL en dépend, et `set transaction` doit en
 * rester la première instruction.
 */
async function errorSchemaV69(): Promise<boolean> {
  const [row] = await q<{ v69: boolean }>(
    `select exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='rum_error' and column_name='error_source') as v69`,
  );
  return row?.v69 === true;
}

function enrichmentOf(v69: boolean): ErrorEnrichment {
  return v69
    ? { available: true, diagnostic: null }
    : { available: false, diagnostic: DIAGNOSTIC_PRE_V69 };
}

/**
 * Avertissement d'échantillonnage, sans pondération.
 *
 * Une erreur est conservée si sa session l'est (`sample_rate`) OU si le SDK la
 * promeut (`error_sample_rate` sur le reste) : p = sr + (1 − sr) × esr. Le taux de
 * session seul exagérerait la perte — avec les défauts sr = 0,1 et esr = 1, toute
 * erreur est gardée (p = 1) et aucun avertissement n'est dû. Aucune
 * extrapolation : on montre l'incertitude plutôt qu'une estimation non démontrée.
 */
function samplingOf(p: number | null | undefined): ErrorSampling {
  if (p == null) return { min_inclusion_probability: null, message: null };
  const pct = (p * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return {
    min_inclusion_probability: p,
    message:
      p > 0 && p < 1
        ? `Erreurs observées sur un échantillon (probabilité d'inclusion minimale ${pct} %). Aucune extrapolation n'est appliquée.`
        : null,
  };
}

type Lecture = <T>(sql: string, params: unknown[]) => Promise<T[]>;

/**
 * Une photographie et une horloge pour toutes les instructions d'une lecture :
 * `now()` est figé au début de la transaction, et une ingestion concurrente ne
 * peut pas faire diverger liste, totaux et tendance. `set transaction` DOIT être
 * la première instruction : PostgreSQL la refuse après la moindre requête.
 */
function snapshot<T>(fn: (lire: Lecture) => Promise<T>): Promise<T> {
  return tx(async (client) => {
    await client.query("set transaction isolation level repeatable read read only");
    return fn(async <R>(sql: string, params: unknown[]) => (await client.query(sql, params)).rows as R[]);
  });
}

interface ErrorRestriction {
  /** Apps d'un principal scopé ; `null` = pas de liste (admin). */
  apps?: string[] | null;
  fingerprints?: string[];
  cursor?: { ts: string; id: string } | null;
}

interface ErrorBase {
  /** `with filtered_errors as (…)` — à citer UNE seule fois par instruction. */
  sql: string;
  /** CTE `origine` (première vue), indépendante de `filtered_errors`. */
  origine: string;
  params: unknown[];
  /** Ajoute une valeur liée et rend sa position (`$n`). */
  bind: (value: unknown) => string;
}

/**
 * La base filtrée, construite ICI et nulle part ailleurs.
 *
 * La jointure de session est scopée par app : un émetteur hostile peut citer
 * l'identifiant de session d'un autre tenant, qui ne doit lui prêter ni appareil,
 * ni visiteur, ni identité, ni lien. Les lignes sans session restent dans la
 * population tant qu'aucun filtre d'appareil ou de segment ne l'exclut — une
 * erreur backend est une erreur.
 *
 * `origine` porte `first_seen`, NON BORNÉ, délibérément : « première apparition »
 * n'a de sens que depuis toujours. C'est la seule colonne dans ce cas, et l'écran
 * la libelle comme telle. Elle garde le périmètre d'apps et d'empreintes, jamais
 * la fenêtre ni les filtres de session.
 *
 * Chaque appel a sa propre liste de paramètres, de sorte qu'une instruction ne
 * déclare que des `$n` qu'elle utilise : PostgreSQL refuse un paramètre dont il
 * ne peut pas déduire le type.
 */
function errorBase(f: ErrorFilters, v69: boolean, r: ErrorRestriction = {}): ErrorBase {
  const params: unknown[] = [f.app, f.device];
  const bind = (value: unknown) => `$${params.push(value)}`;
  const perimetre =
    "($1::text is null or e.app_id = $1)" +
    (r.apps ? ` and e.app_id = any(${bind(r.apps)}::text[])` : "") +
    (r.fingerprints ? ` and e.fingerprint = any(${bind(r.fingerprints)}::text[])` : "") +
    internalClause(f, "e.app_id");
  const curseur = r.cursor
    ? ` and (e.ts, e.id) < (${bind(r.cursor.ts)}::timestamptz, ${bind(r.cursor.id)}::bigint)`
    : "";
  const segment = buildSegment(f.segment, params.length + 1);
  params.push(...segment.params);
  const enveloppe = ENVELOPPE_V69.map(([col, type]) => (v69 ? `e.${col}` : `null::${type} as ${col}`)).join(", ");
  // L'identité métier de l'occurrence prime (snapshot v69), sinon celle de sa session.
  const identite = v69 ? "coalesce(e.user_id_hash, s.user_id_hash)" : "s.user_id_hash";
  return {
    params,
    bind,
    sql: `with filtered_errors as (
      select e.id, e.app_id, e.fingerprint, e.ts, e.occurrences,
             e.error_type, e.message, e.kind, e.stack, e.source, e.lineno, e.colno,
             e.route, e.session_id, e.release, e.action_id, ${enveloppe},
             ${identite} as identity_hash,
             s.session_id as same_app_session_id, s.visitor_id, s.device_type,
             case when s.session_id is not null
                  then coalesce(s.sample_rate, 1) + (1 - coalesce(s.sample_rate, 1)) * coalesce(s.error_sample_rate, 1)
             end as inclusion_probability
        from rum_error e
        left join rum_session s on s.app_id = e.app_id and s.session_id = e.session_id
       where e.ts >= now() - interval '${PERIODS[f.period].interval}' and e.ts < now()
         and ${perimetre}${curseur}
         and ($2::text is null or s.device_type = $2)${segment.where("s")}${f.includeBots ? "" : " and not coalesce(s.is_bot, false)"}
    )`,
    origine: `origine as (
      select e.app_id, e.fingerprint, min(e.ts) as first_seen
        from rum_error e
       where e.fingerprint is not null
         and ${perimetre}
       group by e.app_id, e.fingerprint
    )`,
  };
}

// Les six mesures d'impact, sur les lignes de `filtered_errors` du groupement courant.
//
// SOMME, pas comptage (v59). Le SDK déduplique une erreur qui se répète et joint
// le nombre d'occurrences qu'il a tues : compter les lignes sous-estimerait
// précisément la boucle qu'on veut voir. `float8` partout : exact jusqu'à 2^53,
// là où `::int` déborde, et une division de deux entiers tronquerait un ratio à 0.
const IMPACT_SQL = `sum(occurrences)::float8 as occurrences,
         nullif(count(distinct same_app_session_id), 0)::float8 as sessions_affected,
         nullif(count(distinct visitor_id), 0)::float8 as visitors_affected,
         nullif(count(distinct identity_hash), 0)::float8 as identified_users_affected,
         coalesce(sum(occurrences) filter (where same_app_session_id is not null), 0)::float8
           / nullif(sum(occurrences), 0)::float8 as session_coverage,
         coalesce(sum(occurrences) filter (where visitor_id is not null or identity_hash is not null), 0)::float8
           / nullif(sum(occurrences), 0)::float8 as identity_coverage`;

const REGRESSED_SQL = "coalesce(st.status = 'resolved' and g.last_seen > st.resolved_at, false)";

// Tri triage : régressions d'abord, puis ouvertes, puis résolues, puis ignorées.
//
// PUIS PAR IMPACT SUR LA FENÊTRE, pas par volume cumulé. « Impact » = visiteurs
// distincts touchés : mille occurrences chez une personne pèsent moins qu'une
// occurrence chez cent.
//
// LA RETOMBÉE SUR LES SESSIONS N'EST PAS UN ORNEMENT. Depuis migration-v57 seules
// les sessions portant un `visitor_id` alimentent les visiteurs ; tant que la
// rétention n'a pas fait disparaître l'historique (30 jours), beaucoup de
// groupes n'auront aucun visiteur connu. Sans ce deuxième critère, le tri
// s'effondrerait sur le départage et rangerait au hasard. Les sessions sont
// exactes sur la fenêtre et constituent le meilleur substitut d'impact disponible.
//
// `nulls last` : un impact INCONNU (backend sans session) n'est pas nul, mais il
// ne peut pas passer devant un impact mesuré. Le départage final (app, empreinte)
// rend l'ordre total : deux pages d'offset ne répètent ni ne sautent une ligne.
/** Groupes de la population, avec `first_seen` et triage ; liste ET détail. */
function groupsSql(base: ErrorBase): string {
  return `${base.sql}, g as (
    select app_id, fingerprint,
           max(error_type) as error_type, max(message) as sample_message,
           ${IMPACT_SQL},
           max(ts) as last_seen,
           min(inclusion_probability) as min_inclusion_probability
      from filtered_errors
     where fingerprint is not null
     group by app_id, fingerprint
  ), ${base.origine}
  select g.app_id, g.fingerprint, g.error_type, g.sample_message, g.occurrences,
         coalesce(g.sessions_affected, 0) as sessions,
         coalesce(g.visitors_affected, 0) as users_affected,
         o.first_seen, g.last_seen,
         coalesce(st.status, 'open') as status, st.resolved_at,
         ${REGRESSED_SQL} as regressed,
         g.sessions_affected, g.visitors_affected, g.identified_users_affected,
         g.session_coverage, g.identity_coverage, g.min_inclusion_probability
    from g
    join origine o on o.app_id = g.app_id and o.fingerprint = g.fingerprint
    left join error_status st on st.app_id = g.app_id and st.fingerprint = g.fingerprint
   order by (case
              when ${REGRESSED_SQL} then 0
              when coalesce(st.status, 'open') = 'open' then 1
              when st.status = 'ignored' then 3
              else 2 end),
            g.visitors_affected desc nulls last, g.sessions_affected desc nulls last,
            g.occurrences desc, g.last_seen desc, g.app_id, g.fingerprint`;
}

/**
 * Totaux de la population en UN passage : les lignes avec empreinte portent
 * l'impact, le nombre de groupes et l'échantillonnage ; celles sans empreinte
 * (v0.1, non groupables) ne donnent que leurs occurrences.
 */
function totalsSql(base: ErrorBase): string {
  return `${base.sql}
  select fingerprint is null as unfingerprinted_rows,
         ${IMPACT_SQL},
         count(distinct (app_id, fingerprint))::float8 as groups,
         min(inclusion_probability) as min_inclusion_probability
    from filtered_errors
   group by fingerprint is null`;
}

function bucketSql(period: PeriodKey, ts: string): string {
  return `date_bin(interval '${PERIODS[period].bucket}', ${ts}, timestamptz '2000-01-01')`;
}

/**
 * Occurrences par seau, zéros compris, de la population avec empreinte.
 *
 * SUIT LA PÉRIODE CHOISIE. Une version précédente était figée sur 24 seaux d'une
 * heure : sur une fenêtre de 7 jours, l'écran classait les groupes sur 7 jours
 * puis dessinait leurs 24 dernières heures. Un groupe pouvait être en tête du
 * tableau avec une sparkline entièrement plate.
 *
 * Le seau vient de PERIODS (1 h → 5 min, 24 h → 1 h, 7 j → 6 h) et les bornes
 * sont les seaux de `from` et de `to` : une fenêtre glissante entame deux seaux
 * partiels, d'où N + 1 points (13 / 25 / 29). Toute ligne de [from,to) tombe dans
 * un seau listé : la somme de la tendance égale le total affiché.
 */
function trendSql(base: ErrorBase, period: PeriodKey): string {
  const { bucket, interval } = PERIODS[period];
  return `${base.sql}, buckets as (
    select generate_series(${bucketSql(period, `now() - interval '${interval}'`)},
                           ${bucketSql(period, "now()")}, interval '${bucket}') as bucket
  ), counts as (
    select ${bucketSql(period, "ts")} as bucket, sum(occurrences)::float8 as occurrences
      from filtered_errors
     where fingerprint is not null
     group by 1
  )
  select b.bucket, coalesce(c.occurrences, 0)::float8 as occurrences
    from buckets b
    left join counts c on c.bucket = b.bucket
   order by b.bucket`;
}

/** Occurrences par seau des groupes d'une page ; le zéro-remplissage suit `trend`. */
function seriesSql(base: ErrorBase, period: PeriodKey): string {
  return `${base.sql}
  select app_id, fingerprint, ${bucketSql(period, "ts")} as bucket, sum(occurrences)::float8 as occurrences
    from filtered_errors
   group by 1, 2, 3`;
}

function exemplarSql(base: ErrorBase): string {
  return `${base.sql}
  select id::float8 as id, ts, message, error_type, kind, stack, source, lineno, colno, route,
         session_id, release, occurrences, trace_id, source_parent_span_id, error_source,
         handled, is_fatal, view_name, env, service, action_id
    from filtered_errors
   order by ts desc, id desc
   limit 1`;
}

/**
 * Occurrences d'un groupe, les plus récentes d'abord.
 *
 * Pagination par curseur `(ts, id)` : un offset glisse dès qu'une erreur arrive
 * entre deux pages. Le curseur est formaté PAR PostgreSQL, à la microseconde —
 * JavaScript tronque à la milliseconde, et de deux occurrences à 1 µs d'écart la
 * page suivante perdrait la seconde.
 *
 * Liens : seulement si la relation existe DANS LA MÊME APP. Identifiants de trace,
 * de span et de session sont émis par le client ; sans ce contrôle, une erreur
 * forgée ouvrirait la trace ou la session d'un autre tenant.
 */
function occurrencesSql(base: ErrorBase): string {
  return `${base.sql}
  select fe.id::float8 as id, fe.ts, fe.route, fe.session_id, fe.kind, fe.message, fe.device_type,
         fe.occurrences, fe.release, fe.error_source, fe.handled, fe.is_fatal, fe.view_name,
         fe.env, fe.service, fe.trace_id, fe.source_parent_span_id,
         fe.same_app_session_id is not null as link_session,
         fe.same_app_session_id is not null and exists (
           select 1 from replay_chunk rc
            where rc.app_id = fe.app_id and rc.session_id = fe.session_id
         ) as link_replay,
         fe.trace_id is not null and exists (
           select 1 from rum_span sp
            where sp.app_id = fe.app_id and sp.trace_id = fe.trace_id
         ) as link_trace,
         fe.trace_id is not null and fe.source_parent_span_id is not null and exists (
           select 1 from rum_span sp
            where sp.app_id = fe.app_id and sp.trace_id = fe.trace_id
              and sp.span_id = fe.source_parent_span_id
         ) as link_parent_span,
         a.action_id as link_action_id, a.name as link_action_name, a.type as link_action_type,
         fe.id::text as cursor_id,
         to_char(fe.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts
    from filtered_errors fe
    left join rum_action a
      on a.app_id = fe.app_id and a.action_id = fe.action_id and a.session_id = fe.session_id
   order by fe.ts desc, fe.id desc`;
}

type GroupSqlRow = Omit<ErrorGroupRow, "series"> & { min_inclusion_probability: number | null };

interface TotalsSqlRow extends ErrorImpact {
  unfingerprinted_rows: boolean;
  groups: number;
  min_inclusion_probability: number | null;
}

interface SeriesSqlRow extends ErrorGroupRef {
  bucket: Date;
  occurrences: number;
}

type OccurrenceSqlRow = Omit<ErrorOccurrenceRow, "links"> & {
  link_session: boolean;
  link_replay: boolean;
  link_trace: boolean;
  link_parent_span: boolean;
  link_action_id: string | null;
  link_action_name: string | null;
  link_action_type: string | null;
  cursor_id: string;
  cursor_ts: string;
};

function toGroupRow({ min_inclusion_probability: _sampling, ...group }: GroupSqlRow): ErrorGroupRow {
  return group;
}

function toOccurrenceRow({
  link_session,
  link_replay,
  link_trace,
  link_parent_span,
  link_action_id,
  link_action_name,
  link_action_type,
  cursor_id: _cursorId,
  cursor_ts: _cursorTs,
  ...row
}: OccurrenceSqlRow): ErrorOccurrenceRow {
  return {
    ...row,
    links: {
      session: link_session,
      replay: link_replay,
      trace: link_trace,
      parent_span: link_parent_span,
      action: link_action_id ? { id: link_action_id, name: link_action_name, type: link_action_type } : null,
    },
  };
}

function withSeries(groups: ErrorGroupRow[], trend: ErrorTrendPoint[], points: SeriesSqlRow[]): ErrorGroupRow[] {
  const position = new Map(trend.map((point, i) => [point.bucket.getTime(), i]));
  const key = (ref: ErrorGroupRef) => JSON.stringify([ref.app_id, ref.fingerprint]);
  const series = new Map(groups.map((group) => [key(group), new Array<number>(trend.length).fill(0)]));
  for (const point of points) {
    const values = series.get(key(point));
    const i = position.get(point.bucket.getTime());
    // Une même empreinte peut exister dans une app absente de la page : ignorée.
    if (values && i !== undefined) values[i] += point.occurrences;
  }
  return groups.map((group) => ({ ...group, series: series.get(key(group)) }));
}

/**
 * Groupes d'erreurs de la fenêtre, avec totaux, tendance et avertissements.
 * `opts.apps` restreint à la liste d'un principal scopé (vide = aucune ligne).
 */
export async function listErrorGroups(
  f: ErrorFilters,
  page: { limit: number; offset: number },
  opts?: { series?: boolean; apps?: string[] | null },
): Promise<ErrorListResult> {
  const v69 = await errorSchemaV69();
  const restriction: ErrorRestriction = { apps: opts?.apps ?? null };
  return snapshot(async (lire) => {
    const groupsBase = errorBase(f, v69, restriction);
    const rows = await lire<GroupSqlRow>(
      `${groupsSql(groupsBase)}
       limit ${groupsBase.bind(page.limit)} offset ${groupsBase.bind(page.offset)}`,
      groupsBase.params,
    );
    const totalsBase = errorBase(f, v69, restriction);
    const totalsRows = await lire<TotalsSqlRow>(totalsSql(totalsBase), totalsBase.params);
    const trendBase = errorBase(f, v69, restriction);
    const trend = await lire<ErrorTrendPoint>(trendSql(trendBase, f.period), trendBase.params);

    let groups = rows.map(toGroupRow);
    if (opts?.series && groups.length) {
      const seriesBase = errorBase(f, v69, {
        ...restriction,
        fingerprints: [...new Set(groups.map((group) => group.fingerprint))],
      });
      const points = await lire<SeriesSqlRow>(seriesSql(seriesBase, f.period), seriesBase.params);
      groups = withSeries(groups, trend, points);
    }

    const population = totalsRows.find((row) => !row.unfingerprinted_rows);
    const unfingerprinted = totalsRows.find((row) => row.unfingerprinted_rows)?.occurrences ?? 0;
    const totals: ErrorTotals = {
      occurrences: population?.occurrences ?? 0,
      sessions_affected: population?.sessions_affected ?? null,
      visitors_affected: population?.visitors_affected ?? null,
      identified_users_affected: population?.identified_users_affected ?? null,
      session_coverage: population?.session_coverage ?? null,
      identity_coverage: population?.identity_coverage ?? null,
      groups: population?.groups ?? 0,
      unfingerprinted,
    };
    return {
      groups,
      unfingerprinted,
      page: { limit: page.limit, offset: page.offset },
      total: totals.groups,
      totals,
      trend,
      sampling: samplingOf(population?.min_inclusion_probability),
      enrichment: enrichmentOf(v69),
    };
  });
}

/**
 * Quelle app porte cette empreinte ? Une empreinte n'identifie pas un groupe :
 * deux apps peuvent la partager, et l'ancien détail en retenait une arbitraire
 * (`limit 1`). Les candidates sont lues dans la MÊME base filtrée ; au-delà d'une,
 * l'appelant fait choisir.
 *
 * Seules l'app, les occurrences et la date sont lues : la base en forme antérieure
 * à v69 est valide sur les deux schémas et évite une sonde.
 */
export async function resolveErrorGroup(
  fingerprint: string,
  f: ErrorFilters,
  apps: string[] | null,
): Promise<ErrorGroupResolution> {
  // AD-16 : un périmètre vide ne voit rien, inutile d'interroger la base.
  if (apps?.length === 0) return { kind: "not_found" };
  const base = errorBase(f, false, { apps, fingerprints: [fingerprint] });
  const candidates = await q<ErrorGroupCandidate>(
    `${base.sql}
     select app_id, sum(occurrences)::float8 as occurrences, max(ts) as last_seen
       from filtered_errors
      group by app_id
      order by occurrences desc, app_id asc
      limit 20`,
    base.params,
  );
  if (candidates.length === 0) return { kind: "not_found" };
  if (candidates.length === 1) return { kind: "found", ref: { app_id: candidates[0].app_id, fingerprint } };
  return { kind: "ambiguous", candidates };
}

/**
 * Détail d'un groupe résolu : groupe, tendance, exemplaire et occurrences dans la
 * même photographie et la même base que la liste. `null` si la référence n'a
 * aucune ligne sur cette fenêtre avec ces filtres.
 */
export async function errorGroupDetail(
  ref: ErrorGroupRef,
  f: ErrorFilters,
  page: { limit: number; cursor: { ts: string; id: string } | null },
): Promise<ErrorGroupDetailResult | null> {
  const v69 = await errorSchemaV69();
  // La référence résolue fixe l'app : le détail ne déborde jamais sur une autre,
  // quel que soit le filtre reçu. Une app explicite n'exclut pas les apps internes.
  const scoped: ErrorFilters = { ...f, app: ref.app_id };
  const groupe: ErrorRestriction = { fingerprints: [ref.fingerprint] };
  return snapshot(async (lire) => {
    const groupBase = errorBase(scoped, v69, groupe);
    const [row] = await lire<GroupSqlRow>(groupsSql(groupBase), groupBase.params);
    if (!row) return null;
    const trendBase = errorBase(scoped, v69, groupe);
    const trend = await lire<ErrorTrendPoint>(trendSql(trendBase, scoped.period), trendBase.params);
    const exemplarBase = errorBase(scoped, v69, groupe);
    const [last] = await lire<ErrorExemplar>(exemplarSql(exemplarBase), exemplarBase.params);
    const occurrencesBase = errorBase(scoped, v69, { ...groupe, cursor: page.cursor });
    const rows = await lire<OccurrenceSqlRow>(
      `${occurrencesSql(occurrencesBase)}
       limit ${occurrencesBase.bind(page.limit)}`,
      occurrencesBase.params,
    );
    // Page pleine seulement : une page incomplète est la dernière.
    const lastOfPage = rows.length === page.limit ? rows.at(-1) : undefined;
    return {
      group: toGroupRow(row),
      last: last ?? null,
      occurrences: rows.map(toOccurrenceRow),
      trend,
      page: { limit: page.limit, next_cursor: lastOfPage ? encodeErrorCursor(lastOfPage) : null },
      sampling: samplingOf(row.min_inclusion_probability),
      enrichment: enrichmentOf(v69),
    };
  });
}
