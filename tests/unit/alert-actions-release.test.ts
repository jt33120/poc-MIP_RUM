// F68 — l'action serveur d'une règle de release, et qui peut l'écrire (piège 20, V9).
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Qu'une session de démonstration, un viewer ou un anonyme écrive une règle par
//     un POST direct : l'écran ne leur rend pas le formulaire, mais masquer n'est
//     pas protéger. La garde est testée À TRAVERS la vraie chaîne d'authentification
//     (`requireAdmin` → `getUser` → cookie signé), seuls `next/headers` et
//     `next/navigation` étant simulés.
//   - Qu'une « régression de release » s'écrive sur autre chose qu'un Web Vital, ou
//     avec une hausse tolérée vide, nulle ou négative remplacée en silence.
//   - Que le champ « Seuil » masqué (mode seuil) fasse le seuil d'une règle de
//     release : la hausse vient de SON champ, en pour cent.
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `next` est une dépendance de la CONSOLE : ses modules se simulent par leur chemin
// résolu depuis `apps/console`, celui qu'importe `lib/auth.ts` (import dynamique).
const depuisConsole = createRequire(`${process.cwd()}/apps/console/package.json`);
let jeton: string | null = null;
vi.doMock(depuisConsole.resolve("next/headers"), () => ({
  cookies: async () => ({ get: (nom: string) => (nom === "mip_session" && jeton ? { value: jeton } : undefined) }),
}));
vi.doMock(depuisConsole.resolve("next/navigation"), () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECTION ${url}`);
  },
}));
vi.mock("@/lib/next-cache", () => ({ revalidatePath: vi.fn() }));
// C8 : l'écriture et son audit partent d'une transaction (un client inerte ici).
vi.mock("@/lib/db", () => ({ q: vi.fn(async () => []), tx: vi.fn(async (fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })) }));
vi.mock("@/lib/queries-v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries-v2")>();
  return { ...actual, insertAlertRule: vi.fn(), updateAlertRule: vi.fn(), appDeRegle: vi.fn(), toggleAlertRuleActive: vi.fn() };
});

const { createRuleAction, toggleRuleAction, updateRuleAction } = await import("@/app/alerts/actions");
const { signJwt } = await import("@/lib/auth");
import type { SessionUser } from "@/lib/auth";
import { appDeRegle, insertAlertRule, toggleAlertRuleActive, updateAlertRule } from "@/lib/queries-v2";

const connecter = async (u: SessionUser | null) => {
  jeton = u ? await signJwt(u) : null;
};

function formulaireF68(extra: Record<string, string | null> = {}): FormData {
  const fd = new FormData();
  const champs: Record<string, string | null> = {
    app_id: "app-a",
    metric: "LCP",
    route: "/checkout",
    comparator: "<",
    threshold: "",
    window_minutes: "1440",
    mode: "release",
    severity: "warning",
    sensitivity: "3",
    baseline_weeks: "4",
    release_pct: "25",
    ...extra,
  };
  for (const [cle, valeur] of Object.entries(champs)) if (valeur !== null) fd.set(cle, valeur);
  return fd;
}

describe("F68 — règle de release : ce que l'action écrit", () => {
  beforeEach(() => connecter({ email: "admin@x", role: "admin", apps: null }));
  afterEach(() => vi.clearAllMocks());

  it("écrit le mode, la hausse EN POUR CENT de son champ, et « > » quel que soit le comparateur masqué", async () => {
    await createRuleAction(formulaireF68());
    expect(insertAlertRule).toHaveBeenCalledWith(
      expect.objectContaining({ app_id: "app-a", metric: "LCP", mode: "release", threshold: 25, comparator: ">", window_minutes: 1440 }),
      expect.anything(),
    );
  });

  it("champ absent (formulaire d'avant F68) : +20 %, la valeur par défaut du plan", async () => {
    await createRuleAction(formulaireF68({ release_pct: null }));
    expect(insertAlertRule).toHaveBeenCalledWith(expect.objectContaining({ mode: "release", threshold: 20 }), expect.anything());
  });

  it("hausse vide, nulle, négative ou démesurée : refusée, jamais remplacée", async () => {
    for (const release_pct of ["", "0", "-5", "abc", "1001"]) {
      await expect(createRuleAction(formulaireF68({ release_pct })), release_pct).rejects.toThrow(/hausse tolérée invalide/);
    }
    expect(insertAlertRule).not.toHaveBeenCalled();
  });

  it("réservée aux Web Vitals : taux d'erreur, logs, événement ou issue refusés", async () => {
    await expect(createRuleAction(formulaireF68({ metric: "error_rate" }))).rejects.toThrow(/Web Vitals/);
    await expect(createRuleAction(formulaireF68({ metric: "log_errors" }))).rejects.toThrow(/Web Vitals/);
    await expect(createRuleAction(formulaireF68({ metric: "event", event_name: "checkout" }))).rejects.toThrow(/Web Vitals/);
    expect(insertAlertRule).not.toHaveBeenCalled();
  });

  it("l'édition suit la même règle ; les modes seuil et baseline gardent leur seuil", async () => {
    await updateRuleAction(formulaireF68({ id: "9", release_pct: "12.5" }));
    expect(updateAlertRule).toHaveBeenCalledWith(9, "app-a", expect.objectContaining({ mode: "release", threshold: 12.5 }), expect.anything());
    await createRuleAction(formulaireF68({ mode: "threshold", threshold: "2500", comparator: ">" }));
    expect(insertAlertRule).toHaveBeenCalledWith(expect.objectContaining({ mode: "threshold", threshold: 2500 }), expect.anything());
  });
});

describe("F68 — qui peut écrire une règle (piège 20)", () => {
  afterEach(() => vi.clearAllMocks());

  it("anonyme : renvoyé vers /login, rien d'écrit", async () => {
    await connecter(null);
    await expect(createRuleAction(formulaireF68())).rejects.toThrow("REDIRECTION /login");
    expect(insertAlertRule).not.toHaveBeenCalled();
  });

  it("viewer, même dans son périmètre : renvoyé vers /, rien d'écrit", async () => {
    await connecter({ email: "viewer@x", role: "viewer", apps: ["app-a"] });
    await expect(createRuleAction(formulaireF68())).rejects.toThrow("REDIRECTION /");
    await expect(updateRuleAction(formulaireF68({ id: "9" }))).rejects.toThrow("REDIRECTION /");
    expect(insertAlertRule).not.toHaveBeenCalled();
    expect(updateAlertRule).not.toHaveBeenCalled();
  });

  it("démonstration, même avec le rôle admin : lecture seule, rien d'écrit — ni règle, ni bascule", async () => {
    await connecter({ email: "demo@x", role: "admin", apps: ["demo-app"], demo: true });
    await expect(createRuleAction(formulaireF68({ app_id: "demo-app" }))).rejects.toThrow(/démonstration/);
    await expect(updateRuleAction(formulaireF68({ app_id: "demo-app", id: "9" }))).rejects.toThrow(/démonstration/);
    const bascule = new FormData();
    bascule.set("id", "9");
    await expect(toggleRuleAction(bascule)).rejects.toThrow(/démonstration/);
    expect(insertAlertRule).not.toHaveBeenCalled();
    expect(updateAlertRule).not.toHaveBeenCalled();
    expect(toggleAlertRuleActive).not.toHaveBeenCalled();
  });

  it("C8 — un administrateur d'une LISTE n'écrit que dans ses applications ; la règle éditée est cherchée dans la sienne", async () => {
    await connecter({ email: "admin@x", role: "admin", apps: ["app-b"] });
    await expect(createRuleAction(formulaireF68({ app_id: "app-a" }))).rejects.toThrow(/périmètre/);
    await expect(updateRuleAction(formulaireF68({ app_id: "app-a", id: "9" }))).rejects.toThrow(/périmètre/);
    expect(insertAlertRule).not.toHaveBeenCalled();
    expect(updateAlertRule).not.toHaveBeenCalled();
    // Dans son application : écrit, sans relecture préalable (le filtre est dans l'écriture).
    await createRuleAction(formulaireF68({ app_id: "app-b" }));
    await updateRuleAction(formulaireF68({ app_id: "app-b", id: "9" }));
    expect(insertAlertRule).toHaveBeenCalledTimes(1);
    expect(updateAlertRule).toHaveBeenCalledWith(9, "app-b", expect.objectContaining({ app_id: "app-b" }), expect.anything());
    expect(appDeRegle).not.toHaveBeenCalled();
  });
});
