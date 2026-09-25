// P5.4 — routes console des source maps : QUI peut écrire, et par quel port.
//
// POST /api/sourcemaps accepte un jeton dédié OU une session admin avec l'Origin
// de la console ; jamais un jeton de lecture, jamais une session viewer ou démo.
// Les lectures et écritures en base sont simulées ; le contrat d'upload RÉEL
// (bornes, validation) s'exécute, et l'écriture est prouvée sur PostgreSQL
// ailleurs. Les jetons de CI s'administrent depuis C9 par leurs commandes
// (`tests/unit/sourcemap-jetons-commandes.test.ts`) : les routes
// `/api/admin/sourcemap-tokens` ont été retirées.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const simul = vi.hoisted(() => ({
  verifierJetonUpload: vi.fn(),
  enregistrerMaps: vi.fn(),
  listSourcemapReleases: vi.fn(),
  releaseManifest: vi.fn(),
  listSourcemapTokens: vi.fn(),
  createSourcemapToken: vi.fn(),
  revokeSourcemapToken: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ pool: { simule: true }, q: vi.fn(), tx: vi.fn() }));
vi.mock("../../packages/backend/lib/sourcemap-upload.mjs", async (original) => ({
  ...(await original<object>()),
  verifierJetonUpload: simul.verifierJetonUpload,
  enregistrerMaps: simul.enregistrerMaps,
}));
vi.mock("@/lib/queries-sourcemap", async (original) => ({
  ...(await original<object>()),
  listSourcemapReleases: simul.listSourcemapReleases,
  releaseManifest: simul.releaseManifest,
}));
vi.mock("@/lib/queries-sourcemap-tokens", async (original) => ({
  ...(await original<object>()),
  listSourcemapTokens: simul.listSourcemapTokens,
  createSourcemapToken: simul.createSourcemapToken,
  revokeSourcemapToken: simul.revokeSourcemapToken,
}));

import { GET as LISTE_MAPS, POST as UPLOAD } from "../../apps/console/app/api/sourcemaps/route";
import { guardAdmin, sameOrigin } from "../../apps/console/lib/api/admin";
import { signJwt } from "../../apps/console/lib/auth";
import { parseTokenRequest } from "../../apps/console/lib/queries-sourcemap-tokens";

const CONSOLE = "https://console.exemple.fr";
const MAP = { version: 3, sources: ["src/a.ts"], names: [], mappings: "AAAA" };
const JETON = `msu_${"1".repeat(32)}_${"2".repeat(64)}`;

type Qui = { cookie?: string; bearer?: string; origin?: string | null };

/** Requête web réelle (corps en flux), augmentée de ce que NextRequest ajoute : nextUrl et cookies. */
function requete(
  chemin: string,
  { cookie, bearer, origin = CONSOLE }: Qui,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { host: "console.exemple.fr", ...init.headers };
  if (origin) headers.origin = origin;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const brute = new Request(`${CONSOLE}${chemin}`, { method: init.method ?? "GET", headers, body: init.body });
  return Object.assign(brute, {
    nextUrl: new URL(brute.url),
    cookies: { get: (nom: string) => (cookie && nom === "mip_session" ? { value: cookie } : undefined) },
  }) as never;
}

const upload = (qui: Qui, corps: unknown, headers?: Record<string, string>) =>
  UPLOAD(requete("/api/sourcemaps", qui, { method: "POST", body: JSON.stringify(corps), headers }));

let admin: string;
let viewer: string;
let demo: string;

beforeEach(async () => {
  admin = await signJwt({ email: "admin@mip", role: "admin", apps: null });
  viewer = await signJwt({ email: "viewer@mip", role: "viewer", apps: ["app-a"] });
  demo = await signJwt({ email: "demo@mip", role: "viewer", apps: ["app-a"], demo: true });
  process.env.CONSOLE_API_TOKENS = "tok,scope@app-a";
  simul.enregistrerMaps.mockResolvedValue({ statut: 200, corps: { uploaded: 1, created: 1, unchanged: 0, replaced: 0 } });
});

afterEach(() => {
  delete process.env.CONSOLE_API_TOKENS;
  vi.clearAllMocks();
});

