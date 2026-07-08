// Percentiles & distribution — logique pure.
import { describe, expect, it } from "vitest";
import {
  histogramBins,
  labelPercentiles,
  maxCount,
  PCT_LABELS,
  totalCount,
  VITAL_CAP,
} from "../../apps/console/lib/distribution";

describe("histogramBins", () => {
  it("répartit les tranches contiguës sur [0, cap]", () => {
    // cap 100, 5 tranches -> largeur 20 : [0,20),[20,40),...
    const bins = histogramBins(
      [
        { bucket: 1, count: 3 },
        { bucket: 3, count: 5 },
      ],
      100,
      5,
    );
    expect(bins).toHaveLength(5);
    expect(bins[0]).toEqual({ from: 0, to: 20, count: 3 });
    expect(bins[2]).toEqual({ from: 40, to: 60, count: 5 });
    expect(bins[1].count).toBe(0);
  });
  it("replie le débordement (N+1) dans la dernière tranche", () => {
    const bins = histogramBins([{ bucket: 6, count: 4 }], 100, 5); // N+1 = 6
    expect(bins[4].count).toBe(4);
  });
  it("replie le cas <0 (bucket 0) dans la première tranche", () => {
    const bins = histogramBins([{ bucket: 0, count: 2 }], 100, 5);
    expect(bins[0].count).toBe(2);
  });
  it("tolère bucket/count en chaînes (driver pg) et ignore le non fini", () => {
    const bins = histogramBins(
      [
        { bucket: "2", count: "7" },
        { bucket: "x", count: "1" },
      ],
      100,
      5,
    );
    expect(bins[1].count).toBe(7);
    expect(totalCount(bins)).toBe(7);
  });
});

describe("maxCount / totalCount", () => {
  it("calcule max et total", () => {
    const bins = histogramBins(
      [
        { bucket: 1, count: 3 },
        { bucket: 2, count: 8 },
      ],
      100,
      5,
    );
    expect(maxCount(bins)).toBe(8);
    expect(totalCount(bins)).toBe(11);
  });
  it("0 sur histogramme vide", () => {
    expect(maxCount(histogramBins([], 100, 5))).toBe(0);
  });
});

describe("labelPercentiles", () => {
  it("associe chaque valeur à son libellé dans l'ordre", () => {
    const out = labelPercentiles([1000, 1500, 2200, 2800, 3500]);
    expect(out.map((o) => o.label)).toEqual([...PCT_LABELS]);
    expect(out[0]).toEqual({ label: "p50", value: 1000 });
    expect(out[4]).toEqual({ label: "p99", value: 3500 });
  });
  it("gère null / manquants", () => {
    expect(labelPercentiles(null).every((o) => o.value === null)).toBe(true);
    expect(labelPercentiles([1000])[1].value).toBeNull();
  });
});

describe("VITAL_CAP", () => {
  it("couvre les 5 web vitals", () => {
    for (const v of ["LCP", "INP", "CLS", "FCP", "TTFB"]) expect(VITAL_CAP[v]).toBeGreaterThan(0);
  });
});
