// P5.6 — routes v1 du workflow d'une issue : QUI peut écrire, et quel statut HTTP
// pour chaque issue du contrat.
//
// `/api/v1` contourne le middleware : les gardes de démo, de rôle et d'Origin sont
// dans handleMutation, et c'est ici qu'on les prouve. Les écritures en base sont
// simulées ; parseurs, garde, débit et bornes de corps sont les vrais. Le
// comportement transactionnel est prouvé dans tests/integration/error-issues-sql.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const simul = vi.hoisted(() => ({
  triageIssue: vi.fn(),
  commentIssue: vi.fn(),
  linkIssue: vi.fn(),
  listIssueActivity: vi.fn(),
}));

vi.mock("@/lib/error-issue-workflow", async (original) => ({
  ...(await original<object>()),
  ...simul,
}));

import { GET as ACTIVITE } from "../../apps/console/app/api/v1/issues/[id]/activity/route";
import { POST as COMMENTER } from "../../apps/console/app/api/v1/issues/[id]/comments/route";
import { POST as LIER } from "../../apps/console/app/api/v1/issues/[id]/links/route";
import { POST as TRIER } from "../../apps/console/app/api/v1/issues/[id]/triage/route";
import { _resetRateLimit } from "../../apps/console/lib/api/ratelimit";
import { signJwt } from "../../apps/console/lib/auth";

const CONSOLE = "https://console.exemple.fr";
const ISSUE = "11111111-2222-4333-8444-555555555555";
const ETAT = {
  id: ISSUE,
  app_id: "app-a",
  status: "resolved",
  status_source: "user",
  assignee: null,
  resolved_at: new Date("2026-09-17T10:00:00Z"),
  resolved_by: { user_id: "1", email: "admin@mip" },
  resolved_release: "1.4",
  resolved_env: "prod",
  revision: "4",
  updated_at: new Date("2026-09-17T10:00:00Z"),
};

type Qui = { cookie?: string; bearer?: string; origin?: string | null };

function requete(chemin: string, { cookie, bearer, origin = CONSOLE }: Qui, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "console.exemple.fr", ...init.headers };
  if (origin) headers.origin = origin;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const brute = new Request(`${CONSOLE}${chemin}`, { method: init.method ?? "GET", headers, body: init.body });
  return Object.assign(brute, {
    nextUrl: new URL(brute.url),
    cookies: { get: (nom: string) => (cookie && nom === "mip_session" ? { value: cookie } : undefined) },
  }) as never;
}

const route = (id = ISSUE) => ({ params: Promise.resolve({ id }) });
const trier = (qui: Qui, corps: unknown, id = ISSUE, headers?: Record<string, string>) =>
  TRIER(requete(`/api/v1/issues/${id}/triage`, qui, { method: "POST", body: typeof corps === "string" ? corps : JSON.stringify(corps), headers }), route(id));

let admin: string;
let viewer: string;
let demo: string;
const corpsTriage = { app: "app-a", status: "resolved", expectedRevision: "3" };

beforeEach(async () => {
  admin = await signJwt({ email: "admin@mip", role: "admin", apps: null });
  viewer = await signJwt({ email: "viewer@mip", role: "viewer", apps: ["app-a"] });
  demo = await signJwt({ email: "demo@mip", role: "viewer", apps: ["app-a"], demo: true });
  process.env.CONSOLE_API_TOKENS = "tok,scope@app-a";
  simul.triageIssue.mockResolvedValue({ kind: "ok", value: ETAT });
});

afterEach(() => {
  delete process.env.CONSOLE_API_TOKENS;
  delete process.env.CONSOLE_API_RATE_LIMIT;
  _resetRateLimit();
  vi.clearAllMocks();
});

