// Contrat de GET /api/v1/issues et /api/v1/issues/{id} (P5.5) : portée (jeton
// scopé, session viewer sans app), paramètres refusés AVANT toute lecture, filtres
// transmis à la lecture unique, identifiant qui fait foi et forme de réponse. Les
// nombres sont prouvés sur PostgreSQL (tests/integration/error-issues-sql.test.ts) ;
// ici la lecture est simulée.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lecture = vi.hoisted(() => ({
  listIssues: vi.fn(),
  resolveIssue: vi.fn(),
  issueDetail: vi.fn(),
}));

// Parseurs RÉELS : seules les lectures SQL sont remplacées.
vi.mock("@/lib/error-issues", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/console/lib/error-issues")>()),
  ...lecture,
}));
const exemplarSymbolication = vi.hoisted(() => vi.fn());
vi.mock("@/lib/error-symbolication", () => ({ exemplarSymbolication }));

import { GET as LISTE } from "../../apps/console/app/api/v1/issues/route";
import { GET as DETAIL } from "../../apps/console/app/api/v1/issues/[id]/route";
import { buildOpenApi } from "../../apps/console/lib/api/openapi";
import { signJwt } from "../../apps/console/lib/auth";
import { GROUPING_BASES, ISSUE_STATUSES, encodeIssueCursor } from "../../apps/console/lib/error-issues";
import { ERROR_SOURCES } from "../../apps/console/lib/queries-errors";

type Auth = { bearer: string } | { cookie: string };

function requete(chemin: string, auth: Auth) {
  const url = `http://console.test/api/v1${chemin}`;
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers("bearer" in auth ? { authorization: `Bearer ${auth.bearer}` } : {}),
    cookies: { get: (nom: string) => ("cookie" in auth && nom === "mip_session" ? { value: auth.cookie } : undefined) },
  } as never;
}

const liste = (query: string, auth: Auth) => LISTE(requete(`/issues?${query}`, auth), { params: Promise.resolve({}) });
const detail = (id: string, query: string, auth: Auth) =>
  DETAIL(requete(`/issues/${encodeURIComponent(id)}?${query}`, auth), { params: Promise.resolve({ id }) });

const ID = "6e8bd3a1-2b1c-4d7e-9f00-0a1b2c3d4e5f";
const ISSUE = {
  id: ID,
  app_id: "app-b",
  grouping_version: 2,
  grouping_basis: "symbolicated_frame",
  origin: "migration",
  status: "for_review",
  status_source: "migration",
  first_seen: new Date("2026-09-10T10:00:00Z"),
  last_seen: new Date("2026-09-17T09:00:00Z"),
  first_release: "1.0.0",
  last_release: "1.1.0",
  resolved_at: null,
  resolved_release: null,
  resolved_env: null,
  reappeared: false,
  revision: "2",
  created_at: new Date("2026-09-17T08:00:00Z"),
  updated_at: new Date("2026-09-17T09:00:00Z"),
};
const IMPACT = {
  occurrences: 5, sessions_affected: 2, visitors_affected: null, identified_users_affected: null,
  session_coverage: 1, identity_coverage: 0,
};
const ECHANTILLONNAGE = { min_inclusion_probability: 1, message: null };

const CLES_LISTE = ["issues", "total", "next_cursor", "sampling", "coverage"];
const CLES_DETAIL = ["issue", "impact", "trend", "last_sample", "occurrences", "next_cursor", "sampling"];

beforeEach(() => {
  process.env.CONSOLE_API_TOKENS = "tok@app-a,s@app-a;app-b,global";
  lecture.listIssues.mockResolvedValue({
    issues: [{ kind: "issue", ...ISSUE, ...IMPACT, error_type: "TypeError", sample_message: "boom" }],
    total: 1,
    next_cursor: null,
    sampling: ECHANTILLONNAGE,
    coverage: { grouping_version: 2, available: true, active_apps: ["app-a"], issues: 1, legacy_groups: 0, occurrences_in_issues: 5, occurrences_legacy: 0, occurrences_low_confidence: 0, issue_share: 1 },
    enrichment: { available: true, diagnostic: null },
  });
  lecture.resolveIssue.mockResolvedValue(ISSUE);
  lecture.issueDetail.mockImplementation(async (issue) => detailLu(issue));
});

function detailLu(issue: typeof ISSUE) {
  return {
    issue,
    error_type: "TypeError",
    sample_message: "boom",
    impact: IMPACT,
    trend: [],
    last_sample: null,
    occurrences: [],
    next_cursor: null,
    sampling: ECHANTILLONNAGE,
    enrichment: { available: true, diagnostic: null },
    legacy_groups: [{ fingerprint: "368e01a8", legacy_status: "resolved", legacy_resolved_at: null, current_status: "resolved", note: "corrigé", issues: 1, attached_at: new Date() }],
    grouping_active: true,
  };
}

