// P5.1 — contrat de lecture des erreurs : paramètres d'URL, périmètre, et forme
// du SQL réellement envoyé (base simulée). La preuve des nombres est sur
// PostgreSQL (tests/integration/error-queries-p51-sql.test.ts) ; ici on verrouille
// ce qui protège l'isolation : app liée partout, une photographie, aucune
// troncature `::int`, et `filtered_errors` citée une seule fois par instruction.
import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error — module .mjs sans déclaration de types
import { ERROR_SOURCES as SOURCES_INGESTION } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

type Client = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

const db = vi.hoisted(() => {
  const journal: { sql: string; params: unknown[] }[] = [];
  const q = vi.fn();
  // Réponses des instructions de données, dans l'ordre d'exécution.
  const donnees = vi.fn();
  const tx = vi.fn(async (fn: (client: Client) => unknown) =>
    fn({
      query: async (sql: string, params: unknown[] = []) => {
        journal.push({ sql, params });
        return { rows: /^set transaction/.test(sql) ? [] : await donnees(sql, params) };
      },
    }));
  return { journal, q, donnees, tx };
});
vi.mock("@/lib/db", () => ({ q: db.q, tx: db.tx }));

import { parseEventCursor } from "../../apps/console/lib/queries-events";
import {
  ERROR_LIST_MAX_OFFSET,
  ERROR_SOURCE_LABELS,
  ERROR_SOURCES,
  encodeErrorCursor,
  errorDeviceFrom,
  errorGroupDetail,
  errorPageFilters,
  errorScopeFor,
  isFingerprintParam,
  listErrorGroups,
  parseErrorCursor,
  parseErrorListPage,
  parseOccurrencesPage,
  resolveErrorGroup,
  scopeApps,
  stackSymbolisable,
  type ErrorFilters,
} from "../../apps/console/lib/queries-errors";

const DIAGNOSTIC_PRE_V69 =
  "migration v69 absente : corrélation trace/identité indisponible, compteurs historiques conservés";
const SET_TRANSACTION = "set transaction isolation level repeatable read read only";

const sp = (query: string) => new URLSearchParams(query);
const curseur = (ts: string, id = "42") => Buffer.from(JSON.stringify([ts, id])).toString("base64url");
const citations = (sql: string) => (sql.match(/\bfiltered_errors\b/g) ?? []).length;
const donneesSql = () => db.journal.slice(1);

const filtres = (over: Partial<ErrorFilters> = {}): ErrorFilters => ({
  app: "app-a",
  period: "24h",
  device: "tablet",
  segment: [{ dim: "geo", op: "==", value: "FR" }],
  includeBots: false,
  includeInternal: false,
  ...over,
});

const groupe = (over: Record<string, unknown> = {}) => ({
  app_id: "app-a",
  fingerprint: "fp1",
  error_type: "TypeError",
  sample_message: "boom",
  occurrences: 38,
  sessions: 1,
  users_affected: 1,
  first_seen: new Date("2026-09-13T08:00:00Z"),
  last_seen: new Date("2026-09-16T09:51:00Z"),
  status: "open",
  resolved_at: null,
  regressed: false,
  sessions_affected: 1,
  visitors_affected: 1,
  identified_users_affected: 1,
  session_coverage: 1,
  identity_coverage: 1,
  min_inclusion_probability: 1,
  ...over,
});

beforeEach(() => {
  db.journal.length = 0;
  db.q.mockReset();
  db.donnees.mockReset().mockResolvedValue([]);
  db.tx.mockClear();
});

// ═══════════════════════════ Paramètres d'URL ═════════════════════════════════

