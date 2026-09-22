// Carte d'expérience (Lot B DEM) — logique pure : santé, tendance, mise en page.
import { describe, expect, it } from "vitest";
import {
  REGLE_SANTE_API,
  apiHealth,
  atRisk,
  layoutGraph,
  pageHealth,
  texteRegleSanteApi,
  trend,
  type GEdge,
  type GNode,
} from "../../apps/console/lib/map";

describe("apiHealth", () => {
  it("bad si erreur >= 10% ou latence >= 3s", () => {
    expect(apiHealth(0.1, 100)).toBe("bad");
    expect(apiHealth(0, 3000)).toBe("bad");
  });
  it("warn si erreur >= 2% ou latence >= 1s", () => {
    expect(apiHealth(0.03, 100)).toBe("warn");
    expect(apiHealth(0, 1200)).toBe("warn");
  });
  it("good sinon", () => {
    expect(apiHealth(0, 200)).toBe("good");
  });
  // F40 (V3) : une latence inconnue ne vaut pas 0 ms.
  it("latence null -> unknown, sauf si le taux d'erreur suffit seul à conclure « dégradé »", () => {
    expect(apiHealth(0, null)).toBe("unknown");
    expect(apiHealth(0.05, null)).toBe("unknown"); // à surveiller OU dégradé : on ne sait pas
    expect(apiHealth(0.15, null)).toBe("bad"); // la règle est un OU : l'erreur décide
  });
});

describe("pageHealth", () => {
  it("verdict LCP lu dans lib/rating.ts (bornes web.dev, « bon » inclusif)", () => {
    expect(pageHealth(1500)).toBe("good");
    expect(pageHealth(2500)).toBe("good"); // « 2.5 seconds or less »
    expect(pageHealth(3000)).toBe("warn");
    expect(pageHealth(4000)).toBe("warn"); // « mauvais » strict : au-delà de 4,0 s
    expect(pageHealth(5000)).toBe("bad");
  });
  it("aucune mesure -> unknown, jamais « good »", () => {
    expect(pageHealth(null)).toBe("unknown");
  });
});

describe("texteRegleSanteApi (S6 : un seuil propre à l'écran est écrit avec sa source)", () => {
  it("dit les bornes lues dans REGLE_SANTE_API, et l'état inconnu", () => {
    const t = texteRegleSanteApi().replace(/\u00a0/g, " ");
    expect(t).toContain(`${REGLE_SANTE_API.erreurDegrade * 100} %`);
    expect(t).toContain(`${REGLE_SANTE_API.latenceDegradeMs / 1000} s`);
    expect(t).toContain(`${REGLE_SANTE_API.erreurSurveiller * 100} %`);
    expect(t).toContain("inconnu sans latence mesurée");
  });
});

describe("trend", () => {
  it("flat si trop peu de données", () => {
    expect(trend(2, 1)).toBe("flat");
  });
  it("up si volume récent nettement supérieur", () => {
    expect(trend(20, 5)).toBe("up");
  });
  it("down si volume récent nettement inférieur", () => {
    expect(trend(3, 20)).toBe("down");
  });
});

describe("atRisk", () => {
  it("hausse + santé dégradée = à risque", () => {
    expect(atRisk("up", "warn")).toBe(true);
    expect(atRisk("up", "good")).toBe(false);
    expect(atRisk("flat", "bad")).toBe(false);
  });
  it("santé inconnue : pas une dégradation observée, donc pas « à risque »", () => {
    expect(atRisk("up", "unknown")).toBe(false);
  });
});

describe("layoutGraph", () => {
  const mk = (id: string, tier: "front" | "back"): GNode => ({
    id, tier, route: id, calls: 1, health: "good", dir: "flat", risk: false,
  });
  it("place front/back en deux colonnes et empile", () => {
    const front = [mk("front:/a", "front"), mk("front:/b", "front")];
    const back = [mk("back:/x", "back")];
    const l = layoutGraph(front, back, []);
    expect(l.nodes).toHaveLength(3);
    // deux colonnes distinctes
    const xs = new Set(l.nodes.map((n) => n.x));
    expect(xs.size).toBe(2);
    // empilement vertical dans une colonne
    expect(l.nodes[1].y).toBeGreaterThan(l.nodes[0].y);
  });
  it("ne garde que les arêtes dont les 2 extrémités sont visibles", () => {
    const front = [mk("front:/a", "front")];
    const back = [mk("back:/x", "back")];
    const edges: GEdge[] = [
      { from: "front:/a", to: "back:/x", calls: 5 }, // visible
      { from: "front:/a", to: "back:/hidden", calls: 9 }, // extrémité absente
    ];
    const l = layoutGraph(front, back, edges);
    expect(l.edges).toHaveLength(1);
    expect(l.edges[0].to).toBe("back:/x");
    expect(l.edges[0].width).toBeGreaterThan(0);
  });
});
