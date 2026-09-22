// Entonnoir de conversion — profondeur atteinte, reached, rapport. Logique pure.
import { describe, expect, it } from "vitest";
import { computeFunnel, funnelReached, reachedDepth } from "../../apps/console/lib/funnel";

describe("reachedDepth", () => {
  it("compte le préfixe d'étapes en ordre temporel", () => {
    expect(reachedDepth([1, 2, 3])).toBe(3);
    expect(reachedDepth([1, 2, null])).toBe(2); // 3e absente
    expect(reachedDepth([null, 2, 3])).toBe(0); // 1re absente
    expect(reachedDepth([3, 2, 1])).toBe(1); // ordre décroissant : casse après 1
    expect(reachedDepth([1, 1, 1])).toBe(3); // égalité = non décroissant, OK
    expect(reachedDepth([])).toBe(0);
  });
});

describe("funnelReached", () => {
  it("cumule les sessions par étape atteinte", () => {
    const sessions = [
      [1, 2, 3], // atteint 3
      [1, 2, null], // atteint 2
      [1, null, null], // atteint 1
      [null, 1, 2], // atteint 0
    ];
    expect(funnelReached(sessions, 3)).toEqual([3, 2, 1]);
  });
});

describe("computeFunnel", () => {
  it("conversion vs départ / vs précédent + abandon", () => {
    const sessions = [
      [10, 20, 30],
      [10, 20, null],
      [10, null, null],
      [10, 20, 40],
    ];
    // reached = [4, 3, 2]
    const rep = computeFunnel(sessions, ["view", "add", "buy"]);
    expect(rep.map((s) => s.reached)).toEqual([4, 3, 2]);
    expect(rep[0]).toMatchObject({ ord: 1, convFromStart: 1, convFromPrev: 1, dropoff: 0 });
    expect(rep[1].convFromStart).toBeCloseTo(0.75);
    expect(rep[1].convFromPrev).toBeCloseTo(0.75);
    expect(rep[1].dropoff).toBe(1);
    expect(rep[2].convFromStart).toBeCloseTo(0.5);
    expect(rep[2].convFromPrev).toBeCloseTo(2 / 3);
    expect(rep[2].dropoff).toBe(1);
  });
  // F40 (V3) : sans départ, il n'y a pas de dénominateur. « 0 % du départ » se
  // lirait comme un entonnoir qui perd tout le monde ; c'est un taux non calculable.
  it("départ 0 -> taux null (pas « 0 % »), comptes à 0, pas de division par zéro", () => {
    const rep = computeFunnel([], ["a", "b"]);
    expect(rep.map((s) => s.reached)).toEqual([0, 0]);
    expect(rep.map((s) => s.convFromStart)).toEqual([null, null]);
    expect(rep.map((s) => s.convFromPrev)).toEqual([null, null]);
    expect(rep.map((s) => s.dropoff)).toEqual([0, 0]);
  });

  it("étape précédente vide -> conversion depuis elle null, conversion depuis le départ 0 réel", () => {
    // Départ atteint par 2 sessions, étape 2 par aucune : 0 % du départ est un VRAI zéro,
    // mais l'étape 3 n'a pas de dénominateur « étape précédente ».
    const rep = computeFunnel(
      [
        [10, null, null],
        [10, null, null],
      ],
      ["a", "b", "c"],
    );
    expect(rep[1]).toMatchObject({ reached: 0, convFromStart: 0, convFromPrev: 0, dropoff: 2 });
    expect(rep[2]).toMatchObject({ reached: 0, convFromStart: 0, convFromPrev: null, dropoff: 0 });
  });
});
