// Carte d'expérience (Lot B DEM) — logique pure : santé, tendance, mise en page.
import { describe, expect, it } from "vitest";
import {
  apiHealth,
  atRisk,
  layoutGraph,
  pageHealth,
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
});

describe("pageHealth", () => {
  it("seuils LCP 2026", () => {
    expect(pageHealth(1500)).toBe("good");
    expect(pageHealth(3000)).toBe("warn");
    expect(pageHealth(5000)).toBe("bad");
    expect(pageHealth(null)).toBe("good");
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
