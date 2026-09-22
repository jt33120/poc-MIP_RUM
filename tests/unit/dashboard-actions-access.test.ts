import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/next-cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/dashboard-access", () => ({
  canCreateDashboard: vi.fn(),
  dashboardPrincipal: vi.fn(),
  getWritableDashboard: vi.fn(),
}));
vi.mock("@/lib/queries-dashboards", () => ({
  deleteDashboard: vi.fn(),
  insertDashboard: vi.fn(),
  updateDashboardMeta: vi.fn(),
  updateLayout: vi.fn(),
}));

import {
  addWidgetAction,
  cloneDashboardAction,
  createDashboardAction,
  deleteDashboardAction,
  renameDashboardAction,
  saveAnalysisAction,
} from "@/app/dashboards/actions";
import { getUser } from "@/lib/auth";
import { canCreateDashboard, dashboardPrincipal, getWritableDashboard } from "@/lib/dashboard-access";
import { deleteDashboard, insertDashboard, updateDashboardMeta, updateLayout } from "@/lib/queries-dashboards";
import { revalidatePath } from "@/lib/next-cache";
import { cloneTemplateAction as f35CloneTemplateAction } from "@/app/dashboards/actions";
import { redirect as f35Redirect } from "next/navigation";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
};

/**
 * `redirect()` de Next interrompt l'action en JETANT : c'est son mécanisme normal
 * de contrôle de flux. Le test l'absorbe pour observer ce qui a été écrit AVANT.
 */
async function appeler(action: (fd: FormData) => Promise<void>, fd: FormData): Promise<void> {
  try {
    await action(fd);
  } catch (e) {
    if (!(e instanceof Error) || !/NEXT_REDIRECT/.test(e.message)) throw e;
  }
}

const TABLEAU = {
  id: 44,
  name: "Ops",
  app_id: "app-a",
  created_by: "admin@example.test",
  owner_id: "7",
  owner_email: "admin@example.test",
  revision: "5",
  created_at: new Date("2026-09-16T10:00:00Z"),
  updated_at: new Date("2026-09-16T10:00:00Z"),
  layout: [{ kind: "v1" as const, type: "traffic" as const, title: "Trafic" }],
};

const ANALYSE = {
  schemaVersion: 2,
  type: "analytics",
  title: "Erreurs par release",
  query: {
    version: 1,
    dataset: "errors",
    measure: { aggregation: "sum", field: "occurrences" },
    filters: [],
    groupBy: ["release"],
    limit: 10,
  },
  visualization: "toplist",
  filters: [],
};

