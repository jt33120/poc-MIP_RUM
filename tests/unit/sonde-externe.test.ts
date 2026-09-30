// La supervision externe ne doit jamais réveiller la base.
//
// Une sonde qui frappe `/health` (un `select 1`) tous les quarts d'heure empêche
// Neon de dormir : c'est l'incident du 24/09/2026. Ce fichier garde les deux bouts :
//   · le workflow ne vise que des sondes sans base (`/live`, `/api/live`, et le
//     `/health` de `mcp`, service qui n'a aucun accès à Postgres) ;
//   · la route `/api/live` de la console n'importe rien — un import de trop
//     suffirait à ouvrir le pool — et le middleware la laisse passer sans session.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "../../apps/console/app/api/live/route";

const RACINE = join(__dirname, "..", "..");
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

const WORKFLOW = lire(".github/workflows/sonde-externe.yml");
const URLS = [...WORKFLOW.matchAll(/"(\S+)\s+(https:\/\/\S+)"/g)].map(([, nom, url]) => ({ nom, url: new URL(url) }));

describe("sonde externe — le workflow", () => {
  it("sonde la console et les quatre services Railway exposés", () => {
    expect(URLS.map((c) => c.nom).sort()).toEqual(["api", "collector", "console", "console-api", "mcp"]);
  });

  it("ne vise jamais une sonde qui touche la base", () => {
    for (const { nom, url } of URLS) {
      if (nom === "mcp") expect(url.pathname, nom).toBe("/health");
      else if (nom === "console") expect(url.pathname, nom).toBe("/api/live");
      else expect(url.pathname, nom).toBe("/live");
    }
  });

  it("n'utilise aucune action tierce et ne demande aucun droit", () => {
    expect(WORKFLOW).not.toMatch(/^\s*(?:-\s*)?uses:/m);
    expect(WORKFLOW).toMatch(/^permissions: \{\}$/m);
  });

  it("tourne au quart d'heure, et à la demande", () => {
    expect(WORKFLOW).toMatch(/cron: "7,22,37,52 \* \* \* \*"/);
    expect(WORKFLOW).toMatch(/workflow_dispatch:/);
  });
});

describe("sonde externe — la route /api/live de la console", () => {
  it("n'importe rien : aucun chemin vers la base", () => {
    const source = lire("apps/console/app/api/live/route.ts");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it("répond 200, sans cache", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("passe le middleware sans session", () => {
    expect(lire("apps/console/middleware.ts")).toContain('if (req.nextUrl.pathname === "/api/live") return NextResponse.next();');
  });
});
