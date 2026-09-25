// C2 → C5 — les écrans de console-api : une lecture devient une SECTION sur le fil,
// sans sa raison ; un principal ne reçoit que ce que son chargeur rend pour lui ;
// un écran reçoit ce que reçoit sa page (principal, paramètres, `app` tel que
// demandé, chemin), après les gardes du pipeline.
//
// Les vrais chargeurs, sur une vraie base et par profil, sont dans la matrice
// d'autorisations (`tests/contract/console-api-authz.test.ts`).
import { describe, expect, it, vi } from "vitest";
import { ECRANS } from "@mip/console-contract";
import { operationsEcrans, versSection, type ChargeursEcrans, type PrincipalChargeur } from "@mip/console-api";
import { creerConsoleApi } from "@mip/console-api";
import { ECRANS_FACTICES } from "../fixtures/ecrans-factices";

const SECRET = "e".repeat(40);

describe("C2 — une lecture devient une section, sa raison reste au journal", () => {
  it("réussie : la donnée ; en échec : `lecture_en_echec`, et la raison au journal seulement", () => {
    const journal = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(versSection({ ok: true, data: [1] }, { journal, requestId: "r-1", section: "s" })).toEqual({ ok: true, data: [1] });
    const s = versSection({ ok: false, raison: "connect ECONNREFUSED db.interne:5432" }, { journal, requestId: "r-2", section: "schema" });
    expect(s).toEqual({ ok: false, code: "lecture_en_echec" });
    expect(JSON.stringify(s)).not.toContain("db.interne");
    expect(journal.warn).toHaveBeenCalledWith("section en échec", { section: "schema", request_id: "r-2", raison: "connect ECONNREFUSED db.interne:5432" });
  });
});

describe("C2 — GET /v1/shell : le chargeur reçoit le principal relu en base, la réponse est la coquille", () => {
  const vus: PrincipalChargeur[] = [];
  const api = creerConsoleApi({
    table: operationsEcrans({
      coquille: async (p) => {
        vus.push(p);
        return {
          projets: { ok: true, data: [{ app_id: "app-a", name: "A" }] },
          schema: { ok: false, raison: "sonde en échec" },
          fuseaux: { "app-a": "Europe/Paris" },
          tickets: p.role === "admin" ? { ok: true, data: false } : null,
        };
      },
      pages: ECRANS_FACTICES.pages,
      refusDeFiltre: () => null,
    }),
    secretsClient: [SECRET],
    journal: { info() {}, warn() {}, error() {} },
    verifierSession: async (j) =>
      j === "jeton-de-session-viewer"
        ? { kind: "session", sessionId: "s", userId: "1", email: "v@mip.test", role: "viewer", apps: ["app-a"], demo: false }
        : null,
  });

  it("un viewer : ses projets, la section en échec dite comme telle, pas d'entrée d'administration", async () => {
    const r = await api(new Request("https://c.test/v1/shell", { headers: { "x-mip-client": SECRET, authorization: "Bearer jeton-de-session-viewer" } }));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({
      projets: { ok: true, data: [{ app_id: "app-a", name: "A" }] },
      schema: { ok: false, code: "lecture_en_echec" },
      fuseaux: { "app-a": "Europe/Paris" },
      tickets: null,
    });
    expect(vus.at(-1)).toEqual({ email: "v@mip.test", role: "viewer", apps: ["app-a"], demo: false });
  });

  it("sans session : 401, et le chargeur n'est pas appelé", async () => {
    const avant = vus.length;
    expect((await api(new Request("https://c.test/v1/shell", { headers: { "x-mip-client": SECRET } }))).status).toBe(401);
    expect(vus.length).toBe(avant);
  });
});

