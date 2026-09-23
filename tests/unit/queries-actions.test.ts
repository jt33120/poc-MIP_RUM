import { beforeEach, describe, expect, it, vi } from "vitest";

const { q } = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock("@/lib/db", () => ({ q }));
// Schéma migré : la sonde des colonnes de dimensions ne consomme pas les réponses simulées.
vi.mock("@/lib/query-schema", async () => {
  const { schemaComplet } = await import("../fixtures/dimension-schema");
  return { dimensionSchema: async () => schemaComplet() };
});

import {
  actionSamplingNotice,
  actionsDisponible,
  etatActions,
  hasNextActionsPage,
  MANQUE_TABLE_ACTIONS,
  parseActionsPage,
  topActions,
  topActionsSummary,
} from "../../apps/console/lib/queries-actions";

beforeEach(() => q.mockReset());

describe("actionsDisponible", () => {
  it("rend false sans la table, en une seule sonde to_regclass", async () => {
    q.mockResolvedValueOnce([{ present: false }]);
    await expect(actionsDisponible()).resolves.toBe(false);
    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][0]).toContain("to_regclass");
    expect(q.mock.calls[0][1]).toEqual(["public.rum_action"]);
  });

  it("rend true quand la table existe", async () => {
    q.mockResolvedValueOnce([{ present: true }]);
    await expect(actionsDisponible()).resolves.toBe(true);
  });
});

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
    // Fenêtre [from,to) liée, périmètre, appareil, segment, puis pagination — dans l'ordre des $n.
    expect(params).toEqual([expect.any(String), expect.any(String), ["app-a"], "mobile", "FR", 25, 50]);
    expect(Date.parse(params[1] as string) - Date.parse(params[0] as string)).toBe(7 * 86_400_000);
    expect(sql).toContain("a.ts >= $1::timestamptz and a.ts < $2::timestamptz");
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
    expect(sql).toContain("a.app_id = any($3::text[])");
    expect(sql).toContain("s.device_type = $4");
    expect(sql).toContain("s.geo_country = $5");
    expect(sql).toContain("limit $6 offset $7");
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
    expect(params).toEqual([expect.any(String), expect.any(String), ["app-a"], "mobile", "FR"]);
    expect(sql).toContain("s.geo_country = $5");
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

// ─────────────────────────── F24 — Onglet Actions ───────────────────────────

describe("F24 — état, période précédente et p75 par action", () => {
  it("table absente : non_collecte nommé, jamais un « 0 action »", () => {
    expect(etatActions(false)).toEqual({ kind: "non_collecte", manque: MANQUE_TABLE_ACTIONS });
    expect(MANQUE_TABLE_ACTIONS).toContain("table des actions");
    // Un zéro dirait « aucun geste dans la fenêtre » : ce n'est pas la même chose (V3).
    expect(JSON.stringify(etatActions(false))).not.toContain("0");
  });

  it("table présente : aucun état, l'écran lit et affiche ses chiffres", () => {
    expect(etatActions(true)).toBeNull();
  });

  it("cmp=prev : le résumé lit la période précédente CONTIGUË, même durée", async () => {
    // Horloge FIGÉE : les deux lectures calculent chacune « maintenant ». Sans cela,
    // une milliseconde qui passe entre les deux appels décale la borne commune — le
    // test échouait par intermittence (« …44.190Z » contre « …44.189Z », en CI aussi).
    vi.useFakeTimers({ now: new Date("2026-09-16T09:37:44.189Z"), toFake: ["Date"] });
    try {
      const f = { app: "app-a", period: "7d" as const, device: null, segment: [] };
      q.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([{ actions: 1, min_sample_rate: 1 }]);
      await topActionsSummary(f);
      const courante = q.mock.calls[1][1] as string[];

      q.mockReset();
      q.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([{ actions: 1, min_sample_rate: 1 }]);
      await topActionsSummary(f, true);
      const precedente = q.mock.calls[1][1] as string[];

      // La fenêtre précédente se termine là où la courante commence, et dure autant.
      expect(precedente[1]).toBe(courante[0]);
      expect(Date.parse(precedente[1]) - Date.parse(precedente[0])).toBe(7 * 86_400_000);
      // Rien d'autre ne change : même périmètre, mêmes paramètres liés ensuite.
      expect(precedente.slice(2)).toEqual(courante.slice(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("classement : la p75 du temps lié PAR action, calculée sur les durées brutes", async () => {
    q.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([]);
    await topActions({ app: "app-a", period: "24h", device: null, segment: [] });
    const [sql] = q.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("percentile_cont(0.75) within group (order by resource_ms + api_ms)");
    expect(sql).toContain("as lie_p75_ms");
    // Le cumul reste lu, à côté : il est nommé « cumulé » par l'écran, pas remplacé.
    expect(sql).toContain("as total_ms");
    // Aucun percentile agrégé d'un autre (V5) : un seul `percentile_cont`, sur les lignes.
    expect(sql.match(/percentile_cont/g)).toHaveLength(1);
  });
});
