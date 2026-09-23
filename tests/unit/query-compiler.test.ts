// Compilateur des prédicats du contrat (P6.2) — logique pure : registre fermé des
// couples jeu de données × dimension, colonnes sondées, identifiants SQL issus du
// seul code, valeurs toujours liées, périmètre et apps internes, seaux UTC.
import { describe, expect, it } from "vitest";
import {
  DATASETS,
  DATASET_REGISTRY,
  UnsupportedFilterError,
  binder,
  bucketExpr,
  bucketSeriesSql,
  compileScope,
  compileWhere,
  compileWhereOrThrow,
  dimensionSupport,
  registryColumns,
  sessionJoin,
  type CompileTarget,
  type DatasetId,
} from "../../apps/console/lib/query-compiler";
import {
  DIMENSIONS,
  parseAnalyticsQuery,
  type AnalyticsQuery,
  type Dimension,
  type ScopePrincipal,
} from "../../apps/console/lib/query-contract";
import { schemaComplet, schemaSans } from "../fixtures/dimension-schema";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const ADMIN: ScopePrincipal = { role: "admin", apps: null };

function requete(qs: string, principal: ScopePrincipal = ADMIN): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

// B8 : `runtime`, `browser_version`, `os_version` et `net_type` sont des dimensions de session.
const SESSION: Dimension[] = [
  "device",
  "browser",
  "os",
  "country",
  "country_source",
  "source",
  "client",
  "runtime",
  "browser_version",
  "os_version",
  "net_type",
];
const OCCURRENCE: Dimension[] = ["route", "release", "env"];

/** Matrice attendue, schéma migré (P6.1 compris) : ce qui est applicable, et rien d'autre. */
const ATTENDU: Record<DatasetId, Dimension[]> = {
  sessions: SESSION,
  views: [...SESSION, ...OCCURRENCE],
  vitals: [...SESSION, ...OCCURRENCE],
  custom_events: [...SESSION, ...OCCURRENCE],
  actions: [...SESSION, ...OCCURRENCE],
  longtasks: [...SESSION, ...OCCURRENCE],
  resources: [...SESSION, ...OCCURRENCE],
  errors: [...SESSION, ...OCCURRENCE, "service"],
  events: [...SESSION, ...OCCURRENCE, "service"],
  spans: [...SESSION, ...OCCURRENCE, "service"],
  synthetic: ["route"],
};

// Colonnes livrées par P6.1 (migration-v75) : absentes d'un schéma v74.
const COLONNES_P61 = [
  "rum_session.browser",
  "rum_session.os",
  ...["rum_pageview", "rum_metric", "rum_action", "rum_resource", "rum_longtask", "rum_event", "rum_span", "rum_event_index"].flatMap(
    (table) => [`${table}.env`, `${table}.release`],
  ),
  "rum_span.service",
  "rum_event_index.service",
];

describe("registre fermé jeu de données × dimension", () => {
  it("chaque couple autorisé est compilable, chaque autre est « sans objet »", () => {
    const schema = schemaComplet();
    for (const dataset of DATASETS) {
      for (const dimension of DIMENSIONS) {
        const support = dimensionSupport(dataset, dimension, schema);
        const attendu = ATTENDU[dataset].includes(dimension);
        expect(support.supported, `${dataset} × ${dimension}`).toBe(attendu);
        if (!support.supported) expect(support.reason, `${dataset} × ${dimension}`).toBe("not_applicable");
      }
    }
  });

  it("colonne absente (console publiée avant la migration) : « pas encore collecté », jamais ignoré", () => {
    const schema = schemaSans(...COLONNES_P61);
    const support = dimensionSupport("views", "browser", schema);
    expect(support).toEqual({
      supported: false,
      reason: "not_collected",
      message: "« Navigateur » n'est pas encore collecté pour les pages vues",
    });
    // rum_error porte release/env/service depuis v69 : disponibles sans P6.1.
    for (const dimension of ["release", "env", "service"] as const) {
      expect(dimensionSupport("errors", dimension, schema).supported, dimension).toBe(true);
    }
    expect(dimensionSupport("views", "release", schema)).toMatchObject({ supported: false, reason: "not_collected" });
    expect(dimensionSupport("sessions", "release", schema)).toMatchObject({ supported: false, reason: "not_applicable" });
  });

  it("la release, l'env et le service d'une occurrence ne sont jamais lus sur la session", () => {
    for (const dataset of DATASETS) {
      for (const dimension of ["release", "env", "service"] as const) {
        const source = DATASET_REGISTRY[dataset].dimensions[dimension];
        if (source) expect(source.on, `${dataset} × ${dimension}`).toBe("row");
      }
    }
  });

  it("la sonde couvre exactement les colonnes du registre", () => {
    const { tables, columns } = registryColumns();
    expect(tables).toEqual([...tables].sort());
    expect(tables).toContain("rum_session");
    expect(columns).toEqual(expect.arrayContaining(["browser", "os", "release", "env", "service", "route", "route_hint", "device_type"]));
    expect(new Set(columns).size).toBe(columns.length);
  });
});

