// Spec OpenAPI 3.0 de l'API v1, construite en code (fonction PURE, testable, aucun import
// next/*). Servie en JSON par app/api/v1/openapi/route.ts. Les schémas reflètent les DTO
// réels de la couche data (lib/queries*.ts, health.ts) ; les timestamps sont sérialisés en
// ISO 8601 par les handlers → modélisés `string`/date-time ici.

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const num = { type: "number" } as const;
const dateTime = { type: "string", format: "date-time" } as const;

function nul(schema: Record<string, unknown>) {
  return { ...schema, nullable: true };
}
function o(properties: Record<string, unknown>, required?: string[]) {
  return { type: "object", properties, ...(required ? { required } : {}) };
}
function arr(items: unknown) {
  return { type: "array", items };
}
function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}
/** Enveloppe { meta, data } commune à toutes les réponses de données. */
function envelope(dataSchema: unknown) {
  return o({ meta: ref("Meta"), data: dataSchema }, ["meta", "data"]);
}
/** Opération GET standard : sécurité, réponses 200/401/500 (+ extras). */
function get(
  summary: string,
  tag: string,
  dataSchema: unknown,
  opts: { params?: unknown[]; extraResponses?: Record<string, unknown>; public?: boolean } = {},
) {
  const responses: Record<string, unknown> = {
    "200": {
      description: "OK",
      content: { "application/json": { schema: envelope(dataSchema) } },
    },
    ...(opts.public ? {} : { "401": ref0("Unauthorized"), "429": ref0("RateLimited") }),
    "500": ref0("ServerError"),
    ...(opts.extraResponses ?? {}),
  };
  return {
    summary,
    tags: [tag],
    ...(opts.public ? {} : { security: [{ bearerAuth: [] }, { sessionCookie: [] }] }),
    ...(opts.params ? { parameters: opts.params } : {}),
    responses,
  };
}
function ref0(name: string) {
  return { $ref: `#/components/responses/${name}` };
}

/**
 * La liste des endpoints de LECTURE, dérivée de la spec ci-dessous.
 *
 * Sert le descripteur `GET /api/v1`, qui énumérait auparavant sa propre liste
 * écrite à la main — et qui a fini par annoncer trois routes `/ai` inexistantes
 * tout en omettant `/docs` et `/deploys`. Une seconde liste, c'est une liste
 * qui dérive : celle-ci ne peut pas contenir une route absente de la spec.
 *
 * Fonction PURE (aucun import next/*), testée.
 */
export function endpointsDeclares(): { method: string; path: string; desc: string }[] {
  const paths = buildOpenApi().paths as Record<string, { get?: { summary?: string } }>;
  return Object.entries(paths)
    .filter(([, op]) => op.get)
    .map(([chemin, op]) => ({
      method: "GET",
      // La spec est relative au serveur `/api/v1` ; le descripteur, lui, donne
      // des chemins absolus — c'est ce qu'un client colle dans une requête.
      path: chemin === "/" ? "/api/v1" : `/api/v1${chemin}`,
      desc: op.get?.summary ?? "",
    }));
}

