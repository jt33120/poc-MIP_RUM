// Contrat réel de GET /api/v1/events : auth, scope A/B, kind, pagination et 400.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listEventIndex } = vi.hoisted(() => ({ listEventIndex: vi.fn() }));

vi.mock("@/lib/queries-events", () => ({
  listEventIndex,
  parseEventKind(value: string | null) {
    if (value == null || value === "") return null;
    return ["pageview", "vital", "error", "resource", "longtask", "breadcrumb", "event", "span"].includes(value)
      ? value
      : undefined;
  },
  parseEventPage(searchParams: URLSearchParams) {
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 200);
    const offset = Math.min(Math.max(Math.floor(Number(searchParams.get("offset")) || 0), 0), 10_000);
    return { limit, offset };
  },
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
    listEventIndex.mockResolvedValue([
      { id: "9007199254740993", app_id: "app-a", session_id: "a", ts: new Date("2026-01-01T00:00:00Z"), route: "/a", kind: "vital", source_name: "LCP", source_span_id: "00000000000000a2" },
      { id: "9007199254740992", app_id: "app-a", session_id: "a", ts: new Date("2025-12-31T23:59:00Z"), route: "/a", kind: "vital", source_name: "INP", source_span_id: "00000000000000a1" },
    ]);
  });

  afterEach(() => {
    delete process.env.CONSOLE_API_TOKENS;
    vi.clearAllMocks();
  });

  it("force A malgré une demande B et conserve kind, ordre et pagination", async () => {
    const response = await request("app=app-b&kind=vital&limit=1&offset=1");
    expect(response.status).toBe(200);
    expect(listEventIndex).toHaveBeenCalledWith("app-a", "vital", { limit: 1, offset: 1 });
    const body = await response.json();
    expect(body.meta.app).toBe("app-a");
    expect(body.data.page).toEqual({ limit: 1, offset: 1 });
    expect(body.data.events.map((event: { id: string }) => event.id)).toEqual([
      "9007199254740993", "9007199254740992",
    ]);
  });

  it("refuse un kind hostile avec 400, sans appeler la lecture", async () => {
    const response = await request("kind=event%3Bdrop%20table%20rum_event_index");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "kind invalide" });
    expect(listEventIndex).not.toHaveBeenCalled();
  });
});
