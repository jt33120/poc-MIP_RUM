// Contrat commun des filtres d'analytics (P6.2) — logique PURE, testée, sans accès base.
//
// UN SEUL MODÈLE. Avant ce module, deux `Filters` vivaient côte à côte (lib/filters.ts :
// app null = toutes ; lib/queries-v2.ts : app 'all') et chaque lecture P4/P5 ajoutait
// son adaptateur (tablette, segment, bots). Ici se résolvent, une fois par requête :
//   · le PÉRIMÈTRE d'apps, à partir du principal signé et jamais du client ;
//   · la PLAGE [from,to) en UTC, `to` capturé une seule fois ;
//   · les FILTRES bornés (appareil, dimensions, segments), sans fallback silencieux.
// Les anciennes façades (parseFilters, parseApiFilters) dérivent de ce contrat.

export const QUERY_VERSION = 1 as const;

// ─────────────────────────────── Plages ──────────────────────────────────────

export const RANGE_PRESETS = ["1h", "24h", "7d"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const PRESET_MS: Record<RangePreset, number> = { "1h": HOUR_MS, "24h": DAY_MS, "7d": 7 * DAY_MS };
export const PRESET_LABELS: Record<RangePreset, string> = { "1h": "1 h", "24h": "24 h", "7d": "7 j" };

/** Durée maximale d'une plage personnalisée. Elle n'étend pas la rétention. */
export const RANGE_MAX_MS = 30 * DAY_MS;
/** Au plus 300 points par série, seaux de bord compris. */
export const MAX_POINTS = 300;

// ───────────────────────────── Dimensions ────────────────────────────────────

export const DIMENSIONS = [
  "device",
  "browser",
  "os",
  "env",
  "service",
  "release",
  "route",
  "country",
  // P8.7 : d'où vient le pays de la session. Une dimension à part entière, et
  // non une note de bas de page : sans elle, un classement par pays mélange
  // silencieusement une résolution d'adresse et un réglage de terminal.
  // Nommée comme `country` l'est : un identifiant d'API, jamais le nom de la
  // colonne (`geo_source`) qui l'alimente.
  "country_source",
  "source",
  "client",
  // B8 : dimensions de LECTURE portées par la session, collectées bien avant
  // d'être lisibles — `runtime` (v82), `browser_version` et `os_version` (v75),
  // `net_type` (v53). Aucune n'a de paramètre d'URL dédié : elles passent par
  // `seg` (`seg=v2:runtime:eq:react_native`), comme `country_source`, pour ne pas
  // ajouter de paramètre de population au contrat (§ 3.1).
  "runtime",
  "browser_version",
  "os_version",
  "net_type",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Dimensions portées par un paramètre d'URL dédié (`?browser=Firefox`). */
export const PARAM_DIMENSIONS = ["browser", "os", "env", "service", "release", "route", "country"] as const;
export type ParamDimension = (typeof PARAM_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  device: "Appareil",
  browser: "Navigateur",
  os: "Système",
  env: "Environnement",
  service: "Service",
  release: "Release",
  route: "Route",
  // « estimé », et jamais « Pays » tout court : trois provenances possibles, dont
  // aucune ne localise une personne (cf. lib/geo.ts).
  country: "Pays estimé",
  country_source: "Provenance du pays",
  source: "Source de collecte",
  client: "Client",
  // L'émetteur DÉCLARÉ (`react_native`, `browser`), jamais déduit de l'user-agent.
  runtime: "Runtime",
  browser_version: "Version du navigateur",
  os_version: "Version du système",
  // Une ESTIMATION du navigateur (`navigator.connection`, Chromium seulement),
  // jamais l'opérateur : « estimé », comme le pays.
  net_type: "Type de réseau estimé",
};

export const DEVICES = ["desktop", "mobile", "tablet"] as const;
export type Device = (typeof DEVICES)[number];

export const FILTER_OPERATORS = ["eq", "neq", "is_null"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** Bornes du contrat : au-delà, la requête est refusée avant tout SQL. */
export const MAX_CONDITIONS = 10;
export const DIMENSION_NAME_MAX = 100;
export const VALUE_MAX = 500;

// ────────────────────────────────── Types ────────────────────────────────────

export interface QueryScope {
  requestedApp: string | null;
  /** null = admin transverse autorisé ; jamais [] (aucun accès = erreur). */
  authorizedApps: string[] | null;
  /** null = toutes les apps ; sinon liste non vide, triée. */
  effectiveApps: string[] | null;
}

export interface ResolvedRange {
  /** ISO UTC, borne incluse. */
  from: string;
  /** ISO UTC, borne exclue. */
  to: string;
  preset: RangePreset | null;
  bucketSeconds: number;
}

/**
 * Condition de segment. `neq` exclut les valeurs inconnues (SQL `<>`) ; « Inconnu »
 * s'exprime par `is_null`, jamais par une chaîne qui pourrait être une vraie valeur.
 */
export interface FilterCondition {
  dimension: Dimension;
  operator: FilterOperator;
  value: string | null;
}

export interface AnalyticsFilters {
  device?: Device;
  browser?: string;
  os?: string;
  env?: string;
  service?: string;
  release?: string;
  route?: string;
  country?: string;
  includeBots: boolean;
  includeInternal: boolean;
  segments: FilterCondition[];
}

export interface AnalyticsQuery {
  version: typeof QUERY_VERSION;
  scope: QueryScope;
  range: ResolvedRange;
  filters: AnalyticsFilters;
}

export type ContractErrorCode =
  | "no_app_access"
  | "forbidden_app"
  | "invalid_range"
  | "range_conflict"
  | "range_too_long"
  | "range_in_future"
  | "invalid_filter"
  | "too_many_conditions"
  | "ambiguous_parameter"
  | "unsupported_dimension";

export interface ContractError {
  code: ContractErrorCode;
  message: string;
  parameter?: string;
  dimension?: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ContractError };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (code: ContractErrorCode, message: string, extra: Partial<ContractError> = {}): Parsed<never> => ({
  ok: false,
  error: { code, message, ...extra },
});

/** Statut HTTP d'une erreur de contrat : 403 pour le périmètre, 400 sinon. */
export function contractErrorStatus(error: ContractError): 400 | 403 {
  return error.code === "no_app_access" || error.code === "forbidden_app" ? 403 : 400;
}

// ──────────────────────────────── Périmètre ──────────────────────────────────

export interface ScopePrincipal {
  role: "admin" | "viewer";
  apps: string[] | null;
}

/**
 * Apps autorisées d'un principal signé : `null` = toutes (admin, ou viewer sans
 * liste) ; `[]` = AUCUNE. Une liste vide n'est jamais « sans restriction ».
 */
export function authorizedAppsOf(principal: ScopePrincipal | null): string[] | null {
  if (!principal) return [];
  if (principal.role === "admin" || principal.apps === null) return null;
  return [...new Set(principal.apps)].sort();
}

/** Valeur d'app demandée : absente, vide ou `all` = toutes les apps du périmètre. */
export function requestedAppOf(raw: string | null | undefined): string | null {
  const app = raw?.trim();
  return app && app !== "all" ? app : null;
}

/**
 * Périmètre effectif. Pas de repli « première app » : une app hors périmètre est
 * refusée, et « toutes » vaut toutes les apps AUTORISÉES — une vue multi-app
 * réelle, pas la première de la liste.
 */
export function resolveScope(principal: ScopePrincipal | null, requested: string | null): Parsed<QueryScope> {
  const authorized = authorizedAppsOf(principal);
  if (authorized !== null && authorized.length === 0) {
    return fail("no_app_access", "aucune application autorisée");
  }
  if (requested === null) return ok({ requestedApp: null, authorizedApps: authorized, effectiveApps: authorized });
  if (!isSafeText(requested, 200)) return fail("invalid_filter", "app invalide", { parameter: "app" });
  if (authorized !== null && !authorized.includes(requested)) {
    return fail("forbidden_app", `app hors périmètre : ${requested}`, { parameter: "app" });
  }
  return ok({ requestedApp: requested, authorizedApps: authorized, effectiveApps: [requested] });
}

// ───────────────────────────────── Plages ────────────────────────────────────

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/;

/** Timestamp ISO UTC explicite (suffixe Z), date réelle (pas de 30 février). */
export function parseUtcInstant(raw: string): number | null {
  const m = ISO_UTC.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "0", frac = "0"] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(frac.padEnd(3, "0")));
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== Number(y) ||
    back.getUTCMonth() !== Number(mo) - 1 ||
    back.getUTCDate() !== Number(d) ||
    back.getUTCHours() !== Number(h) ||
    back.getUTCMinutes() !== Number(mi) ||
    back.getUTCSeconds() !== Number(s)
  ) {
    return null;
  }
  return ms;
}

