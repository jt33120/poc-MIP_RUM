import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries", () => ({ slowRoutes: vi.fn(), vitalsP75: vi.fn() }));
vi.mock("@/lib/queries-grid", () => ({ dailyTraffic: vi.fn() }));
vi.mock("@/lib/queries-frustration", () => ({ topFrustrations: vi.fn() }));
vi.mock("@/lib/queries-errors", () => ({ listErrorGroups: vi.fn() }));
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
      kind: "v1",
      type: "event_count",
      title: "Événements · checkout",
      eventName: "checkout",
    }, { filters, timeZone: "Europe/Paris", nowMs: Date.parse("2026-09-17T12:00:00Z") })).resolves.toEqual({
      // F36 (W-B11) : la carte transporte un NOMBRE ; `KpiTile` le formate au rendu.
      kind: "value",
      total: 1234,
      samples: 1234,
      format: "count",
      unit: "",
      effectif: "Comptage observé, sans extrapolation.",
    });
    expect(eventCount).toHaveBeenCalledWith(filters, "checkout");
  });

  // W-B11 — « Non collecté » n'est pas « 0 » : une capacité absente ne se chiffre
  // pas (V3, § 0.5). La carte dit l'absence et son diagnostic, sans jamais écrire
  // un compte qui se lirait « personne n'a déclenché cet événement ».
  it("capacité absente : « Non collecté », jamais un zéro", async () => {
    vi.mocked(eventCount).mockResolvedValue({
      available: false,
      count: null,
      sampling_notice: null,
      diagnostic: "la table des événements n’existe pas sur cette base",
    });
    const filters = { app: "app-a", period: "24h" as const, segment: [] };
    const data = await resolveWidget(
      { kind: "v1", type: "event_count", title: "Événements · checkout", eventName: "checkout" },
      { filters, timeZone: "Europe/Paris", nowMs: Date.parse("2026-09-17T12:00:00Z") },
    );
    expect(data.total).toBeNull();
    expect(data.raisonNull).toBe("Non collecté");
    expect(JSON.stringify(data)).not.toContain('"total":0');
  });
});
