// P5.6 — la route v1 de LECTURE du workflow d'une issue : son historique, par jeton
// ou par session, dans le périmètre du principal.
//
// Les écritures (triage, commentaire, lien, ticket) ont quitté l'API v1 en C7 : elles
// passent par l'écran et leurs commandes (`lib/commandes/issues.ts`), éprouvées par
// `tests/unit/issue-workflow-commandes.test.ts`, la matrice d'autorisations et
// `tests/integration/error-issues-sql.test.ts` (comportement transactionnel).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const simul = vi.hoisted(() => ({
  listIssueActivity: vi.fn(),
}));

vi.mock("@/lib/error-issue-workflow", async (original) => ({
  ...(await original<object>()),
  ...simul,
}));

import { GET as ACTIVITE } from "../../apps/console/app/api/v1/issues/[id]/activity/route";
import { _resetRateLimit } from "../../apps/console/lib/api/ratelimit";
import { signJwt } from "../../apps/console/lib/auth";

const CONSOLE = "https://console.exemple.fr";
const ISSUE = "11111111-2222-4333-8444-555555555555";
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

let admin: string;
let viewer: string;

beforeEach(async () => {
  admin = await signJwt({ email: "admin@mip", role: "admin", apps: null });
  viewer = await signJwt({ email: "viewer@mip", role: "viewer", apps: ["app-a"] });
  process.env.CONSOLE_API_TOKENS = "tok,scope@app-a";
});

afterEach(() => {
  delete process.env.CONSOLE_API_TOKENS;
  delete process.env.CONSOLE_API_RATE_LIMIT;
  _resetRateLimit();
  vi.clearAllMocks();
});

describe("GET /api/v1/issues/{id}/activity", () => {
  const lire = (qui: Qui, query = "", id = ISSUE) => ACTIVITE(requete(`/api/v1/issues/${id}/activity${query}`, qui), route(id));

  it("lecture autorisée au jeton et au viewer, dans leur périmètre ; meta.app = app de l'issue", async () => {
    simul.listIssueActivity.mockResolvedValue({ kind: "ok", value: { app_id: "app-a", activities: [], next_cursor: null } });
    // Une app NOMMÉE hors périmètre est refusée avant toute lecture (P6.2), jamais rabattue.
    const refus = await lire({ bearer: "scope" }, "?app=app-b&limit=500");
    expect(refus.status).toBe(403);
    expect(simul.listIssueActivity).not.toHaveBeenCalled();
    const reponse = await lire({ bearer: "scope" }, "?limit=500");
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.meta.app).toBe("app-a");
    expect(corps.meta.scope).toEqual({ requested_app: "app-a", effective_apps: ["app-a"] });
    expect(corps.data).toEqual({ activities: [], next_cursor: null });
    // Jeton partenaire, puis viewer : jamais les adresses des comptes de la console.
    expect(simul.listIssueActivity).toHaveBeenCalledWith(ISSUE, ["app-a"], { limit: 100, cursor: null }, { emails: false });
    expect((await lire({ cookie: viewer })).status).toBe(200);
    expect(simul.listIssueActivity).toHaveBeenLastCalledWith(ISSUE, expect.anything(), { limit: 50, cursor: null }, { emails: false });
    expect((await lire({ cookie: admin })).status).toBe(200);
    expect(simul.listIssueActivity).toHaveBeenLastCalledWith(ISSUE, null, { limit: 50, cursor: null }, { emails: true });
  });

  it("401 sans authentification, 400 identifiant ou curseur invalide, 404 hors périmètre, 403 session sans app", async () => {
    expect((await lire({})).status).toBe(401);
    expect((await lire({ cookie: admin }, "", "pas-un-uuid")).status).toBe(400);
    expect((await lire({ cookie: admin }, "?cursor=forge")).status).toBe(400);
    simul.listIssueActivity.mockResolvedValue({ kind: "not_found" });
    expect((await lire({ cookie: admin })).status).toBe(404);
    const sansApp = await signJwt({ email: "vide@mip", role: "viewer", apps: [] });
    const vide = await lire({ cookie: sansApp });
    expect(vide.status).toBe(403);
    expect(await vide.json()).toMatchObject({ code: "no_app_access" });
  });
});
