// Visites & récurrence — logique pure.
import { describe, expect, it } from "vitest";
import { isReturning, splitVisits, VISIT_GAP_MS } from "../../apps/console/lib/sessions";

const MIN = 60 * 1000;

describe("splitVisits", () => {
  it("une seule visite si tout est rapproché", () => {
    const base = 1_000_000;
    expect(splitVisits([base, base + 5 * MIN, base + 20 * MIN])).toBe(1);
  });
  it("coupe une nouvelle visite après un trou > 30 min", () => {
    const base = 1_000_000;
    expect(splitVisits([base, base + 40 * MIN])).toBe(2);
    expect(splitVisits([base, base + 40 * MIN, base + 45 * MIN, base + 120 * MIN])).toBe(3);
  });
  it("exactement 30 min ne coupe pas (seuil strict)", () => {
    const base = 1_000_000;
    expect(splitVisits([base, base + VISIT_GAP_MS])).toBe(1);
    expect(splitVisits([base, base + VISIT_GAP_MS + 1])).toBe(2);
  });
  it("trie les entrées et ignore le non fini ; série vide -> 0", () => {
    const base = 1_000_000;
    expect(splitVisits([base + 40 * MIN, base])).toBe(2);
    expect(splitVisits([base, NaN, base + 2 * MIN])).toBe(1);
    expect(splitVisits([])).toBe(0);
  });
  it("gap paramétrable", () => {
    const base = 1_000_000;
    expect(splitVisits([base, base + 2 * MIN], 60 * 1000)).toBe(2);
  });
});

describe("isReturning", () => {
  it("revenant si une activité antérieure existe", () => {
    expect(isReturning([500, 800], 1000)).toBe(true);
    expect(isReturning([1200], 1000)).toBe(false);
    expect(isReturning([], 1000)).toBe(false);
  });
});