describe("pagination", () => {
  it("liste : 100 par défaut, 200 au plus, offset borné à 10 000", () => {
    expect(parseErrorListPage(sp(""))).toEqual({ limit: 100, offset: 0 });
    expect(parseErrorListPage(sp("limit=999&offset=999999"))).toEqual({ limit: 200, offset: ERROR_LIST_MAX_OFFSET });
    expect(parseErrorListPage(sp("limit=abc&offset=-5"))).toEqual({ limit: 100, offset: 0 });
    expect(parseErrorListPage(sp("limit=25&offset=50"))).toEqual({ limit: 25, offset: 50 });
  });

  it("occurrences : toujours entre 1 et 100, 100 par défaut", () => {
    expect(parseOccurrencesPage(sp(""))).toEqual({ limit: 100 });
    expect(parseOccurrencesPage(sp("limit=500"))).toEqual({ limit: 100 });
    expect(parseOccurrencesPage(sp("limit=1"))).toEqual({ limit: 1 });
    // `parsePagination` tronquerait ces valeurs en 0 : une page vide jamais voulue.
    for (const limit of ["0", "0.5", "-3", "abc"]) {
      expect(parseOccurrencesPage(sp(`limit=${limit}`)), limit).toEqual({ limit: 100 });
      expect(parseErrorListPage(sp(`limit=${limit}`)).limit, limit).toBe(100);
    }
  });
});

describe("curseur d'occurrences", () => {
  it("garde le codec P4 et les microsecondes, sans passer par Date", () => {
    const encoded = encodeErrorCursor({ cursor_ts: "2026-09-16T10:00:00.123456Z", cursor_id: "9007199254740993" });
    expect(parseEventCursor(encoded)).toEqual({ ts: "2026-09-16T10:00:00.123456Z", id: "9007199254740993" });
    expect(parseErrorCursor(encoded)).toEqual({ ts: "2026-09-16T10:00:00.123456Z", id: "9007199254740993" });
  });

  it("absent = null, invalide = undefined", () => {
    expect(parseErrorCursor(null)).toBeNull();
    expect(parseErrorCursor("")).toBeNull();
    for (const hostile of ["1", "%%%sql%%%", curseur("2026-09-16T10:00:00.123456Z", "abc"), curseur("2026-09-16T10:00:00.123456Z", "9223372036854775808")])
      expect(parseErrorCursor(hostile), hostile).toBeUndefined();
  });

  it("refuse ce que P4 accepte mais que ce curseur ne produit jamais", () => {
    // Tous passent `parseEventCursor` (Date.parse les lit) : la forme stricte est ici.
    for (const ts of [
      "1",
      "+275760-09-13T00:00:00.000000Z",
      "2026-09-16T10:00:00.123Z",
      "2026-09-16T10:00:00Z",
      "2026-09-16T10:00:00.123456+02:00",
    ]) {
      expect(parseEventCursor(curseur(ts)), ts).not.toBeUndefined();
      expect(parseErrorCursor(curseur(ts)), ts).toBeUndefined();
    }
  });

  it("refuse une date que JavaScript reporte mais que PostgreSQL rejetterait (500)", () => {
    for (const ts of ["2026-02-30T00:00:00.000000Z", "0000-01-01T00:00:00.000000Z", "2026-09-16T24:00:00.000000Z"])
      expect(parseErrorCursor(curseur(ts)), ts).toBeUndefined();
    expect(parseErrorCursor(curseur("2024-02-29T23:59:59.999999Z"))).toEqual({ ts: "2024-02-29T23:59:59.999999Z", id: "42" });
  });
});

describe("empreinte et appareil", () => {
  it("empreinte : 1 à 64 caractères, sans caractère de contrôle", () => {
    expect(isFingerprintParam("p51fp001")).toBe(true);
    expect(isFingerprintParam("x".repeat(64))).toBe(true);
    expect(isFingerprintParam("é".repeat(64))).toBe(true);
    for (const bad of ["", "x".repeat(65), "a\u0000b", "a\nb", "a\u007fb"]) expect(isFingerprintParam(bad), JSON.stringify(bad)).toBe(false);
  });

  it("appareil : desktop, mobile ou tablet exactement, sinon tous", () => {
    expect(errorDeviceFrom("desktop")).toBe("desktop");
    expect(errorDeviceFrom("mobile")).toBe("mobile");
    expect(errorDeviceFrom("tablet")).toBe("tablet");
    for (const raw of ["all", "Desktop", "", null, undefined]) expect(errorDeviceFrom(raw), String(raw)).toBeNull();
  });
});

// ═══════════════════════════════ Périmètre ════════════════════════════════════

