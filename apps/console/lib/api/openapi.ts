// Spec OpenAPI 3.0 de l'API v1, construite en code (fonction PURE, testable, aucun import
// next/*). Servie en JSON par app/api/v1/openapi/route.ts. Les schémas reflètent les DTO
// réels de la couche data (lib/queries*.ts, health.ts) ; les timestamps sont sérialisés en
// ISO 8601 par les handlers → modélisés `string`/date-time ici.

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const num = { type: "number" } as const;
const bool = { type: "boolean" } as const;
const dateTime = { type: "string", format: "date-time" } as const;
const traceId = { type: "string", pattern: "^[0-9a-f]{32}$" } as const;
const spanId = { type: "string", pattern: "^[0-9a-f]{16}$" } as const;

// Recopiés de lib/queries-v2.ts et lib/queries-errors.ts : ces modules ouvrent le
// pool PostgreSQL à l'import, et cette spec doit rester pure. Une copie dérive :
// tests/unit/api-v1-errors-route.test.ts compare les listes publiées aux originales.
const errorStatus = { type: "string", enum: ["open", "resolved", "ignored"] } as const;
// OpenAPI 3.0.3 : `nullable` n'ajoute pas null à un `enum` — il doit y figurer.
const errorSource = {
  type: "string",
  nullable: true,
  enum: [
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
    null,
  ],
} as const;

// Recopié de ingest/lib/error-symbolication.mjs (statuts de migration-v71).
const symbolicationStatus = {
  type: "string",
  nullable: true,
  enum: ["pending", "resolved", "unavailable", "failed", null],
  description:
    "resolved : stack source disponible ; unavailable : aucune map pour la release ou positions absentes ; " +
    "failed : map inutilisable ; pending : budget d'ingestion épuisé ; null : aucune frame JavaScript",
} as const;

// Recopiés de lib/error-issues.ts (taxonomies de migration-v72), pour la même raison.
const issueStatus = { type: "string", enum: ["open", "for_review", "resolved", "ignored"] } as const;
const groupingBasis = {
  type: "string",
  enum: ["override", "symbolicated_frame", "normalized_frame", "low_confidence"],
  description:
    "override : clé déclarée par l'émetteur ; symbolicated_frame : première frame applicative en positions source ; " +
    "normalized_frame : première frame applicative minifiée ou non symbolisée ; low_confidence : aucune frame applicative, repli peu discriminant",
} as const;

