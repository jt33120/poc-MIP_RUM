// C2 — les écrans de console-api : une lecture devient une SECTION sur le fil,
// sans sa raison ; un principal ne reçoit que ce que son chargeur rend pour lui.
//
// Le vrai chargeur de la coquille, sur une vraie base et par profil, est dans la
// matrice d'autorisations (`tests/contract/console-api-authz.test.ts`).
import { describe, expect, it, vi } from "vitest";
import { operationsEcrans, versSection, type PrincipalChargeur } from "@mip/console-api";
import { creerConsoleApi } from "@mip/console-api";

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
    expect(vus.at(-1)).toEqual({ email: "v@mip.test", role: "viewer", apps: ["app-a"] });
  });

  it("sans session : 401, et le chargeur n'est pas appelé", async () => {
    const avant = vus.length;
    expect((await api(new Request("https://c.test/v1/shell", { headers: { "x-mip-client": SECRET } }))).status).toBe(401);
    expect(vus.length).toBe(avant);
  });
});
