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
  aucunPassageSurLaGrille,
  casesFriseRobot,
  dernierPassage,
  ETATS_FRISE_ROBOT,
  grilleHoraire,
  heuresAngleMort,
  lignesRetard,
  pucesAnglesMorts,
  regleAlerteAngleMort,
  regleAngleMort,
  trierRoutes,
} from "../../apps/console/lib/correlation";
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

// ---------------------------------------------------------------------------
// F58 — écran /correlation : règles pures de la page (§ 5.7 CR1, CR4, CR7, CR7-b,
// CR9, CR12).
// ---------------------------------------------------------------------------

describe("F58 — regleAngleMort (CR9)", () => {
  it("la borne vient de THRESHOLDS au moment de l'appel : changer la borne change le texte", () => {
    expect(regleAngleMort(30)).toContain("au-dessus de 2,5 s (borne Bon de lib/rating.ts)");
    expect(regleAngleMort(30)).toContain("heures d'au moins 30 mesures");
    const avant = THRESHOLDS.LCP;
    try {
      THRESHOLDS.LCP = [3000, 4000];
      expect(regleAngleMort(30)).toContain("au-dessus de 3,0 s");
      expect(regleAngleMort(30)).not.toContain("2,5 s");
      expect(regleAlerteAngleMort()).toBe("robot ok et réel au-delà de 3,0 s la même heure");
    } finally {
      THRESHOLDS.LCP = avant;
    }
  });
});

describe("F58 — heuresAngleMort (CR4 = cases « angle mort » de CR8)", () => {
  it("somme des cellules robot ok × réel À améliorer ou Mauvais, rien d'autre", () => {
    const cellules = [
      { robot: "ok" as const, reel: "good" as const, heures: 400 },
      { robot: "ok" as const, reel: "needs-improvement" as const, heures: 38 },
      { robot: "ok" as const, reel: "poor" as const, heures: 9 },
      { robot: "warn" as const, reel: "poor" as const, heures: 6 },
      { robot: "incident" as const, reel: "good" as const, heures: 3 },
    ];
    expect(heuresAngleMort(cellules)).toBe(47);
    expect(heuresAngleMort([])).toBe(0);
  });
});

describe("F58 — frise robot (CR7-b)", () => {
  const grille = ["2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z", "2026-09-22T12:00:00Z", "2026-09-22T13:00:00Z"];
  const robot = (syn_state: "ok" | "warn" | "incident" | null, syn_latency_avg: number | null, syn_measures: string | null) => ({
    syn_state,
    syn_latency_avg,
    syn_measures,
  });

  it("heure vide → aucun passage ; réel seul → aucun passage (pas « état inconnu ») ; passage sans état → inconnu", () => {
    const cases = casesFriseRobot(
      [robot("incident", 3400, "Parcours"), null, robot(null, null, null), robot(null, 900, "Parcours")],
      grille,
    );
    expect(cases.map((c) => c.etat)).toEqual(["incident", "absent", "absent", "inconnu"]);
    expect(cases[0]).toEqual({ t: grille[0], etat: "incident", detail: "premier chargement 3,40 s · Parcours" });
    expect(cases[1].detail).toBe("aucun passage du robot");
    expect(cases.map((c) => c.t)).toEqual(grille);
  });

  it("une case par élément de la grille, même si les lignes sont plus courtes", () => {
    expect(casesFriseRobot([], grille).map((c) => c.etat)).toEqual(["absent", "absent", "absent", "absent"]);
    expect(aucunPassageSurLaGrille([null, robot(null, null, null)])).toBe(true);
    expect(aucunPassageSurLaGrille([null, robot("ok", 800, null)])).toBe(false);
  });

  it("états de la frise : forme et glyphe portent l'état, ok est neutre (pas un verdict)", () => {
    const parCle = Object.fromEntries(ETATS_FRISE_ROBOT.map((e) => [e.cle, e]));
    expect(parCle.incident).toMatchObject({ libelle: "incident", forme: "haute", glyphe: "×" });
    expect(parCle.warn).toMatchObject({ forme: "moyenne", glyphe: "!" });
    expect(parCle.ok).toMatchObject({ forme: "basse", ton: "neutre" });
    expect(parCle.absent).toMatchObject({ libelle: "aucun passage", forme: "hachure" });
    expect(parCle.inconnu).toMatchObject({ forme: "contour" });
  });
});

