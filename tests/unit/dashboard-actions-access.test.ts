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
// F37 — sections de tableau de bord (imports du lot).
import { addSectionAction as f37AddSectionAction } from "@/app/dashboards/actions";
import { MAX_WIDGETS as F37_MAX_WIDGETS } from "@/lib/dashboards";
import type { DashboardRow as F37DashboardRow } from "@/lib/queries-dashboards";
// Revue de fin de vague 7 — une analyse de l'Explorer sur un tableau plein.
import { redirect as v7Redirect } from "next/navigation";
import { MAX_WIDGETS as V7_MAX_WIDGETS } from "@/lib/dashboards";
import type { DashboardRow as V7DashboardRow } from "@/lib/queries-dashboards";

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
    // F37 : sept cartes et trois titres de section ; la première carte garde son titre.
    expect(ecrit.layout).toHaveLength(10);
    expect(ecrit.layout?.[0]).toEqual({ kind: "section", title: "Seuils", question: "Les vitals tiennent-ils les seuils ?" });
    expect(ecrit.layout?.[1]).toMatchObject({ kind: "v2", title: "LCP p75" });
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

// F37 (W-B12) — « Ajouter une section ». La garde n'est pas un mock complaisant :
// `getWritableDashboard` y rejoue la VRAIE décision d'écriture
// (`canDashboardAction(…, "add_widget")`, soit `canMutateDashboard`) sur un tableau
// réel. Une section compte dans MAX_WIDGETS : un tableau plein la refuse comme une
// 25e carte, et le dit.
describe("F37 — ajouter une section", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWritableDashboard).mockReset();
  });

  /** Tableau de l'app A, propriété du compte 7 : deux cartes, révision 5. */
  const TABLEAU_F37: F37DashboardRow = {
    ...TABLEAU,
    owner_id: "7",
    layout: [
      { kind: "v1", type: "traffic", title: "Trafic" },
      { kind: "v1", type: "top_errors", title: "Erreurs principales" },
    ],
  };
  const PROPRIETAIRE_F37 = { email: "a@example.test", role: "viewer" as const, apps: ["app-a"], accountId: "7" };

  /** `getWritableDashboard` rejoue la garde RÉELLE de `lib/dashboard-access` sur `tableau`. */
  async function gardeReelleF37(tableau: F37DashboardRow): Promise<void> {
    const reel = await vi.importActual<typeof import("@/lib/dashboard-access")>("@/lib/dashboard-access");
    vi.mocked(getWritableDashboard).mockImplementation(async (_id, principal, action) =>
      reel.canDashboardAction(principal, tableau, action ?? "rename") ? tableau : null,
    );
  }

  /**
   * Destination d'une action, ou `null` : aucune redirection. Même lecture que le
   * helper F35 : l'URL est dans le `digest` de l'erreur NEXT_REDIRECT, ou dans le
   * dernier appel du mock quand il s'applique au module de l'action.
   */
  async function destinationF37(action: (fd: FormData) => Promise<void>, fd: FormData): Promise<string | null> {
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

  it("un viewer non propriétaire et une session démo : rien n'est écrit", async () => {
    await gardeReelleF37(TABLEAU_F37);
    const refuses = [
      { email: "b@example.test", role: "viewer" as const, apps: ["app-a"], accountId: "9" },
      { email: "demo@mip-rum.local", role: "viewer" as const, apps: ["app-a"], demo: true, accountId: null },
    ];
    for (const principal of refuses) {
      vi.mocked(dashboardPrincipal).mockResolvedValue(principal);
      await appeler(f37AddSectionAction, form({ id: "44", title: "Où ?", position: "0", revision: "5" }));
    }
    expect(updateLayout).not.toHaveBeenCalled();
    // La garde demandée est celle de l'ajout d'une carte — celle qui conditionne aussi le formulaire.
    expect(vi.mocked(getWritableDashboard).mock.calls.map((appel) => appel[2])).toEqual(["add_widget", "add_widget"]);
  });

  it("le propriétaire pose la section à la position choisie, en citant sa révision", async () => {
    await gardeReelleF37(TABLEAU_F37);
    vi.mocked(dashboardPrincipal).mockResolvedValue(PROPRIETAIRE_F37);
    vi.mocked(updateLayout).mockResolvedValue({ kind: "ok", revision: "6" });

    await appeler(
      f37AddSectionAction,
      form({ id: "44", title: " Où ? ", question: "Où les pages sont-elles lentes ?", position: "1", revision: "5" }),
    );
    // Sans position : en fin de tableau.
    await appeler(f37AddSectionAction, form({ id: "44", title: "Qui ?", revision: "5" }));

    const [[, avant], [, fin]] = vi.mocked(updateLayout).mock.calls;
    expect(avant).toEqual([
      TABLEAU_F37.layout[0],
      { kind: "section", title: "Où ?", question: "Où les pages sont-elles lentes ?" },
      TABLEAU_F37.layout[1],
    ]);
    expect(fin).toEqual([...TABLEAU_F37.layout, { kind: "section", title: "Qui ?", question: "" }]);
    expect(vi.mocked(updateLayout).mock.calls.map((appel) => appel[2])).toEqual(["5", "5"]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboards/44");
  });

  it("titre vide (des espaces passent `required`) ou position disparue : refus dit, rien d'écrit", async () => {
    await gardeReelleF37(TABLEAU_F37);
    vi.mocked(dashboardPrincipal).mockResolvedValue(PROPRIETAIRE_F37);

    const vide = await destinationF37(
      f37AddSectionAction,
      form({ id: "44", title: "   ", position: "0", revision: "5", ctx: "period=7d&tri=volume" }),
    );
    const horsTableau = await destinationF37(f37AddSectionAction, form({ id: "44", title: "Où ?", position: "3", revision: "5" }));

    expect(updateLayout).not.toHaveBeenCalled();
    // Seuls les paramètres du contrat voyagent avec le refus.
    expect([vide, horsTableau]).toEqual(["/dashboards/44?period=7d&section-refusee=1", "/dashboards/44?section-refusee=1"]);
  });

  it("24 éléments, sections comprises : la section est refusée comme une 25e carte, et le refus est dit", async () => {
    const plein: F37DashboardRow = {
      ...TABLEAU_F37,
      layout: [
        { kind: "section", title: "Seuils", question: "" },
        ...Array.from({ length: F37_MAX_WIDGETS - 1 }, () => ({ kind: "v1" as const, type: "traffic" as const, title: "Trafic" })),
      ],
    };
    await gardeReelleF37(plein);
    vi.mocked(dashboardPrincipal).mockResolvedValue(PROPRIETAIRE_F37);

    const section = await destinationF37(f37AddSectionAction, form({ id: "44", title: "Où ?", revision: "5" }));
    const carte = await destinationF37(addWidgetAction, form({ id: "44", type: "traffic", revision: "5" }));

    expect(updateLayout).not.toHaveBeenCalled();
    expect([section, carte]).toEqual(["/dashboards/44?plein=1", "/dashboards/44?plein=1"]);
  });
});

