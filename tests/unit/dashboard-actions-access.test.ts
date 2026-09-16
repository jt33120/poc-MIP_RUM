import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/next-cache", () => ({ revalidatePath: vi.fn() }));
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

import { addWidgetAction, createDashboardAction, deleteDashboardAction, renameDashboardAction } from "@/app/dashboards/actions";
import { getUser } from "@/lib/auth";
import { canCreateDashboard, getWritableDashboard } from "@/lib/dashboard-access";
import { deleteDashboard, insertDashboard, updateDashboardMeta, updateLayout } from "@/lib/queries-dashboards";
import { revalidatePath } from "@/lib/next-cache";

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

  it("ajoute un widget event_count valide au dashboard autorisé", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    vi.mocked(getWritableDashboard).mockResolvedValue({
      id: 44,
      name: "Ops",
      app_id: "app-a",
      created_by: "admin@example.test",
      created_at: new Date("2026-09-16T10:00:00Z"),
      updated_at: new Date("2026-09-16T10:00:00Z"),
      layout: [{ type: "traffic", title: "Trafic" }],
    });

    await addWidgetAction(form({ id: "44", type: "event_count", event_name: " checkout " }));

    expect(updateLayout).toHaveBeenCalledWith(44, [
      { type: "traffic", title: "Trafic" },
      { type: "event_count", eventName: "checkout", title: "Événements · checkout" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboards/44");
  });
});