describe("compileWhere", () => {
  const vues: CompileTarget = { dataset: "views", row: "p", session: "s", time: "p.started_at" };

  it("fenêtre, périmètre, conditions puis bots — chaque valeur liée, dans l'ordre des $n", () => {
    const query = requete("app=a&device=tablet&browser=Firefox&seg=v2:route:neq:%2Fadmin;os:is_null", { role: "viewer", apps: ["a", "b"] });
    const { params, bind } = binder();
    const compiled = compileWhere(query, vues, schemaComplet(), bind);
    expect(compiled).toEqual({
      ok: true,
      value:
        " and p.started_at >= $1::timestamptz and p.started_at < $2::timestamptz" +
        " and p.app_id = any($3::text[])" +
        " and s.device_type = $4 and s.browser = $5 and p.route <> $6 and s.os is null" +
        " and not coalesce(s.is_bot, false)",
    });
    expect(params).toEqual([query.range.from, query.range.to, ["a"], "tablet", "Firefox", "/admin"]);
  });

  it("aucune valeur hostile n'entre dans le texte SQL", () => {
    const hostile = "x' or '1'='1; drop table rum_session; --";
    const query = requete(`route=${encodeURIComponent(hostile)}&seg=${encodeURIComponent(`v2:release:eq:${encodeURIComponent(hostile)}`)}`);
    const { params, bind } = binder();
    const compiled = compileWhere(query, vues, schemaComplet(), bind);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value).not.toContain("drop table");
    expect(compiled.value).not.toContain("'1'='1");
    expect(params.filter((p) => p === hostile)).toHaveLength(2);
  });

  it("dimension non applicable ou non collectée : erreur typée, jamais un filtre ignoré", () => {
    const query = requete("service=api");
    const { bind } = binder();
    expect(compileWhere(query, vues, schemaComplet(), bind)).toEqual({
      ok: false,
      error: {
        code: "unsupported_dimension",
        message: "« Service » est sans objet pour les pages vues",
        dimension: "service",
      },
    });
    const avant = compileWhere(requete("browser=Firefox"), vues, schemaSans("rum_session.browser"), binder().bind);
    expect(avant).toMatchObject({ ok: false, error: { code: "unsupported_dimension", dimension: "browser" } });
    expect(() => compileWhereOrThrow(requete("service=api"), vues, schemaComplet(), bind)).toThrow(UnsupportedFilterError);
  });

  it("une dimension de session exige la session jointe", () => {
    const sansSession: CompileTarget = { dataset: "views", row: "p", time: "p.started_at" };
    expect(compileWhere(requete("device=mobile"), sansSession, schemaComplet(), binder().bind)).toMatchObject({
      ok: false,
      error: { code: "unsupported_dimension", message: "« Appareil » exige la session, absente ici" },
    });
    // Une dimension de la ligne n'en a pas besoin ; sans session, pas de clause bots.
    const compiled = compileWhere(requete("route=%2Fa"), sansSession, schemaComplet(), binder().bind);
    expect(compiled).toMatchObject({ ok: true });
    if (compiled.ok) expect(compiled.value).not.toContain("is_bot");
  });

  it("bots inclus sur demande ; jeu sans session (synthétique) jamais filtré par bots", () => {
    const bots = compileWhere(requete("bots=1"), vues, schemaComplet(), binder().bind);
    if (bots.ok) expect(bots.value).not.toContain("is_bot");
    const synthetique = compileWhere(requete("route=%2Fa"), { dataset: "synthetic", row: "y", time: "y.ts" }, schemaComplet(), binder().bind);
    expect(synthetique).toMatchObject({ ok: true });
    if (synthetique.ok) {
      expect(synthetique.value).toContain("y.route_hint = $3");
      expect(synthetique.value).not.toContain("is_bot");
    }
  });

  it("liste de configuration (time null), plage imposée (période précédente), périmètre compilé à part", () => {
    const query = requete("app=a");
    const config = compileWhere(query, { ...vues, time: null }, schemaComplet(), binder().bind);
    if (config.ok) expect(config.value).not.toContain("started_at");
    const precedente = { ...query.range, from: "2026-09-15T12:00:00.000Z", to: "2026-09-16T12:00:00.000Z" };
    const { params, bind } = binder();
    compileWhere(query, { ...vues, range: precedente, scope: false }, schemaComplet(), bind);
    expect(params.slice(0, 2)).toEqual(["2026-09-15T12:00:00.000Z", "2026-09-16T12:00:00.000Z"]);
    expect(params).not.toContainEqual(["a"]);
    const autreApp = compileWhere(query, { ...vues, app: "p.owner_app" }, schemaComplet(), binder().bind);
    if (autreApp.ok) expect(autreApp.value).toContain("p.owner_app = any($3::text[])");
  });

  it("identifiants SQL : alias et colonnes de code seulement, sinon exception", () => {
    const query = requete("");
    for (const target of [
      { ...vues, row: "p;drop" },
      { ...vues, session: "S" },
      { ...vues, time: "started_at desc" },
      { ...vues, app: "p.app_id or true" },
    ] as CompileTarget[]) {
      expect(() => compileWhere(query, target, schemaComplet(), binder().bind), JSON.stringify(target)).toThrow();
    }
  });
});

