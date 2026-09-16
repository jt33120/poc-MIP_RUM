import { beforeEach, describe, expect, it, vi } from "vitest";

const { q } = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock("@/lib/db", () => ({ q }));

import {
  actionSamplingNotice,
  hasNextActionsPage,
  parseActionsPage,
  topActions,
  topActionsSummary,
} from "../../apps/console/lib/queries-actions";

beforeEach(() => q.mockReset());

describe("Top Actions", () => {
  it("fail-soft avant v67 sans interroger rum_action", async () => {
    q.mockResolvedValueOnce([{ present: false }]);
    await expect(topActions({
      app: "app-a", period: "24h", device: null, segment: [],
    })).resolves.toEqual([]);
    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][0]).toContain("to_regclass");
  });

  it("scope l'app, agrège chaque famille avant jointure et trie totalement", async () => {
    q.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([]);
    await topActions({
      app: "app-a",
      period: "7d",
      device: "mobile",
      segment: [{ dim: "geo", op: "==", value: "FR" }],
      includeBots: false,
      includeInternal: false,
    }, { limit: 25, offset: 50 });
    const [sql, params] = q.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual(["app-a", "mobile", 25, 50, "FR"]);
    expect(sql).toContain("a.action_id = e.action_id and a.app_id = e.app_id and a.session_id = e.session_id");
    expect(sql).toContain("a.action_id = r.action_id and a.app_id = r.app_id and a.session_id = r.session_id");
    expect(sql).toContain("a.action_id = p.action_id and a.app_id = p.app_id and a.session_id = p.session_id");
    expect(sql).toContain("group by e.action_id");
    expect(sql).toContain("group by r.action_id");
    expect(sql).toContain("group by p.action_id");
    expect(sql).toContain("r.type in ('fetch', 'xhr', 'xmlhttprequest')");
    expect(sql).toContain("p.url is not distinct from m.url");
    expect(sql).toContain("with recursive filtered_actions");
    expect(sql).toContain("resource_matching");
    expect(sql).toContain("r.ts - interval '1 second'");
    expect(sql).toContain("m.resource_span_id = r.span_id");
    expect(sql).toContain("row_number() over");
    expect(sql).toContain("a.action_id = e.action_id and a.app_id = e.app_id and a.session_id = e.session_id");
    expect(sql).toContain("a.app_id = $1");
    expect(sql).toContain("s.geo_country = $5");
    expect(sql).toContain("order by errors desc, total_ms desc, actions desc");
    expect(sql).toContain("app_id asc, name asc, type asc, coalesce(route, '') asc");
  });

  it("borne l'offset à 10 000", () => {
    expect(parseActionsPage(new URLSearchParams("limit=999&offset=999999")))
      .toEqual({ limit: 200, offset: 10_000 });
  });

  it("arrête la pagination au plafond même sur une page pleine", () => {
    expect(hasNextActionsPage({ limit: 50, offset: 9_950 }, 50)).toBe(true);
    expect(hasNextActionsPage({ limit: 50, offset: 10_000 }, 50)).toBe(false);
    expect(hasNextActionsPage({ limit: 50, offset: 9_950 }, 49)).toBe(false);
  });

  it("calcule les KPI sur toute la période sans limite ni offset", async () => {
    q.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([{
      actions: 123, sessions: 42, errors: 7, error_clicks: 3,
      resources: 10, api_calls: 12, resource_ms: 100, api_ms: 200, total_ms: 300,
      min_sample_rate: 0.25,
    }]);
    await expect(topActionsSummary({
      app: "app-a",
      period: "7d",
      device: "mobile",
      segment: [{ dim: "geo", op: "==", value: "FR" }],
    })).resolves.toMatchObject({
      actions: 123,
      errors: 7,
      total_ms: 300,
      sampling_notice: { min_sample_rate: 0.25 },
    });
    const [sql, params] = q.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual(["app-a", "mobile", "FR"]);
    expect(sql).toContain("s.geo_country = $3");
    expect(sql).not.toMatch(/\blimit\s+\$/i);
    expect(sql).not.toMatch(/\boffset\s+\$/i);
    expect(sql).toContain("min(sample_rate)");
  });

  it("déclare les volumes bruts quand l'échantillonnage peut biaiser les actions", () => {
    expect(actionSamplingNotice(1)).toBeNull();
    expect(actionSamplingNotice(0.1)).toMatchObject({ min_sample_rate: 0.1 });
    expect(actionSamplingNotice(0.1)?.message).toContain("ne sont pas extrapolés");
  });

  it("renvoie des KPI nuls avant la migration v67", async () => {
    q.mockResolvedValueOnce([{ present: false }]);
    await expect(topActionsSummary({
      app: null, period: "24h", device: null, segment: [],
    })).resolves.toMatchObject({ actions: 0, errors: 0, total_ms: 0 });
    expect(q).toHaveBeenCalledTimes(1);
  });
});
