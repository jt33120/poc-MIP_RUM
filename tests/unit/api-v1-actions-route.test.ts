import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { topActions, topActionsSummary } = vi.hoisted(() => ({
  topActions: vi.fn(),
  topActionsSummary: vi.fn(),
}));
vi.mock("@/lib/queries-actions", () => ({
  topActions,
  topActionsSummary,
  parseActionsPage(searchParams: URLSearchParams) {
    return {
      limit: Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200),
      offset: Math.min(Math.max(Math.floor(Number(searchParams.get("offset")) || 0), 0), 10_000),
    };
  },
}));

import { GET } from "../../apps/console/app/api/v1/actions/route";

const route = { params: Promise.resolve({}) };

function request(query: string) {
  const url = `http://console.test/api/v1/actions?${query}`;
  return GET({
    url,
    nextUrl: new URL(url),
    headers: new Headers({ authorization: "Bearer actions-secret" }),
    cookies: { get: () => undefined },
  } as never, route);
}

describe("GET /api/v1/actions", () => {
  beforeEach(() => {
    process.env.CONSOLE_API_TOKENS = "actions-secret@app-a";
    topActions.mockResolvedValue([{ app_id: "app-a", name: "Payer", actions: 1 }]);
    topActionsSummary.mockResolvedValue({
      actions: 1,
      sampling_notice: { min_sample_rate: 0.1, message: "échantillon" },
    });
  });
  afterEach(() => {
    delete process.env.CONSOLE_API_TOKENS;
    vi.clearAllMocks();
  });

  it("refuse l'app B hors du périmètre du jeton (403), sans rien lire ni rabattre sur A", async () => {
    const response = await request("app=app-b&period=7d&limit=20&offset=999999");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "forbidden_app", parameter: "app" });
    expect(topActions).not.toHaveBeenCalled();
    expect(topActionsSummary).not.toHaveBeenCalled();
  });

  it("lit l'app A du périmètre et transmet une pagination bornée", async () => {
    const response = await request("app=app-a&period=7d&limit=20&offset=999999");
    expect(response.status).toBe(200);
    expect(topActions).toHaveBeenCalledWith(expect.objectContaining({ app: "app-a", period: "7d" }), {
      limit: 20,
      offset: 10_000,
    });
    const body = await response.json();
    expect(body.meta.app).toBe("app-a");
    expect(body.meta.scope).toEqual({ requested_app: "app-a", effective_apps: ["app-a"] });
    expect(body.data.actions).toEqual([{ app_id: "app-a", name: "Payer", actions: 1 }]);
    expect(body.data.summary.sampling_notice).toMatchObject({ min_sample_rate: 0.1 });
  });

  it("sans app : toutes les apps AUTORISÉES du jeton, annoncées dans meta", async () => {
    const response = await request("period=24h");
    expect(response.status).toBe(200);
    const [filters] = topActions.mock.calls[0];
    expect(filters.app).toBeNull();
    expect(filters.query.scope.effectiveApps).toEqual(["app-a"]);
    expect((await response.json()).meta).toMatchObject({ app: "all", scope: { requested_app: null, effective_apps: ["app-a"] } });
  });
});
