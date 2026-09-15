import { describe, expect, it } from "vitest";
import {
  canAccessDashboard,
  canCreateDashboard,
  canMutateDashboard,
  canUseDashboardApp,
  dashboardApps,
  dashboardFilters,
} from "../../apps/console/lib/dashboard-access";

const dashboard = (app_id: string | null, created_by: string | null = "a@example.test") => ({
  id: 9,
  name: "Vue",
  app_id,
  layout: [],
  created_by,
  created_at: new Date(),
  updated_at: new Date(),
});
const viewerA = { email: "a@example.test", role: "viewer" as const, apps: ["app-a"] };
const admin = { email: "admin@example.test", role: "admin" as const, apps: null };

describe("dashboard access — scope tenant unique", () => {
  it("refuse le dashboard B à un viewer A, mais préserve l'accès admin", () => {
    expect(canAccessDashboard(viewerA, dashboard("app-b"))).toBe(false);
    expect(canAccessDashboard(admin, dashboard("app-b"))).toBe(true);
    expect(canUseDashboardApp(viewerA, "app-b")).toBe(false);
  });

  it("sépare la lecture transverse filtrée de toute écriture viewer", () => {
    const transverse = dashboard(null);
    expect(canAccessDashboard(viewerA, transverse)).toBe(true);
    expect(canCreateDashboard(viewerA, null)).toBe(false);
    expect(canMutateDashboard(viewerA, transverse)).toBe(false);
    expect(canMutateDashboard(viewerA, dashboard("app-a", "other@example.test"))).toBe(false);
    expect(canMutateDashboard(viewerA, dashboard("app-a"))).toBe(true);
    expect(canCreateDashboard(viewerA, "app-a")).toBe(true);
    expect(canCreateDashboard(viewerA, "app-b")).toBe(false);
  });

  it("laisse à l'admin la lecture et l'écriture globale", () => {
    expect(canCreateDashboard(admin, null)).toBe(true);
    expect(canMutateDashboard(admin, dashboard(null, "other@example.test"))).toBe(true);
    expect(canUseDashboardApp(admin, "app-b")).toBe(true);
  });

  it("ne laisse ni le query string ni le sélecteur révéler l'app B", () => {
    expect(dashboardFilters(dashboard(null), { app: "app-b", period: "7d" }, viewerA)?.app).toBe("app-a");
    expect(dashboardApps([{ app_id: "app-a", name: "A" }, { app_id: "app-b", name: "B" }], viewerA))
      .toEqual([{ app_id: "app-a", name: "A" }]);
  });
});
