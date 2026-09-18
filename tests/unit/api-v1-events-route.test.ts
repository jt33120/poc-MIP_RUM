// Contrat réel de GET /api/v1/events : auth, scope A/B, kind, pagination et 400.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { exploreEvents } = vi.hoisted(() => ({ exploreEvents: vi.fn() }));

vi.mock("@/lib/queries-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/console/lib/queries-events")>()),
  exploreEvents,
}));

import { GET } from "../../apps/console/app/api/v1/events/route";

const route = { params: Promise.resolve({}) };

function request(query: string) {
  const url = `http://console.test/api/v1/events?${query}`;
  return GET({
    url,
    nextUrl: new URL(url),
    headers: new Headers({ authorization: "Bearer events-secret" }),
    cookies: { get: () => undefined },
  } as never, route);
}

describe("GET /api/v1/events", () => {
  beforeEach(() => {
    process.env.CONSOLE_API_TOKENS = "events-secret@app-a";
    exploreEvents.mockResolvedValue({
      events: [
        { id: "9007199254740993", app_id: "app-a", session_id: "a", ts: new Date("2026-01-01T00:00:00Z"), route: "/a", kind: "vital", source_name: "LCP", source_span_id: "00000000000000a2" },
        { id: "9007199254740992", app_id: "app-a", session_id: "a", ts: new Date("2025-12-31T23:59:00Z"), route: "/a", kind: "vital", source_name: "INP", source_span_id: "00000000000000a1" },
      ],
      page: { limit: 1, offset: 1, next_cursor: null }, total: 2, trend: [],
      facets: { names: [], attributes: [], values: [] }, sampling_notice: null,
      enrichment: { available: true, diagnostic: null },
    });
  });

  afterEach(() => {
    delete process.env.CONSOLE_API_TOKENS;
    vi.clearAllMocks();
  });

  it("refuse une demande B hors périmètre (403), sans rabattre sur A ni lire", async () => {
    const response = await request("app=app-b&kind=vital&limit=1&offset=1");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "forbidden_app", parameter: "app" });
    expect(exploreEvents).not.toHaveBeenCalled();
  });

  it("lit A et conserve kind, ordre et pagination", async () => {
    const response = await request("app=app-a&kind=vital&limit=1&offset=1");
    expect(response.status).toBe(200);
    expect(exploreEvents).toHaveBeenCalledWith(
      expect.objectContaining({ app: "app-a", period: "24h" }),
      { kind: "vital", name: null, attribute: null },
      { limit: 1, offset: 1 },
      null,
    );
    const body = await response.json();
    expect(body.meta.app).toBe("app-a");
    expect(body.data.page).toEqual({ limit: 1, offset: 1, next_cursor: null });
    expect(body.data.events.map((event: { id: string }) => event.id)).toEqual([
      "9007199254740993", "9007199254740992",
    ]);
  });

  it("refuse un kind hostile avec 400, sans appeler la lecture", async () => {
    const response = await request("kind=event%3Bdrop%20table%20rum_event_index");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "filtre d’événement invalide" });
    expect(exploreEvents).not.toHaveBeenCalled();
  });

  it("applique tablet à l’Explorer sur toutes les apps autorisées et remet offset à zéro avec un curseur", async () => {
    const cursor = Buffer.from(JSON.stringify(["2026-09-16T10:00:00.000Z", "42"])).toString("base64url");
    const response = await request(`kind=event&device=tablet&offset=99&cursor=${cursor}`);
    expect(response.status).toBe(200);
    const [filters] = exploreEvents.mock.calls[0];
    // Sans app : le périmètre AUTORISÉ du jeton, pas sa première app.
    expect(filters.query.scope.effectiveApps).toEqual(["app-a"]);
    expect(exploreEvents).toHaveBeenCalledWith(
      expect.objectContaining({ app: null, device: "tablet" }),
      { kind: "event", name: null, attribute: null },
      { limit: 100, offset: 0 },
      { ts: "2026-09-16T10:00:00.000Z", id: "42" },
    );
  });
});