describe("garde admin des routes API", () => {
  it("même origine : Origin comparé à x-forwarded-host, sinon host ; absent = refus", () => {
    const h = (entetes: Record<string, string>) => new Headers(entetes);
    expect(sameOrigin(h({ origin: CONSOLE, host: "console.exemple.fr" }))).toBe(true);
    expect(sameOrigin(h({ origin: CONSOLE, host: "interne:3000", "x-forwarded-host": "console.exemple.fr" }))).toBe(true);
    expect(sameOrigin(h({ origin: "https://evil.exemple", host: "console.exemple.fr" }))).toBe(false);
    expect(sameOrigin(h({ host: "console.exemple.fr" }))).toBe(false);
    expect(sameOrigin(h({ origin: "null", host: "console.exemple.fr" }))).toBe(false);
  });

  it("401 sans session, 403 viewer et démo, 403 mutation sans Origin, admin accepté", async () => {
    const h = new Headers({ origin: CONSOLE, host: "console.exemple.fr" });
    expect(await guardAdmin(h, null, { mutation: false })).toMatchObject({ ok: false, status: 401 });
    expect(await guardAdmin(h, viewer, { mutation: false })).toMatchObject({ ok: false, status: 403 });
    expect(await guardAdmin(h, demo, { mutation: false })).toMatchObject({ ok: false, status: 403 });
    expect(await guardAdmin(new Headers({ host: "console.exemple.fr" }), admin, { mutation: true })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await guardAdmin(h, admin, { mutation: true })).toMatchObject({ ok: true, user: { email: "admin@mip" } });
  });
});

describe("POST /api/sourcemaps — port console", () => {
  const corps = { appId: "app-a", release: "2.3.1", maps: [{ filename: "main.js", content: MAP }] };

  it("un jeton de lecture CONSOLE_API_TOKENS n'écrit jamais : 401, sans toucher la base", async () => {
    // Vérificateur RÉEL : c'est lui qui doit refuser le format, pas la simulation.
    const reel = await vi.importActual<typeof import("../../packages/backend/lib/sourcemap-upload.mjs")>(
      "../../packages/backend/lib/sourcemap-upload.mjs",
    );
    const db = { query: vi.fn() };
    simul.verifierJetonUpload.mockImplementation((_pool: unknown, authorization: string | null) =>
      reel.verifierJetonUpload(db, authorization),
    );
    for (const bearer of ["tok", "scope"]) {
      const reponse = await upload({ bearer }, corps);
      expect(reponse.status).toBe(401);
    }
    expect(db.query).not.toHaveBeenCalled();
    expect(simul.enregistrerMaps).not.toHaveBeenCalled();
  });

  it("sans authentification, en viewer ou en démo : refus avant toute écriture", async () => {
    expect((await upload({}, corps)).status).toBe(401);
    expect((await upload({ cookie: viewer }, corps)).status).toBe(403);
    expect((await upload({ cookie: demo }, corps)).status).toBe(403);
    expect(simul.enregistrerMaps).not.toHaveBeenCalled();
  });

  it("cookie admin : Origin de la console exigé (CSRF), puis écriture au nom de l'admin", async () => {
    expect((await upload({ cookie: admin, origin: null }, corps)).status).toBe(403);
    expect((await upload({ cookie: admin, origin: "https://evil.exemple" }, corps)).status).toBe(403);
    expect(simul.enregistrerMaps).not.toHaveBeenCalled();

    const reponse = await upload({ cookie: admin }, { ...corps, replace: true });
    expect(reponse.status).toBe(200);
    expect(simul.enregistrerMaps).toHaveBeenCalledWith(
      { simule: true },
      expect.objectContaining({ appId: "app-a", release: "2.3.1", remplacer: true, par: "admin@mip", jetonId: null }),
    );
  });

  it("jeton dédié : limité à son app et sans droit de remplacement", async () => {
    simul.verifierJetonUpload.mockResolvedValue({ id: "11111111-1111-1111-1111-111111111111", app_id: "app-a" });
    expect((await upload({ bearer: JETON, origin: null }, { ...corps, appId: "app-b" })).status).toBe(403);
    expect((await upload({ bearer: JETON, origin: null }, { ...corps, replace: true })).status).toBe(403);
    expect(simul.enregistrerMaps).not.toHaveBeenCalled();

    const reponse = await upload({ bearer: JETON, origin: null }, corps);
    expect(reponse.status).toBe(200);
    expect(simul.enregistrerMaps).toHaveBeenCalledWith(
      { simule: true },
      expect.objectContaining({
        par: "jeton:11111111-1111-1111-1111-111111111111",
        jetonId: "11111111-1111-1111-1111-111111111111",
        remplacer: false,
      }),
    );
  });

  it("jeton inconnu, révoqué ou expiré : 401", async () => {
    simul.verifierJetonUpload.mockResolvedValue(null);
    expect((await upload({ bearer: JETON }, corps)).status).toBe(401);
  });

  it("au-delà de 4 Mio : 413 qui indique le backend direct, annoncé ou mesuré", async () => {
    const annonce = await upload({ cookie: admin }, corps, { "content-length": String(4 * 1024 * 1024 + 1) });
    expect(annonce.status).toBe(413);
    expect((await annonce.json()).error).toContain("/v1/sourcemaps");

    const lourd = { ...corps, maps: [{ filename: "main.js", content: `${" ".repeat(4 * 1024 * 1024)}{}` }] };
    const mesure = await upload({ cookie: admin }, lourd);
    expect(mesure.status).toBe(413);
    expect((await mesure.json()).error).toContain("/v1/sourcemaps");
    expect(simul.enregistrerMaps).not.toHaveBeenCalled();
  });

  it("une liste dont la dernière map est invalide : 400, rien n'est écrit", async () => {
    const reponse = await upload(
      { cookie: admin },
      { ...corps, maps: [...corps.maps, { filename: "casse.js", content: { ...MAP, version: 2 } }] },
    );
    expect(reponse.status).toBe(400);
    expect((await reponse.json()).error).toMatch(/casse\.js/);
    expect(simul.enregistrerMaps).not.toHaveBeenCalled();
  });

  it("le 409 du contrat d'écriture est rendu tel quel", async () => {
    simul.enregistrerMaps.mockResolvedValue({ statut: 409, corps: { error: "conflit", conflicts: [{ filename: "main.js" }] } });
    const reponse = await upload({ cookie: admin }, corps);
    expect(reponse.status).toBe(409);
    expect((await reponse.json()).conflicts).toEqual([{ filename: "main.js" }]);
  });
});

