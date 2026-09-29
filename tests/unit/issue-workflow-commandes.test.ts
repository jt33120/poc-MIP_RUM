// C7 — le workflow d'une issue passe par la server action de l'écran et ses
// commandes (`lib/commandes/issues.ts`) : qui peut écrire, sur quelle application,
// et ce que le formulaire en dit. Les mutations en base sont simulées ; les
// analyseurs, la règle et l'exécuteur de commandes sont les vrais. Le comportement
// transactionnel est prouvé dans `tests/integration/error-issues-sql.test.ts`, les
// vraies commandes par profil dans la matrice d'autorisations.
import { beforeEach, describe, expect, it, vi } from "vitest";

const simul = vi.hoisted(() => ({
  user: null as null | { email: string; role: "admin" | "viewer"; apps: string[] | null; demo?: boolean },
  triageIssue: vi.fn(),
  commentIssue: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getUser: async () => simul.user }));
vi.mock("@/lib/db", () => ({ q: vi.fn(async () => []), tx: vi.fn() }));
vi.mock("@/lib/error-issue-workflow", async (original) => ({
  ...(await original<object>()),
  triageIssue: simul.triageIssue,
  commentIssue: simul.commentIssue,
}));

const { muterIssue } = await import("@/app/errors/issues/actions");

const ISSUE = "11111111-2222-4333-8444-555555555555";
const ADMIN_A = { email: "admin@mip", role: "admin" as const, apps: ["app-a"] };

beforeEach(() => {
  vi.clearAllMocks();
  simul.user = ADMIN_A;
  for (const f of [simul.triageIssue, simul.commentIssue]) f.mockResolvedValue({ kind: "ok", value: {} });
});

describe("C7 — qui peut écrire le workflow d'une issue", () => {
  it("l'administrateur de l'application : la mutation part DANS cette application, avec l'audit de la commande", async () => {
    expect(await muterIssue(ISSUE, "triage", { app: "app-a", status: "resolved", expectedRevision: "3" })).toEqual({ etat: "ok" });
    const [ctx, demande] = simul.triageIssue.mock.calls[0];
    expect(ctx).toMatchObject({ issueId: ISSUE, apps: ["app-a"], actorEmail: "admin@mip" });
    expect(typeof ctx.auditer).toBe("function");
    expect(demande).toEqual({ app: "app-a", status: "resolved", expectedRevision: "3" });
  });

  it("un viewer, une démo, une application hors de la liste : refusés avant toute mutation, et dit", async () => {
    simul.user = { email: "v@mip", role: "viewer", apps: ["app-a"] };
    expect(await muterIssue(ISSUE, "comments", { app: "app-a", body: "vu", expectedRevision: "3" })).toEqual({ etat: "erreur", message: "Réservé aux administrateurs." });
    simul.user = { email: "d@mip", role: "admin", apps: ["app-a"], demo: true };
    expect(await muterIssue(ISSUE, "comments", { app: "app-a", body: "vu", expectedRevision: "3" })).toMatchObject({ etat: "erreur" });
    simul.user = ADMIN_A;
    expect(await muterIssue(ISSUE, "triage", { app: "app-b", status: "resolved", expectedRevision: "3" })).toEqual({
      etat: "erreur",
      message: "Cette application n'est pas dans votre périmètre.",
    });
    expect(simul.triageIssue).not.toHaveBeenCalled();
    expect(simul.commentIssue).not.toHaveBeenCalled();
  });

  it("un identifiant d'issue qui n'est pas un UUID : refusé en entrée, rien ne part", async () => {
    expect(await muterIssue("pas-un-uuid", "triage", { app: "app-a", status: "resolved", expectedRevision: "3" })).toMatchObject({ etat: "erreur" });
    expect(simul.triageIssue).not.toHaveBeenCalled();
  });
});

describe("C7 — ce que le formulaire dit de la décision", () => {
  it("conflit de révision : dit comme tel, pour proposer de recharger", async () => {
    simul.triageIssue.mockResolvedValue({ kind: "conflict", error: "l'issue a été modifiée depuis sa lecture : recharger", revision: "5" });
    expect(await muterIssue(ISSUE, "triage", { app: "app-a", status: "ignored", expectedRevision: "3" })).toEqual({
      etat: "conflit",
      message: "l'issue a été modifiée depuis sa lecture : recharger",
    });
  });

  it("corps refusé par l'analyseur du workflow : l'erreur en toutes lettres, la mutation jamais appelée", async () => {
    expect(await muterIssue(ISSUE, "triage", { app: "app-a", status: "bidule", expectedRevision: "3" })).toMatchObject({ etat: "erreur" });
    expect(simul.triageIssue).not.toHaveBeenCalled();
  });

  it("introuvable : un refus, pas une panne", async () => {
    simul.commentIssue.mockResolvedValue({ kind: "not_found" });
    expect(await muterIssue(ISSUE, "comments", { app: "app-a", body: "vu", expectedRevision: "3" })).toEqual({ etat: "erreur", message: "Issue introuvable." });
  });

  it("le lien et la demande de ticket, retirés le 29/09/2026 : une action inconnue, rien ne part", async () => {
    for (const action of ["links", "tickets"]) {
      expect(await muterIssue(ISSUE, action as never, { app: "app-a", expectedRevision: "3" })).toEqual({ etat: "erreur", message: "action inconnue" });
    }
    expect(simul.triageIssue).not.toHaveBeenCalled();
    expect(simul.commentIssue).not.toHaveBeenCalled();
  });
});