describe("mutations : qui peut écrire", () => {
  it("401 sans authentification ; 401 pour un jeton inconnu", async () => {
    expect((await trier({}, corpsTriage)).status).toBe(401);
    expect((await trier({ bearer: "inconnu" }, corpsTriage)).status).toBe(401);
    expect(simul.triageIssue).not.toHaveBeenCalled();
  });

  it("403 pour un jeton de lecture, même accompagné d'un cookie admin, pour un viewer et pour la démo", async () => {
    for (const qui of [{ bearer: "tok" }, { bearer: "scope" }, { bearer: "tok", cookie: admin }, { cookie: viewer }, { cookie: demo }]) {
      const reponse = await trier(qui, corpsTriage);
      expect(reponse.status, JSON.stringify(qui)).toBe(403);
    }
    expect(simul.triageIssue).not.toHaveBeenCalled();
  });

  it("403 pour une session admin sans Origin ou d'une autre origine (CSRF)", async () => {
    expect((await trier({ cookie: admin, origin: null }, corpsTriage)).status).toBe(403);
    expect((await trier({ cookie: admin, origin: "https://evil.exemple" }, corpsTriage)).status).toBe(403);
    expect(simul.triageIssue).not.toHaveBeenCalled();
  });

  it("session admin de même origine : mutation au nom de l'admin, enveloppe { meta, data }", async () => {
    const reponse = await trier({ cookie: admin }, corpsTriage);
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("cache-control")).toBe("no-store");
    const corps = await reponse.json();
    expect(corps.meta).toMatchObject({ app: "app-a" });
    expect(corps.data.issue).toMatchObject({ id: ISSUE, status: "resolved", revision: "4" });
    expect(simul.triageIssue).toHaveBeenCalledWith(
      { issueId: ISSUE, apps: null, actorEmail: "admin@mip" },
      { app: "app-a", status: "resolved", expectedRevision: "3" },
    );
  });
});

