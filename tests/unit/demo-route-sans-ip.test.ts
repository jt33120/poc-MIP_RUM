// La démo publique n'écrit JAMAIS l'adresse IP du visiteur (recette du 26/09/2026).
//
// La vitrine promet « Aucune adresse IP n'est stockée, sous aucune forme ». Branchée
// directement sur la base (le mode de la production actuelle), la route `/demo`
// écrivait pourtant `{ ip, apps }` dans `audit_log` à chaque visite ; la branche
// console-api, elle, ne l'a jamais journalisée. Ce test fait passer une vraie
// requête par la route, en-têtes de proxy compris, et relit ce qui part vers la base.
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const depuisConsole = createRequire(`${process.cwd()}/apps/console/package.json`);
const IP = "203.0.113.42";

const ecritures = vi.hoisted(() => [] as { sql: string; params: unknown[] }[]);

vi.doMock(depuisConsole.resolve("next/headers"), () => ({
  cookies: async () => ({ set: () => {}, get: () => undefined }),
  headers: async () => new Headers({ "x-forwarded-for": `${IP}, 10.0.0.1`, "x-real-ip": IP }),
}));
vi.mock("@/lib/db", () => ({
  q: vi.fn(async (sql: string, params: unknown[] = []) => {
    ecritures.push({ sql, params });
    return [];
  }),
}));
// Console branchée sur la base : la branche console-api n'est pas prise.
vi.mock("@/lib/backend", () => ({ backend: () => ({ estBranche: () => false }) }));

beforeEach(() => {
  ecritures.length = 0;
  process.env.AUTH_SECRET = "secret-de-test-demo-sans-ip";
  process.env.DEMO_USER_APPS = "demo-app";
});

describe("GET /demo — aucune IP au journal", () => {
  it("ouvre la session et journalise le périmètre, jamais l'adresse du visiteur", async () => {
    const { GET } = await import("@/app/demo/route");
    const res = await GET(new Request("https://console.test/demo"));
    expect(res.status).toBe(302);

    const audit = ecritures.filter((e) => e.sql.includes("audit_log"));
    expect(audit).toHaveLength(1);
    const texte = JSON.stringify(audit[0].params);
    expect(texte).not.toContain(IP);
    expect(texte).not.toContain("10.0.0.1");
    expect(JSON.parse(String(audit[0].params[1]))).toEqual({ apps: ["demo-app"] });
  });
});
