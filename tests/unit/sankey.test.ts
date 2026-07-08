// Flux Sankey biparti — layout normalisé. Logique pure.
import { describe, expect, it } from "vitest";
import { buildSankey } from "../../apps/console/lib/sankey";
import type { Transition } from "../../apps/console/lib/paths";

const T = (from: string, to: string, count: number): Transition => ({ from, to, count });

describe("buildSankey", () => {
  it("entrée vide -> modèle vide", () => {
    const m = buildSankey([]);
    expect(m).toEqual({ left: [], right: [], links: [], shownFlow: 0, totalFlow: 0 });
  });

  it("place sources à gauche, cibles à droite ; totaux conservés", () => {
    const m = buildSankey([T("/", "/a", 3), T("/", "/b", 1), T("/a", "/b", 2)]);
    expect(m.totalFlow).toBe(6);
    expect(m.shownFlow).toBe(6);
    expect(m.left.map((n) => n.route).sort()).toEqual(["/", "/a"]);
    expect(m.right.map((n) => n.route).sort()).toEqual(["/a", "/b"]);
    // "/" a 4 de flux sortant (3+1), "/a" 2
    expect(m.left.find((n) => n.route === "/")?.total).toBe(4);
    expect(m.left.find((n) => n.route === "/a")?.total).toBe(2);
  });

  it("y et h normalisés dans [0,1]", () => {
    const m = buildSankey([T("/", "/a", 3), T("/x", "/b", 1), T("/y", "/c", 2)]);
    for (const n of [...m.left, ...m.right]) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.h).toBeGreaterThan(0);
      expect(n.y + n.h).toBeLessThanOrEqual(1 + 1e-9);
    }
    for (const l of m.links) {
      expect(l.sy0).toBeGreaterThanOrEqual(0);
      expect(l.sy1).toBeLessThanOrEqual(1 + 1e-9);
      expect(l.sy1).toBeGreaterThanOrEqual(l.sy0);
      expect(l.ty1).toBeGreaterThanOrEqual(l.ty0);
    }
  });

  it("les bandes source d'un nœud couvrent sa hauteur", () => {
    const m = buildSankey([T("/", "/a", 3), T("/", "/b", 1)], { gap: 0 });
    const node = m.left.find((n) => n.route === "/")!;
    const bands = m.links.filter((l) => l.from === "/");
    const sum = bands.reduce((a, l) => a + (l.sy1 - l.sy0), 0);
    expect(sum).toBeCloseTo(node.h, 6);
  });

  it("maxNodes borne les nœuds et réduit la couverture", () => {
    const trans = [T("/a", "/z", 10), T("/b", "/z", 8), T("/c", "/z", 6), T("/d", "/z", 4)];
    const m = buildSankey(trans, { maxNodes: 2 });
    expect(m.left).toHaveLength(2); // /a, /b (top 2 sources)
    expect(m.shownFlow).toBe(18); // 10 + 8
    expect(m.totalFlow).toBe(28);
    expect(m.shownFlow).toBeLessThan(m.totalFlow);
  });
});
