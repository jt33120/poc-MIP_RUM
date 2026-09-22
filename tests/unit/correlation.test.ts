// Robot et réel — la FORME des lectures (F55, F57) et les règles pures qui les
// interprètent (lib/correlation.ts, § 5.7 CR1, CR5, CR11).
//
// F55 : la borne des angles morts est LIÉE depuis lib/rating.ts, pas écrite en dur.
// Un angle mort, c'est une heure où le robot dit « ok » alors que le LCP p75 réel
// dépasse la borne « Bon ». Tant que la borne était le littéral 2500 dans le SQL,
// changer THRESHOLDS aurait laissé les angles morts sur l'ancienne valeur.
//
// F57 : même règle d'effectif (30 mesures LCP par heure) pour la liste et pour le
// compte ; chaque instruction a SON contexte de paramètres (un `$n` par valeur liée).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { q } = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock("@/lib/db", () => ({ q }));
vi.mock("@/lib/query-schema", async () => {
  const { schemaComplet } = await import("../fixtures/dimension-schema");
  return { dimensionSchema: async () => schemaComplet() };
});

import { bandeauRetard, partCouverte, retardRobot, trierSansRobot } from "../../apps/console/lib/correlation";
import {
  blindSpots,
  correlationConcordance,
  correlationSeries,
  EFFECTIF_MIN_HEURE,
  syntheticFreshness,
} from "../../apps/console/lib/queries-v2";
import { THRESHOLDS } from "../../apps/console/lib/rating";

const F = { app: "app-a", period: "24h" as const, device: null, segment: [] };

beforeEach(() => q.mockReset());

/** Paramètre lié au premier `$n` qui suit `prefixe` dans le SQL. */
function lie(sql: string, params: unknown[], prefixe: RegExp): unknown {
  const m = new RegExp(`${prefixe.source}\\$(\\d+)`).exec(sql);
  expect(m, `aucun paramètre après ${prefixe}`).not.toBeNull();
  return params[Number(m![1]) - 1];
}

/** Chaque `$n` rendu a sa valeur, et chaque valeur son `$n` : un contexte par requête. */
function unContexteParRequete(sql: string, params: unknown[]): void {
  const utilises = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  expect(Math.max(...utilises)).toBe(params.length);
  expect(utilises.size).toBe(params.length);
}

describe("blindSpots", () => {
  it("lie la borne Bon du LCP en paramètre, typée, et ne garde que le robot « ok »", async () => {
    q.mockResolvedValueOnce([]);
    await blindSpots(F);
    const [sql, params] = q.mock.calls[0] as [string, unknown[]];
    const m = /r\.rum_lcp_p75 > \$(\d+)::float8/.exec(sql);
    expect(m, "borne non liée").not.toBeNull();
    expect(params[Number(m![1]) - 1]).toBe(THRESHOLDS.LCP[0]);
    expect(sql).not.toMatch(/rum_lcp_p75 > 2500/);
    expect(sql).toContain("s.syn_state = 'ok'");
  });

  it("F57 : effectif minimal lié (30 par défaut), scénarios et effectif rendus, plafond 50", async () => {
    q.mockResolvedValue([]);
    await blindSpots(F);
    await blindSpots(F, 12);
    const [[sql, params], [, params12]] = q.mock.calls as [string, unknown[]][];
    expect(EFFECTIF_MIN_HEURE).toBe(30);
    expect(lie(sql, params, /r\.rum_lcp_n >= /)).toBe(30);
    expect(lie(sql, params12, /r\.rum_lcp_n >= /)).toBe(12);
    expect(sql).toMatch(/r\.rum_lcp_n, s\.syn_latency_avg, s\.syn_state, s\.syn_measures/);
    expect(sql).toContain("limit 50");
    unContexteParRequete(sql, params);
  });

  it("un effectif minimal absurde est refusé plutôt que de vider la liste", async () => {
    await expect(blindSpots(F, 0)).rejects.toThrow(/effectif minimal invalide/);
    await expect(blindSpots(F, Number.NaN)).rejects.toThrow(/effectif minimal invalide/);
    expect(q).not.toHaveBeenCalled();
  });
});

describe("correlationConcordance", () => {
  it("bornes Bon / Mauvais et effectif liés depuis THRESHOLDS, jamais écrits en dur", async () => {
    q.mockResolvedValueOnce([]);
    const conc = await correlationConcordance(F);
    const [sql, params] = q.mock.calls[0] as [string, unknown[]];
    expect(lie(sql, params, /r\.rum_lcp_p75 <= /)).toBe(THRESHOLDS.LCP[0]);
    expect(lie(sql, params, /r\.rum_lcp_n < /)).toBe(30);
    // La seconde borne suit la première : « Mauvais » strictement au-delà de 4 000 ms.
    const bornes = [...sql.matchAll(/r\.rum_lcp_p75 <= \$(\d+)::float8/g)].map((m) => params[Number(m[1]) - 1]);
    expect(bornes).toEqual([THRESHOLDS.LCP[0], THRESHOLDS.LCP[1]]);
    expect(sql).not.toMatch(/2500|4000/);
    expect(conc.bornesLcp).toEqual(THRESHOLDS.LCP);
    unContexteParRequete(sql, params);
  });

  it("rend les 9 cellules, zéros compris, et les angles morts par couple triés", async () => {
    q.mockResolvedValueOnce([
      { classe: "matrice", robot: "ok", reel: "poor", app_id: null, route: null, heures: 3 },
      { classe: "matrice", robot: "ok", reel: "needs-improvement", app_id: null, route: null, heures: 4 },
      { classe: "reel_insuffisant", robot: null, reel: null, app_id: null, route: null, heures: 2 },
      { classe: "robot_seul", robot: null, reel: null, app_id: null, route: null, heures: 5 },
      { classe: "angle_mort", robot: null, reel: null, app_id: "b", route: "/x", heures: 2 },
      { classe: "angle_mort", robot: null, reel: null, app_id: "a", route: "/p/:id", heures: 5 },
    ]);
    const conc = await correlationConcordance(F);
    expect(conc.cellules).toHaveLength(9);
    expect(conc.cellules.filter((c) => c.heures > 0)).toEqual([
      { robot: "ok", reel: "needs-improvement", heures: 4 },
      { robot: "ok", reel: "poor", heures: 3 },
    ]);
    expect([conc.robotSeul, conc.reelSeul, conc.reelInsuffisant, conc.robotInconnu]).toEqual([5, 0, 2, 0]);
    expect(conc.anglesMortsParRoute).toEqual([
      { serie: "a:%2Fp%2F%3Aid", app_id: "a", route: "/p/:id", heures: 5 },
      { serie: "b:%2Fx", app_id: "b", route: "/x", heures: 2 },
    ]);
  });
});