export function buildOpenApi(): Record<string, unknown> {
  const commonFilters = [
    { $ref: "#/components/parameters/app" },
    { $ref: "#/components/parameters/period" },
    { $ref: "#/components/parameters/device" },
  ];
  const pageParams = [
    { $ref: "#/components/parameters/limit" },
    { $ref: "#/components/parameters/offset" },
  ];

  return {
    openapi: "3.0.3",
    info: {
      title: "MIP RUM — API console v1",
      version: "1.0.0",
      description:
        "API REST lecture seule des agrégats RUM (Real User Monitoring), consommée par le front MIP " +
        "(Angular) ou tout autre client. Auth Bearer (CONSOLE_API_TOKENS) ou cookie de session (RBAC). " +
        "Enveloppe stable { meta, data }. Voir docs/API_CONSOLE.md et docs/DEPLOY_API.md.",
    },
    servers: [{ url: "/api/v1", description: "Base de l'API (relative à l'origine de la console)" }],
    tags: [
      { name: "meta", description: "Découverte, santé, spec" },
      { name: "rum", description: "Agrégats RUM" },
    ],
    paths: {
      "/health": {
        get: get("Liveness (sans auth)", "meta", ref("HealthCheck"), { public: true }),
      },
      "/openapi": {
        get: get("Spec OpenAPI (JSON, sans auth)", "meta", o({}), { public: true }),
      },
      "/": {
        get: get("Découverte : version + endpoints", "meta", ref("Discovery")),
      },
      "/apps": {
        get: get("Catalogue des apps monitorées", "rum", o({ apps: arr(ref("AppItem")) }, ["apps"])),
      },
      "/overview": {
        get: get("Health score + vitals p75 + stats (période précédente incluse)", "rum", ref("Overview"), {
          params: commonFilters,
        }),
      },
      "/vitals": {
        get: get("p75 par vital + séries temporelles", "rum", ref("Vitals"), {
          params: [
            ...commonFilters,
            {
              name: "series",
              in: "query",
              schema: str,
              description: "Vitals à détailler en série : ex. 'LCP,INP' ou 'all' (défaut : aucune série)",
            },
          ],
        }),
      },
      "/pages": {
        get: get("Routes les plus lentes (p75 LCP/INP)", "rum", o({ routes: arr(ref("RouteRow")) }, ["routes"]), {
          params: commonFilters,
        }),
      },
      "/errors": {
        get: get(
          "Groupes d'erreurs (fingerprint) + erreurs non groupables",
          "rum",
          o({ groups: arr(ref("ErrorGroupRow")), unfingerprinted: int, page: ref("Page") }, ["groups", "unfingerprinted"]),
          { params: [...commonFilters, ...pageParams] },
        ),
      },
      "/errors/{fingerprint}": {
        get: get("Détail d'un groupe d'erreurs", "rum", ref("ErrorGroupDetail"), {
          params: [
            { name: "fingerprint", in: "path", required: true, schema: str },
            ...commonFilters,
          ],
          extraResponses: { "404": ref0("NotFound") },
        }),
      },
      "/sessions": {
        get: get(
          "Sessions récentes",
          "rum",
          o({ sessions: arr(ref("SessionRow")), page: ref("Page") }, ["sessions"]),
          { params: [...commonFilters, ...pageParams] },
        ),
      },
      "/sessions/{id}": {
        get: get(
          "Métadonnées + timeline d'une session",
          "rum",
          o({ meta: ref("SessionMeta"), timeline: arr(ref("TimelineItem")) }, ["meta", "timeline"]),
          {
            params: [{ name: "id", in: "path", required: true, schema: str }],
            extraResponses: { "404": ref0("NotFound") },
          },
        ),
      },
      "/tracing": {
        get: get(
          "Couverture tracing + appels API + routes back",
          "rum",
          o(
            { coverage: ref("TraceCoverage"), apiCalls: arr(ref("ApiCallRow")), backRoutes: arr(ref("BackRouteRow")) },
            ["coverage", "apiCalls", "backRoutes"],
          ),
          { params: commonFilters },
        ),
      },
      "/correlation": {
        get: get(
          "Corrélation front/back + angles morts",
          "rum",
          o({ cards: arr(ref("CorrCardRow")), blindSpots: arr(ref("BlindSpotRow")) }, ["cards", "blindSpots"]),
          { params: commonFilters },
        ),
      },
      "/health-grid": {
        get: get(
          "Heatmap santé (jour×heure) + trafic quotidien",
          "rum",
          o({ grid: arr(ref("HealthGridCell")), dailyTraffic: arr(ref("DailyTraffic")) }, ["grid", "dailyTraffic"]),
          { params: commonFilters },
        ),
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Jeton machine listé dans CONSOLE_API_TOKENS (lecture seule, toutes apps).",
        },
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "mip_session",
          description: "Cookie de session JWT de la console (respecte le RBAC viewer scopé).",
        },
      },
      parameters: {
        app: { name: "app", in: "query", schema: str, description: "slug d'app, ou 'all' (défaut)" },
        period: { name: "period", in: "query", schema: { type: "string", enum: ["1h", "24h", "7d"] }, description: "fenêtre (défaut 24h)" },
        device: { name: "device", in: "query", schema: { type: "string", enum: ["mobile", "desktop", "tablet", "all"] }, description: "type d'appareil (défaut all)" },
        limit: { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 }, description: "taille de page (borné 1..200)" },
        offset: { name: "offset", in: "query", schema: { type: "integer", minimum: 0 }, description: "décalage de page" },
      },
      responses: {
        Unauthorized: { description: "Authentification requise/invalide", content: { "application/json": { schema: ref("Error") } } },
        NotFound: { description: "Ressource inconnue (ou hors-scope)", content: { "application/json": { schema: ref("Error") } } },
        RateLimited: { description: "Trop de requêtes (voir en-têtes RateLimit-* / Retry-After)", content: { "application/json": { schema: ref("Error") } } },
        ServerError: { description: "Erreur interne", content: { "application/json": { schema: ref("Error") } } },
      },
      schemas: {
        Error: o({ error: str }, ["error"]),
        Meta: o({ app: str, period: str, device: str, generatedAt: dateTime }, ["app", "period", "device", "generatedAt"]),
        Page: o({ limit: int, offset: int }, ["limit", "offset"]),
        HealthCheck: o({ status: str, service: str, version: str, generatedAt: dateTime }, ["status"]),
        Discovery: o({ version: str, description: str, filters: o({}), endpoints: arr(o({ method: str, path: str, desc: str })) }),
        AppItem: o({ app_id: str, name: str }, ["app_id", "name"]),

        Health: o({ score: nul(num), label: nul(str), factors: arr(ref("HealthFactor")), anomalies: arr(ref("AnomalyRow")) }),
        HealthFactor: o({ key: str, label: str, detail: str, earned: nul(num), max: num }),
        AnomalyRow: o({ app_id: str, route: nul(str), bucket: dateTime, p75: num, mean_7d: num, z_score: num }),

        VitalAgg: o({ name: str, p75: num, n: num }, ["name", "p75", "n"]),
        OverviewStats: o({ sessions: int, errors: int, pageviews: int }, ["sessions", "errors", "pageviews"]),
        SeriesRow: o({ bucket: str, p75: num }, ["bucket", "p75"]),
        Overview: o(
          {
            health: ref("Health"),
            vitals: o({ current: arr(ref("VitalAgg")), previous: arr(ref("VitalAgg")) }, ["current", "previous"]),
            stats: o({ current: ref("OverviewStats"), previous: ref("OverviewStats") }, ["current", "previous"]),
          },
          ["health", "vitals", "stats"],
        ),
        Vitals: o(
          { p75: arr(ref("VitalAgg")), series: { type: "object", additionalProperties: arr(ref("SeriesRow")) } },
          ["p75", "series"],
        ),
        RouteRow: o({ route: str, views: num, lcp_p75: nul(num), inp_p75: nul(num), cls_p75: nul(num), longtasks: num }, ["route"]),

        ErrorGroupRow: o(
          { app_id: str, fingerprint: str, error_type: nul(str), sample_message: nul(str), occurrences: int, sessions: int, first_seen: dateTime, last_seen: dateTime },
          ["app_id", "fingerprint", "occurrences", "sessions"],
        ),
        ErrorSample: o({ message: nul(str), error_type: nul(str), kind: nul(str), stack: nul(str), source: nul(str), lineno: nul(int), colno: nul(int), route: nul(str), session_id: nul(str), release: nul(str), ts: dateTime }),
        ErrorOccurrence: o({ id: int, ts: dateTime, route: nul(str), session_id: nul(str), kind: nul(str), message: nul(str), device_type: nul(str) }),
        ErrorGroupDetail: o({ group: ref("ErrorGroupRow"), last: nul(ref("ErrorSample")), occurrences: arr(ref("ErrorOccurrence")) }, ["group", "occurrences"]),

        SessionRow: o(
          { session_id: str, app_id: str, device_type: nul(str), geo_country: nul(str), user_agent: nul(str), started_at: dateTime, last_seen_at: dateTime, page_count: int, routes: nul(arr(str)), err_count: int },
          ["session_id", "app_id"],
        ),
        SessionMeta: o(
          { session_id: str, app_id: str, client_id: nul(str), user_hash: nul(str), user_agent: nul(str), device_type: nul(str), geo_country: nul(str), started_at: dateTime, last_seen_at: dateTime, page_count: int },
          ["session_id", "app_id"],
        ),
        TimelineItem: o(
          { kind: { type: "string", enum: ["pageview", "vital", "error", "breadcrumb", "longtask", "event", "api"] }, ts: dateTime, title: nul(str), detail: nul(str), value: nul(num), rating: nul(str) },
          ["kind", "ts"],
        ),

        TraceCoverage: o({ total: num, correlated: num, back_total: num, front_p75: nul(num), back_p75: nul(num) }),
        ApiCallRow: o({ url: str, method: str, n: num, front_p75: num, back_p75: nul(num), err: num }, ["url", "method"]),
        BackRouteRow: o({ route: str, n: num, p75: num, p95: num, err: num }, ["route"]),

        CorrCardRow: o({ app_id: str, route: nul(str), rum_lcp_p75: nul(num), rum_inp_p75: nul(num), rum_sessions: nul(num), syn_latency_avg: nul(num), syn_score_avg: nul(num), syn_state: nul(str), syn_measures: nul(str) }, ["app_id"]),
        BlindSpotRow: o({ app_id: str, route: nul(str), bucket: dateTime, rum_lcp_p75: num, syn_latency_avg: num, syn_state: str, gap_ms: num }, ["app_id"]),

        HealthGridCell: o({ day: str, hour: int, good_w: num, total_w: num }, ["day", "hour"]),
        DailyTraffic: o({ day: str, pageviews: num, errors: num }, ["day"]),
      },
    },
  };
}