describe("C3 — un écran : les gardes du pipeline, puis le chargeur avec ce que reçoit la page", () => {
  class RefusFactice extends Error {
    constructor(readonly error: { code: string; message: string }) {
      super(error.message);
    }
  }
  const appels: { principal: PrincipalChargeur; parametres: Record<string, string>; chemin: Record<string, string>; requestId: string }[] = [];
  const pages = Object.fromEntries(
    Object.keys(ECRANS).map((cle) => [
      cle,
      async (principal: PrincipalChargeur, parametres: Record<string, string>, chemin: Record<string, string>, requestId: string) => {
        if (parametres.seg === "refus") throw new RefusFactice({ code: "unsupported_dimension", message: "dimension non collectée ici" });
        if (parametres.seg === "panne") throw new Error("connect ECONNREFUSED db.interne:5432");
        appels.push({ principal, parametres, chemin, requestId });
        return { etat: "ok", sections: { a: { ok: true, data: 1 } } };
      },
    ]),
  ) as ChargeursEcrans["pages"];
  const journal = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const api = creerConsoleApi({
    table: operationsEcrans({ ...ECRANS_FACTICES, pages, refusDeFiltre: (e) => (e instanceof RefusFactice ? e.error : null) }),
    secretsClient: [SECRET],
    journal,
    verifierSession: async (j) =>
      j === "jeton-de-session-viewer"
        ? { kind: "session", sessionId: "s", userId: "1", email: "v@mip.test", role: "viewer", apps: ["app-a", "app-b"], demo: false }
        : j === "jeton-de-session-demo0"
          ? { kind: "session", sessionId: "d", userId: null, email: "demo@mip.test", role: "viewer", apps: ["app-a"], demo: true }
          : null,
  });
  const appeler = (chemin: string, jeton = "jeton-de-session-viewer") =>
    api(new Request(`https://c.test${chemin}`, { headers: { "x-mip-client": SECRET, authorization: `Bearer ${jeton}`, "x-request-id": "req-ecran-0001" } }));

  it("le chargeur reçoit le principal relu, `app` TEL QUE DEMANDÉ (`all` compris) et les autres paramètres", async () => {
    const r = await appeler("/v1/screens/actions?app=all&period=7d&offset=50");
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ etat: "ok", sections: { a: { ok: true, data: 1 } } });
    expect(appels.at(-1)).toEqual({
      principal: { email: "v@mip.test", role: "viewer", apps: ["app-a", "app-b"], demo: false },
      parametres: { app: "all", period: "7d", offset: "50" },
      chemin: {},
      requestId: "req-ecran-0001",
    });
  });

  it("une démo lit ; une app hors du périmètre est refusée AVANT le chargeur", async () => {
    expect((await appeler("/v1/screens/actions?app=app-a", "jeton-de-session-demo0")).status).toBe(200);
    expect(appels.at(-1)?.principal.demo).toBe(true);
    const avant = appels.length;
    expect((await appeler("/v1/screens/actions?app=app-b", "jeton-de-session-demo0")).status).toBe(403);
    expect((await appeler("/v1/screens/actions?app=app-z")).status).toBe(403);
    expect((await appeler("/v1/screens/actions")).status).toBe(400);
    expect(appels.length).toBe(avant);
  });

  it("des paramètres bornés : un nom illisible, une valeur trop longue, un paramètre répété → 400", async () => {
    expect((await appeler("/v1/screens/actions?app=app-a&%3Cscript%3E=1")).status).toBe(400);
    expect((await appeler(`/v1/screens/actions?app=app-a&seg=${"x".repeat(2049)}`)).status).toBe(400);
    expect((await appeler("/v1/screens/actions?app=app-a&period=7d&period=24h")).status).toBe(400);
  });

  it("un filtre que l'écran ne sait pas appliquer : 400 `filtre_non_supporte` ; une panne : 500 générique, la cause au journal", async () => {
    const refus = await appeler("/v1/screens/actions?app=app-a&seg=refus");
    expect(refus.status).toBe(400);
    expect((await refus.json()).error).toEqual({ code: "filtre_non_supporte", message: "dimension non collectée ici", details: { code: "unsupported_dimension" } });
    const panne = await appeler("/v1/screens/actions?app=app-a&seg=panne");
    expect(panne.status).toBe(500);
    expect(await panne.text()).not.toContain("db.interne");
    expect(journal.error).toHaveBeenCalled();
  });
});