describe("mutations : contrat et statuts", () => {
  it("429 au-delà du débit, avec Retry-After", async () => {
    process.env.CONSOLE_API_RATE_LIMIT = "1";
    expect((await trier({ cookie: admin }, corpsTriage)).status).toBe(200);
    const refus = await trier({ cookie: admin }, corpsTriage);
    expect(refus.status).toBe(429);
    expect(Number(refus.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("413 au-delà de 16 Kio, annoncés ou mesurés", async () => {
    const annonce = await trier({ cookie: admin }, corpsTriage, ISSUE, { "content-length": String(16 * 1024 + 1) });
    expect(annonce.status).toBe(413);
    const lourd = await COMMENTER(
      requete(`/api/v1/issues/${ISSUE}/comments`, { cookie: admin }, {
        method: "POST",
        body: JSON.stringify({ app: "app-a", body: "x".repeat(20 * 1024), expectedRevision: "3" }),
      }),
      route(),
    );
    expect(lourd.status).toBe(413);
    expect(simul.commentIssue).not.toHaveBeenCalled();
  });

  it("400 : JSON invalide, identifiant non UUID, contrat de corps non respecté", async () => {
    expect((await trier({ cookie: admin }, "{pas du json")).status).toBe(400);
    expect((await trier({ cookie: admin }, corpsTriage, "pas-un-uuid")).status).toBe(400);
    const sansMutation = await trier({ cookie: admin }, { app: "app-a", expectedRevision: "3" });
    expect(sansMutation.status).toBe(400);
    expect((await sansMutation.json()).error).toMatch(/au moins une mutation/);
    expect((await trier({ cookie: admin }, { ...corpsTriage, expectedRevision: undefined })).status).toBe(400);
    const lien = await LIER(
      requete(`/api/v1/issues/${ISSUE}/links`, { cookie: admin }, {
        method: "POST",
        body: JSON.stringify({ app: "app-a", url: "http://jira.exemple.fr/MIP-1", label: "MIP-1", expectedRevision: "3" }),
      }),
      route(),
    );
    expect(lien.status).toBe(400);
    expect(simul.triageIssue).not.toHaveBeenCalled();
    expect(simul.linkIssue).not.toHaveBeenCalled();
  });

  it("404 hors périmètre, 403 sans compte console, 409 avec la révision courante, 503 avant migration-v73", async () => {
    const statuts: Array<[unknown, number]> = [
      [{ kind: "not_found" }, 404],
      [{ kind: "forbidden", error: "aucun compte console actif pour cette session" }, 403],
      [{ kind: "conflict", error: "l'issue a été modifiée depuis sa lecture : recharger", revision: "7" }, 409],
      [{ kind: "invalid", error: "assigneeUserId : aucun compte actif autorisé sur cette app" }, 400],
      [{ kind: "unavailable" }, 503],
    ];
    for (const [resultat, statut] of statuts) {
      simul.triageIssue.mockResolvedValueOnce(resultat);
      const reponse = await trier({ cookie: admin }, corpsTriage);
      expect(reponse.status, JSON.stringify(resultat)).toBe(statut);
      if (statut === 409) expect(await reponse.json()).toEqual({ revision: "7", error: "l'issue a été modifiée depuis sa lecture : recharger" });
    }
  });

  it("commentaire et lien créés : 201, corps scrubbé transmis tel que validé", async () => {
    simul.commentIssue.mockResolvedValue({ kind: "ok", value: { activity: { id: "9", kind: "comment" }, revision: "5" } });
    const commente = await COMMENTER(
      requete(`/api/v1/issues/${ISSUE}/comments`, { cookie: admin }, {
        method: "POST",
        body: JSON.stringify({ app: "app-a", body: "voir avec luc@exemple.fr", expectedRevision: 4 }),
      }),
      route(),
    );
    expect(commente.status).toBe(201);
    expect((await commente.json()).data).toEqual({ activity: { id: "9", kind: "comment" }, revision: "5" });
    expect(simul.commentIssue).toHaveBeenCalledWith(
      { issueId: ISSUE, apps: null, actorEmail: "admin@mip" },
      { app: "app-a", body: "voir avec [email]", expectedRevision: "4" },
    );

    simul.linkIssue.mockResolvedValue({ kind: "duplicate", error: "ce lien est déjà attaché à l'issue" });
    const doublon = await LIER(
      requete(`/api/v1/issues/${ISSUE}/links`, { cookie: admin }, {
        method: "POST",
        body: JSON.stringify({ app: "app-a", url: "https://jira.exemple.fr/MIP-1", label: "MIP-1", expectedRevision: "5" }),
      }),
      route(),
    );
    // Un doublon n'est pas un conflit de révision : 422, sans révision à relire.
    expect(doublon.status).toBe(422);
    expect(await doublon.json()).toEqual({ error: "ce lien est déjà attaché à l'issue" });
  });
});

describe("GET /api/v1/issues/{id}/activity", () => {
  const lire = (qui: Qui, query = "", id = ISSUE) => ACTIVITE(requete(`/api/v1/issues/${id}/activity${query}`, qui), route(id));

  it("lecture autorisée au jeton et au viewer, dans leur périmètre ; meta.app = app de l'issue", async () => {
    simul.listIssueActivity.mockResolvedValue({ kind: "ok", value: { app_id: "app-a", activities: [], next_cursor: null } });
    const reponse = await lire({ bearer: "scope" }, "?app=app-b&limit=500");
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.meta.app).toBe("app-a");
    expect(corps.data).toEqual({ activities: [], next_cursor: null });
    // Jeton partenaire, puis viewer : jamais les adresses des comptes de la console.
    expect(simul.listIssueActivity).toHaveBeenCalledWith(ISSUE, ["app-a"], { limit: 100, cursor: null }, { emails: false });
    expect((await lire({ cookie: viewer })).status).toBe(200);
    expect(simul.listIssueActivity).toHaveBeenLastCalledWith(ISSUE, expect.anything(), { limit: 50, cursor: null }, { emails: false });
    expect((await lire({ cookie: admin })).status).toBe(200);
    expect(simul.listIssueActivity).toHaveBeenLastCalledWith(ISSUE, null, { limit: 50, cursor: null }, { emails: true });
  });

  it("401 sans authentification, 400 identifiant ou curseur invalide, 404 hors périmètre ou session sans app", async () => {
    expect((await lire({})).status).toBe(401);
    expect((await lire({ cookie: admin }, "", "pas-un-uuid")).status).toBe(400);
    expect((await lire({ cookie: admin }, "?cursor=forge")).status).toBe(400);
    simul.listIssueActivity.mockResolvedValue({ kind: "not_found" });
    expect((await lire({ cookie: admin })).status).toBe(404);
    const sansApp = await signJwt({ email: "vide@mip", role: "viewer", apps: [] });
    expect((await lire({ cookie: sansApp })).status).toBe(404);
  });
});
