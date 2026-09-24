// P4 — le serveur MCP distant joint l'API v1 par le réseau privé Railway.
//
// `origineApi` décide où part le jeton de l'appelant. Deux propriétés comptent :
// le service `api` l'emporte sur la console quand il est déclaré, et un hôte
// PUBLIC en HTTP clair est refusé au démarrage — le jeton y voyagerait en clair.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
// @ts-expect-error module ESM, sans déclarations
import { origineApi, PORT_API_DEFAUT } from "../../packages/mcp-tools/lib/client.mjs";

describe("P4 — origine de l'API pour le serveur MCP", () => {
  it("le service api par le réseau privé l'emporte sur la console", () => {
    expect(origineApi({ MIP_API_HOST: "api.railway.internal", MIP_API_PORT: "8080", MIP_CONSOLE_URL: "https://c.example" }))
      .toEqual({ base: "http://api.railway.internal:8080", via: "reseau-prive" });
    expect(origineApi({ MIP_API_HOST: " api.railway.internal " })).toEqual({
      base: `http://api.railway.internal:${PORT_API_DEFAUT}`,
      via: "reseau-prive",
    });
  });

  it("un service compose ou localhost vaut réseau privé", () => {
    expect(origineApi({ MIP_API_HOST: "api", MIP_API_PORT: "4323" })).toEqual({ base: "http://api:4323", via: "reseau-prive" });
    expect(origineApi({ MIP_API_HOST: "localhost" })).toMatchObject({ via: "reseau-prive" });
  });

  it("sans MIP_API_HOST, la console, comme avant P4", () => {
    expect(origineApi({ MIP_CONSOLE_URL: "https://mip-rum-console.vercel.app" }))
      .toEqual({ base: "https://mip-rum-console.vercel.app", via: "console" });
    expect(origineApi({ MIP_API_HOST: "", MIP_CONSOLE_URL: "https://c.example" })).toMatchObject({ via: "console" });
  });

  it("refuse un hôte public : le jeton de l'appelant y partirait en clair", () => {
    for (const hote of ["api.example.com", "mip-api.up.railway.app", "10.0.0.1", "api.railway.internal.example.com"]) {
      expect(origineApi({ MIP_API_HOST: hote }), hote).toEqual({ erreur: expect.stringContaining("n'est pas un hôte privé") });
    }
  });

  it("refuse un hôte ou un port mal formé, et l'absence des deux", () => {
    expect(origineApi({ MIP_API_HOST: "http://api.railway.internal" })).toEqual({ erreur: expect.stringContaining("nom d'hôte invalide") });
    expect(origineApi({ MIP_API_HOST: "api:8080" })).toEqual({ erreur: expect.stringContaining("nom d'hôte invalide") });
    for (const port of ["0", "65536", "80a", "-1"]) {
      expect(origineApi({ MIP_API_HOST: "api.railway.internal", MIP_API_PORT: port }), port).toEqual({
        erreur: expect.stringContaining("MIP_API_PORT"),
      });
    }
    expect(origineApi({})).toEqual({ erreur: expect.stringContaining("ni MIP_API_HOST") });
  });

  it("le serveur distant refuse de démarrer sur un hôte public, en le disant", () => {
    const r = spawnSync(process.execPath, ["services/mcp/http.mjs"], {
      env: { PATH: process.env.PATH, MIP_API_HOST: "api.example.com", PORT: "0" },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("n'est pas un hôte privé");
    expect(r.stderr).toContain("refuse de démarrer");
  });
});