describe("périmètre d'un principal", () => {
  it("anonyme ou liste vide : aucun accès (AD-16) ; admin ou liste absente : tout", () => {
    expect(errorScopeFor(null)).toEqual({ kind: "none" });
    expect(errorScopeFor({ role: "viewer", apps: [] })).toEqual({ kind: "none" });
    expect(errorScopeFor({ role: "viewer", apps: null })).toEqual({ kind: "all" });
    expect(errorScopeFor({ role: "admin", apps: ["app-a"] })).toEqual({ kind: "all" });
    expect(errorScopeFor({ role: "viewer", apps: ["app-a", "app-b"] })).toEqual({ kind: "apps", apps: ["app-a", "app-b"] });
  });

  it("liste d'apps : null pour tout, [] pour rien", () => {
    expect(scopeApps({ kind: "all" })).toBeNull();
    expect(scopeApps({ kind: "none" })).toEqual([]);
    expect(scopeApps({ kind: "apps", apps: ["app-a"] })).toEqual(["app-a"]);
  });

  it("filtres de page : app forcée dans le périmètre, tablette conservée", () => {
    const viewer = { email: "v@test", role: "viewer" as const, apps: ["app-a", "app-b"] };
    expect(errorPageFilters({}, null)).toBeNull();
    expect(errorPageFilters({ app: "app-a" }, { ...viewer, apps: [] })).toBeNull();
    expect(errorPageFilters({ app: "app-z" }, viewer)?.app).toBe("app-a");
    expect(errorPageFilters({ app: "all" }, viewer)?.app).toBe("app-a");
    expect(errorPageFilters({ app: "app-b" }, viewer)?.app).toBe("app-b");
    expect(errorPageFilters({ app: "all" }, { email: "a@test", role: "admin", apps: null })?.app).toBeNull();
    expect(errorPageFilters({ app: "app-b", period: "7d", device: "tablet", seg: "geo==FR", bots: "1", internal: "1" }, viewer))
      .toEqual({
        app: "app-b",
        period: "7d",
        device: "tablet",
        segment: [{ dim: "geo", op: "==", value: "FR" }],
        includeBots: true,
        includeInternal: true,
      });
    expect(errorPageFilters({ device: ["mobile", "desktop"] }, viewer)?.device).toBe("mobile");
    expect(errorPageFilters({ device: "phablet" }, viewer)?.device).toBeNull();
  });
});

describe("sources d'erreur", () => {
  it("la copie console suit l'énumération d'ingestion, dans le même ordre", () => {
    expect([...ERROR_SOURCES]).toEqual([...SOURCES_INGESTION]);
  });

  it("chaque source a un libellé français", () => {
    expect(Object.keys(ERROR_SOURCE_LABELS).sort()).toEqual([...ERROR_SOURCES].sort());
    expect(ERROR_SOURCE_LABELS.browser_js).toBe("JavaScript navigateur");
    for (const label of Object.values(ERROR_SOURCE_LABELS)) expect(label.trim()).not.toBe("");
  });

  it("une source map de release ne s'applique qu'à une stack JS navigateur ou React Native (P5.3)", () => {
    const symbolisables = ERROR_SOURCES.filter((source) => stackSymbolisable(source));
    expect(symbolisables).toEqual([
      "browser_js", "browser_console", "browser_resource", "browser_csp", "browser_network", "react_native_js",
    ]);
    // Frames Node, Python, JVM ou natives : jamais réécrites par une map navigateur.
    for (const source of ["node", "python", "otel", "native"] as const) expect(stackSymbolisable(source)).toBe(false);
    // Émetteur non typé ou ligne antérieure à v69 : comportement historique.
    expect(stackSymbolisable(null)).toBe(true);
  });
});

// ═══════════════════════════════ Liste ═══════════════════════════════════════

