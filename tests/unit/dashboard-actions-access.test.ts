import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/dashboard-access", () => ({
  canCreateDashboard: vi.fn(),
  getWritableDashboard: vi.fn(),
}));
vi.mock("@/lib/queries-dashboards", () => ({
  deleteDashboard: vi.fn(),
  insertDashboard: vi.fn(),
  updateDashboardMeta: vi.fn(),
  updateLayout: vi.fn(),
}));

import { createDashboardAction, deleteDashboardAction, renameDashboardAction } from "@/app/dashboards/actions";
import { getUser } from "@/lib/auth";
import { canCreateDashboard, getWritableDashboard } from "@/lib/dashboard-access";
import { deleteDashboard, insertDashboard, updateDashboardMeta } from "@/lib/queries-dashboards";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
};

describe("actions dashboards — lecture transverse ≠ écriture", () => {
  afterEach(() => vi.clearAllMocks());

  it("un viewer ne crée pas de global et ne mute pas le dashboard d'un autre", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "a@example.test", role: "viewer", apps: ["app-a"] });
    vi.mocked(canCreateDashboard).mockReturnValue(false);
    vi.mocked(getWritableDashboard).mockResolvedValue(null);

    await createDashboardAction(form({ name: "global", app_id: "" }));
    await renameDashboardAction(form({ id: "44", name: "B secret", app_id: "app-b" }));
    await deleteDashboardAction(form({ id: "44" }));

    expect(insertDashboard).not.toHaveBeenCalled();
    expect(updateDashboardMeta).not.toHaveBeenCalled();
    expect(deleteDashboard).not.toHaveBeenCalled();
  });
});
