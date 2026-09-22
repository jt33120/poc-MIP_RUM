// F62 — FORME des lectures d'alertes sur fenêtre fixe (alertEventsByDay,
// alertFirings) : périmètre d'apps LIÉ, un contexte de paramètres par instruction
// (chaque `$n` a sa valeur), et la garde `to_regclass` de v73 lue avant la requête.
// Le comportement sur données vit dans tests/integration/alertes-sql.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { q } = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock("@/lib/db", () => ({ q }));
vi.mock("@/lib/query-schema", async () => {
  const { schemaComplet } = await import("../fixtures/dimension-schema");
  return { dimensionSchema: async () => schemaComplet() };
});

import { alertEventsByDay, alertFirings, totalNonLivres } from "../../apps/console/lib/queries-v2";

const F = { app: "app-a", period: "24h" as const, device: null, segment: [] };

beforeEach(() => q.mockReset());

function unContexteParRequete(sql: string, params: unknown[]): void {
  const utilises = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  expect(Math.max(...utilises)).toBe(params.length);
  expect(utilises.size).toBe(params.length);
}

describe.each([
  ["alertEventsByDay", () => alertEventsByDay(F)],
  ["alertFirings", () => alertFirings(F)],
])("%s", (_nom, lire) => {
  it.each([true, false])("v73 = %s : périmètre lié, fenêtre de 30 jours liée, un contexte", async (v73) => {
    q.mockResolvedValueOnce([{ v73 }]).mockResolvedValueOnce([]);
    await lire();
    const [garde] = q.mock.calls[0] as [string];
    expect(garde).toContain("to_regclass('public.error_issue_notification')");
    const [sql, params] = q.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/ev\.app_id = any\(\$\d+::text\[\]\)/);
    expect(params).toContainEqual(["app-a"]);
    expect(params).toContain(30);
    expect(sql.includes("error_issue_notification")).toBe(v73);
    expect(sql).not.toMatch(/is null or app_id/);
    unContexteParRequete(sql, params);
  });
});

describe("totalNonLivres", () => {
  it("somme exacte des jours, 0 sans jour", () => {
    expect(totalNonLivres([{ non_livres: 2 }, { non_livres: 0 }, { non_livres: 5 }])).toBe(7);
    expect(totalNonLivres([])).toBe(0);
  });
});