/** Seau d'une durée : ≤ 1 h → 5 min, ≤ 24 h → 1 h, ≤ 7 j → 6 h, au-delà → 24 h. */
export function bucketSecondsFor(durationMs: number): number {
  if (durationMs <= HOUR_MS) return 300;
  if (durationMs <= DAY_MS) return 3600;
  if (durationMs <= 7 * DAY_MS) return 21_600;
  return 86_400;
}

/**
 * Seaux alignés sur l'époque UTC couvrant [from,to) : le premier contient `from`,
 * le dernier contient l'instant qui précède `to`. Un seau de bord est partiel.
 */
export function bucketStarts(range: Pick<ResolvedRange, "from" | "to" | "bucketSeconds">): number[] {
  const width = range.bucketSeconds * 1000;
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const starts: number[] = [];
  for (let start = Math.floor(from / width) * width; start < to && starts.length <= MAX_POINTS; start += width) {
    starts.push(start);
  }
  return starts;
}

export interface RangeInput {
  period?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * Plage résolue UNE fois. Preset : `to` = instant serveur fourni, `from` = `to`
 * moins la durée. Personnalisée : ISO UTC explicites, from < to ≤ maintenant,
 * 30 jours au plus. Preset ET from/to : refus, jamais un choix silencieux.
 *
 * Les presets restent inchangés, défaut documenté des anciennes URL compris :
 * `period` absent ou inconnu vaut 24 h (API et pages). Une plage personnalisée
 * invalide, elle, est refusée partout.
 */
export function resolveRange(input: RangeInput, nowMs: number): Parsed<ResolvedRange> {
  const rawFrom = input.from?.trim() || null;
  const rawTo = input.to?.trim() || null;
  const rawPeriod = input.period?.trim() || null;

  if (rawFrom !== null || rawTo !== null) {
    if (rawPeriod !== null) {
      return fail("range_conflict", "préciser soit period, soit from et to, pas les deux", { parameter: "period" });
    }
    if (rawFrom === null || rawTo === null) {
      return fail("invalid_range", "une plage personnalisée exige from ET to", { parameter: rawFrom === null ? "from" : "to" });
    }
    const from = parseUtcInstant(rawFrom);
    if (from === null) return fail("invalid_range", "from doit être un instant ISO UTC (…Z)", { parameter: "from" });
    const to = parseUtcInstant(rawTo);
    if (to === null) return fail("invalid_range", "to doit être un instant ISO UTC (…Z)", { parameter: "to" });
    if (from >= to) return fail("invalid_range", "from doit précéder to", { parameter: "from" });
    if (to > nowMs) return fail("range_in_future", "to ne peut pas dépasser l'heure du serveur", { parameter: "to" });
    if (to - from > RANGE_MAX_MS) return fail("range_too_long", "la plage ne peut pas dépasser 30 jours", { parameter: "from" });
    return ok({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      preset: null,
      bucketSeconds: bucketSecondsFor(to - from),
    });
  }

  const normalized = rawPeriod?.toLowerCase().replace("7j", "7d") ?? "24h";
  const chosen = (RANGE_PRESETS as readonly string[]).includes(normalized) ? (normalized as RangePreset) : "24h";
  const duration = PRESET_MS[chosen];
  return ok({
    from: new Date(nowMs - duration).toISOString(),
    to: new Date(nowMs).toISOString(),
    preset: chosen,
    bucketSeconds: bucketSecondsFor(duration),
  });
}

/** Période précédente contiguë, de même durée (comparaison N-1). */
export function previousRange(range: ResolvedRange): ResolvedRange {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  return { ...range, from: new Date(from - (to - from)).toISOString(), to: new Date(from).toISOString() };
}

/** Variation relative ; dénominateur précédent nul ou absent → null. */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

/** Libellé d'une largeur de seau : 300 → « 5 min », 21 600 → « 6 h », 86 400 → « 1 j ». */
export function bucketLabel(bucketSeconds: number): string {
  if (bucketSeconds < 3600) return `${Math.round(bucketSeconds / 60)} min`;
  if (bucketSeconds < 86_400) return `${Math.round(bucketSeconds / 3600)} h`;
  return `${Math.round(bucketSeconds / 86_400)} j`;
}

/** Libellé court d'une plage (« 24 h », ou « du 17/09 10:00 au 17/09 12:00 »). */
export function rangeLabel(range: ResolvedRange, timeZone: string): string {
  if (range.preset) return PRESET_LABELS[range.preset];
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `du ${fmt.format(new Date(range.from))} au ${fmt.format(new Date(range.to))}`;
}

// ─────────────────────── Heures locales ↔ instants UTC ───────────────────────
//
// Les champs `datetime-local` saisissent une heure MURALE sans fuseau. Les fenêtres
// restent UTC : la conversion se fait dans le fuseau d'affichage, en tenant compte
// du changement d'heure. Heure inexistante (saut de printemps) : refusée. Heure
// ambiguë (recul d'automne) : la première occurrence, en heure d'été.

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function offsetMs(timeZone: string, instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** `2026-10-25T02:30` (heure de Paris) → ISO UTC ; null si l'heure n'existe pas. */
export function localInputToUtc(value: string, timeZone: string): string | null {
  const m = LOCAL_INPUT.exec(value);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (new Date(wall).getUTCDate() !== Number(m[3])) return null;
  // Les deux décalages possibles autour de l'instant ; la première occurrence
  // valide (offset le plus grand = heure d'été) gagne en cas d'ambiguïté.
  const candidates = [...new Set([offsetMs(timeZone, wall - 12 * HOUR_MS), offsetMs(timeZone, wall + 12 * HOUR_MS)])]
    .sort((a, b) => b - a)
    .map((offset) => wall - offset)
    .filter((instant) => utcToLocalInput(new Date(instant).toISOString(), timeZone) === value);
  return candidates.length ? new Date(candidates[0]).toISOString() : null;
}

/** ISO UTC → `YYYY-MM-DDTHH:MM` dans le fuseau d'affichage. */
export function utcToLocalInput(iso: string, timeZone: string): string {
  const instant = Date.parse(iso);
  const wall = new Date(instant + offsetMs(timeZone, instant));
  return wall.toISOString().slice(0, 16);
}

// ───────────────────────────────── Filtres ───────────────────────────────────

/** Texte borné sans caractère de contrôle (valeurs de dimension, app). */
export function isSafeText(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isDimension(value: string): value is Dimension {
  return (DIMENSIONS as readonly string[]).includes(value);
}

// Anciens segments (v1) : `geo==FR;device!=mobile`, dimensions historiques seulement.
const LEGACY_SEGMENT_DIMENSIONS: Record<string, Dimension> = {
  geo: "country",
  device: "device",
  client: "client",
  source: "source",
};

export const SEGMENT_V2_PREFIX = "v2:";

function conditionOf(dimension: Dimension, operator: FilterOperator, value: string | null): Parsed<FilterCondition> {
  if (operator === "is_null") return ok({ dimension, operator, value: null });
  if (value === null || !isSafeText(value, VALUE_MAX)) {
    return fail("invalid_filter", `valeur invalide pour ${dimension} (1 à ${VALUE_MAX} caractères)`, { dimension });
  }
  if (dimension === "device" && !(DEVICES as readonly string[]).includes(value)) {
    return fail("invalid_filter", "appareil invalide (desktop, mobile ou tablet)", { dimension });
  }
  return ok({ dimension, operator, value });
}

/**
 * Segment d'URL. `v2:` : `dimension:operateur[:valeur]` séparés par `;`, valeurs
 * encodées (`encodeURIComponent`). Sans préfixe : ancien format v1 repris tel quel
 * (`geo` devient `country`). Tout jeton inconnu ou mal formé est REFUSÉ : l'ancien
 * parseur les ignorait, et l'écran affichait un segment qui n'était pas appliqué.
 */
export function parseSegmentParam(raw: string | null): Parsed<FilterCondition[]> {
  if (raw === null || raw.trim() === "") return ok([]);
  const conditions: FilterCondition[] = [];
  if (raw.startsWith(SEGMENT_V2_PREFIX)) {
    for (const token of raw.slice(SEGMENT_V2_PREFIX.length).split(";")) {
      if (!token) continue;
      const [name, operator, ...rest] = token.split(":");
      if (!name || name.length > DIMENSION_NAME_MAX || !isDimension(name)) {
        return fail("unsupported_dimension", `dimension inconnue : ${String(name).slice(0, DIMENSION_NAME_MAX)}`, {
          parameter: "seg",
          dimension: String(name).slice(0, DIMENSION_NAME_MAX),
        });
      }
      if (!(FILTER_OPERATORS as readonly string[]).includes(operator ?? "")) {
        return fail("invalid_filter", `opérateur invalide pour ${name}`, { parameter: "seg", dimension: name });
      }
      let value: string | null = null;
      if (operator !== "is_null") {
        try {
          value = decodeURIComponent(rest.join(":"));
        } catch {
          return fail("invalid_filter", `valeur mal encodée pour ${name}`, { parameter: "seg", dimension: name });
        }
      } else if (rest.length) {
        return fail("invalid_filter", `is_null ne prend pas de valeur (${name})`, { parameter: "seg", dimension: name });
      }
      const condition = conditionOf(name, operator as FilterOperator, value);
      if (!condition.ok) return { ok: false, error: { ...condition.error, parameter: "seg" } };
      conditions.push(condition.value);
    }
    return ok(conditions);
  }
  for (const token of raw.split(";")) {
    if (!token) continue;
    const m = /^([a-z_]+)(==|!=)(.*)$/.exec(token);
    const dimension = m ? LEGACY_SEGMENT_DIMENSIONS[m[1]] : undefined;
    if (!m || !dimension) {
      return fail("invalid_filter", `segment invalide : ${token.slice(0, 40)}`, { parameter: "seg" });
    }
    const condition = conditionOf(dimension, m[2] === "==" ? "eq" : "neq", m[3].trim());
    if (!condition.ok) return { ok: false, error: { ...condition.error, parameter: "seg" } };
    conditions.push(condition.value);
  }
  return ok(conditions);
}

/** Sérialise des conditions au format v2 (aller-retour avec parseSegmentParam). */
export function serializeSegments(conditions: FilterCondition[]): string {
  if (!conditions.length) return "";
  return (
    SEGMENT_V2_PREFIX +
    conditions
      .map((c) =>
        c.operator === "is_null" ? `${c.dimension}:is_null` : `${c.dimension}:${c.operator}:${encodeURIComponent(c.value ?? "")}`,
      )
      .join(";")
  );
}

/** Lecture minimale d'une query string : `URLSearchParams` ou searchParams Next. */
export interface ParamReader {
  get(name: string): string | null;
  getAll(name: string): string[];
}

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/** Adapte les searchParams d'une page Next (tableaux pour les répétitions). */
export function paramReader(sp: SearchParamsRecord | URLSearchParams): ParamReader {
  if (sp instanceof URLSearchParams) return sp;
  return {
    get: (name) => {
      const v = sp[name];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    },
    getAll: (name) => {
      const v = sp[name];
      return Array.isArray(v) ? v : v === undefined ? [] : [v];
    },
  };
}

/** Paramètres du contrat : répétés, ils sont ambigus et refusés. */
export const CONTRACT_PARAMS = ["app", "period", "from", "to", "device", "bots", "internal", "seg", ...PARAM_DIMENSIONS] as const;

/**
 * Filtres d'une query string. Les paramètres historiques gardent leur défaut
 * documenté (`device` inconnu = tous) ; les nouveaux — dimensions, segment v2 —
 * sont validés : une valeur illisible est refusée, jamais ignorée.
 */
export function parseFilterParams(sp: ParamReader): Parsed<AnalyticsFilters> {
  for (const name of CONTRACT_PARAMS) {
    if (sp.getAll(name).length > 1) return fail("ambiguous_parameter", `paramètre répété : ${name}`, { parameter: name });
  }
  const filters: AnalyticsFilters = {
    includeBots: sp.get("bots") === "1",
    includeInternal: sp.get("internal") === "1",
    segments: [],
  };
  const rawDevice = sp.get("device")?.trim().toLowerCase() ?? "";
  if ((DEVICES as readonly string[]).includes(rawDevice)) filters.device = rawDevice as Device;
  for (const dimension of PARAM_DIMENSIONS) {
    const raw = sp.get(dimension);
    if (raw === null || raw === "") continue;
    if (!isSafeText(raw, VALUE_MAX)) {
      return fail("invalid_filter", `${dimension} invalide (1 à ${VALUE_MAX} caractères, sans caractère de contrôle)`, {
        parameter: dimension,
        dimension,
      });
    }
    filters[dimension] = raw;
  }
  const segments = parseSegmentParam(sp.get("seg"));
  if (!segments.ok) return segments;
  filters.segments = segments.value;
  if (conditionCount(filters) > MAX_CONDITIONS) {
    return fail("too_many_conditions", `au plus ${MAX_CONDITIONS} conditions combinées`, { parameter: "seg" });
  }
  return ok(filters);
}

/** Nombre de conditions ET (appareil, dimensions, segments). */
export function conditionCount(filters: AnalyticsFilters): number {
  return (filters.device ? 1 : 0) + PARAM_DIMENSIONS.filter((d) => filters[d] !== undefined).length + filters.segments.length;
}

/** Toutes les conditions sous forme uniforme (dimension, opérateur, valeur). */
export function conditionsOf(filters: AnalyticsFilters): FilterCondition[] {
  const out: FilterCondition[] = [];
  if (filters.device) out.push({ dimension: "device", operator: "eq", value: filters.device });
  for (const dimension of PARAM_DIMENSIONS) {
    const value = filters[dimension];
    if (value !== undefined) out.push({ dimension, operator: "eq", value });
  }
  return [...out, ...filters.segments];
}

/** Dimensions citées par les filtres (pour les capacités de surface). */
export function dimensionsUsed(filters: AnalyticsFilters): Dimension[] {
  return [...new Set(conditionsOf(filters).map((c) => c.dimension))];
}

// ───────────────────────────── Requête complète ──────────────────────────────

export interface QueryParseOptions {
  principal: ScopePrincipal | null;
  nowMs: number;
}

export function parseAnalyticsQuery(sp: ParamReader, options: QueryParseOptions): Parsed<AnalyticsQuery> {
  const filters = parseFilterParams(sp);
  if (!filters.ok) return filters;
  const range = resolveRange({ period: sp.get("period"), from: sp.get("from"), to: sp.get("to") }, options.nowMs);
  if (!range.ok) return range;
  const scope = resolveScope(options.principal, requestedAppOf(sp.get("app")));
  if (!scope.ok) return scope;
  return ok({ version: QUERY_VERSION, scope: scope.value, range: range.value, filters: filters.value });
}

/**
 * Resserre le périmètre effectif sur une app, sans jamais l'élargir : une app hors
 * du périmètre effectif donne un périmètre VIDE (zéro ligne), pas un repli.
 */
export function intersectApp(query: AnalyticsQuery, app: string): AnalyticsQuery {
  const effective = query.scope.effectiveApps;
  const allowed = effective === null ? true : effective.includes(app);
  return { ...query, scope: { ...query.scope, requestedApp: app, effectiveApps: allowed ? [app] : [] } };
}

/**
 * Périmètre d'une RESSOURCE dont l'identifiant fait foi (issue, groupe d'erreurs) :
 * ses chiffres viennent de son app, pourvu qu'elle soit AUTORISÉE au principal —
 * même si l'URL en nommait une autre. Hors autorisation : périmètre vide.
 */
export function resourceScope(query: AnalyticsQuery, app: string): AnalyticsQuery {
  const authorized = query.scope.authorizedApps;
  const allowed = authorized === null || authorized.includes(app);
  return { ...query, scope: { ...query.scope, requestedApp: app, effectiveApps: allowed ? [app] : [] } };
}

/** Élargit au périmètre AUTORISÉ entier : recherche d'une ressource dans toutes les apps du principal. */
export function authorizedScope(query: AnalyticsQuery): AnalyticsQuery {
  return { ...query, scope: { ...query.scope, requestedApp: null, effectiveApps: query.scope.authorizedApps } };
}

/**
 * Intersection d'un filtre local (widget, drill-down) avec la requête globale :
 * même dimension = ET, jamais un remplacement. Un widget ne peut ni remplacer
 * `app=A` par `app=B` ni effacer un filtre global : l'intersection vide rend zéro.
 */
export function intersectQuery(
  base: AnalyticsQuery,
  local: { app?: string | null; conditions?: FilterCondition[] },
): AnalyticsQuery {
  const scoped = local.app ? intersectApp(base, local.app) : base;
  return {
    ...scoped,
    filters: { ...scoped.filters, segments: [...scoped.filters.segments, ...(local.conditions ?? [])] },
  };
}

// ─────────────────────── Sérialisation et empreinte ──────────────────────────

/**
 * Paramètres d'URL canoniques d'une requête (liens internes, drill-downs, export).
 * `app` reprend l'app demandée ; les défauts ne sont pas écrits.
 */
export function queryToSearchParams(query: AnalyticsQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (query.scope.requestedApp) p.set("app", query.scope.requestedApp);
  if (query.range.preset) {
    if (query.range.preset !== "24h") p.set("period", query.range.preset);
  } else {
    p.set("from", query.range.from);
    p.set("to", query.range.to);
  }
  const f = query.filters;
  if (f.device) p.set("device", f.device);
  for (const dimension of PARAM_DIMENSIONS) {
    const value = f[dimension];
    if (value !== undefined) p.set(dimension, value);
  }
  const seg = serializeSegments(f.segments);
  if (seg) p.set("seg", seg);
  if (f.includeBots) p.set("bots", "1");
  if (f.includeInternal) p.set("internal", "1");
  return p;
}

/**
 * Contexte global d'une URL reporté vers un autre écran (navigation) : app, plage,
 * appareil, dimensions, segment, bots, apps internes — tels quels, sans les valider.
 * Les paramètres propres à l'écran quitté (curseur, pagination, recherche) restent
 * derrière : ils n'ont pas de sens ailleurs.
 */
export function contextSearchParams(sp: ParamReader): URLSearchParams {
  const out = new URLSearchParams();
  for (const name of CONTRACT_PARAMS) for (const value of sp.getAll(name)) out.append(name, value);
  return out;
}

/**
 * Lien vers une autre surface en conservant les filtres courants. `extra` ajoute
 * ou remplace des paramètres propres à la cible (`null` retire).
 */
export function hrefWithQuery(
  pathname: string,
  query: AnalyticsQuery,
  extra: Record<string, string | null | undefined> = {},
): string {
  const p = queryToSearchParams(query);
  for (const [key, value] of Object.entries(extra)) {
    if (value === null || value === undefined) p.delete(key);
    else p.set(key, value);
  }
  const qs = p.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Empreinte stable d'une requête RÉSOLUE : périmètre autorisé et effectif, plage
 * et filtres triés. Entre dans les clés de cache et les ETag : une réponse calculée
 * pour A ne peut pas servir à B, ni une plage à une autre.
 *
 * `exact` (clé d'un calcul) retient les instants [from,to). `sliding` (ETag d'une
 * représentation) retient le preset d'une fenêtre glissante, dont les instants
 * avancent à chaque appel : sans cela aucune revalidation ne rendrait jamais 304.
 * Une plage personnalisée garde ses instants dans les deux cas.
 */
export function queryFingerprint(query: AnalyticsQuery, window: "exact" | "sliding" = "exact"): string {
  const f = query.filters;
  const { range } = query;
  const canonical = JSON.stringify([
    query.version,
    query.scope.authorizedApps ?? "*",
    query.scope.effectiveApps ?? "*",
    ...(window === "sliding" && range.preset ? [range.preset] : [range.from, range.to]),
    range.bucketSeconds,
    f.includeBots,
    f.includeInternal,
    conditionsOf(f)
      .map((c) => [c.dimension, c.operator, c.value])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]);
  return fnv1a(canonical);
}

/** FNV-1a 32 bits, hexadécimal — empreinte courte, non cryptographique. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ─────────────────────────── Segments enregistrés ────────────────────────────

export const SAVED_SEGMENTS_KEY_V1 = "mip-saved-segments";
export const SAVED_SEGMENTS_KEY = "mip-saved-segments-v2";

export interface SavedSegment {
  name: string;
  seg: string;
}

export interface SavedSegmentsV2 {
  version: 2;
  items: SavedSegment[];
}

/**
 * Reprise des segments enregistrés dans le navigateur. Le magasin v2 fait foi dès
 * qu'il existe ; sinon la v1 (tableau `{name, seg}` au format d'URL historique) est
 * convertie. La clé v1 n'est jamais réécrite : un retour arrière la relit intacte,
 * et un segment supprimé en v2 ne ressuscite pas depuis la v1. Les entrées
 * illisibles sont écartées ET comptées, jamais réinterprétées.
 */
export function migrateSavedSegments(rawV2: string | null, rawV1: string | null): { store: SavedSegmentsV2; dropped: number } {
  const items: SavedSegment[] = [];
  let dropped = 0;
  const push = (name: unknown, seg: unknown) => {
    if (typeof name !== "string" || !name.trim() || name.length > 100 || typeof seg !== "string") {
      dropped++;
      return;
    }
    const parsed = parseSegmentParam(seg);
    if (!parsed.ok || parsed.value.length === 0 || parsed.value.length > MAX_CONDITIONS) {
      dropped++;
      return;
    }
    const canonical = serializeSegments(parsed.value);
    const existing = items.findIndex((item) => item.name === name.trim());
    if (existing >= 0) items.splice(existing, 1);
    items.push({ name: name.trim(), seg: canonical });
  };
  const read = (raw: string | null): unknown => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      dropped++;
      return null;
    }
  };
  if (rawV2 !== null) {
    const v2 = read(rawV2);
    if (v2 && typeof v2 === "object" && (v2 as SavedSegmentsV2).version === 2 && Array.isArray((v2 as SavedSegmentsV2).items)) {
      for (const entry of (v2 as SavedSegmentsV2).items) push(entry?.name, entry?.seg);
    } else if (v2 !== null) {
      dropped++;
    }
    return { store: { version: 2, items }, dropped };
  }
  const v1 = read(rawV1);
  if (Array.isArray(v1)) for (const entry of v1) push(entry?.name, entry?.seg);
  else if (v1 !== null) dropped++;
  return { store: { version: 2, items }, dropped };
}
