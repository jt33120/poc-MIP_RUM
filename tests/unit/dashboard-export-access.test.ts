// Le 404 d'un dashboard hors scope doit couvrir la page de données ET le CSV :
// un identifiant séquentiel ne doit jamais révéler le nom/layout de l'app B.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/dashboard-access", () => ({
  canDashboardAction: vi.fn(),
  dashboardFilters: vi.fn(),
  dashboardPrincipal: vi.fn(),
  getAccessibleDashboard: vi.fn(),
}));
vi.mock("@/lib/widget-data", () => ({ resolveWidgets: vi.fn(), layoutToCsv: vi.fn() }));

import { GET } from "@/app/api/dashboards/[id]/export/route";
import { getUser } from "@/lib/auth";
import { dashboardPrincipal, getAccessibleDashboard } from "@/lib/dashboard-access";
import { layoutToCsv, resolveWidgets } from "@/lib/widget-data";

describe("GET /api/dashboards/:id/export — cloisonnement", () => {
  afterEach(() => vi.clearAllMocks());

  it("rend 404 sans aucun contenu B pour un viewer hors application", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "a@example.test", role: "viewer", apps: ["app-a"] });
    vi.mocked(dashboardPrincipal).mockResolvedValue({
      email: "a@example.test",
      role: "viewer",
      apps: ["app-a"],
      accountId: "7",
    });
    vi.mocked(getAccessibleDashboard).mockResolvedValue(null);

    const response = await GET(new Request("https://console.test/api/dashboards/42/export"), {
      params: Promise.resolve({ id: "42" }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("B secret dashboard");
    expect(resolveWidgets).not.toHaveBeenCalled();
    expect(layoutToCsv).not.toHaveBeenCalled();
  });

  it("rend 401 sans session — un export n'est jamais public", async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    vi.mocked(dashboardPrincipal).mockResolvedValue(null);

    const response = await GET(new Request("https://console.test/api/dashboards/42/export"), {
      params: Promise.resolve({ id: "42" }),
    });

    expect(response.status).toBe(401);
    expect(getAccessibleDashboard).not.toHaveBeenCalled();
  });
});
