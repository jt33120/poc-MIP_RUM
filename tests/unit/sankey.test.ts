// Flux Sankey biparti — layout normalisé. Logique pure.
import { describe, expect, it } from "vitest";
import { buildSankey, hauteurSankey } from "../../apps/console/lib/sankey";
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

// F50 (plan § 5.13.4) — la hauteur du dessin suit le NOMBRE de nœuds : à hauteur
// fixe, trois routes donnaient des rubans obèses et huit routes des filets.
describe("hauteurSankey", () => {
  it("120 px de base, 36 px par nœud de la colonne la plus haute", () => {
    // 2 sources, 2 cibles : 120 + 36 × 2.
    expect(hauteurSankey(buildSankey([T("/", "/a", 3), T("/b", "/c", 1)]))).toBe(192);
    // 3 sources pour 1 cible : c'est la colonne la plus haute qui décide.
    const troisVersUne = buildSankey([T("/a", "/z", 3), T("/b", "/z", 2), T("/c", "/z", 1)]);
    expect(troisVersUne.left).toHaveLength(3);
    expect(troisVersUne.right).toHaveLength(1);
    expect(hauteurSankey(troisVersUne)).toBe(120 + 36 * 3);
  });

  it("plafonne à 380 px ; un modèle sans nœud garde la base", () => {
    // 8 nœuds par côté (le maximum de buildSankey) : 120 + 288 = 408, plafonné.
    const pleine = buildSankey(Array.from({ length: 8 }, (_, i) => T(`/s${i}`, `/c${i}`, 10 - i)));
    expect(pleine.left).toHaveLength(8);
    expect(hauteurSankey(pleine)).toBe(380);
    expect(hauteurSankey(buildSankey([]))).toBe(120);
  });
});