describe("périmètre et apps internes", () => {
  it("toutes les apps (admin) : apps internes exclues, lignes sans app conservées (not exists)", () => {
    const { params, bind } = binder();
    expect(compileScope(requete(""), "x.app_id", bind)).toBe(
      " and not exists (select 1 from app_registry internes where internes.internal and internes.app_id = x.app_id)",
    );
    expect(params).toEqual([]);
    expect(compileScope(requete("internal=1"), "x.app_id", bind)).toBe("");
  });

  it("apps effectives liées ; un périmètre vide (intersection) ne rend AUCUNE ligne", () => {
    const { params, bind } = binder();
    const vide: AnalyticsQuery = { ...requete("app=a"), scope: { requestedApp: "a", authorizedApps: null, effectiveApps: [] } };
    expect(compileScope(vide, "x.app_id", bind)).toBe(" and x.app_id = any($1::text[])");
    expect(params).toEqual([[]]);
  });

  it("jointure de session TOUJOURS scopée par app", () => {
    expect(sessionJoin("e", "s")).toBe("left join rum_session s on s.app_id = e.app_id and s.session_id = e.session_id");
  });

  it("binder : numérotation continue, une valeur réutilisable par son $n", () => {
    const { params, bind } = binder(["déjà"]);
    const a = bind("x");
    expect(a).toBe("$2");
    expect(bind(3)).toBe("$3");
    expect(params).toEqual(["déjà", "x", 3]);
  });
});

describe("seaux UTC", () => {
  const range = requete("period=24h").range;

  it("origine d'alignement explicitement UTC, largeur issue de la plage", () => {
    expect(bucketExpr("m.ts", range)).toBe("date_bin(interval '3600 seconds', m.ts, timestamptz '2000-01-01 00:00:00+00')");
    const { params, bind } = binder();
    expect(bucketSeriesSql(range, bind)).toBe(
      `generate_series(date_bin(interval '3600 seconds', $1::timestamptz, timestamptz '2000-01-01 00:00:00+00'),
                          $2::timestamptz - interval '1 microsecond', interval '3600 seconds')`,
    );
    expect(params).toEqual([range.from, range.to]);
  });

  it("refuse une largeur ou une colonne qui ne viennent pas du contrat", () => {
    expect(() => bucketExpr("m.ts", { ...range, bucketSeconds: 0 })).toThrow();
    expect(() => bucketExpr("m.ts", { ...range, bucketSeconds: 1.5 })).toThrow();
    expect(() => bucketExpr("m.ts); drop table x; --", range)).toThrow();
  });
});

