// Contrat réel de GET /api/v1/errors et /api/v1/errors/{fingerprint} (P5.1) : portée
// (jeton scopé, session viewer sans app), filtres transmis à la lecture unique,
// résolution d'une empreinte partagée entre apps, curseur et forme de réponse.
// Les nombres eux-mêmes sont prouvés sur PostgreSQL
// (tests/integration/error-queries-p51-sql.test.ts) ; ici la lecture est simulée et
// on verrouille ce que la route lui demande — et ce qu'elle ne lui demande jamais.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lecture = vi.hoisted(() => ({
  listErrorGroups: vi.fn(),
  resolveErrorGroup: vi.fn(),
  errorGroupDetail: vi.fn(),
}));

// Parseurs et périmètre RÉELS : seules les trois lectures SQL sont remplacées.
vi.mock("@/lib/queries-errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/console/lib/queries-errors")>()),
  ...lecture,
}));

import { GET as LISTE } from "../../apps/console/app/api/v1/errors/route";
import { GET as DETAIL } from "../../apps/console/app/api/v1/errors/[fingerprint]/route";
import { buildOpenApi } from "../../apps/console/lib/api/openapi";
import { signJwt } from "../../apps/console/lib/auth";
import { ERROR_SOURCES } from "../../apps/console/lib/queries-errors";
import { ERROR_STATUSES } from "../../apps/console/lib/queries-v2";

type Auth = { bearer: string } | { cookie: string };

function requete(chemin: string, auth: Auth) {
  const url = `http://console.test/api/v1${chemin}`;
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers("bearer" in auth ? { authorization: `Bearer ${auth.bearer}` } : {}),
    cookies: { get: (nom: string) => ("cookie" in auth && nom === "mip_session" ? { value: auth.cookie } : undefined) },
  } as never;
}

const liste = (query: string, auth: Auth) =>
  LISTE(requete(`/errors?${query}`, auth), { params: Promise.resolve({}) });
const detail = (fingerprint: string, query: string, auth: Auth) =>
  DETAIL(requete(`/errors/${encodeURIComponent(fingerprint)}?${query}`, auth), {
    params: Promise.resolve({ fingerprint }),
  });

const GROUPE = {
  app_id: "app-a",
  fingerprint: "p51fp001",
  error_type: "TypeError",
  sample_message: "x is undefined",
  occurrences: 38,
  sessions_affected: 1,
  visitors_affected: 1,
  identified_users_affected: 1,
  session_coverage: 1,
  identity_coverage: 1,
  sessions: 1,
  users_affected: 1,
  first_seen: new Date("2026-09-13T10:00:00Z"),
  last_seen: new Date("2026-09-16T09:51:00Z"),
  status: "open",
  resolved_at: null,
  regressed: false,
};
const ECHANTILLONNAGE = { min_inclusion_probability: 1, message: null };
const ENRICHISSEMENT = { available: true, diagnostic: null };

const CLES_LISTE = ["groups", "unfingerprinted", "page", "total", "totals", "trend", "sampling", "enrichment"];
const CLES_DETAIL = ["group", "last", "occurrences", "trend", "page", "sampling", "enrichment"];

// Un curseur tel que l'émet PostgreSQL : microsecondes comprises.
const curseur = (ts: string, id: string) => Buffer.from(JSON.stringify([ts, id])).toString("base64url");

beforeEach(() => {
  process.env.CONSOLE_API_TOKENS = "tok@app-a,s@app-a;app-b,global";
  lecture.listErrorGroups.mockImplementation(async (_f, page) => ({
    groups: [GROUPE],
    unfingerprinted: 0,
    page,
    total: 1,
    totals: { ...GROUPE, groups: 1, unfingerprinted: 0 },
    trend: [{ bucket: new Date("2026-09-16T09:00:00Z"), occurrences: 38 }],
    sampling: ECHANTILLONNAGE,
    enrichment: ENRICHISSEMENT,
  }));
  lecture.errorGroupDetail.mockImplementation(async (ref, _f, page) => ({
    group: { ...GROUPE, app_id: ref.app_id },
    last: null,
    occurrences: [],
    trend: [],
    page: { limit: page.limit, next_cursor: null },
    sampling: ECHANTILLONNAGE,
    enrichment: ENRICHISSEMENT,
  }));
});