describe("correlationSeries et syntheticFreshness", () => {
  it("la série lie l'app ET la route, et rend l'état, les scénarios et l'effectif", async () => {
    q.mockResolvedValueOnce([]);
    await correlationSeries("demo", "/partners/:id", F);
    const [sql, params] = q.mock.calls[0] as [string, unknown[]];
    expect(lie(sql, params, /from rum where app_id = /)).toBe("demo");
    expect(lie(sql, params, /from syn where app_id = \$\d+ and route = /)).toBe("/partners/:id");
    expect(sql).toMatch(/r\.rum_lcp_n,\s+s\.syn_latency_avg, s\.syn_state, s\.syn_measures/);
    unContexteParRequete(sql, params);
  });

  it("fraîcheur : périmètre explicite lié pour garder les apps sans passage", async () => {
    q.mockResolvedValueOnce([]);
    await syntheticFreshness(F);
    const [sql, params] = q.mock.calls[0] as [string, unknown[]];
    expect(lie(sql, params, /right join unnest\(/)).toEqual(["app-a"]);
    expect(sql).toContain("partition by y.app_id, y.measure_name");
    unContexteParRequete(sql, params);
  });
});

describe("retardRobot (CR1)", () => {
  const TO = Date.parse("2026-09-22T12:00:00Z");
  const H = 3_600_000;

  it("retard de 3 h pour un intervalle de 15 min : bandeau", () => {
    const r = retardRobot({ dernier: new Date(TO - 3 * H), intervalle_median_s: 900, passages: 40 }, TO);
    expect(r).toEqual({ etat: "en_retard", retardMs: 3 * H, intervalleMs: 900_000 });
    expect(bandeauRetard(r)).toBe(true);
  });

  it("retard de 20 min pour un intervalle de 15 min : rien", () => {
    const r = retardRobot({ dernier: new Date(TO - 20 * 60_000), intervalle_median_s: 900, passages: 40 }, TO);
    expect(r.etat).toBe("a_jour");
    expect(bandeauRetard(r)).toBe(false);
  });

  it("moins de deux passages : intervalle inconnu, bandeau « intervalle inconnu »", () => {
    const r = retardRobot({ dernier: new Date(TO - 5 * 60_000), intervalle_median_s: null, passages: 1 }, TO);
    expect(r).toEqual({ etat: "intervalle_inconnu", retardMs: 5 * 60_000 });
    expect(bandeauRetard(r)).toBe(true);
  });

  it("aucun passage : état à part (non collecté), pas un bandeau de retard", () => {
    const r = retardRobot({ dernier: null, intervalle_median_s: null, passages: 0 }, TO);
    expect(r).toEqual({ etat: "aucun_passage" });
    expect(bandeauRetard(r)).toBe(false);
  });
});

describe("partCouverte (CR5)", () => {
  it("deux routes, 300 mesures avec robot et 100 sans : 75 %", () => {
    expect(
      partCouverte([
        { rum_lcp_n: 300, syn_latency_avg: 800 },
        { rum_lcp_n: 100, syn_latency_avg: null },
        { rum_lcp_n: null, syn_latency_avg: 500 }, // robot seul : ne pèse rien
      ]),
    ).toBe(0.75);
  });

  it("aucune mesure LCP : null, jamais 0 %", () => {
    expect(partCouverte([])).toBeNull();
    expect(partCouverte([{ rum_lcp_n: null, syn_latency_avg: 800 }, { rum_lcp_n: 0, syn_latency_avg: null }])).toBeNull();
  });
});

describe("trierSansRobot (CR11)", () => {
  const carte = (route: string, rum_lcp_p75: number, rum_lcp_n: number, syn_latency_avg: number | null = null) => ({
    route,
    rum_lcp_p75,
    rum_lcp_n,
    syn_latency_avg,
  });

  it("Mauvais à 40 mesures avant Bon à 4 000 mesures ; 12 mesures après les deux", () => {
    const tri = trierSansRobot([
      carte("/faible", 6000, 12),
      carte("/bon", 1200, 4000),
      carte("/mauvais", 4500, 40),
      carte("/suivie", 9000, 900, 800), // a un scénario robot : exclue
    ]);
    expect(tri.map((c) => c.route)).toEqual(["/mauvais", "/bon", "/faible"]);
    expect(tri.map((c) => [c.verdict, c.faible])).toEqual([
      ["poor", false],
      ["good", false],
      ["poor", true],
    ]);
  });

  it("à verdict égal, le volume départage", () => {
    const tri = trierSansRobot([carte("/a", 3000, 50), carte("/b", 3100, 500)]);
    expect(tri.map((c) => c.route)).toEqual(["/b", "/a"]);
  });
});