describe("F58 — grilleHoraire (CR7)", () => {
  it("24 h : seaux d'une heure alignés UTC, non tronquée", () => {
    const g = grilleHoraire({ from: "2026-09-21T10:30:00.000Z", to: "2026-09-22T10:30:00.000Z" });
    expect(g.tronque).toBe(false);
    expect(g.grille[0]).toBe("2026-09-21T10:00:00Z");
    expect(g.grille[g.grille.length - 1]).toBe("2026-09-22T10:00:00Z");
    expect(g.grille).toHaveLength(25);
  });

  it("plage de 20 jours : les 300 dernières heures seulement, tronquée", () => {
    const g = grilleHoraire({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" });
    expect(g.tronque).toBe(true);
    expect(g.grille).toHaveLength(300);
    expect(g.grille[0]).toBe("2026-09-08T12:00:00Z");
  });
});

describe("F58 — sélecteur et tables (CR7-a, CR12)", () => {
  it("puces : couples aux angles morts les plus nombreux, parmi les options, au plus 5", () => {
    const options = [
      { app_id: "a", route: "/x" },
      { app_id: "a", route: "/y" },
    ];
    const am = [
      { serie: "a:%2Fz", app_id: "a", route: "/z", heures: 40 }, // pas une option du hero
      { serie: "a:%2Fy", app_id: "a", route: "/y", heures: 12 },
      { serie: "a:%2Fx", app_id: "a", route: "/x", heures: 3 },
    ];
    expect(pucesAnglesMorts(am, options).map((p) => p.route)).toEqual(["/y", "/x"]);
    expect(pucesAnglesMorts(am, options, 1).map((p) => p.route)).toEqual(["/y"]);
  });

  it("routes : les deux côtés d'abord, puis LCP p75 décroissant, LCP inconnu en dernier", () => {
    const tri = trierRoutes([
      { app_id: "a", route: "/robot-seul", rum_lcp_p75: null, syn_latency_avg: 700 },
      { app_id: "a", route: "/reel-seul", rum_lcp_p75: 5000, syn_latency_avg: null },
      { app_id: "a", route: "/lent", rum_lcp_p75: 3200, syn_latency_avg: 900 },
      { app_id: "a", route: "/rapide", rum_lcp_p75: 1200, syn_latency_avg: 800 },
    ]);
    expect(tri.map((c) => c.route)).toEqual(["/lent", "/rapide", "/reel-seul", "/robot-seul"]);
  });
});

describe("F58 — bandeau de fraîcheur (CR1, CR6)", () => {
  const TO = Date.parse("2026-09-22T12:00:00Z");
  const H = 3_600_000;
  const espaces = (s: string) => s.replace(/\u00a0/g, " ");

  it("robot arrêté depuis 3 h 12 pour un passage toutes les 15 min : le bandeau le dit", () => {
    const lignes = lignesRetard(
      [{ app_id: "demo", dernier: new Date(TO - 3 * H - 12 * 60_000), intervalle_median_s: 900, passages: 40 }],
      TO,
    );
    expect(lignes.map(espaces)).toEqual(["Dernier passage du robot : il y a 3 h 12 min (attendu toutes les 15 min)"]);
  });

  it("robot à jour : rien ; aucun passage : pas de ligne (« Non collecté » à part) ; plusieurs apps : app nommée", () => {
    expect(
      lignesRetard([{ app_id: "demo", dernier: new Date(TO - 10 * 60_000), intervalle_median_s: 900, passages: 40 }], TO),
    ).toEqual([]);
    const plusieurs = lignesRetard(
      [
        { app_id: "a", dernier: null, intervalle_median_s: null, passages: 0 },
        { app_id: "b", dernier: new Date(TO - 5 * 60_000), intervalle_median_s: null, passages: 1 },
      ],
      TO,
    );
    expect(plusieurs.map(espaces)).toEqual([
      "b — Dernier passage du robot : il y a 5 min (rythme attendu inconnu : moins de deux passages d'un même scénario sur la plage)",
    ]);
  });

  it("dernier passage du périmètre : le plus récent, null sans aucun", () => {
    const d1 = new Date(TO - 2 * H);
    const d2 = new Date(TO - H);
    expect(dernierPassage([{ dernier: d1 }, { dernier: null }, { dernier: d2 }])).toBe(d2);
    expect(dernierPassage([{ dernier: null }])).toBeNull();
  });
});
