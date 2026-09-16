import { describe, expect, it } from "vitest";
import {
  eventPageFilters,
  eventPagePagination,
  eventResetHref,
  eventSearchParams,
} from "../../apps/console/lib/events-page-params";

const baseFilters = {
  app: "demo-app",
  period: "7d" as const,
  device: null,
  segment: [],
};

describe("paramètres de la page Événements", () => {
  it("refuse les query params répétés au lieu d'en choisir un silencieusement", () => {
    expect(eventSearchParams({ name: ["checkout", "signup"] })).toBeNull();
    expect(eventSearchParams({ app: ["tenant-a", "tenant-b"] })).toBeNull();
  });

  it("préserve explicitement le filtre tablette", () => {
    const url = eventSearchParams({ device: "tablet" });
    expect(eventPageFilters(baseFilters, url).device).toBe("tablet");
  });

  it("force offset=0 lorsqu'un curseur stable est fourni", () => {
    expect(eventPagePagination({ limit: 25, offset: 500 }, { ts: "x", id: "1" })).toEqual({
      limit: 25,
      offset: 0,
    });
    expect(eventPagePagination({ limit: 25, offset: 500 }, null).offset).toBe(500);
  });

  it("réinitialise seulement les filtres événementiels", () => {
    const href = eventResetHref({ ...baseFilters, device: "tablet" });
    expect(href).toBe("/events?period=7d&app=demo-app&device=tablet");
    expect(href).not.toMatch(/name|attr_|cursor|offset/);
  });
});