describe("GET /api/sourcemaps — releases et manifeste (admin)", () => {
  it("refuse jeton de lecture, viewer et démo ; exige appId", async () => {
    expect((await LISTE_MAPS(requete("/api/sourcemaps?appId=app-a", { bearer: "tok" }))).status).toBe(401);
    expect((await LISTE_MAPS(requete("/api/sourcemaps?appId=app-a", { cookie: viewer }))).status).toBe(403);
    expect((await LISTE_MAPS(requete("/api/sourcemaps?appId=app-a", { cookie: demo }))).status).toBe(403);
    expect((await LISTE_MAPS(requete("/api/sourcemaps", { cookie: admin }))).status).toBe(400);
  });

  it("releases d'une app, puis fichiers d'une release — jamais de contenu", async () => {
    simul.listSourcemapReleases.mockResolvedValue([{ release: "2.3.1", files: 2, size_bytes: 10, last_uploaded_at: new Date(0) }]);
    const liste = await LISTE_MAPS(requete("/api/sourcemaps?appId=app-a", { cookie: admin }));
    expect(await liste.json()).toEqual({
      appId: "app-a",
      releases: [{ release: "2.3.1", files: 2, size_bytes: 10, last_uploaded_at: "1970-01-01T00:00:00.000Z" }],
    });
    simul.releaseManifest.mockResolvedValue({ files: [], size_bytes: 0, fingerprint: "f" });
    const detail = await LISTE_MAPS(requete("/api/sourcemaps?appId=app-a&release=2.3.1", { cookie: admin }));
    expect(await detail.json()).toEqual({ appId: "app-a", release: "2.3.1", files: [], size_bytes: 0, fingerprint: "f" });
  });

  it("schéma antérieur à v71 : 503 explicite", async () => {
    simul.listSourcemapReleases.mockRejectedValue(Object.assign(new Error("colonne absente"), { code: "42703" }));
    const reponse = await LISTE_MAPS(requete("/api/sourcemaps?appId=app-a", { cookie: admin }));
    expect(reponse.status).toBe(503);
  });
});

describe("jetons de CI : le contrat de création", () => {
  it("parseTokenRequest : nom requis, 1 à 90 jours entiers, 30 par défaut", () => {
    expect(parseTokenRequest({ appId: " app-a ", name: " CI " })).toEqual({ ok: true, appId: "app-a", name: "CI", expiresInDays: 30, scope: "sourcemaps:write" });
    // C11 — un privilège par jeton : les marqueurs de déploiement, ou rien d'autre.
    expect(parseTokenRequest({ appId: "app-a", name: "CI", scope: "deploys:write" })).toMatchObject({ ok: true, scope: "deploys:write" });
    expect(parseTokenRequest({ appId: "app-a", name: "CI", scope: "errors:read" })).toMatchObject({ ok: false });
    expect(parseTokenRequest({ appId: "app-a", name: "CI", expiresInDays: 90 })).toMatchObject({ ok: true, expiresInDays: 90 });
    for (const expiresInDays of [0, 91, 1.5, "30"]) {
      expect(parseTokenRequest({ appId: "app-a", name: "CI", expiresInDays })).toMatchObject({ ok: false });
    }
    expect(parseTokenRequest({ appId: "app-a", name: "" })).toMatchObject({ ok: false });
    expect(parseTokenRequest({ appId: "app-a", name: "n".repeat(101) })).toMatchObject({ ok: false });
    expect(parseTokenRequest({ name: "CI" })).toMatchObject({ ok: false });
    expect(parseTokenRequest(null)).toMatchObject({ ok: false });
  });
});
