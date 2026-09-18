import { describe, expect, it } from "vitest";
import {
  canAccessDashboard,
  canCreateDashboard,
  canMutateDashboard,
  canUseDashboardApp,
  dashboardApps,
  dashboardFilters,
} from "../../apps/console/lib/dashboard-access";
import { parseAnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
function requete(qs: string, principal: ScopePrincipal) {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

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
    // La requête de l'écran est résolue contre le principal : app=app-b est refusée en amont.
    expect(parseAnalyticsQuery(new URLSearchParams("app=app-b"), { principal: viewerA, nowMs: NOW }).ok).toBe(false);
    // Tableau transverse sans app : les widgets restent dans les apps AUTORISÉES.
    const transverse = dashboardFilters(dashboard(null), requete("period=7d", viewerA), viewerA);
    expect(transverse?.query?.scope.effectiveApps).toEqual(["app-a"]);
    expect(transverse?.period).toBe("7d");
    // Tableau B hors périmètre : aucun filtre, donc aucun widget.
    expect(dashboardFilters(dashboard("app-b"), requete("", viewerA), viewerA)).toBeNull();
    expect(dashboardApps([{ app_id: "app-a", name: "A" }, { app_id: "app-b", name: "B" }], viewerA))
      .toEqual([{ app_id: "app-a", name: "A" }]);
  });

  it("intersecte l'app du tableau avec celle de l'écran, sans jamais la remplacer", () => {
    // Tableau lié à A lu en vue « toutes apps » : les widgets se resserrent sur A.
    expect(dashboardFilters(dashboard("app-a"), requete("", admin), admin)?.query?.scope.effectiveApps).toEqual(["app-a"]);
    // Tableau lié à A lu avec app=app-c : intersection vide, chaque widget rend zéro.
    const vide = dashboardFilters(dashboard("app-a"), requete("app=app-c&device=tablet", admin), admin);
    expect(vide?.query?.scope.effectiveApps).toEqual([]);
    // Les filtres globaux traversent l'intersection (ET), jamais effacés.
    expect(vide?.query?.filters.device).toBe("tablet");
  });
});