describe("actions dashboards — lecture transverse ≠ écriture", () => {
  afterEach(() => vi.clearAllMocks());

  it("un viewer ne crée pas de global et ne mute pas le dashboard d'un autre", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "a@example.test", role: "viewer", apps: ["app-a"] });
    vi.mocked(dashboardPrincipal).mockResolvedValue({
      email: "a@example.test", role: "viewer", apps: ["app-a"], accountId: "9",
    });
    vi.mocked(canCreateDashboard).mockReturnValue(false);
    vi.mocked(getWritableDashboard).mockResolvedValue(null);

    await appeler(createDashboardAction, form({ name: "global", app_id: "" }));
    await appeler(renameDashboardAction, form({ id: "44", name: "B secret", app_id: "app-b", revision: "1" }));
    await appeler(deleteDashboardAction, form({ id: "44" }));

    expect(insertDashboard).not.toHaveBeenCalled();
    expect(updateDashboardMeta).not.toHaveBeenCalled();
    expect(deleteDashboard).not.toHaveBeenCalled();
  });

  it("ajoute un widget event_count valide au dashboard autorisé, en citant sa révision", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    vi.mocked(dashboardPrincipal).mockResolvedValue({
      email: "admin@example.test", role: "admin", apps: null, accountId: "7",
    });
    vi.mocked(getWritableDashboard).mockResolvedValue(TABLEAU);
    vi.mocked(updateLayout).mockResolvedValue({ kind: "ok", revision: "6" });

    await appeler(addWidgetAction, form({ id: "44", type: "event_count", event_name: " checkout ", revision: "5" }));

    expect(updateLayout).toHaveBeenCalledWith(
      44,
      [
        { kind: "v1", type: "traffic", title: "Trafic" },
        { kind: "v1", type: "event_count", eventName: "checkout", title: "Événements · checkout" },
      ],
      "5",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboards/44");
  });

  it("une révision absente ou falsifiée n'écrit pas à l'aveugle : elle est citée comme invalide", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    vi.mocked(dashboardPrincipal).mockResolvedValue({
      email: "admin@example.test", role: "admin", apps: null, accountId: "7",
    });
    vi.mocked(getWritableDashboard).mockResolvedValue(TABLEAU);
    vi.mocked(updateLayout).mockResolvedValue({ kind: "conflict", error: "changé", revision: "6" });

    await appeler(addWidgetAction, form({ id: "44", type: "traffic", revision: "pas-un-entier" }));

    expect(updateLayout).toHaveBeenCalledWith(44, expect.anything(), "0");
    // Conflit : aucune revalidation, l'écran revient annoté.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("enregistre une analyse de l'Explorer comme carte v2, sans app ni fenêtre héritées", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    vi.mocked(dashboardPrincipal).mockResolvedValue({
      email: "admin@example.test", role: "admin", apps: null, accountId: "7",
    });
    vi.mocked(getWritableDashboard).mockResolvedValue(TABLEAU);
    vi.mocked(updateLayout).mockResolvedValue({ kind: "ok", revision: "6" });

    await saveAnalysisAction(
      form({ id: "44", widget: JSON.stringify(ANALYSE), title: "Top releases", revision_44: "5" }),
    );

    const [, layout] = vi.mocked(updateLayout).mock.calls[0];
    expect(layout).toHaveLength(2);
    expect(layout[1]).toMatchObject({ kind: "v2", title: "Top releases", rangeOverride: null });
  });

  it("une configuration illisible n'est jamais enregistrée", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    vi.mocked(dashboardPrincipal).mockResolvedValue({
      email: "admin@example.test", role: "admin", apps: null, accountId: "7",
    });
    vi.mocked(getWritableDashboard).mockResolvedValue(TABLEAU);

    await saveAnalysisAction(form({ id: "44", widget: "{pas du json", revision_44: "5" }));
    await saveAnalysisAction(
      form({ id: "44", widget: JSON.stringify({ ...ANALYSE, visualization: "camembert" }), revision_44: "5" }),
    );

    expect(updateLayout).not.toHaveBeenCalled();
  });

  it("cloner produit un NOUVEL identifiant, le cloneur pour propriétaire et la MÊME app", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "autre@example.test", role: "admin", apps: null });
    vi.mocked(dashboardPrincipal).mockResolvedValue({
      email: "autre@example.test", role: "admin", apps: null, accountId: "12",
    });
    vi.mocked(getWritableDashboard).mockResolvedValue(TABLEAU);
    vi.mocked(insertDashboard).mockResolvedValue(77);

    await appeler(cloneDashboardAction, form({ id: "44" }));

    expect(insertDashboard).toHaveBeenCalledWith({
      name: "Ops (copie)",
      app_id: "app-a",
      created_by: "autre@example.test",
      owner_id: "12",
      layout: TABLEAU.layout,
    });
  });
});

