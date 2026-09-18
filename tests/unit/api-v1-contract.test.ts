// Enveloppe de l'API v1 sous le contrat commun (P6.2) : refus typés avant toute
// lecture, `meta` qui annonce ce qui a RÉELLEMENT été appliqué, ETag lié au
// principal, au périmètre, à la plage et aux filtres, et 400 pour un filtre qu'une
// lecture ne sait pas appliquer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle } from "../../apps/console/lib/api/handle";
import { UnsupportedFilterError } from "../../apps/console/lib/query-compiler";

// La lecture simulée : même donnée quel que soit l'appel, pour isoler ce que l'enveloppe ajoute.
const lecture = vi.fn();
const GET = handle(async ({ filters }) => {
  lecture(filters);
  return { total: 38 };
});

function appel(query: string, auth: string, headers: Record<string, string> = {}) {
  const url = `http://console.test/api/v1/overview?${query}`;
  return GET(
    {
      url,
      nextUrl: new URL(url),
      headers: new Headers({ authorization: `Bearer ${auth}`, ...headers }),
      cookies: { get: () => undefined },
    } as never,
    { params: Promise.resolve({}) },
  );
}

beforeEach(() => {
  process.env.CONSOLE_API_TOKENS = "tok-a@app-a,tok-ab@app-a;app-b,tok-vide@,global";
  process.env.CONSOLE_API_ALLOWED_ORIGINS = "https://front.test";
});
afterEach(() => {
  delete process.env.CONSOLE_API_TOKENS;
  delete process.env.CONSOLE_API_ALLOWED_ORIGINS;
  vi.useRealTimers();
  lecture.mockClear();
});

describe("refus du contrat, avant toute lecture", () => {
  it.each([
    ["tok-vide", "", 403, { code: "no_app_access", error: "aucune application autorisée" }],
    ["tok-a", "app=app-b", 403, { code: "forbidden_app", parameter: "app", error: "app hors périmètre : app-b" }],
    ["global", "period=24h&from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z", 400, { code: "range_conflict", parameter: "period" }],
    ["global", "from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z", 400, { code: "range_too_long" }],
    ["global", "from=2026-09-01T00:00:00Z&to=2999-01-01T00:00:00Z", 400, { code: "range_in_future", parameter: "to" }],
    ["global", "seg=v2:ville:eq:Paris", 400, { code: "unsupported_dimension", dimension: "ville" }],
    ["global", "device=mobile&device=desktop", 400, { code: "ambiguous_parameter", parameter: "device" }],
  ])("%s ?%s → %i", async (auth, query, status, corps) => {
    const reponse = await appel(query, auth);
    expect(reponse.status).toBe(status);
    expect(await reponse.json()).toMatchObject(corps);
    expect(lecture).not.toHaveBeenCalled();
  });

  it("un filtre qu'une lecture ne sait pas appliquer est un 400 typé, jamais un 500 ni un résultat qui l'ignore", async () => {
    const REFUS = handle(async () => {
      throw new UnsupportedFilterError({
        code: "unsupported_dimension",
        message: "« Navigateur » n'est pas encore collecté pour les pages vues",
        dimension: "browser",
      });
    });
    const url = "http://console.test/api/v1/pages?browser=Firefox";
    const reponse = await REFUS(
      { url, nextUrl: new URL(url), headers: new Headers({ authorization: "Bearer global" }), cookies: { get: () => undefined } } as never,
      { params: Promise.resolve({}) },
    );
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({
      code: "unsupported_dimension",
      dimension: "browser",
      error: "« Navigateur » n'est pas encore collecté pour les pages vues",
    });
  });
});

describe("meta : ce qui a été appliqué", () => {
  it("périmètre effectif, plage résolue, conditions et drapeaux ; champs historiques conservés", async () => {
    const reponse = await appel("app=app-b&period=7d&device=tablet&release=4.8.0&seg=geo==FR&bots=1", "tok-ab");
    expect(reponse.status).toBe(200);
    const { meta } = await reponse.json();
    expect(meta).toMatchObject({
      app: "app-b",
      period: "7d",
      device: "tablet",
      query_version: 1,
      scope: { requested_app: "app-b", effective_apps: ["app-b"] },
      range: { preset: "7d", bucket_seconds: 21_600 },
      filters: {
        conditions: [
          { dimension: "device", operator: "eq", value: "tablet" },
          { dimension: "release", operator: "eq", value: "4.8.0" },
          { dimension: "country", operator: "eq", value: "FR" },
        ],
        include_bots: true,
        include_internal: false,
      },
    });
    expect(Date.parse(meta.range.to) - Date.parse(meta.range.from)).toBe(7 * 86_400_000);
    expect(typeof meta.generatedAt).toBe("string");
  });

  it("plage personnalisée : period « custom » et bornes UTC exactes", async () => {
    const { meta } = await (await appel("from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z", "global")).json();
    expect(meta).toMatchObject({
      app: "all",
      period: "custom",
      scope: { requested_app: null, effective_apps: null },
      range: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z", preset: null, bucket_seconds: 3600 },
    });
  });
});

describe("ETag et cache", () => {
  it("une réponse calculée pour A ne revalide jamais pour B, même donnée et mêmes paramètres", async () => {
    const a = await appel("app=app-a", "tok-a");
    const ab = await appel("app=app-a", "tok-ab");
    expect(a.headers.get("ETag")).toMatch(/^W\//);
    expect(ab.headers.get("ETag")).not.toBe(a.headers.get("ETag"));
    // L'ETag de A présenté par B : jamais 304.
    const croise = await appel("app=app-a", "tok-ab", { "if-none-match": a.headers.get("ETag")! });
    expect(croise.status).toBe(200);
  });

  it("change avec la plage personnalisée et les filtres ; fenêtre glissante inchangée → 304", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-17T12:00:00Z"));
    const premiere = await appel("app=app-a&period=24h", "tok-a");
    const etag = premiere.headers.get("ETag")!;
    vi.setSystemTime(new Date("2026-09-17T12:00:07Z"));
    // Même preset, donnée inchangée : les instants ont glissé, la représentation non.
    const revalidee = await appel("app=app-a&period=24h", "tok-a", { "if-none-match": etag });
    expect(revalidee.status).toBe(304);
    expect(revalidee.headers.get("ETag")).toBe(etag);
    for (const query of [
      "app=app-a&period=7d",
      "app=app-a&device=mobile",
      "app=app-a&bots=1",
      "app=app-a&from=2026-09-16T00:00:00Z&to=2026-09-17T00:00:00Z",
      "app=app-a&from=2026-09-16T00:00:00Z&to=2026-09-17T00:00:01Z",
    ]) {
      const autre = await appel(query, "tok-a", { "if-none-match": etag });
      expect(autre.status, query).toBe(200);
      expect(autre.headers.get("ETag"), query).not.toBe(etag);
    }
  });

  it("cache privé et Vary sur l'identité, sans écraser Vary: Origin du CORS", async () => {
    const reponse = await appel("app=app-a", "tok-a", { origin: "https://front.test" });
    expect(reponse.headers.get("Cache-Control")).toBe("private, max-age=15");
    expect(reponse.headers.get("Vary")).toBe("Origin, Authorization, Cookie");
    expect(reponse.headers.get("Access-Control-Allow-Origin")).toBe("https://front.test");
  });
});
