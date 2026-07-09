// Rétention par cohortes — matrice triangulaire. Logique pure.
import { describe, expect, it } from "vitest";
import { buildCohorts } from "../../apps/console/lib/cohorts";

describe("buildCohorts", () => {
  it("vide -> []", () => {
    expect(buildCohorts([], 4)).toEqual([]);
  });

  it("cohorte = 1re semaine ; offset 0 = 100 %", () => {
    // u1 actif s10, s11 ; u2 actif s10 seulement
    const rows = [
      { user: "u1", week: 10 },
      { user: "u1", week: 11 },
      { user: "u2", week: 10 },
    ];
    const c = buildCohorts(rows, 4);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ cohort: 10, size: 2 });
    // offset 0 : les 2 ; offset 1 : seul u1
    expect(c[0].cells[0]).toEqual({ offset: 0, retained: 2, rate: 1 });
    expect(c[0].cells[1]).toEqual({ offset: 1, retained: 1, rate: 0.5 });
  });

  it("plusieurs cohortes, matrice triangulaire (pas d'offset futur)", () => {
    const rows = [
      { user: "a", week: 10 },
      { user: "a", week: 12 },
      { user: "b", week: 11 },
    ];
    const c = buildCohorts(rows, 5);
    // latest = 12. cohorte 10 -> offsets 0..2 ; cohorte 11 -> 0..1
    const c10 = c.find((x) => x.cohort === 10)!;
    const c11 = c.find((x) => x.cohort === 11)!;
    expect(c10.cells.map((x) => x.offset)).toEqual([0, 1, 2]);
    expect(c10.cells[2]).toMatchObject({ offset: 2, retained: 1, rate: 1 }); // a revient s12
    expect(c10.cells[1].retained).toBe(0); // a absent s11
    expect(c11.cells.map((x) => x.offset)).toEqual([0, 1]);
  });

  it("maxOffset borne le nombre de colonnes", () => {
    const rows = [
      { user: "a", week: 0 },
      { user: "a", week: 9 },
    ];
    const c = buildCohorts(rows, 3);
    expect(c[0].cells).toHaveLength(4); // offsets 0..3 malgré latest-cohort=9
  });
});