describe("B8 — runtime, versions et type de réseau : dimensions de lecture de la session", () => {
  const sessionsB8: CompileTarget = { dataset: "sessions", row: "s", session: "s", time: "s.started_at" };
  const erreursB8: CompileTarget = { dataset: "errors", row: "e", session: "s", time: "e.ts" };
  const B8 = ["runtime", "browser_version", "os_version", "net_type"];

  it("seg v2 seulement : aucun paramètre d'URL dédié, donc aucun paramètre de population nouveau", async () => {
    const { CONTRACT_PARAMS, PARAM_DIMENSIONS } = await import("../../apps/console/lib/query-contract");
    for (const dimension of B8) {
      expect(DIMENSIONS as readonly string[], dimension).toContain(dimension);
      expect(CONTRACT_PARAMS as readonly string[], dimension).not.toContain(dimension);
      expect(PARAM_DIMENSIONS as readonly string[], dimension).not.toContain(dimension);
    }
    expect(requete("seg=v2:runtime:eq:react_native;net_type:is_null;browser_version:neq:139;os_version:eq:17").filters.segments).toEqual([
      { dimension: "runtime", operator: "eq", value: "react_native" },
      { dimension: "net_type", operator: "is_null", value: null },
      { dimension: "browser_version", operator: "neq", value: "139" },
      { dimension: "os_version", operator: "eq", value: "17" },
    ]);
  });

  it("compilées sur la session jointe, valeurs liées, « Inconnu » en `is null`", () => {
    const query = requete("app=a&seg=v2:runtime:eq:react_native;net_type:is_null;browser_version:neq:139;os_version:eq:17");
    const { params, bind } = binder();
    expect(compileWhere(query, sessionsB8, schemaComplet(), bind)).toEqual({
      ok: true,
      value:
        " and s.started_at >= $1::timestamptz and s.started_at < $2::timestamptz" +
        " and s.app_id = any($3::text[])" +
        " and s.runtime = $4 and s.net_type is null and s.browser_version <> $5 and s.os_version = $6" +
        " and not coalesce(s.is_bot, false)",
    });
    expect(params).toEqual([query.range.from, query.range.to, ["a"], "react_native", "139", "17"]);
    // Sur une table d'occurrences, la même condition porte sur la SESSION jointe.
    const occ = binder();
    const compiled = compileWhere(requete("seg=v2:runtime:eq:react_native"), erreursB8, schemaComplet(), occ.bind);
    expect(compiled.ok && compiled.value).toContain(" and s.runtime = $");
    expect(occ.params).toContain("react_native");
  });

  it("colonne absente (base antérieure à v82) : « pas encore collecté », refusé et jamais ignoré", () => {
    const avantV82 = schemaSans("rum_session.runtime");
    expect(dimensionSupport("sessions", "runtime", avantV82)).toEqual({
      supported: false,
      reason: "not_collected",
      message: "« Runtime » n'est pas encore collecté pour les sessions",
    });
    expect(() => compileWhereOrThrow(requete("seg=v2:runtime:eq:react_native"), sessionsB8, avantV82, binder().bind)).toThrow(
      UnsupportedFilterError,
    );
    // Le robot synthétique n'a pas de session : sans objet.
    expect(dimensionSupport("synthetic", "runtime", schemaComplet())).toMatchObject({ supported: false, reason: "not_applicable" });
  });

  it("la sonde de schéma interroge les quatre colonnes", () => {
    expect(registryColumns().columns).toEqual(expect.arrayContaining(B8));
  });

  it("périmètre : `apps = []` se compile en liste vide liée, jamais en « toutes les apps »", () => {
    const query = requete("seg=v2:runtime:eq:react_native", { role: "viewer", apps: ["a"] });
    const vide: AnalyticsQuery = { ...query, scope: { ...query.scope, effectiveApps: [] } };
    const { params, bind } = binder();
    const compiled = compileWhere(vide, sessionsB8, schemaComplet(), bind);
    expect(compiled.ok && compiled.value).toContain(" and s.app_id = any($3::text[])");
    expect(params[2]).toEqual([]);
  });
});