// Revue de fin de vague 7 (F37) — « Enregistrer cette analyse » (Explorer) ajoutait sa
// carte sans la garde de `addWidgetAction` : sur un tableau de 24 éléments, l'écriture
// « réussissait » et `serializeLayout` coupait la 25e carte en silence. Elle est
// désormais refusée, et le tableau le dit (`plein=1`, V10).
describe("Revue v7 — une analyse de l'Explorer sur un tableau plein", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWritableDashboard).mockReset();
  });

  const ADMIN_V7 = { email: "admin@example.test", role: "admin" as const, apps: null, accountId: "7" };
  /** Un tableau de `n` cartes « Trafic ». */
  const tableauV7 = (n: number): V7DashboardRow => ({
    ...TABLEAU,
    layout: Array.from({ length: n }, () => ({ kind: "v1" as const, type: "traffic" as const, title: "Trafic" })),
  });

  /** Destination de l'action (même lecture que les helpers F35 et F37), ou `null`. */
  async function destinationV7(fd: FormData): Promise<string | null> {
    vi.mocked(v7Redirect).mockClear();
    try {
      await saveAnalysisAction(fd);
    } catch (e) {
      const digest = (e as { digest?: unknown }).digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? null;
      throw e;
    }
    const appels = vi.mocked(v7Redirect).mock.calls;
    return appels.length ? String(appels[appels.length - 1][0]) : null;
  }

  it("24 éléments : la 25e carte est refusée, rien n'est écrit, et le refus est dit", async () => {
    vi.mocked(dashboardPrincipal).mockResolvedValue(ADMIN_V7);
    vi.mocked(getWritableDashboard).mockResolvedValue(tableauV7(V7_MAX_WIDGETS));

    const vers = await destinationV7(
      form({ id: "44", widget: JSON.stringify(ANALYSE), revision_44: "5", ctx: "period=7d&tri=volume" }),
    );

    expect(updateLayout).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    // Le tableau l'écrit (`role="alert"`, « Rien n'a été ajouté… ») ; seul le contrat voyage.
    expect(vers).toBe("/dashboards/44?period=7d&plein=1");
  });

  it("23 éléments : la 24e carte s'écrit encore, en fin de tableau, sans refus", async () => {
    vi.mocked(dashboardPrincipal).mockResolvedValue(ADMIN_V7);
    vi.mocked(getWritableDashboard).mockResolvedValue(tableauV7(V7_MAX_WIDGETS - 1));
    vi.mocked(updateLayout).mockResolvedValue({ kind: "ok", revision: "6" });

    const vers = await destinationV7(form({ id: "44", widget: JSON.stringify(ANALYSE), revision_44: "5" }));

    expect(vers).toBeNull();
    const [, layout, revision] = vi.mocked(updateLayout).mock.calls[0];
    expect(layout).toHaveLength(V7_MAX_WIDGETS);
    expect(layout[V7_MAX_WIDGETS - 1]).toMatchObject({ kind: "v2", title: "Erreurs par release" });
    expect(revision).toBe("5");
  });
});
