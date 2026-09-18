import { describe, expect, it } from "vitest";
import {
  DASHBOARD_ACTIONS,
  canAccessDashboard,
  canCreateDashboard,
  canDashboardAction,
  canMutateDashboard,
  canUseDashboardApp,
  dashboardApps,
  dashboardFilters,
  ownerLabel,
  ownsDashboard,
} from "../../apps/console/lib/dashboard-access";
import { parseAnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
function requete(qs: string, principal: ScopePrincipal) {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

const dashboard = (
  app_id: string | null,
  created_by: string | null = "a@example.test",
  owner_id: string | null = null,
) => ({
  id: 9,
  name: "Vue",
  app_id,
  layout: [],
  created_by,
  owner_id,
  owner_email: owner_id ? created_by : null,
  revision: "1",
  created_at: new Date(),
  updated_at: new Date(),
});
const viewerA = { email: "a@example.test", role: "viewer" as const, apps: ["app-a"], accountId: "7" };
const admin = { email: "admin@example.test", role: "admin" as const, apps: null, accountId: "1" };

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

describe("dashboard access — chaque geste est nommé (P6.5)", () => {
  const demoA = { email: "demo@example.test", role: "viewer" as const, apps: ["app-a"], demo: true, accountId: null };
  const adminA = { email: "ops@example.test", role: "admin" as const, apps: ["app-a"], accountId: "3" };
  const LECTURES = ["read", "export"] as const;
  const ECRITURES = DASHBOARD_ACTIONS.filter((a) => !["read", "export", "clone"].includes(a));

  it("une session démo lit et exporte, mais n'écrit RIEN — clone compris", () => {
    const tableau = dashboard("app-a", "demo@example.test");
    for (const action of LECTURES) expect(canDashboardAction(demoA, tableau, action), action).toBe(true);
    for (const action of ECRITURES) expect(canDashboardAction(demoA, tableau, action), action).toBe(false);
    // Cloner CRÉE ailleurs : une session démo n'en a pas le droit non plus.
    expect(canDashboardAction(demoA, tableau, "clone")).toBe(false);
  });

  it("un viewer autorisé lit tout son périmètre, mais n'écrit que le sien", () => {
    const sien = dashboard("app-a", "a@example.test");
    const autrui = dashboard("app-a", "b@example.test");
    for (const action of LECTURES) {
      expect(canDashboardAction(viewerA, sien, action), action).toBe(true);
      expect(canDashboardAction(viewerA, autrui, action), action).toBe(true);
    }
    for (const action of ECRITURES) {
      expect(canDashboardAction(viewerA, sien, action), action).toBe(true);
      expect(canDashboardAction(viewerA, autrui, action), action).toBe(false);
    }
    // Cloner un tableau qu'il peut lire, dans une app où il peut créer : autorisé.
    expect(canDashboardAction(viewerA, autrui, "clone")).toBe(true);
    // Un tableau transverse se lit, ne se clone pas (il faudrait créer en transverse).
    expect(canDashboardAction(viewerA, dashboard(null), "read")).toBe(true);
    expect(canDashboardAction(viewerA, dashboard(null), "clone")).toBe(false);
  });

  it("un admin SCOPÉ gère dans son périmètre, et pas au-delà", () => {
    for (const action of DASHBOARD_ACTIONS) {
      expect(canDashboardAction(adminA, dashboard("app-a", "autre@example.test"), action), action).toBe(true);
      expect(canDashboardAction(adminA, dashboard("app-b", "autre@example.test"), action), action).toBe(false);
    }
    // Un tableau transverse n'appartient à aucune app : seul un admin transverse l'écrit.
    expect(canDashboardAction(adminA, dashboard(null), "rename")).toBe(false);
    expect(canDashboardAction(admin, dashboard(null), "rename")).toBe(true);
  });

  it("la clé de compte prime sur l'email : un homonyme n'hérite pas d'un tableau", () => {
    // Propriétaire résolu (owner_id) : l'email ne fait plus foi.
    expect(ownsDashboard(viewerA, dashboard("app-a", "a@example.test", "7"))).toBe(true);
    expect(ownsDashboard(viewerA, dashboard("app-a", "a@example.test", "99"))).toBe(false);
    // Propriétaire hérité (owner_id null) : l'email v18 reste le seul lien.
    expect(ownsDashboard(viewerA, dashboard("app-a", "a@example.test"))).toBe(true);
    expect(ownsDashboard(viewerA, dashboard("app-a", null))).toBe(false);
  });

  it("être propriétaire n'AJOUTE aucun droit hors périmètre", () => {
    const horsScope = dashboard("app-b", "a@example.test", "7");
    expect(ownsDashboard(viewerA, horsScope)).toBe(true);
    expect(canMutateDashboard(viewerA, horsScope)).toBe(false);
    expect(canAccessDashboard(viewerA, horsScope)).toBe(false);
  });

  it("l'adresse d'un AUTRE compte ne sort que vers une session admin", () => {
    const autrui = dashboard("app-a", "b@example.test", "42");
    expect(ownerLabel(autrui, viewerA)).toBe("un autre compte");
    expect(ownerLabel(autrui, admin)).toBe("b@example.test");
    expect(ownerLabel(dashboard("app-a", "a@example.test", "7"), viewerA)).toBe("vous");
    expect(ownerLabel(dashboard("app-a", null), admin)).toBe("propriétaire hérité");
  });
});