// F35 (W-D1) — cloner un modèle fourni : un tableau à soi, dans une app NOMMÉE où
// la session peut créer ; jamais pour une session démo ni un viewer sans app.
describe("F35 — cloner un modèle de tableau de bord", () => {
  afterEach(() => vi.clearAllMocks());

  /**
   * Destination d'une action : l'erreur NEXT_REDIRECT porte l'URL dans son `digest`
   * (« NEXT_REDIRECT;replace;/url;307; ») ; si le mock de `next/navigation` s'applique
   * au module de l'action, c'est son dernier appel. `null` : aucune redirection.
   */
  async function destination(action: (fd: FormData) => Promise<void>, fd: FormData): Promise<string | null> {
    vi.mocked(f35Redirect).mockClear();
    try {
      await action(fd);
    } catch (e) {
      const digest = (e as { digest?: unknown }).digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? null;
      throw e;
    }
    const appels = vi.mocked(f35Redirect).mock.calls;
    return appels.length ? String(appels[appels.length - 1][0]) : null;
  }

  it("session démo ou viewer sans app : rien n'est écrit, le refus est dit", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "demo@mip-rum.local", role: "viewer", apps: ["app-a"], demo: true });
    vi.mocked(dashboardPrincipal).mockResolvedValue({
      email: "demo@mip-rum.local", role: "viewer", apps: ["app-a"], demo: true, accountId: null,
    });
    vi.mocked(canCreateDashboard).mockReturnValue(false);
    const demo = await destination(f35CloneTemplateAction, form({ modele: "performance", app_id: "app-a" }));

    vi.mocked(dashboardPrincipal).mockResolvedValue({ email: "v@example.test", role: "viewer", apps: [], accountId: "9" });
    const sansApp = await destination(f35CloneTemplateAction, form({ modele: "performance", app_id: "app-a" }));

    expect(insertDashboard).not.toHaveBeenCalled();
    expect([demo, sansApp]).toEqual(["/dashboards?creation=refus", "/dashboards?creation=refus"]);
  });

  it("« toutes les apps » n'est jamais une cible de clonage, même pour un admin transverse", async () => {
    vi.mocked(dashboardPrincipal).mockResolvedValue({ email: "a@example.test", role: "admin", apps: null, accountId: "7" });
    vi.mocked(canCreateDashboard).mockReturnValue(true);
    expect(await destination(f35CloneTemplateAction, form({ modele: "erreurs", app_id: "" }))).toBe("/dashboards?creation=refus");
    expect(insertDashboard).not.toHaveBeenCalled();
  });

  it("un modèle inconnu ne clone rien", async () => {
    vi.mocked(canCreateDashboard).mockReturnValue(true);
    expect(await destination(f35CloneTemplateAction, form({ modele: "inexistant", app_id: "app-a" }))).toBe(
      "/dashboards?creation=modele-inconnu",
    );
    expect(insertDashboard).not.toHaveBeenCalled();
  });

  it("cloner « Performance » : « Performance — copie », le cloneur propriétaire, les cartes du modèle", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "a@example.test", role: "admin", apps: ["app-a"] });
    vi.mocked(dashboardPrincipal).mockResolvedValue({ email: "a@example.test", role: "admin", apps: ["app-a"], accountId: "7" });
    vi.mocked(canCreateDashboard).mockReturnValue(true);
    vi.mocked(insertDashboard).mockResolvedValue(91);

    const vers = await destination(
      f35CloneTemplateAction,
      form({ modele: "performance", app_id: "app-a", ctx: "period=7d&tri=volume" }),
    );

    const [ecrit] = vi.mocked(insertDashboard).mock.calls[0];
    expect(ecrit).toMatchObject({ name: "Performance — copie", app_id: "app-a", created_by: "a@example.test", owner_id: "7" });
    expect(ecrit.layout).toHaveLength(7);
    expect(ecrit.layout?.[0]).toMatchObject({ kind: "v2", title: "Seuils — LCP p75" });
    // Seuls les paramètres du contrat voyagent ; l'app du clone devient celle de l'écran.
    expect(vers).toBe("/dashboards/91?period=7d&app=app-a");
  });

  it("créer un tableau vide sans nom : refus dit, rien d'écrit", async () => {
    vi.mocked(canCreateDashboard).mockReturnValue(true);
    expect(await destination(createDashboardAction, form({ name: "   ", app_id: "app-a" }))).toBe(
      "/dashboards?creation=nom-vide",
    );
    expect(insertDashboard).not.toHaveBeenCalled();
  });
});
