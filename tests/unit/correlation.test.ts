// F55 — la borne des angles morts est LIÉE depuis lib/rating.ts, pas écrite en dur.
//
// Un angle mort, c'est une heure où le robot dit « ok » alors que le LCP p75 réel
// dépasse la borne « Bon ». Tant que la borne était le littéral 2500 dans le SQL,
// changer THRESHOLDS aurait laissé les angles morts sur l'ancienne valeur.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { q } = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock("@/lib/db", () => ({ q }));
vi.mock("@/lib/query-schema", async () => {
  const { schemaComplet } = await import("../fixtures/dimension-schema");
  return { dimensionSchema: async () => schemaComplet() };
});

import { blindSpots } from "../../apps/console/lib/queries-v2";
import { THRESHOLDS } from "../../apps/console/lib/rating";

beforeEach(() => q.mockReset());

describe("blindSpots", () => {
  it("lie la borne Bon du LCP en paramètre, typée, et ne garde que le robot « ok »", async () => {
    q.mockResolvedValueOnce([]);
    await blindSpots({ app: "app-a", period: "24h", device: null, segment: [] });
    const [sql, params] = q.mock.calls[0] as [string, unknown[]];
    const m = /r\.rum_lcp_p75 > \$(\d+)::float8/.exec(sql);
    expect(m, "borne non liée").not.toBeNull();
    expect(params[Number(m![1]) - 1]).toBe(THRESHOLDS.LCP[0]);
    expect(sql).not.toMatch(/rum_lcp_p75 > 2500/);
    expect(sql).toContain("s.syn_state = 'ok'");
  });
});