describe("listErrorGroups — SQL", () => {
  it("sonde v69 avant la transaction, puis `set transaction` en première instruction", async () => {
    db.q.mockResolvedValueOnce([{ v69: true }]);
    await listErrorGroups(filtres(), { limit: 50, offset: 0 });
    expect(db.q).toHaveBeenCalledOnce();
    expect(db.q.mock.calls[0][0]).toContain("information_schema.columns");
    expect(db.q.mock.calls[0][0]).toContain("column_name='error_source'");
    expect(db.q.mock.invocationCallOrder[0]).toBeLessThan(db.tx.mock.invocationCallOrder[0]);
    expect(db.tx).toHaveBeenCalledOnce();
    expect(db.journal[0].sql).toBe(SET_TRANSACTION);
    // Groupes, totaux, tendance ; pas de séries sans groupe.
    expect(donneesSql()).toHaveLength(3);
  });

  it("chaque instruction lie app et périmètre, borne [from,to) et cite filtered_errors une fois", async () => {
    db.q.mockResolvedValueOnce([{ v69: true }]);
    db.donnees
      .mockResolvedValueOnce([groupe()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ bucket: new Date("2026-09-16T09:00:00Z"), occurrences: 38 }])
      .mockResolvedValueOnce([]);
    await listErrorGroups(filtres(), { limit: 50, offset: 10 }, { series: true, apps: ["app-a", "app-b"] });

    const data = donneesSql();
    expect(data).toHaveLength(4);
    for (const { sql, params } of data) {
      // Deux mentions : la définition, puis UNE référence (sinon matérialisation).
      expect(citations(sql)).toBe(2);
      expect(sql).toContain("($1::text is null or e.app_id = $1) and e.app_id = any($3::text[])");
      expect(sql).toContain("left join rum_session s on s.app_id = e.app_id and s.session_id = e.session_id");
      expect(sql).toContain("e.ts >= now() - interval '24 hours' and e.ts < now()");
      expect(sql).toContain("($2::text is null or s.device_type = $2)");
      expect(sql).toContain("not coalesce(s.is_bot, false)");
      expect(sql).not.toMatch(/::int(eger|4)?\b/);
      expect(sql).not.toMatch(/\buser_hash\b/);
      expect(params.slice(0, 3)).toEqual(["app-a", "tablet", ["app-a", "app-b"]]);
    }
    const [groupes, totaux, tendance, series] = data;
    expect(groupes.params).toEqual(["app-a", "tablet", ["app-a", "app-b"], "FR", 50, 10]);
    expect(groupes.sql).toContain("s.geo_country = $4");
    expect(groupes.sql).toContain("limit $5 offset $6");
    // `origine` garde le périmètre d'apps, sans jamais citer la population bornée.
    expect(groupes.sql).toMatch(/origine as \([\s\S]*e\.app_id = any\(\$3::text\[\]\)[\s\S]*group by e\.app_id, e\.fingerprint/);
    expect(groupes.sql).toContain("left join error_status st on st.app_id = g.app_id and st.fingerprint = g.fingerprint");
    expect(totaux.params).toEqual(["app-a", "tablet", ["app-a", "app-b"], "FR"]);
    expect(totaux.sql).toContain("group by fingerprint is null");
    expect(tendance.sql).toContain("generate_series(date_bin(interval '1 hour', now() - interval '24 hours'");
    expect(series.params).toEqual(["app-a", "tablet", ["app-a", "app-b"], ["fp1"], "FR"]);
    expect(series.sql).toContain("e.fingerprint = any($4::text[])");
    expect(series.sql).toContain("s.geo_country = $5");
  });

  it("toutes apps : exclut les apps internes jusque dans `origine`, et les bots sur demande seulement", async () => {
    db.q.mockResolvedValueOnce([{ v69: true }]);
    await listErrorGroups(filtres({ app: null, includeBots: true, segment: [] }), { limit: 10, offset: 0 });
    const [groupes] = donneesSql();
    expect((groupes.sql.match(/e\.app_id not in \(select app_id from app_registry where internal\)/g) ?? []).length).toBe(2);
    expect(groupes.sql).not.toContain("is_bot");
    expect(groupes.params).toEqual([null, "tablet", 10, 0]);
  });

  it("v69 : enveloppe lue et identité de l'occurrence d'abord", async () => {
    db.q.mockResolvedValueOnce([{ v69: true }]);
    const result = await listErrorGroups(filtres(), { limit: 10, offset: 0 });
    for (const { sql } of donneesSql()) {
      expect(sql).toContain("e.trace_id, e.source_parent_span_id, e.error_source, e.handled, e.is_fatal");
      expect(sql).toContain("coalesce(e.user_id_hash, s.user_id_hash) as identity_hash");
    }
    expect(result.enrichment).toEqual({ available: true, diagnostic: null });
  });

  it("avant v69 : NULL typés, identité de la session, diagnostic explicite", async () => {
    db.q.mockResolvedValueOnce([{ v69: false }]);
    const result = await listErrorGroups(filtres(), { limit: 10, offset: 0 });
    for (const { sql } of donneesSql()) {
      expect(sql).toContain("null::text as trace_id");
      expect(sql).toContain("null::boolean as handled");
      expect(sql).toContain("s.user_id_hash as identity_hash");
      expect(sql).not.toMatch(/\be\.(trace_id|source_parent_span_id|error_source|handled|is_fatal|view_name|env|service|user_id_hash)\b/);
    }
    expect(result.enrichment).toEqual({ available: false, diagnostic: DIAGNOSTIC_PRE_V69 });
  });

  it("impact en float8, inconnu en NULL, couverture en division réelle", async () => {
    db.q.mockResolvedValueOnce([{ v69: true }]);
    await listErrorGroups(filtres(), { limit: 10, offset: 0 });
    const [groupes] = donneesSql();
    expect(groupes.sql).toContain("sum(occurrences)::float8 as occurrences");
    expect(groupes.sql).toContain("nullif(count(distinct same_app_session_id), 0)::float8 as sessions_affected");
    expect(groupes.sql).toContain("nullif(count(distinct visitor_id), 0)::float8 as visitors_affected");
    expect(groupes.sql).toContain("nullif(count(distinct identity_hash), 0)::float8 as identified_users_affected");
    expect(groupes.sql).toMatch(/coalesce\(sum\(occurrences\) filter \(where same_app_session_id is not null\), 0\)::float8\s+\/ nullif\(sum\(occurrences\), 0\)::float8 as session_coverage/);
    expect(groupes.sql).toContain("coalesce(st.status = 'resolved' and g.last_seen > st.resolved_at, false) as regressed");
    expect(groupes.sql).toMatch(/g\.visitors_affected desc nulls last, g\.sessions_affected desc nulls last,\s+g\.occurrences desc, g\.last_seen desc, g\.app_id, g\.fingerprint/);
  });
});

