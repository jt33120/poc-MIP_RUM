// Analyse de parcours — transitions, entrées, sorties. Logique pure.
import { describe, expect, it } from "vitest";
import {
  collapseRepeats,
  countEntries,
  countExits,
  countTransitions,
} from "../../apps/console/lib/paths";

describe("collapseRepeats", () => {
  it("compresse les répétitions consécutives", () => {
    expect(collapseRepeats(["/a", "/a", "/b", "/b", "/a"])).toEqual(["/a", "/b", "/a"]);
    expect(collapseRepeats([])).toEqual([]);
    expect(collapseRepeats(["/x"])).toEqual(["/x"]);
  });
});

describe("countTransitions", () => {
  it("agrège les paires consécutives, triées par fréquence", () => {
    const sessions = [
      ["/", "/a", "/b"],
      ["/", "/a", "/c"],
      ["/", "/a"],
    ];
    const t = countTransitions(sessions);
    expect(t[0]).toEqual({ from: "/", to: "/a", count: 3 });
    expect(t).toContainEqual({ from: "/a", to: "/b", count: 1 });
    expect(t).toContainEqual({ from: "/a", to: "/c", count: 1 });
  });
  it("retire les boucles A→A par défaut (recharges)", () => {
    const t = countTransitions([["/a", "/a", "/b"]]);
    expect(t).toEqual([{ from: "/a", to: "/b", count: 1 }]);
  });
  it("garde les boucles si dropSelfLoops=false", () => {
    const t = countTransitions([["/a", "/a", "/b"]], { dropSelfLoops: false });
    expect(t).toContainEqual({ from: "/a", to: "/a", count: 1 });
    expect(t).toContainEqual({ from: "/a", to: "/b", count: 1 });
  });
  it("séquence < 2 routes → aucune transition", () => {
    expect(countTransitions([["/a"], []])).toEqual([]);
  });
  it("départage stable à fréquence égale (from puis to)", () => {
    const t = countTransitions([["/b", "/z"], ["/a", "/y"]]);
    expect(t.map((x) => x.from)).toEqual(["/a", "/b"]);
  });
});

describe("countEntries / countExits", () => {
  const sessions = [
    ["/", "/a", "/b"],
    ["/", "/a", "/b"],
    ["/login", "/a"],
  ];
  it("entrées = 1re route par session", () => {
    expect(countEntries(sessions)).toEqual([
      { route: "/", count: 2 },
      { route: "/login", count: 1 },
    ]);
  });
  it("sorties = dernière route par session", () => {
    expect(countExits(sessions)).toEqual([
      { route: "/b", count: 2 },
      { route: "/a", count: 1 },
    ]);
  });
  it("ignore les sessions vides", () => {
    expect(countEntries([[], ["/x"]])).toEqual([{ route: "/x", count: 1 }]);
  });
});