afterEach(() => {
  delete process.env.CONSOLE_API_TOKENS;
  vi.clearAllMocks();
});

describe("GET /api/v1/errors", () => {
  it("force l'app du jeton, transmet tablette et période, borne l'offset", async () => {
    const reponse = await liste("app=app-b&period=7d&device=tablet&limit=20&offset=999999", { bearer: "tok" });
    expect(reponse.status).toBe(200);
    expect(lecture.listErrorGroups).toHaveBeenCalledTimes(1);
    const [filtres, page, ...reste] = lecture.listErrorGroups.mock.calls[0];
    expect(filtres).toMatchObject({ app: "app-a", period: "7d", device: "tablet", segment: [] });
    // Bots et apps internes exclus comme dans la console : l'API ne les rouvre pas.
    expect(filtres.includeBots).toBeFalsy();
    expect(filtres.includeInternal).toBeFalsy();
    expect(page).toEqual({ limit: 20, offset: 10_000 });
    // Pas de séries par groupe dans l'API : aucune option passée.
    expect(reste).toEqual([]);
    const corps = await reponse.json();
    expect(corps.meta.app).toBe("app-a");
    expect(Object.keys(corps.data)).toEqual(CLES_LISTE);
    expect(corps.data.groups[0]).toMatchObject({
      occurrences: 38,
      sessions: 1,
      users_affected: 1,
      status: "open",
      resolved_at: null,
      regressed: false,
      first_seen: "2026-09-13T10:00:00.000Z",
    });
    expect(corps.data.page).toEqual({ limit: 20, offset: 10_000 });
  });

  it("appareil absent → null, jamais 'all' (qui ne correspondrait à aucune session)", async () => {
    await liste("", { bearer: "global" });
    expect(lecture.listErrorGroups).toHaveBeenCalledWith(
      expect.objectContaining({ app: null, device: null, period: "24h" }),
      { limit: 100, offset: 0 },
    );
  });

  it("refuse 403 une session viewer sans aucune app, sans lire la base", async () => {
    // `parseApiFilters` traite `apps: []` comme non restreint : sans cette garde,
    // ce principal lirait les erreurs de toutes les apps.
    const cookie = await signJwt({ email: "v@mip", role: "viewer", apps: [] });
    const reponse = await liste("app=app-b", { cookie });
    expect(reponse.status).toBe(403);
    expect(await reponse.json()).toEqual({ error: "aucune application autorisée" });
    expect(lecture.listErrorGroups).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/errors/{fingerprint}", () => {
  it("répond 404 à une session viewer sans aucune app, sans résoudre ni lire", async () => {
    const cookie = await signJwt({ email: "v@mip", role: "viewer", apps: [] });
    const reponse = await detail("p51fp001", "app=app-a", { cookie });
    expect(reponse.status).toBe(404);
    expect(await reponse.json()).toEqual({ error: "groupe d'erreurs introuvable" });
    expect(lecture.resolveErrorGroup).not.toHaveBeenCalled();
    expect(lecture.errorGroupDetail).not.toHaveBeenCalled();
  });

  it("sans app, cherche dans TOUT le périmètre du jeton et refuse l'ambiguïté en 400", async () => {
    lecture.resolveErrorGroup.mockResolvedValue({
      kind: "ambiguous",
      candidates: [
        { app_id: "app-a", occurrences: 38, last_seen: new Date() },
        { app_id: "app-b", occurrences: 13, last_seen: new Date() },
      ],
    });
    const reponse = await detail("p51fp001", "device=desktop", { bearer: "s" });
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({
      error: "fingerprint présent dans plusieurs apps : préciser app (app-a, app-b)",
    });
    // Filtres sans app (sinon seule la première app du jeton serait vue), apps du
    // jeton comme périmètre : les candidates ne peuvent venir que de là.
    expect(lecture.resolveErrorGroup).toHaveBeenCalledWith(
      "p51fp001",
      expect.objectContaining({ app: null, device: "desktop" }),
      ["app-a", "app-b"],
    );
    expect(lecture.errorGroupDetail).not.toHaveBeenCalled();
  });

  it("sans app, un groupe trouvé dans une autre app du jeton annonce CETTE app dans meta", async () => {
    lecture.resolveErrorGroup.mockResolvedValue({ kind: "found", ref: { app_id: "app-b", fingerprint: "p51fp001" } });
    const reponse = await detail("p51fp001", "", { bearer: "s" });
    expect(reponse.status).toBe(200);
    expect(lecture.errorGroupDetail).toHaveBeenCalledWith(
      { app_id: "app-b", fingerprint: "p51fp001" },
      expect.objectContaining({ app: "app-b", device: null }),
      { limit: 100, cursor: null },
    );
    const corps = await reponse.json();
    // `parseApiFilters` aurait annoncé app-a, la première app du jeton.
    expect(corps.meta.app).toBe("app-b");
    expect(corps.data.group.app_id).toBe("app-b");
  });

  it("jeton non scopé sans app : aucune liste d'apps, la base décide", async () => {
    lecture.resolveErrorGroup.mockResolvedValue({ kind: "found", ref: { app_id: "app-c", fingerprint: "p51fp002" } });
    const reponse = await detail("p51fp002", "app=all", { bearer: "global" });
    expect(lecture.resolveErrorGroup).toHaveBeenCalledWith("p51fp002", expect.objectContaining({ app: null }), null);
    expect((await reponse.json()).meta.app).toBe("app-c");
  });

  it("app nommée : résolution dans cette app seule, curseur µs et limite bornée transmis", async () => {
    lecture.resolveErrorGroup.mockResolvedValue({ kind: "found", ref: { app_id: "app-b", fingerprint: "p51fp001" } });
    const cursor = curseur("2026-09-16T09:56:00.000001Z", "9007199254740993");
    const reponse = await detail("p51fp001", `app=app-b&device=tablet&limit=500&cursor=${cursor}`, { bearer: "s" });
    expect(reponse.status).toBe(200);
    expect(lecture.resolveErrorGroup).toHaveBeenCalledWith(
      "p51fp001",
      expect.objectContaining({ app: "app-b", device: "tablet" }),
      null,
    );
    expect(lecture.errorGroupDetail).toHaveBeenCalledWith(
      { app_id: "app-b", fingerprint: "p51fp001" },
      expect.objectContaining({ app: "app-b", device: "tablet" }),
      { limit: 100, cursor: { ts: "2026-09-16T09:56:00.000001Z", id: "9007199254740993" } },
    );
    const corps = await reponse.json();
    expect(Object.keys(corps.data)).toEqual(CLES_DETAIL);
    expect(corps.data.page).toEqual({ limit: 100, next_cursor: null });
  });

  it("une app nommée hors périmètre est ramenée au jeton, jamais élargie", async () => {
    lecture.resolveErrorGroup.mockResolvedValue({ kind: "not_found" });
    const reponse = await detail("p51fp001", "app=app-b", { bearer: "tok" });
    expect(reponse.status).toBe(404);
    expect(lecture.resolveErrorGroup).toHaveBeenCalledWith("p51fp001", expect.objectContaining({ app: "app-a" }), null);
  });

  it("refuse 400 un curseur illisible ou à la milliseconde, avant toute lecture", async () => {
    for (const cursor of ["pas-un-curseur!", curseur("2026-09-16T09:56:00.000Z", "42")]) {
      const reponse = await detail("p51fp001", `app=app-a&cursor=${cursor}`, { bearer: "s" });
      expect(reponse.status).toBe(400);
      expect(await reponse.json()).toEqual({ error: "cursor invalide" });
    }
    expect(lecture.resolveErrorGroup).not.toHaveBeenCalled();
  });

  it("refuse 400 une empreinte hors format (trop longue, caractère de contrôle)", async () => {
    for (const fingerprint of ["f".repeat(65), "a b"]) {
      const reponse = await detail(fingerprint, "app=app-a", { bearer: "s" });
      expect(reponse.status).toBe(400);
      expect(await reponse.json()).toEqual({ error: "fingerprint invalide" });
    }
    expect(lecture.resolveErrorGroup).not.toHaveBeenCalled();
  });

  it("404 quand l'empreinte est absente, ou quand le détail résolu n'a plus de ligne", async () => {
    lecture.resolveErrorGroup.mockResolvedValueOnce({ kind: "not_found" });
    expect((await detail("p51fp009", "app=app-a", { bearer: "s" })).status).toBe(404);
    expect(lecture.errorGroupDetail).not.toHaveBeenCalled();

    lecture.resolveErrorGroup.mockResolvedValueOnce({ kind: "found", ref: { app_id: "app-a", fingerprint: "p51fp001" } });
    lecture.errorGroupDetail.mockResolvedValueOnce(null);
    const reponse = await detail("p51fp001", "app=app-a", { bearer: "s" });
    expect(reponse.status).toBe(404);
    expect(await reponse.json()).toEqual({ error: "groupe d'erreurs introuvable" });
  });
});

describe("spec OpenAPI des erreurs", () => {
  const spec = buildOpenApi() as any;
  const refs = (op: { parameters: { $ref?: string }[] }) => op.parameters.map((p) => p.$ref).filter(Boolean);

  it("pagine la liste et les occurrences avec des paramètres dédiés, sans toucher aux partagés", () => {
    expect(refs(spec.paths["/errors"].get)).toContain("#/components/parameters/errorOffset");
    expect(refs(spec.paths["/errors/{fingerprint}"].get)).toEqual(
      expect.arrayContaining(["#/components/parameters/occurrenceLimit", "#/components/parameters/errorCursor"]),
    );
    const params = spec.components.parameters;
    expect(params.errorOffset.schema.maximum).toBe(10_000);
    expect(params.occurrenceLimit.schema).toMatchObject({ minimum: 1, maximum: 100 });
    expect(params.offset.schema.maximum).toBeUndefined();
    expect(params.limit.schema.maximum).toBe(200);
  });

  it("déclare 403 sur la liste, 400 et 404 sur le détail", () => {
    expect(spec.paths["/errors"].get.responses["403"].$ref).toBe("#/components/responses/Forbidden");
    const reponses = spec.paths["/errors/{fingerprint}"].get.responses;
    expect(reponses["400"].description).toContain("plusieurs apps");
    expect(reponses["404"].$ref).toBe("#/components/responses/NotFound");
  });

  it("publie les mêmes énumérations que la lecture (copies, donc comparées)", () => {
    const schemas = spec.components.schemas;
    expect(schemas.ErrorSample.properties.error_source.enum).toEqual([...ERROR_SOURCES, null]);
    expect(schemas.ErrorOccurrence.properties.error_source.enum).toEqual([...ERROR_SOURCES, null]);
    expect(schemas.ErrorGroupRow.allOf[1].properties.status.enum).toEqual([...ERROR_STATUSES]);
  });

  it("décrit toutes les clés renvoyées par les deux routes", () => {
    const schemas = spec.components.schemas;
    expect(Object.keys(schemas.ErrorGroupList.properties)).toEqual(CLES_LISTE);
    expect(Object.keys(schemas.ErrorGroupDetail.properties)).toEqual(CLES_DETAIL);
    expect(schemas.ErrorOccurrence.properties.links.$ref).toBe("#/components/schemas/ErrorOccurrenceLinks");
    expect(Object.keys(schemas.ErrorImpact.properties)).toEqual([
      "occurrences", "sessions_affected", "visitors_affected", "identified_users_affected",
      "session_coverage", "identity_coverage",
    ]);
  });
});