/** Valeur exacte d'une dimension : bornée, sans caractère de contrôle (contrat P6.2). */
const dimension = { type: "string", minLength: 1, maxLength: 500 } as const;

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
    // Le contrat commun peut refuser AVANT la lecture : filtre illisible ou non
    // applicable (400 typé), périmètre vide ou app hors périmètre (403).
    ...(opts.public
      ? {}
      : {
          "400": ref0("BadRequest"),
          "401": ref0("Unauthorized"),
          "403": ref0("Forbidden"),
          "429": ref0("RateLimited"),
        }),
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
    { $ref: "#/components/parameters/from" },
    { $ref: "#/components/parameters/to" },
    { $ref: "#/components/parameters/device" },
    { $ref: "#/components/parameters/browser" },
    { $ref: "#/components/parameters/os" },
    { $ref: "#/components/parameters/env" },
    { $ref: "#/components/parameters/service" },
    { $ref: "#/components/parameters/release" },
    { $ref: "#/components/parameters/route" },
    { $ref: "#/components/parameters/country" },
    { $ref: "#/components/parameters/seg" },
    { $ref: "#/components/parameters/bots" },
    { $ref: "#/components/parameters/internal" },
  ];
  // Les issues portent leur propre `release` (celle des occurrences comptées) :
  // deux paramètres du même nom seraient un descripteur invalide.
  const issueFilters = commonFilters.filter((p) => p.$ref !== "#/components/parameters/release");
  const pageParams = [
    { $ref: "#/components/parameters/limit" },
    { $ref: "#/components/parameters/offset" },
  ];
  const eventPageParams = [
    { $ref: "#/components/parameters/limit" },
    { $ref: "#/components/parameters/eventOffset" },
    { $ref: "#/components/parameters/eventCursor" },
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
      { name: "explorer", description: "Explorer générique : registre de capacités et requête analytique bornée" },
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
          "Groupes d'erreurs (app + fingerprint) sur la fenêtre : impact, totaux, tendance, échantillonnage",
          "rum",
          ref("ErrorGroupList"),
          {
            params: [...commonFilters, { $ref: "#/components/parameters/limit" }, { $ref: "#/components/parameters/errorOffset" }],
            extraResponses: { "403": ref0("Forbidden") },
          },
        ),
      },
      "/errors/{fingerprint}": {
        get: get(
          "Détail d'un groupe d'erreurs : impact, tendance, exemplaire et occurrences liées",
          "rum",
          ref("ErrorGroupDetail"),
          {
            params: [
              { name: "fingerprint", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 64 } },
              ...commonFilters,
              { $ref: "#/components/parameters/occurrenceLimit" },
              { $ref: "#/components/parameters/errorCursor" },
            ],
            extraResponses: {
              // Un 400 propre à cette route : l'ambiguïté se résout en rappelant avec `app`.
              "400": {
                description:
                  "fingerprint ou cursor invalide, ou fingerprint présent dans plusieurs apps du périmètre sans `app` " +
                  "(le message liste les apps candidates : rappeler avec l'une d'elles)",
                content: { "application/json": { schema: ref("Error") } },
              },
              "404": ref0("NotFound"),
            },
          },
        ),
      },
      "/issues": {
        get: get(
          "Issues d'erreurs (regroupement v2) et groupes historiques non repris : impact, statut, couverture, échantillonnage",
          "rum",
          ref("IssueList"),
          {
            params: [
              // `release` vient d'issueRelease : même dimension, bornes de P5.5.
              ...issueFilters,
              { $ref: "#/components/parameters/issueStatus" },
              { $ref: "#/components/parameters/issueRelease" },
              { $ref: "#/components/parameters/issueSource" },
              { $ref: "#/components/parameters/issueLimit" },
              { $ref: "#/components/parameters/issueCursor" },
            ],
            extraResponses: { "400": ref0("BadRequest"), "403": ref0("Forbidden") },
          },
        ),
      },
      "/issues/{id}": {
        get: get(
          "Détail d'une issue : état, groupes historiques repris, impact, tendance, dernier exemplaire et occurrences liées",
          "rum",
          ref("IssueDetail"),
          {
            params: [
              { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
              ...commonFilters,
              { $ref: "#/components/parameters/occurrenceLimit" },
              { $ref: "#/components/parameters/errorCursor" },
            ],
            extraResponses: { "404": ref0("NotFound") },
          },
        ),
      },
      "/issues/{id}/activity": {
        get: get(
          "Historique d'une issue (P5.6) : statuts, assignations, commentaires, liens de ticket et régressions confirmées",
          "rum",
          ref("IssueActivityPage"),
          {
            params: [
              { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
              { $ref: "#/components/parameters/activityLimit" },
              { $ref: "#/components/parameters/errorCursor" },
            ],
            extraResponses: { "400": ref0("BadRequest"), "404": ref0("NotFound"), "503": ref0("Unavailable") },
          },
        ),
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
      "/events": {
        get: get(
          "Explorer les événements RUM : journal, tendance et facettes bornées",
          "rum",
          ref("EventExplorer"),
          {
            params: [
              ...commonFilters,
              { $ref: "#/components/parameters/eventKind" },
              { $ref: "#/components/parameters/eventName" },
              { $ref: "#/components/parameters/eventAttrSource" },
              { $ref: "#/components/parameters/eventAttrKey" },
              { $ref: "#/components/parameters/eventAttrType" },
              { $ref: "#/components/parameters/eventAttrValue" },
              ...eventPageParams,
            ],
            extraResponses: { "400": ref0("BadRequest") },
          },
        ),
      },
      "/actions": {
        get: get(
          "Actions causales agrégées (coût, erreurs et sessions)",
          "rum",
          o(
            { actions: arr(ref("TopActionRow")), summary: ref("ActionSummary"), page: ref("Page") },
            ["actions", "summary", "page"],
          ),
          {
            params: [...commonFilters, { $ref: "#/components/parameters/limit" }, { $ref: "#/components/parameters/actionOffset" }],
          },
        ),
      },
      // P7.5 — le runtime React Native. `platform` n'est pas une dimension
      // nouvelle : c'est `os`, restreint aux deux valeurs qu'un runtime mobile
      // peut rendre, et INTERSECTÉ avec un `os=` déjà présent.
      //
      // Cet endpoint n'expose AUCUN champ pour les crashes natifs, les ANR et le
      // démarrage natif. Ce n'est pas un oubli : leur donner un champ, fût-il
      // `null`, laisserait croire qu'ils sont mesurés. `capabilities` dit
      // capacité par capacité ce qui est collecté, ce qui ne l'est pas, et ce
      // dont personne n'a rien déclaré.
      "/mobile/summary": {
        get: get(
          "Résumé d'un périmètre React Native : capacités déclarées, sessions, erreurs JS, démarrage, écrans et requêtes",
          "rum",
          ref("MobileSummary"),
          {
            params: [
              ...commonFilters.filter(
                (p) =>
                  ![
                    "#/components/parameters/browser",
                    "#/components/parameters/env",
                    "#/components/parameters/service",
                    "#/components/parameters/route",
                    "#/components/parameters/country",
                  ].includes(p.$ref),
              ),
              { $ref: "#/components/parameters/platform" },
            ],
            extraResponses: { "400": ref0("BadRequest") },
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
      "/explorer/schema": {
        get: get(
          "Explorer : registre des capacités (jeux, mesures, dimensions, limites)",
          "explorer",
          ref("ExplorerSchema"),
        ),
      },
      "/explorer/query": {
        // POST, et pourtant une LECTURE : l'AST ne tient pas dans une query string.
        // Même authentification que les GET — un jeton en lecture seule l'appelle.
        post: {
          summary: "Explorer : exécuter une requête analytique bornée (lecture)",
          tags: ["explorer"],
          security: [{ bearerAuth: [] }, { sessionCookie: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("ExplorerQuery") } },
          },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: ref("ExplorerResult") } } },
            "400": ref0("BadRequest"),
            "401": ref0("Unauthorized"),
            "403": ref0("Forbidden"),
            "413": ref0("PayloadTooLarge"),
            "429": ref0("RateLimited"),
            "500": ref0("ServerError"),
            "503": ref0("BudgetExceeded"),
          },
        },
      },
      "/explorer/views": {
        get: get(
          "Vues enregistrées lisibles par la session (les siennes, plus celles de ses apps si admin)",
          "explorer",
          o({ views: arr(ref("SavedView")) }, ["views"]),
          { params: [{ $ref: "#/components/parameters/app" }] },
        ),
        // Écriture de SESSION : un jeton CONSOLE_API_TOKENS est refusé, y compris
        // en lecture — une vue est personnelle, jamais exposée à une machine.
        post: {
          summary: "Enregistrer une analyse comme vue personnelle",
          tags: ["explorer"],
          security: [{ sessionCookie: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: o({ name: { ...str, maxLength: 100 }, query: ref("ExplorerQuery") }, ["name", "query"]),
              },
            },
          },
          responses: {
            "201": { description: "Créée", content: { "application/json": { schema: o({ view: ref("SavedView") }, ["view"]) } } },
            "400": ref0("BadRequest"),
            "401": ref0("Unauthorized"),
            "403": ref0("Forbidden"),
            "413": ref0("PayloadTooLarge"),
            "422": ref0("LimitReached"),
            "429": ref0("RateLimited"),
            "500": ref0("ServerError"),
            "503": ref0("Unavailable"),
          },
        },
      },
      "/explorer/views/{id}": {
        patch: {
          summary: "Renommer une vue et/ou remplacer son AST (propriétaire seul)",
          tags: ["explorer"],
          security: [{ sessionCookie: [] }],
          parameters: [{ $ref: "#/components/parameters/savedViewId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: o(
                  {
                    name: { ...str, maxLength: 100 },
                    query: ref("ExplorerQuery"),
                    expectedRevision: { ...str, description: "révision LUE ; une valeur périmée reçoit 409" },
                  },
                  ["expectedRevision"],
                ),
              },
            },
          },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: o({ view: ref("SavedView") }, ["view"]) } } },
            "400": ref0("BadRequest"),
            "401": ref0("Unauthorized"),
            "403": ref0("Forbidden"),
            "404": ref0("NotFound"),
            "409": ref0("RevisionConflict"),
            "429": ref0("RateLimited"),
            "500": ref0("ServerError"),
            "503": ref0("Unavailable"),
          },
        },
        delete: {
          summary: "Supprimer une vue (propriétaire seul) ; aucune charge utile",
          tags: ["explorer"],
          security: [{ sessionCookie: [] }],
          parameters: [{ $ref: "#/components/parameters/savedViewId" }],
          responses: {
            "200": { description: "Supprimée", content: { "application/json": { schema: o({ deleted: bool }, ["deleted"]) } } },
            "401": ref0("Unauthorized"),
            "403": ref0("Forbidden"),
            "404": ref0("NotFound"),
            "429": ref0("RateLimited"),
            "500": ref0("ServerError"),
            "503": ref0("Unavailable"),
          },
        },
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
        device: { name: "device", in: "query", schema: { type: "string", enum: ["mobile", "desktop", "tablet", "all"] }, description: "type d'appareil (défaut all) ; une valeur inconnue vaut all" },
        from: { name: "from", in: "query", schema: { type: "string", format: "date-time" }, description: "début INCLUS d'une plage personnalisée, instant ISO UTC explicite (…Z) ; exige to et exclut period" },
        to: { name: "to", in: "query", schema: { type: "string", format: "date-time" }, description: "fin EXCLUE d'une plage personnalisée (30 jours au plus, jamais dans le futur)" },
        browser: { name: "browser", in: "query", schema: dimension, description: "navigateur exact ; 400 unsupported_dimension si la mesure ne le porte pas" },
        os: { name: "os", in: "query", schema: dimension, description: "système exact ; 400 unsupported_dimension si la mesure ne le porte pas" },
        env: { name: "env", in: "query", schema: dimension, description: "environnement déclaré par l'émetteur de l'occurrence" },
        service: { name: "service", in: "query", schema: dimension, description: "service déclaré par un émetteur backend (erreurs, spans)" },
        release: { name: "release", in: "query", schema: dimension, description: "release de l'occurrence (jamais celle, mutable, de la session)" },
        route: { name: "route", in: "query", schema: dimension, description: "route normalisée exacte (jamais une URL brute)" },
        country: { name: "country", in: "query", schema: dimension, description: "pays estimé d'après le fuseau de la session (geo_source=timezone)" },
        seg: { name: "seg", in: "query", schema: { type: "string", maxLength: 2048 }, description: "segment : v2 'v2:dimension:eq|neq|is_null[:valeur encodée]' séparés par ';' (format v1 'geo==FR;device!=mobile' encore lu) ; 10 conditions au plus, jeton illisible = 400" },
        bots: { name: "bots", in: "query", schema: { type: "string", enum: ["1"] }, description: "1 = inclure le trafic non humain (exclu par défaut)" },
        internal: { name: "internal", in: "query", schema: { type: "string", enum: ["1"] }, description: "1 = inclure les apps internes dans la vue « toutes apps » (exclues par défaut)" },
        eventKind: { name: "kind", in: "query", schema: { type: "string", enum: ["pageview", "vital", "error", "resource", "longtask", "breadcrumb", "event", "span"] }, description: "catégorie d'événement indexé (défaut toutes)" },
        limit: { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 }, description: "taille de page (borné 1..200)" },
        offset: { name: "offset", in: "query", schema: { type: "integer", minimum: 0 }, description: "décalage de page" },
        eventOffset: { name: "offset", in: "query", schema: { type: "integer", minimum: 0, maximum: 10000 }, description: "décalage du journal d'événements (borné à 10 000)" },
        eventCursor: { name: "cursor", in: "query", schema: { type: "string", maxLength: 512 }, description: "curseur opaque (ts,id) renvoyé dans page.next_cursor" },
        eventName: { name: "name", in: "query", schema: { type: "string", minLength: 1, maxLength: 100 }, description: "nom exact d'événement custom" },
        eventAttrSource: { name: "attr_source", in: "query", schema: { type: "string", enum: ["props", "context"] }, description: "objet top-level portant l'attribut" },
        eventAttrKey: { name: "attr_key", in: "query", schema: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,99}$" }, description: "clé top-level sûre, jamais JSONPath" },
        eventAttrType: { name: "attr_type", in: "query", schema: { type: "string", enum: ["string", "number", "boolean", "null"] }, description: "type JSON primitif exact" },
        eventAttrValue: { name: "attr_value", in: "query", schema: { type: "string", maxLength: 500 }, description: "valeur exacte sérialisée selon attr_type" },
        actionOffset: { name: "offset", in: "query", schema: { type: "integer", minimum: 0, maximum: 10000 }, description: "décalage du classement d'actions (borné à 10 000)" },
        errorOffset: { name: "offset", in: "query", schema: { type: "integer", minimum: 0, maximum: 10000 }, description: "décalage de la liste de groupes d'erreurs (borné à 10 000)" },
        occurrenceLimit: { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 100 }, description: "occurrences par page (borné 1..100)" },
        errorCursor: { name: "cursor", in: "query", schema: { type: "string", maxLength: 512 }, description: "curseur opaque (ts à la microseconde, id) renvoyé dans page.next_cursor ; un curseur modifié reçoit 400" },
        issueStatus: { name: "status", in: "query", schema: issueStatus, description: "statut de l'entrée (un groupe historique n'est jamais for_review) ; absent = tous" },
        issueRelease: { name: "release", in: "query", schema: { type: "string", minLength: 1, maxLength: 200 }, description: "release exacte des occurrences comptées" },
        issueSource: { name: "source", in: "query", schema: { ...errorSource, nullable: false, enum: errorSource.enum.filter((s) => s !== null) }, description: "source des occurrences comptées" },
        issueLimit: { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }, description: "entrées par page (borné 1..100)" },
        issueCursor: { name: "cursor", in: "query", schema: { type: "string", maxLength: 512 }, description: "curseur opaque renvoyé dans data.next_cursor, avec les mêmes filtres ; un curseur modifié reçoit 400" },
        activityLimit: { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }, description: "activités par page (borné 1..100)" },
        savedViewId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "identifiant d'une vue enregistrée" },
        platform: { name: "platform", in: "query", schema: { type: "string", enum: ["ios", "android"] }, description: "plateforme mobile ; traduite en condition `os` du contrat et INTERSECTÉE avec un `os=` déjà présent (jamais un remplacement). Absente = les deux" },
      },
      responses: {
        BadRequest: { description: "Paramètre invalide, ou filtre que la mesure ne sait pas appliquer (corps typé : code, parameter, dimension)", content: { "application/json": { schema: ref("Error") } } },
        Unauthorized: { description: "Authentification requise/invalide", content: { "application/json": { schema: ref("Error") } } },
        Forbidden: { description: "Périmètre : aucune application autorisée (no_app_access) ou app demandée hors périmètre (forbidden_app) — jamais un rabattement silencieux", content: { "application/json": { schema: ref("Error") } } },
        NotFound: { description: "Ressource inconnue (ou hors-scope)", content: { "application/json": { schema: ref("Error") } } },
        RateLimited: { description: "Trop de requêtes (voir en-têtes RateLimit-* / Retry-After)", content: { "application/json": { schema: ref("Error") } } },
        ServerError: { description: "Erreur interne", content: { "application/json": { schema: ref("Error") } } },
        PayloadTooLarge: { description: "Corps de requête au-delà de 32 Kio (code body_too_large)", content: { "application/json": { schema: ref("Error") } } },
        BudgetExceeded: { description: "Budget de lecture dépassé (code query_budget_exceeded) : la requête n'a pas abouti — ce n'est jamais un résultat à zéro", content: { "application/json": { schema: ref("Error") } } },
        Unavailable: { description: "Schéma requis non migré (ex. migration-v73 pour le workflow des issues, migration-v79 pour les vues enregistrées)", content: { "application/json": { schema: ref("Error") } } },
        RevisionConflict: { description: "La ressource a changé depuis sa lecture : rien n'est écrit, le corps porte la révision courante", content: { "application/json": { schema: ref("Error") } } },
        LimitReached: { description: "Plafond atteint (50 vues enregistrées par application et par compte) : recharger n'y change rien", content: { "application/json": { schema: ref("Error") } } },
      },
      schemas: {
        Error: o(
          {
            error: str,
            // Code stable du contrat commun : de quoi réagir sans lire le message.
            code: {
              type: "string",
              enum: [
                "no_app_access", "forbidden_app", "invalid_range", "range_conflict", "range_too_long",
                "range_in_future", "invalid_filter", "too_many_conditions", "ambiguous_parameter", "unsupported_dimension",
                // Explorer (P6.4) : validation de l'AST, curseur et budget de lecture.
                "invalid_query", "unsupported_dataset", "unsupported_measure", "unsupported_visualization",
                "invalid_cursor", "stale_cursor", "body_too_large", "query_budget_exceeded",
              ],
            },
            parameter: str,
            dimension: str,
          },
          ["error"],
        ),
        Meta: o(
          {
            app: str,
            period: str,
            device: str,
            generatedAt: dateTime,
            query_version: int,
            scope: ref("MetaScope"),
            range: ref("MetaRange"),
            filters: ref("MetaFilters"),
          },
          ["app", "period", "device", "generatedAt", "query_version", "scope", "range", "filters"],
        ),
        MetaScope: o({ requested_app: nul(str), effective_apps: nul(arr(str)) }, ["requested_app", "effective_apps"]),
        MetaRange: o({ from: dateTime, to: dateTime, preset: nul(str), bucket_seconds: int }, ["from", "to", "preset", "bucket_seconds"]),
        MetaFilters: o(
          { conditions: arr(ref("MetaCondition")), include_bots: { type: "boolean" }, include_internal: { type: "boolean" } },
          ["conditions", "include_bots", "include_internal"],
        ),
        MetaCondition: o(
          { dimension: str, operator: { type: "string", enum: ["eq", "neq", "is_null"] }, value: nul(str) },
          ["dimension", "operator", "value"],
        ),
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

        // Tous les compteurs d'erreurs portent sur la FENÊTRE demandée (`period`,
        // [début, fin)) et sur la même population que l'écran /errors ; seul
        // `first_seen` est la première apparition connue, toutes fenêtres confondues.
        // Trois populations distinctes, jamais additionnées : sessions, visiteurs,
        // utilisateurs identifiés. Un compte à null = personne de CONNU (erreur sans
        // session ni identité), pas zéro ; une couverture à null = aucune occurrence.
        ErrorImpact: o(
          {
            occurrences: { type: "integer", description: "somme des répétitions reçues (pas un nombre de lignes)" },
            sessions_affected: nul(int),
            visitors_affected: nul(int),
            identified_users_affected: nul(int),
            session_coverage: nul({ type: "number", minimum: 0, maximum: 1, description: "part des occurrences rattachées à une session de la même app" }),
            identity_coverage: nul({ type: "number", minimum: 0, maximum: 1, description: "part des occurrences rattachées à un visiteur ou à une identité" }),
          },
          ["occurrences", "sessions_affected", "visitors_affected", "identified_users_affected", "session_coverage", "identity_coverage"],
        ),
        // `sessions` et `users_affected` (visiteurs distincts) sont les champs
        // historiques, inchangés : les comptes d'impact avec null ramené à 0.
        ErrorGroupRow: {
          allOf: [
            ref("ErrorImpact"),
            o(
              {
                app_id: str,
                fingerprint: str,
                error_type: nul(str),
                sample_message: nul(str),
                sessions: int,
                users_affected: int,
                first_seen: dateTime,
                last_seen: dateTime,
                status: errorStatus,
                resolved_at: nul(dateTime),
                regressed: { type: "boolean", description: "groupe marqué résolu puis revu depuis (last_seen > resolved_at) ; jamais null" },
              },
              ["app_id", "fingerprint", "sessions", "users_affected", "first_seen", "last_seen", "status", "resolved_at", "regressed"],
            ),
          ],
        },
        ErrorTotals: {
          allOf: [
            ref("ErrorImpact"),
            o({ groups: int, unfingerprinted: int }, ["groups", "unfingerprinted"]),
          ],
        },
        ErrorTrendPoint: o({ bucket: dateTime, occurrences: int }, ["bucket", "occurrences"]),
        ErrorSampling: o(
          {
            min_inclusion_probability: nul({ type: "number", minimum: 0, maximum: 1 }),
            message: nul({ type: "string", description: "non null seulement si une erreur a pu ne pas être conservée (0 < probabilité < 1) ; aucune extrapolation n'est appliquée" }),
          },
          ["min_inclusion_probability", "message"],
        ),
        ErrorEnrichment: o({ available: { type: "boolean" }, diagnostic: nul(str) }, ["available", "diagnostic"]),
        ErrorGroupList: o(
          {
            groups: arr(ref("ErrorGroupRow")),
            unfingerprinted: int,
            page: ref("Page"),
            total: { type: "integer", description: "nombre de groupes de la population filtrée" },
            totals: ref("ErrorTotals"),
            trend: arr(ref("ErrorTrendPoint")),
            sampling: ref("ErrorSampling"),
            enrichment: ref("ErrorEnrichment"),
          },
          ["groups", "unfingerprinted", "page", "total", "totals", "trend", "sampling", "enrichment"],
        ),
        // Dernier exemplaire du groupe dans la fenêtre filtrée. Les champs d'enveloppe
        // (trace, source, handled…) valent null avant la migration v69 ou quand
        // l'émetteur ne les fournit pas.
        ErrorSample: o(
          {
            id: int,
            ts: dateTime,
            message: nul(str),
            error_type: nul(str),
            kind: nul(str),
            stack: nul(str),
            source: nul(str),
            lineno: nul(int),
            colno: nul(int),
            route: nul(str),
            session_id: nul(str),
            release: nul(str),
            occurrences: int,
            trace_id: nul(traceId),
            source_parent_span_id: nul(spanId),
            error_source: errorSource,
            handled: nul(bool),
            is_fatal: nul(bool),
            view_name: nul(str),
            env: nul({ type: "string", description: "environnement déclaré par l'émetteur, non vérifié" }),
            service: nul(str),
            action_id: nul(str),
            stack_symbolicated: nul({
              type: "string",
              description:
                "stack réécrite en positions source par les source maps de la release, scrubbed ; `stack` reste la stack brute",
            }),
            symbolication_status: symbolicationStatus,
          },
          ["id", "ts", "occurrences"],
        ),
        // Un lien vaut true seulement si la relation existe DANS LA MÊME APP : les
        // identifiants de session, trace et span sont émis par le client.
        ErrorOccurrenceLinks: o(
          {
            session: bool,
            replay: bool,
            trace: bool,
            parent_span: bool,
            action: nul(o({ id: str, name: nul(str), type: nul(str) }, ["id", "name", "type"])),
          },
          ["session", "replay", "trace", "parent_span", "action"],
        ),
        ErrorOccurrence: o(
          {
            id: int,
            ts: dateTime,
            route: nul(str),
            session_id: nul({ type: "string", description: "tel qu'émis ; links.session dit s'il existe dans la même app" }),
            kind: nul(str),
            message: nul(str),
            device_type: nul(str),
            occurrences: int,
            release: nul(str),
            error_source: errorSource,
            handled: nul(bool),
            is_fatal: nul(bool),
            view_name: nul(str),
            env: nul(str),
            service: nul(str),
            trace_id: nul(traceId),
            source_parent_span_id: nul(spanId),
            links: ref("ErrorOccurrenceLinks"),
          },
          ["id", "ts", "occurrences", "links"],
        ),
        ErrorGroupDetail: o(
          {
            group: ref("ErrorGroupRow"),
            last: nul(ref("ErrorSample")),
            occurrences: arr(ref("ErrorOccurrence")),
            trend: arr(ref("ErrorTrendPoint")),
            page: o({ limit: int, next_cursor: nul(str) }, ["limit", "next_cursor"]),
            sampling: ref("ErrorSampling"),
            enrichment: ref("ErrorEnrichment"),
          },
          ["group", "last", "occurrences", "trend", "page", "sampling", "enrichment"],
        ),

        // P5.5 — une entrée de liste est une issue (identité durable, regroupement v2)
        // OU un groupe historique qu'aucune issue ne reprend. Chaque occurrence de la
        // population est comptée dans une seule entrée.
        IssueEntry: {
          allOf: [
            ref("ErrorImpact"),
            o(
              {
                kind: { type: "string", enum: ["issue", "legacy"] },
                id: { type: "string", format: "uuid", description: "kind=issue seulement" },
                fingerprint: { type: "string", description: "kind=legacy seulement : empreinte historique, à ouvrir avec /errors/{fingerprint}" },
                app_id: str,
                error_type: nul(str),
                sample_message: nul(str),
                status: issueStatus,
                reappeared: { type: "boolean", description: "résolue puis revue depuis : réapparition à vérifier, jamais une régression confirmée" },
                resolved_at: nul(dateTime),
                first_seen: { ...dateTime, description: "issue : première vue persistée (groupes historiques compris) ; groupe historique : première apparition connue" },
                last_seen: dateTime,
                origin: { type: "string", enum: ["new", "migration"], description: "kind=issue : migration = clé v2 recouvrant un groupe historique déjà vu" },
                grouping_basis: groupingBasis,
                first_release: nul(str),
                last_release: nul(str),
                revision: { type: "string", pattern: "^[0-9]+$", description: "bigint sérialisé en chaîne (concurrence optimiste)" },
              },
              ["kind", "app_id", "status", "reappeared", "first_seen", "last_seen"],
            ),
          ],
        },
        IssueCoverage: o(
          {
            grouping_version: { type: "integer", enum: [2] },
            available: { type: "boolean", description: "migration v72 appliquée ; sinon toutes les entrées sont des groupes historiques" },
            active_apps: arr(str),
            issues: int,
            legacy_groups: int,
            occurrences_in_issues: int,
            occurrences_legacy: int,
            occurrences_low_confidence: int,
            issue_share: nul({ type: "number", minimum: 0, maximum: 1 }),
          },
          ["grouping_version", "available", "active_apps", "issues", "legacy_groups", "occurrences_in_issues", "occurrences_legacy", "occurrences_low_confidence", "issue_share"],
        ),
        IssueList: o(
          {
            issues: arr(ref("IssueEntry")),
            total: { type: "integer", description: "entrées de la population filtrée (statut compris)" },
            next_cursor: nul(str),
            sampling: ref("ErrorSampling"),
            coverage: ref("IssueCoverage"),
          },
          ["issues", "total", "next_cursor", "sampling", "coverage"],
        ),
        IssueLegacyGroup: o(
          {
            fingerprint: str,
            legacy_status: nul({ type: "string", enum: ["open", "resolved", "ignored", null] }),
            legacy_resolved_at: nul(dateTime),
            current_status: { type: "string", enum: ["open", "resolved", "ignored"] },
            note: nul(str),
            issues: { type: "integer", description: "issues reprenant la même empreinte (plus d'une : empreinte répartie)" },
            attached_at: dateTime,
          },
          ["fingerprint", "legacy_status", "current_status", "note", "issues", "attached_at"],
        ),
        IssueRecord: o(
          {
            id: { type: "string", format: "uuid" },
            app_id: str,
            grouping_version: { type: "integer", enum: [2] },
            grouping_basis: groupingBasis,
            origin: { type: "string", enum: ["new", "migration"] },
            status: issueStatus,
            status_source: { type: "string", enum: ["system", "migration", "user"] },
            first_seen: dateTime,
            last_seen: dateTime,
            first_release: nul(str),
            last_release: nul(str),
            resolved_at: nul(dateTime),
            resolved_release: nul(str),
            resolved_env: nul(str),
            reappeared: bool,
            revision: { type: "string", pattern: "^[0-9]+$" },
            created_at: dateTime,
            updated_at: dateTime,
            grouping_active: { type: "boolean", description: "false après un retour arrière : l'issue reste lisible, ses nouvelles occurrences ne lui sont plus rattachées" },
            legacy_groups: arr(ref("IssueLegacyGroup")),
          },
          ["id", "app_id", "grouping_version", "grouping_basis", "origin", "status", "first_seen", "last_seen", "revision", "grouping_active", "legacy_groups"],
        ),
        IssueUserRef: o(
          {
            user_id: { type: "string", pattern: "^[0-9]+$", description: "identifiant du compte console (bigint en chaîne)" },
            email: nul({ type: "string", description: "adresse du compte, pour une session admin seulement ; null pour un jeton, un viewer, ou un compte supprimé" }),
          },
          ["user_id", "email"],
        ),
        IssueLink: o(
          {
            id: { type: "string", pattern: "^[0-9]+$" },
            url: { type: "string", format: "uri", maxLength: 2048, description: "https, normalisée, sans identifiants" },
            label: { type: "string", maxLength: 120 },
            created_by: nul(ref("IssueUserRef")),
            created_at: dateTime,
          },
          ["id", "url", "label", "created_by", "created_at"],
        ),
        IssueActivity: o(
          {
            id: { type: "string", pattern: "^[0-9]+$" },
            kind: { type: "string", enum: ["status", "assignee", "comment", "link", "regression"] },
            actor: o({ kind: { type: "string", enum: ["user", "system"] }, user: nul(ref("IssueUserRef")) }, ["kind", "user"]),
            old_status: nul({ ...issueStatus, enum: [...issueStatus.enum, null] }),
            new_status: nul({ ...issueStatus, enum: [...issueStatus.enum, null] }),
            old_assignee: nul(ref("IssueUserRef")),
            new_assignee: nul(ref("IssueUserRef")),
            body: nul({ type: "string", maxLength: 2000, description: "commentaire scrubbé à l'enregistrement" }),
            legacy_fingerprint: nul({ type: "string", description: "commentaire système : note du groupe historique reprise une fois" }),
            link: nul(ref("IssueLink")),
            release: nul({ type: "string", description: "status → resolved : release de référence ; regression : release qui rouvre" }),
            reference_release: nul({ type: "string", description: "regression : release de référence dépassée" }),
            env: nul(str),
            created_at: dateTime,
          },
          ["id", "kind", "actor", "created_at"],
        ),
        IssueActivityPage: o(
          { activities: arr(ref("IssueActivity")), next_cursor: nul(str) },
          ["activities", "next_cursor"],
        ),
        IssueDetail: o(
          {
            issue: ref("IssueRecord"),
            impact: ref("ErrorImpact"),
            trend: arr(ref("ErrorTrendPoint")),
            last_sample: nul(ref("ErrorSample")),
            occurrences: arr(ref("ErrorOccurrence")),
            next_cursor: nul(str),
            sampling: ref("ErrorSampling"),
          },
          ["issue", "impact", "trend", "last_sample", "occurrences", "next_cursor", "sampling"],
        ),

        SessionRow: o(
          { session_id: str, app_id: str, device_type: nul(str), geo_country: nul(str), user_agent: nul(str), started_at: dateTime, last_seen_at: dateTime, page_count: int, routes: nul(arr(str)), err_count: int },
          ["session_id", "app_id"],
        ),
        SessionMeta: o(
          { session_id: str, app_id: str, client_id: nul(str), visitor_id: nul(str), id_kind: nul(str), user_hash: nul(str), user_agent: nul(str), device_type: nul(str), geo_country: nul(str), started_at: dateTime, last_seen_at: dateTime, page_count: int },
          ["session_id", "app_id"],
        ),
        EventIndexRow: o(
          { id: { type: "string", pattern: "^[0-9]+$", description: "bigint PostgreSQL (int64) sérialisé en chaîne pour éviter la perte de précision JavaScript" }, app_id: str, session_id: nul(str), ts: dateTime, route: nul(str), kind: { type: "string", enum: ["pageview", "vital", "error", "resource", "longtask", "breadcrumb", "event", "span"] }, source_name: nul(str), source_span_id: str, name: nul(str), props: nul(o({})), context: nul(o({})), device_type: nul(str) },
          ["id", "app_id", "ts", "kind", "source_span_id"],
        ),
        EventTrendRow: o({ bucket: dateTime, count: int }, ["bucket", "count"]),
        EventNameFacet: o({ value: str, count: int }, ["value", "count"]),
        EventAttributeFacet: o({ source: { type: "string", enum: ["props", "context"] }, key: str, count: int }, ["source", "key", "count"]),
        EventValueFacet: o({ type: { type: "string", enum: ["string", "number", "boolean", "null"] }, value: nul(str), count: int }, ["type", "count"]),
        EventSamplingNotice: o({ min_sample_rate: num, message: str }, ["min_sample_rate", "message"]),
        EventExplorer: o(
          {
            events: arr(ref("EventIndexRow")),
            page: o({ limit: int, offset: int, next_cursor: nul(str) }, ["limit", "offset", "next_cursor"]),
            total: int,
            trend: arr(ref("EventTrendRow")),
            facets: o({ names: arr(ref("EventNameFacet")), attributes: arr(ref("EventAttributeFacet")), values: arr(ref("EventValueFacet")) }, ["names", "attributes", "values"]),
            sampling_notice: nul(ref("EventSamplingNotice")),
            enrichment: o({ available: { type: "boolean" }, diagnostic: nul(str) }, ["available"]),
          },
          ["events", "page", "total", "trend", "facets", "sampling_notice", "enrichment"],
        ),
        TopActionRow: o(
          {
            app_id: str,
            name: str,
            type: { type: "string", enum: ["click", "manual"] },
            route: nul(str),
            actions: int,
            sessions: int,
            errors: int,
            error_clicks: int,
            resources: int,
            api_calls: int,
            resource_ms: num,
            api_ms: num,
            total_ms: num,
            last_seen: dateTime,
          },
          ["app_id", "name", "type", "actions", "sessions", "errors", "total_ms", "last_seen"],
        ),
        ActionSamplingNotice: o(
          { min_sample_rate: num, message: str },
          ["min_sample_rate", "message"],
        ),
        ActionSummary: o(
          {
            actions: int,
            sessions: int,
            errors: int,
            error_clicks: int,
            resources: int,
            api_calls: int,
            resource_ms: num,
            api_ms: num,
            total_ms: num,
            sampling_notice: nul(ref("ActionSamplingNotice")),
          },
          ["actions", "sessions", "errors", "error_clicks", "resources", "api_calls", "resource_ms", "api_ms", "total_ms", "sampling_notice"],
        ),
        TimelineItem: o(
          { kind: { type: "string", enum: ["pageview", "vital", "error", "breadcrumb", "longtask", "event", "action", "resource", "api"] }, ts: dateTime, title: nul(str), detail: nul(str), value: nul(num), rating: nul(str), action_id: nul(str), action_name: nul(str) },
          ["kind", "ts"],
        ),

        // ── P7.5 — runtime React Native ────────────────────────────────────
        //
        // TROIS ÉTATS, PAS DEUX. `active` : une release déclare collecter.
        // `unavailable` : une release déclare NE PAS collecter — « Non
        // collecté », jamais 0. `unknown` : personne n'a rien déclaré.
        // `verified_at` ne vient QUE d'une recette d'opérateur ; aucun chemin
        // d'ingestion ne l'écrit, quoi que le client envoie.
        MobileCapability: o(
          {
            capability: { type: "string", enum: ["js_errors", "native_crashes", "anr", "native_start", "offline_persistence", "screen_tracking"] },
            label: str,
            note: { ...str, description: "ce que l'absence de signal veut dire pour cette capacité" },
            state: { type: "string", enum: ["active", "unavailable", "unknown"] },
            declared_by: { ...arr(nul(str)), description: "releases déclarant la capacité active ; null = release non déclarée par l'application" },
            verified_at: nul({ ...dateTime, description: "recette d'opérateur ; jamais posé par l'ingestion" }),
            verified_by: nul(str),
            last_declared_at: nul(dateTime),
          },
          ["capability", "label", "note", "state", "declared_by", "verified_at", "verified_by", "last_declared_at"],
        ),
        MobileCapabilityDeclaration: o(
          {
            capability: str,
            runtime: str,
            release: nul({ ...str, description: "null = l'application ne déclare pas de version" }),
            declared: bool,
            first_declared_at: dateTime,
            last_declared_at: dateTime,
            verified_at: nul(dateTime),
            verified_by: nul(str),
          },
          ["capability", "runtime", "release", "declared", "first_declared_at", "last_declared_at"],
        ),
        MobileStartupMeasure: o({ samples: int, p50_ms: nul(num), p75_ms: nul(num), p95_ms: nul(num) }, ["samples"]),
        MobileSummary: o(
          {
            capabilities: arr(ref("MobileCapability")),
            declarations: arr(ref("MobileCapabilityDeclaration")),
            sessions: o(
              {
                sessions: { ...int, description: "sessions React Native commencées dans la fenêtre ; un vide réel vaut 0" },
                visitors: nul({ ...int, description: "installations distinctes ; null = aucune session ne porte d'identifiant. Jamais additionné aux sessions" }),
                sessions_without_visitor: int,
              },
              ["sessions", "visitors", "sessions_without_visitor"],
            ),
            js_errors: nul(
              o(
                {
                  occurrences: { ...num, description: "somme des répétitions reçues, pas un nombre de lignes" },
                  crashes: num,
                  unhandled_rejections: num,
                  fatal: nul({ ...num, description: "null = aucune ligne ne renseigne la fatalité (SDK antérieur à P7.3)" }),
                  sessions_affected: int,
                },
                ["occurrences", "crashes", "unhandled_rejections", "fatal", "sessions_affected"],
              ),
            ),
            js_error_free_session_rate: nul({
              type: "number",
              minimum: 0,
              maximum: 1,
              description:
                "1 − (sessions de la cohorte portant au moins une erreur JS / sessions React Native observées), même fenêtre. CE N'EST PAS UN TAUX « SANS CRASH » : les crashes natifs ne sont pas collectés. null quand le taux n'aurait pas de sens (voir js_error_free_unavailable_reason)",
            }),
            js_error_free_unavailable_reason: nul({
              type: "string",
              enum: ["no_sessions", "capability_unavailable", "capability_unknown"],
            }),
            startup: o(
              {
                cold: nul(ref("MobileStartupMeasure")),
                warm: nul(ref("MobileStartupMeasure")),
              },
              ["cold", "warm"],
            ),
            screens: arr(o({ route: nul(str), views: int, sessions: int }, ["route", "views", "sessions"])),
            resources: arr(o({ path: str, method: nul(str), calls: int, p75_ms: nul(num), max_ms: nul(num), errors: int }, ["path", "calls"])),
            sampling: o({ min_inclusion_probability: nul(num), message: nul(str) }),
            unavailable: { ...arr(str), description: "ce que le schéma déployé ne permet pas encore de lire ; vide = réponse complète" },
          },
          [
            "capabilities",
            "declarations",
            "sessions",
            "js_errors",
            "js_error_free_session_rate",
            "js_error_free_unavailable_reason",
            "startup",
            "screens",
            "resources",
            "sampling",
            "unavailable",
          ],
        ),

        TraceCoverage: o({ total: num, correlated: num, back_total: num, front_p75: nul(num), back_p75: nul(num) }),
        ApiCallRow: o({ url: str, method: str, n: num, front_p75: num, back_p75: nul(num), err: num }, ["url", "method"]),
        BackRouteRow: o({ route: str, n: num, p75: num, p95: num, err: num }, ["route"]),

        CorrCardRow: o({ app_id: str, route: nul(str), rum_lcp_p75: nul(num), rum_inp_p75: nul(num), rum_sessions: nul(num), syn_latency_avg: nul(num), syn_score_avg: nul(num), syn_state: nul(str), syn_measures: nul(str) }, ["app_id"]),
        BlindSpotRow: o({ app_id: str, route: nul(str), bucket: dateTime, rum_lcp_p75: num, syn_latency_avg: num, syn_state: str, gap_ms: num }, ["app_id"]),

        HealthGridCell: o({ day: str, hour: int, good_w: num, total_w: num }, ["day", "hour"]),
        DailyTraffic: o({ day: str, pageviews: num, errors: num }, ["day"]),

        // ───────────────────────── Explorer générique (P6.4) ─────────────────
        //
        // Le registre décrit des CAPACITÉS : identifiants d'API, libellés, unités
        // et limites. Ni table, ni colonne, ni valeur de client n'y figurent.
        ExplorerSchema: o(
          {
            version: int,
            operators: arr({ type: "string", enum: ["eq", "neq", "is_null"] }),
            visualizations: arr(o({ id: str, label: str }, ["id", "label"])),
            limits: o({
              conditions: int,
              group_by: int,
              groups: int,
              rows: int,
              body_bytes: int,
              dimension_name: int,
              value: int,
            }),
            capabilities: o({ save_to_dashboard: bool }, ["save_to_dashboard"]),
            datasets: arr(ref("ExplorerDataset")),
          },
          ["version", "operators", "visualizations", "limits", "capabilities", "datasets"],
        ),
        ExplorerDataset: o(
          {
            id: str,
            label: str,
            summary: str,
            population: str,
            variant: nul(o({ id: str, label: str, values: arr(str), required: bool })),
            fields: arr(ref("ExplorerField")),
            dimensions: arr(o({ id: str, label: str, available: bool, reason: nul(str) }, ["id", "available"])),
            columns: arr(o({ id: str, label: str }, ["id", "label"])),
            notices: arr(str),
          },
          ["id", "label", "population", "fields", "dimensions", "columns", "notices"],
        ),
        ExplorerField: o(
          {
            id: str,
            label: str,
            unit: str,
            aggregations: arr({ type: "string", enum: ["count", "sum", "avg", "p75", "p95", "distinct"] }),
            additive: arr(str),
            requiresProperty: bool,
            variant: nul(str),
            bucketable: bool,
            notice: nul(str),
          },
          ["id", "label", "unit", "aggregations", "additive"],
        ),
        ExplorerQuery: o(
          {
            version: { ...int, description: "1 — seule version acceptée" },
            app: nul(str),
            range: {
              description: "EXACTEMENT { preset } ou { from, to } ; les deux ensemble reçoivent 400 range_conflict",
              oneOf: [
                o({ preset: { type: "string", enum: ["1h", "24h", "7d"] } }, ["preset"]),
                o({ from: dateTime, to: dateTime }, ["from", "to"]),
              ],
            },
            dataset: { ...str, description: "identifiant du registre (GET /explorer/schema)" },
            measure: o(
              {
                aggregation: { type: "string", enum: ["count", "sum", "avg", "p75", "p95", "distinct"] },
                field: str,
                property: { ...str, description: "clé de propriété numérique, pour les mesures qui l'exigent" },
              },
              ["aggregation", "field"],
            ),
            variant: { ...str, description: "sous-population fermée du jeu (métrique, API, palier, type)" },
            filters: arr(
              o(
                {
                  field: str,
                  operator: { type: "string", enum: ["eq", "neq", "is_null"] },
                  type: { type: "string", enum: ["string"] },
                  value: dimension,
                },
                ["field", "operator"],
              ),
            ),
            groupBy: { type: "array", items: str, maxItems: 2, description: "2 dimensions au plus, 50 combinaisons au total" },
            visualization: { type: "string", enum: ["value", "toplist", "timeseries", "table"] },
            limit: { ...int, description: "1..50 pour les groupes, 1..200 pour le journal" },
            cursor: { ...str, description: "page suivante du journal ; lié à la requête et à la plage résolue" },
            includeBots: bool,
            includeInternal: bool,
          },
          ["dataset", "measure", "range"],
        ),
        SavedView: o(
          {
            id: { ...str, format: "uuid" },
            app: { ...str, description: "une vue nomme TOUJOURS son app : « toutes » mesurerait une autre population selon le lecteur" },
            name: { ...str, maxLength: 100 },
            query: ref("ExplorerQuery"),
            revision: { ...str, description: "à citer dans expectedRevision pour toute écriture" },
            mine: { ...bool, description: "true si la session en est propriétaire — elle seule peut l'écrire" },
            owner_email: { ...str, nullable: true, description: "adresse du propriétaire, RÉSERVÉE aux sessions admin ; null sinon" },
            created_at: dateTime,
            updated_at: dateTime,
          },
          ["id", "app", "name", "query", "revision", "mine", "created_at", "updated_at"],
        ),
        ExplorerResult: o({ meta: ref("ExplorerMeta"), data: ref("ExplorerData") }, ["meta", "data"]),
        ExplorerMeta: o(
          {
            app: str,
            period: str,
            query_version: int,
            generatedAt: dateTime,
            effective_apps: nul(arr(str)),
            range: ref("MetaRange"),
            dataset: str,
            measure: str,
            unit: str,
            aggregation: str,
            additive: { ...bool, description: "false : ni seau à zéro, ni ligne « Autres » (percentile, distincts)" },
            counting: str,
            source: {
              type: "string",
              enum: ["raw", "rollup+raw"],
              description:
                "raw : tout vient des lignes. rollup+raw : heures entières consolidées d'un agrégat, complétées par les lignes du reste de la fenêtre — jamais les deux pour la même ligne",
            },
            approximate: {
              ...bool,
              description: "true : valeur lue sur une distribution en seaux, approchée à une largeur de seau près",
            },
            rollup: o(
              {
                eligible: bool,
                source: nul(str),
                reason: { ...nul(str), description: "pourquoi l'agrégat n'a pas servi — jamais un refus muet" },
              },
              ["eligible", "source", "reason"],
            ),
            group_by: arr(str),
            visualization: str,
            warnings: arr(str),
            coverage: o({ status: { type: "string", enum: ["complete", "partial", "unknown"] }, reason: nul(str) }),
            truncated_groups: { ...bool, description: "true : des combinaisons existent au-delà de la limite demandée" },
            query: { type: "object", description: "AST canonique rejouable ; aucune donnée de résultat" },
          },
          ["query_version", "range", "dataset", "unit", "aggregation", "counting", "source", "coverage"],
        ),
        ExplorerData: o(
          {
            total: nul(num),
            samples: int,
            groups: arr(ref("ExplorerGroup")),
            series: arr(ref("ExplorerPoint")),
            rows: arr({ type: "object", description: "projection fermée du jeu (GET /explorer/schema → columns)" }),
            next_cursor: nul(str),
          },
          ["total", "samples", "groups", "series", "rows", "next_cursor"],
        ),
        ExplorerGroup: o(
          {
            key: { type: "array", items: nul(str), description: "TUPLE aussi long que groupBy — jamais une concaténation" },
            value: nul(num),
            samples: int,
          },
          ["key", "value", "samples"],
        ),
        ExplorerPoint: o(
          { start: dateTime, end: dateTime, key: arr(nul(str)), value: nul(num), samples: int },
          ["start", "end", "key", "value", "samples"],
        ),
      },
    },
  };
}
