import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries", () => ({ slowRoutes: vi.fn(), vitalsP75: vi.fn() }));
vi.mock("@/lib/queries-grid", () => ({ dailyTraffic: vi.fn() }));
vi.mock("@/lib/queries-frustration", () => ({ topFrustrations: vi.fn() }));
vi.mock("@/lib/queries-v2", () => ({ errorGroups: vi.fn() }));
vi.mock("@/lib/queries-events", () => ({ eventCount: vi.fn() }));

import { eventCount } from "@/lib/queries-events";
import { resolveWidget } from "@/lib/widget-data";

describe("widget event_count", () => {
  it("résout le compte via la requête partagée et expose l'avertissement sampling", async () => {
    vi.mocked(eventCount).mockResolvedValue({
      available: true,
      count: 1234,
      sampling_notice: { min_sample_rate: 0.5, message: "Comptage observé, sans extrapolation." },
      diagnostic: null,
    });
    const filters = { app: "app-a", period: "24h" as const, device: "mobile" as const, segment: [] };

    await expect(resolveWidget({
      type: "event_count",
      title: "Événements · checkout",
      eventName: "checkout",
    }, filters)).resolves.toEqual({
      kind: "value",
      value: "1 234",
      sub: "Comptage observé, sans extrapolation.",
    });
    expect(eventCount).toHaveBeenCalledWith(filters, "checkout");
  });
});