afterEach(() => {
  delete process.env.CONSOLE_API_TOKENS;
  vi.clearAllMocks();
});

describe("GET /api/v1/issues", () => {
  it("refuse l'app B hors du périmètre du jeton (403), sans la rabattre sur A ni lire", async () => {
    const reponse = await liste("app=app-b&period=7d&status=for_review", { bearer: "tok" });
    expect(reponse.status).toBe(403);
    expect(await reponse.json()).toMatchObject({ code: "forbidden_app", parameter: "app" });
    expect(lecture.listIssues).not.toHaveBeenCalled();
  });

  it("app du jeton : transmet filtres et limite bornée, périmètre compris", async () => {
    const reponse = await liste("app=app-a&period=7d&device=tablet&status=for_review&release=1.1.0&source=browser_js&limit=500", { bearer: "tok" });
    expect(reponse.status).toBe(200);
    expect(lecture.listIssues).toHaveBeenCalledTimes(1);
    const [filtres, criteres, page, opts] = lecture.listIssues.mock.calls[0];
    expect(filtres).toMatchObject({ app: "app-a", period: "7d", device: "tablet" });
    expect(filtres.includeBots).toBeFalsy();
    expect(criteres).toEqual({ status: "for_review", release: "1.1.0", source: "browser_js" });
    expect(page).toEqual({ limit: 100, cursor: null });
    expect(opts).toEqual({ apps: ["app-a"] });
    const corps = await reponse.json();
    expect(corps.meta.app).toBe("app-a");
    expect(Object.keys(corps.data)).toEqual(CLES_LISTE);
    expect(corps.data.issues[0]).toMatchObject({ kind: "issue", id: ID, revision: "2", first_seen: "2026-09-10T10:00:00.000Z" });
  });

  it("sans filtre : défauts explicites, jeton global sans liste d'apps", async () => {
    await liste("", { bearer: "global" });
    expect(lecture.listIssues).toHaveBeenCalledWith(
      expect.objectContaining({ app: null, device: null, period: "24h" }),
      { status: null, release: null, source: null },
      { limit: 50, cursor: null },
      { apps: null },
    );
  });

  it("transmet un curseur valide tel quel", async () => {
    const curseur = { rank: 2, visitors: -1, sessions: 3, occurrences: 7, last_seen_us: "1789639200000123", app_id: "app-a", ref: `legacy:368e01a8` };
    await liste(`cursor=${encodeIssueCursor(curseur)}`, { bearer: "tok" });
    expect(lecture.listIssues.mock.calls[0][2]).toEqual({ limit: 50, cursor: curseur });
  });

  it.each([
    ["status=reopened", "status invalide (open, for_review, resolved ou ignored)"],
    ["source=java", "source invalide"],
    [`release=${"x".repeat(201)}`, "release invalide (1 à 200 caractères, sans caractère de contrôle)"],
    ["cursor=pas-un-curseur", "cursor invalide"],
    [`cursor=${Buffer.from(JSON.stringify([9, 0, 0, 0, "1", "a", "legacy:x"])).toString("base64url")}`, "cursor invalide"],
  ])("refuse %s en 400, sans lire la base", async (query, message) => {
    const reponse = await liste(query, { bearer: "global" });
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({ error: message });
    expect(lecture.listIssues).not.toHaveBeenCalled();
  });

  it("refuse release=a%00b par le contrat commun (400 typé), sans lire la base", async () => {
    // `release` est aussi une dimension du contrat : un caractère de contrôle est
    // refusé avant la route, avec le code et la dimension en cause.
    const reponse = await liste("release=a%00b", { bearer: "global" });
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({
      code: "invalid_filter",
      parameter: "release",
      dimension: "release",
      error: "release invalide (1 à 500 caractères, sans caractère de contrôle)",
    });
    expect(lecture.listIssues).not.toHaveBeenCalled();
  });

  it("refuse 403 une session viewer sans aucune app", async () => {
    const cookie = await signJwt({ email: "v@mip", role: "viewer", apps: [] });
    const reponse = await liste("app=app-b", { cookie });
    expect(reponse.status).toBe(403);
    expect(lecture.listIssues).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/issues/{id}", () => {
  it("résout dans le périmètre du jeton, lit l'app de l'issue et l'annonce dans meta", async () => {
    const reponse = await detail(ID, "app=app-a&period=7d&device=desktop&limit=20", { bearer: "s" });
    expect(reponse.status).toBe(200);
    expect(lecture.resolveIssue).toHaveBeenCalledWith(ID, ["app-a", "app-b"]);
    expect(lecture.issueDetail).toHaveBeenCalledWith(
      ISSUE,
      expect.objectContaining({ app: "app-b", period: "7d", device: "desktop" }),
      { limit: 20, cursor: null },
    );
    const corps = await reponse.json();
    expect(corps.meta.app).toBe("app-b");
    expect(Object.keys(corps.data)).toEqual(CLES_DETAIL);
    expect(corps.data.issue).toMatchObject({
      id: ID, status: "for_review", revision: "2", grouping_active: true,
      legacy_groups: [expect.objectContaining({ fingerprint: "368e01a8", note: "corrigé" })],
    });
    expect(corps.data.last_sample).toBeNull();
  });

  it("dernier exemplaire : stack source ajoutée comme sur /errors/{fingerprint}, stack brute conservée", async () => {
    const brute = "TypeError: boom\n    at Ze (https://boutique.test/assets/index-D8LbuEa1.js:1:2345)";
    lecture.issueDetail.mockImplementationOnce(async (issue) => ({
      ...detailLu(issue),
      last_sample: { id: 42, ts: new Date("2026-09-17T09:00:00Z"), stack: brute, release: "1.1.0", occurrences: 1 },
    }));
    exemplarSymbolication.mockResolvedValueOnce({
      stack_symbolicated: "TypeError: boom\n    at validerPanier (src/panier/validerPanier.ts:42:7)",
      symbolication_status: "resolved",
      origin: "ingestion",
      reason: null,
      positions: [],
    });
    const corps = await (await detail(ID, "", { bearer: "s" })).json();
    expect(exemplarSymbolication).toHaveBeenCalledWith("app-b", expect.objectContaining({ id: 42 }));
    expect(corps.data.last_sample).toMatchObject({
      id: 42,
      stack: brute,
      stack_symbolicated: "TypeError: boom\n    at validerPanier (src/panier/validerPanier.ts:42:7)",
      symbolication_status: "resolved",
    });
  });

  it("404 hors périmètre ou inconnue ; 400 pour un identifiant ou un curseur forgé ; 403 sans app, sans lire", async () => {
    lecture.resolveIssue.mockResolvedValueOnce(null);
    expect((await detail(ID, "", { bearer: "tok" })).status).toBe(404);
    expect(lecture.issueDetail).not.toHaveBeenCalled();

    vi.clearAllMocks();
    for (const [id, query, message] of [
      ["pas-un-uuid", "", "id invalide (UUID attendu)"],
      [ID.toUpperCase(), "", "id invalide (UUID attendu)"],
      [ID, "cursor=forge", "cursor invalide"],
    ]) {
      const reponse = await detail(id, query, { bearer: "global" });
      expect(reponse.status, `${id} ${query}`).toBe(400);
      expect(await reponse.json()).toEqual({ error: message });
    }
    expect(lecture.resolveIssue).not.toHaveBeenCalled();

    // Session sans aucune app : refus du contrat (403), avant toute résolution.
    const cookie = await signJwt({ email: "v@mip", role: "viewer", apps: [] });
    const vide = await detail(ID, "", { cookie });
    expect(vide.status).toBe(403);
    expect(await vide.json()).toEqual({ code: "no_app_access", error: "aucune application autorisée" });
    expect(lecture.resolveIssue).not.toHaveBeenCalled();
  });
});

describe("spec OpenAPI des issues", () => {
  const spec = buildOpenApi() as {
    paths: Record<string, unknown>;
    components: { schemas: Record<string, { required?: string[]; properties?: Record<string, { enum?: unknown[] }> }>; parameters: Record<string, { schema: { enum?: unknown[] } }> };
  };

  it("déclare les deux routes et leurs clés de réponse exactes", () => {
    expect(spec.paths).toHaveProperty("/issues");
    expect(spec.paths).toHaveProperty("/issues/{id}");
    expect(spec.components.schemas.IssueList.required).toEqual(CLES_LISTE);
    expect(spec.components.schemas.IssueDetail.required).toEqual(CLES_DETAIL);
  });

  it("recopie fidèlement statuts, bases de regroupement et sources", () => {
    expect(spec.components.parameters.issueStatus.schema.enum).toEqual([...ISSUE_STATUSES]);
    expect(spec.components.schemas.IssueRecord.properties?.grouping_basis.enum).toEqual([...GROUPING_BASES]);
    expect(spec.components.parameters.issueSource.schema.enum).toEqual([...ERROR_SOURCES]);
  });
});