describe("listErrorGroups — résultat", () => {
  const b0 = new Date("2026-09-16T08:00:00Z");
  const b1 = new Date("2026-09-16T09:00:00Z");
  const b2 = new Date("2026-09-16T10:00:00Z");

  it("totaux de population, tendance et séries alignées sur ses seaux, sans colonne interne", async () => {
    db.q.mockResolvedValueOnce([{ v69: true }]);
    db.donnees
      .mockResolvedValueOnce([groupe(), groupe({ app_id: "app-b", occurrences: 13 })])
      .mockResolvedValueOnce([
        {
          unfingerprinted_rows: false, occurrences: 51, sessions_affected: 2, visitors_affected: 2,
          identified_users_affected: 1, session_coverage: 1, identity_coverage: 0.75, groups: 2,
          min_inclusion_probability: 0.125,
        },
        {
          unfingerprinted_rows: true, occurrences: 4, sessions_affected: 1, visitors_affected: null,
          identified_users_affected: null, session_coverage: 1, identity_coverage: 0, groups: 1,
          min_inclusion_probability: 1,
        },
      ])
      .mockResolvedValueOnce([{ bucket: b0, occurrences: 0 }, { bucket: b1, occurrences: 38 }, { bucket: b2, occurrences: 13 }])
      .mockResolvedValueOnce([
        { app_id: "app-a", fingerprint: "fp1", bucket: new Date(b1), occurrences: 38 },
        { app_id: "app-b", fingerprint: "fp1", bucket: new Date(b2), occurrences: 13 },
        // Même empreinte dans une app absente de la page : ignorée.
        { app_id: "app-c", fingerprint: "fp1", bucket: new Date(b2), occurrences: 99 },
      ]);

    const result = await listErrorGroups(filtres({ app: null }), { limit: 2, offset: 0 }, { series: true });

    expect(result.groups.map((g) => [g.app_id, g.series])).toEqual([["app-a", [0, 38, 0]], ["app-b", [0, 0, 13]]]);
    for (const g of result.groups) expect(g).not.toHaveProperty("min_inclusion_probability");
    expect(donneesSql()[3].params).toContainEqual(["fp1"]);
    expect(result).toMatchObject({ unfingerprinted: 4, page: { limit: 2, offset: 0 }, total: 2 });
    expect(result.totals).toEqual({
      occurrences: 51, sessions_affected: 2, visitors_affected: 2, identified_users_affected: 1,
      session_coverage: 1, identity_coverage: 0.75, groups: 2, unfingerprinted: 4,
    });
    expect(result.trend.map((p) => p.occurrences)).toEqual([0, 38, 13]);
    expect(result.sampling).toEqual({
      min_inclusion_probability: 0.125,
      message: "Erreurs observées sur un échantillon (probabilité d'inclusion minimale 12,5 %). Aucune extrapolation n'est appliquée.",
    });
    expect(Object.keys(result)).toEqual(["groups", "unfingerprinted", "page", "total", "totals", "trend", "sampling", "enrichment"]);
  });

  it("population vide : compteurs à zéro, personnes et ratios inconnus, pas d'avertissement", async () => {
    db.q.mockResolvedValueOnce([{ v69: true }]);
    const result = await listErrorGroups(filtres(), { limit: 10, offset: 0 }, { series: true, apps: [] });
    expect(result.groups).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totals).toEqual({
      occurrences: 0, sessions_affected: null, visitors_affected: null, identified_users_affected: null,
      session_coverage: null, identity_coverage: null, groups: 0, unfingerprinted: 0,
    });
    expect(result.sampling).toEqual({ min_inclusion_probability: null, message: null });
    // Liste d'apps vide : liée telle quelle, la base ne rend rien — jamais « toutes ».
    expect(donneesSql()[0].params[2]).toEqual([]);
    expect(donneesSql()).toHaveLength(3);
  });

  it("pas d'avertissement quand toute erreur est conservée, ni quand rien ne l'est mesurable", async () => {
    for (const min of [1, 0]) {
      db.q.mockResolvedValueOnce([{ v69: true }]);
      db.donnees.mockResolvedValueOnce([]).mockResolvedValueOnce([{ unfingerprinted_rows: false, occurrences: 1, groups: 1, min_inclusion_probability: min }]);
      expect((await listErrorGroups(filtres(), { limit: 10, offset: 0 })).sampling).toEqual({ min_inclusion_probability: min, message: null });
    }
  });
});

