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

  it("force le scope A malgré app B et transmet une pagination bornée", async () => {
    const response = await request("app=app-b&period=7d&limit=20&offset=999999");
    expect(response.status).toBe(200);
    expect(topActions).toHaveBeenCalledWith(expect.objectContaining({ app: "app-a", period: "7d" }), {
      limit: 20,
      offset: 10_000,
    });
    const body = await response.json();
    expect(body.meta.app).toBe("app-a");
    expect(body.data.actions).toEqual([{ app_id: "app-a", name: "Payer", actions: 1 }]);
    expect(body.data.summary.sampling_notice).toMatchObject({ min_sample_rate: 0.1 });
  });
});
