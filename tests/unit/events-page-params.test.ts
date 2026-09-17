import { describe, expect, it } from "vitest";
import {
  eventPagePagination,
  eventResetHref,
  eventSearchParams,
} from "../../apps/console/lib/events-page-params";
import { parseAnalyticsQuery } from "../../apps/console/lib/query-contract";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const ADMIN = { role: "admin" as const, apps: null };

describe("paramètres de la page Événements", () => {
  it("refuse les query params répétés au lieu d'en choisir un silencieusement", () => {
    expect(eventSearchParams({ name: ["checkout", "signup"] })).toBeNull();
    expect(eventSearchParams({ app: ["tenant-a", "tenant-b"] })).toBeNull();
  });

  it("force offset=0 lorsqu'un curseur stable est fourni", () => {
    expect(eventPagePagination({ limit: 25, offset: 500 }, { ts: "x", id: "1" })).toEqual({
      limit: 25,
      offset: 0,
    });
    expect(eventPagePagination({ limit: 25, offset: 500 }, null).offset).toBe(500);
  });

  it("réinitialise seulement les filtres événementiels, tablette et contexte global compris", () => {
    const url = eventSearchParams({
      app: "demo-app",
      period: "7d",
      device: "tablet",
      browser: "Firefox",
      seg: "geo==FR",
      bots: "1",
      name: "checkout",
      attr_source: "props",
      cursor: "abc",
      offset: "20",
    });
    const parsed = parseAnalyticsQuery(url!, { principal: ADMIN, nowMs: NOW });
    if (!parsed.ok) throw new Error(parsed.error.code);
    const href = eventResetHref(parsed.value);
    expect(href).toBe("/events?app=demo-app&period=7d&device=tablet&browser=Firefox&seg=v2%3Acountry%3Aeq%3AFR&bots=1");
    expect(href).not.toMatch(/name|attr_|cursor|offset/);
  });

  it("garde une plage personnalisée telle quelle, bornes UTC comprises", () => {
    const parsed = parseAnalyticsQuery(
      new URLSearchParams("app=demo-app&from=2026-09-10T00:00:00Z&to=2026-09-11T00:00:00Z&name=x"),
      { principal: ADMIN, nowMs: NOW },
    );
    if (!parsed.ok) throw new Error(parsed.error.code);
    expect(eventResetHref(parsed.value)).toBe(
      "/events?app=demo-app&from=2026-09-10T00%3A00%3A00.000Z&to=2026-09-11T00%3A00%3A00.000Z",
    );
  });
});