// ════════════════════════════════ Détail ══════════════════════════════════════

describe("errorGroupDetail", () => {
  const ref = { app_id: "app-a", fingerprint: "fp1" };
  const occurrence = (over: Record<string, unknown>) => ({
    id: 2, ts: new Date("2026-09-16T09:51:00Z"), route: "/checkout", session_id: "s1", kind: "error",
    message: "boom", device_type: "tablet", occurrences: 1, release: "1.2.3", error_source: "browser_js",
    handled: false, is_fatal: null, view_name: null, env: null, service: null, trace_id: null,
    source_parent_span_id: null, link_session: true, link_replay: true, link_trace: false,
    link_parent_span: false, link_action_id: null, link_action_name: null, link_action_type: null,
    cursor_id: "2", cursor_ts: "2026-09-16T09:51:00.000001Z",
    ...over,
  });

  it("une photographie : groupe, tendance, exemplaire et occurrences liés à l'app de la référence", async () => {
    db.q.mockResolvedValueOnce([{ v69: true }]);
    db.donnees
      .mockResolvedValueOnce([groupe({ min_inclusion_probability: 0.1 })])
      .mockResolvedValueOnce([{ bucket: new Date("2026-09-16T09:00:00Z"), occurrences: 38 }])
      .mockResolvedValueOnce([{ id: 2, message: "boom" }])
      .mockResolvedValueOnce([
        occurrence({}),
        occurrence({
          id: 1, occurrences: 37, trace_id: "1".repeat(32), source_parent_span_id: "a".repeat(15) + "1",
          link_trace: true, link_parent_span: true, link_action_id: "act-1", link_action_name: "Payer",
          link_action_type: "click", cursor_id: "1", cursor_ts: "2026-09-16T09:51:00.000000Z",
        }),
      ]);

    const detail = await errorGroupDetail(ref, filtres({ app: null }), {
      limit: 2,
      cursor: { ts: "2026-09-16T10:00:00.123456Z", id: "42" },
    });

    expect(db.q).toHaveBeenCalledOnce();
    expect(db.tx).toHaveBeenCalledOnce();
    expect(db.journal[0].sql).toBe(SET_TRANSACTION);
    const data = donneesSql();
    expect(data).toHaveLength(4);
    for (const { sql, params } of data) {
      expect(citations(sql)).toBe(2);
      // L'app de la référence est liée même si le filtre reçu n'en fixait aucune.
      expect(params[0]).toBe("app-a");
      expect(params[2]).toEqual(["fp1"]);
      expect(sql).toContain("e.fingerprint = any($3::text[])");
      expect(sql).not.toMatch(/::int(eger|4)?\b/);
    }
    const [groupSql, trendSql, exemplarSql, occurrencesSql] = data.map((d) => d.sql);
    for (const sql of [groupSql, trendSql, exemplarSql]) expect(sql).not.toContain("(e.ts, e.id) <");
    expect(exemplarSql).toMatch(/order by ts desc, id desc\s+limit 1/);
    expect(occurrencesSql).toContain("(e.ts, e.id) < ($4::timestamptz, $5::bigint)");
    expect(data[3].params).toEqual(["app-a", "tablet", ["fp1"], "2026-09-16T10:00:00.123456Z", "42", "FR", 2]);
    expect(occurrencesSql).toContain("limit $7");
    expect(occurrencesSql).toContain(`to_char(fe.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts`);
    expect(occurrencesSql).toContain("rc.app_id = fe.app_id and rc.session_id = fe.session_id");
    expect(occurrencesSql).toContain("sp.app_id = fe.app_id and sp.trace_id = fe.trace_id");
    expect(occurrencesSql).toContain("and sp.span_id = fe.source_parent_span_id");
    expect(occurrencesSql).toContain("on a.app_id = fe.app_id and a.action_id = fe.action_id and a.session_id = fe.session_id");
    expect(occurrencesSql).toContain("order by fe.ts desc, fe.id desc");

    expect(detail).not.toBeNull();
    expect(detail!.group).not.toHaveProperty("min_inclusion_probability");
    expect(detail!.last).toEqual({ id: 2, message: "boom" });
    expect(detail!.occurrences[0]).toEqual({
      id: 2, ts: new Date("2026-09-16T09:51:00Z"), route: "/checkout", session_id: "s1", kind: "error",
      message: "boom", device_type: "tablet", occurrences: 1, release: "1.2.3", error_source: "browser_js",
      handled: false, is_fatal: null, view_name: null, env: null, service: null, trace_id: null,
      source_parent_span_id: null,
      links: { session: true, replay: true, trace: false, parent_span: false, action: null },
    });
    expect(detail!.occurrences[1].links).toEqual({
      session: true, replay: true, trace: true, parent_span: true,
      action: { id: "act-1", name: "Payer", type: "click" },
    });
    // Page pleine : le curseur reprend la dernière ligne, à la microseconde.
    expect(detail!.page).toEqual({
      limit: 2,
      next_cursor: encodeErrorCursor({ cursor_ts: "2026-09-16T09:51:00.000000Z", cursor_id: "1" }),
    });
    expect(detail!.sampling.message).toContain("probabilité d'inclusion minimale 10 %");
    expect(detail!.enrichment).toEqual({ available: true, diagnostic: null });
  });

  it("page incomplète : pas de curseur suivant", async () => {
    db.q.mockResolvedValueOnce([{ v69: true }]);
    db.donnees
      .mockResolvedValueOnce([groupe()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([occurrence({})]);
    const detail = await errorGroupDetail(ref, filtres(), { limit: 2, cursor: null });
    expect(detail!.page).toEqual({ limit: 2, next_cursor: null });
    expect(detail!.last).toBeNull();
    expect(donneesSql()[3].sql).not.toContain("(e.ts, e.id) <");
  });

  it("référence absente de la base filtrée : null, sans lire la suite", async () => {
    db.q.mockResolvedValueOnce([{ v69: false }]);
    await expect(errorGroupDetail(ref, filtres(), { limit: 100, cursor: null })).resolves.toBeNull();
    expect(donneesSql()).toHaveLength(1);
  });

  it("avant v69 : les liens trace et span parent sont évalués sur des NULL", async () => {
    db.q.mockResolvedValueOnce([{ v69: false }]);
    db.donnees.mockResolvedValueOnce([groupe()]);
    const detail = await errorGroupDetail(ref, filtres(), { limit: 100, cursor: null });
    const occurrencesSql = donneesSql()[3].sql;
    expect(occurrencesSql).toContain("null::text as trace_id");
    expect(occurrencesSql).toContain("fe.trace_id is not null and exists");
    expect(detail!.enrichment).toEqual({ available: false, diagnostic: DIAGNOSTIC_PRE_V69 });
  });
});

// ══════════════════════════════ Résolution ════════════════════════════════════

describe("resolveErrorGroup", () => {
  const tous = filtres({ app: null });

  it("périmètre vide : introuvable, sans requête", async () => {
    await expect(resolveErrorGroup("fp1", tous, [])).resolves.toEqual({ kind: "not_found" });
    await expect(resolveErrorGroup("fp1", filtres(), [])).resolves.toEqual({ kind: "not_found" });
    expect(db.q).not.toHaveBeenCalled();
  });

  it("une seule app candidate : trouvée ; aucune : introuvable", async () => {
    db.q.mockResolvedValueOnce([{ app_id: "app-a", occurrences: 38, last_seen: new Date() }]);
    await expect(resolveErrorGroup("fp1", tous, ["app-a", "app-b"])).resolves.toEqual({
      kind: "found",
      ref: { app_id: "app-a", fingerprint: "fp1" },
    });
    db.q.mockResolvedValueOnce([]);
    await expect(resolveErrorGroup("fp1", filtres(), null)).resolves.toEqual({ kind: "not_found" });
  });

  it("plusieurs apps : ambiguïté explicite, jamais un choix arbitraire", async () => {
    const candidates = [
      { app_id: "app-a", occurrences: 38, last_seen: new Date("2026-09-16T09:51:00Z") },
      { app_id: "app-b", occurrences: 13, last_seen: new Date("2026-09-16T09:55:00Z") },
    ];
    db.q.mockResolvedValueOnce(candidates);
    await expect(resolveErrorGroup("fp1", tous, null)).resolves.toEqual({ kind: "ambiguous", candidates });
  });

  it("même base filtrée, une instruction, candidates bornées et triées", async () => {
    db.q.mockResolvedValue([]);
    await resolveErrorGroup("fp1", tous, ["app-a", "app-b"]);
    await resolveErrorGroup("fp1", filtres(), null);
    // Pas de sonde : seules l'app, les occurrences et la date sont lues.
    expect(db.q).toHaveBeenCalledTimes(2);
    expect(db.tx).not.toHaveBeenCalled();
    const [[scopedSql, scopedParams], [appSql, appParams]] = db.q.mock.calls as [string, unknown[]][];
    for (const sql of [scopedSql, appSql]) {
      expect(citations(sql)).toBe(2);
      expect(sql).toContain("e.ts >= now() - interval '24 hours' and e.ts < now()");
      expect(sql).toContain("s.app_id = e.app_id and s.session_id = e.session_id");
      expect(sql).toMatch(/group by app_id\s+order by occurrences desc, app_id asc\s+limit 20/);
      expect(sql).not.toMatch(/::int(eger|4)?\b/);
    }
    expect(scopedSql).toContain("e.app_id = any($3::text[]) and e.fingerprint = any($4::text[])");
    expect(scopedSql).toContain("app_registry where internal");
    expect(scopedParams).toEqual([null, "tablet", ["app-a", "app-b"], ["fp1"], "FR"]);
    expect(appSql).toContain("($1::text is null or e.app_id = $1) and e.fingerprint = any($3::text[])");
    expect(appParams).toEqual(["app-a", "tablet", ["fp1"], "FR"]);
  });
});
