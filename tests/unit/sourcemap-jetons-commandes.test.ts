// C9 — les jetons de CI des source maps s'administrent par leurs commandes
// (`creerJetonSourcemap`, `revoquerJetonSourcemap`), depuis l'écran : les server
// actions que ses formulaires appellent, en lieu et place des routes
// `/api/admin/sourcemap-tokens`. Qui peut, dans quelle application, et ce que le
// formulaire en reçoit — le secret une seule fois. Les écritures en base sont
// simulées ; elles sont prouvées sur PostgreSQL par la matrice d'autorisations.
import { beforeEach, describe, expect, it, vi } from "vitest";

const simul = vi.hoisted(() => ({
  user: null as null | { email: string; role: "admin" | "viewer"; apps: string[] | null; demo?: boolean },
  createSourcemapToken: vi.fn(),
  revokeSourcemapToken: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getUser: async () => simul.user }));
vi.mock("@/lib/db", () => ({ q: vi.fn(async () => []), tx: vi.fn(), pool: {} }));
vi.mock("@/lib/queries-sourcemap-tokens", async (original) => ({
  ...(await original<object>()),
  createSourcemapToken: simul.createSourcemapToken,
  revokeSourcemapToken: simul.revokeSourcemapToken,
}));

const { creerJetonSourcemapAction, revoquerJetonSourcemapAction } = await import("@/app/admin/sourcemaps/actions");

const JETON = { id: "11111111-1111-4111-8111-111111111111", name: "CI", appId: "app-a", createdAt: "x", expiresAt: "x", revokedAt: null, lastUsedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  simul.user = { email: "admin@mip", role: "admin", apps: ["app-a"] };
});

describe("C9 — créer un jeton de CI", () => {
  it("l'administrateur de l'application : le secret rendu une fois, la création auditée dans sa transaction", async () => {
    simul.createSourcemapToken.mockResolvedValue({ token: JETON, secret: "msu_secret" });
    expect(await creerJetonSourcemapAction("app-a", " CI ", 30)).toEqual({ ok: true, secret: "msu_secret", nom: "CI" });
    const [demande, email, auditer] = simul.createSourcemapToken.mock.calls[0];
    expect(demande).toEqual({ ok: true, appId: "app-a", name: "CI", expiresInDays: 30, scope: "sourcemaps:write" });
    expect(email).toBe("admin@mip");
    expect(typeof auditer).toBe("function");
  });

  it("une application hors de sa liste, un viewer, une démo : refusés avant toute écriture, et dit", async () => {
    expect(await creerJetonSourcemapAction("app-b", "CI", 30)).toEqual({ ok: false, erreur: "Cette application n'est pas dans votre périmètre." });
    simul.user = { email: "v@mip", role: "viewer", apps: ["app-a"] };
    expect(await creerJetonSourcemapAction("app-a", "CI", 30)).toEqual({ ok: false, erreur: "Réservé aux administrateurs." });
    simul.user = { email: "d@mip", role: "admin", apps: ["app-a"], demo: true };
    expect(await creerJetonSourcemapAction("app-a", "CI", 30)).toEqual({ ok: false, erreur: "Session de démonstration : lecture seule." });
    expect(simul.createSourcemapToken).not.toHaveBeenCalled();
  });

  it("une durée hors bornes : le refus du contrat, en toutes lettres", async () => {
    const r = await creerJetonSourcemapAction("app-a", "CI", 91);
    expect(r).toMatchObject({ ok: false });
    expect((r as { erreur: string }).erreur).toMatch(/expiresInDays/);
    expect(simul.createSourcemapToken).not.toHaveBeenCalled();
  });
});

describe("C9 — révoquer un jeton de CI", () => {
  it("cherché DANS l'application de la portée ; inconnu ailleurs", async () => {
    simul.revokeSourcemapToken.mockResolvedValueOnce({ ...JETON, revokedAt: "y" });
    expect(await revoquerJetonSourcemapAction("app-a", JETON.id)).toEqual({ ok: true });
    expect(simul.revokeSourcemapToken.mock.calls[0].slice(0, 3)).toEqual([JETON.id, "admin@mip", "app-a"]);
    simul.revokeSourcemapToken.mockResolvedValueOnce(null);
    expect(await revoquerJetonSourcemapAction("app-a", JETON.id)).toEqual({ ok: false });
    // Hors de sa liste : refusé avant la base.
    expect(await revoquerJetonSourcemapAction("app-b", JETON.id)).toEqual({ ok: false });
    expect(simul.revokeSourcemapToken).toHaveBeenCalledTimes(2);
  });
});
