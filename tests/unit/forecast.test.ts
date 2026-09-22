// AIOps — prévision (régression linéaire). Logique pure.
import { describe, expect, it } from "vitest";
import {
  HORIZON_JOURS,
  buildForecastNarrative,
  cleJour,
  etaToThreshold,
  forecastNext,
  linfit,
  trendDir,
} from "../../apps/console/lib/forecast";

describe("linfit", () => {
  it("ajuste une droite parfaite y = 2x + 1", () => {
    const fit = linfit([1, 3, 5, 7, 9])!;
    expect(fit.slope).toBeCloseTo(2, 6);
    expect(fit.intercept).toBeCloseTo(1, 6);
    expect(fit.n).toBe(5);
  });
  it("ignore les trous mais garde les positions", () => {
    const fit = linfit([1, null, 5, null, 9])!; // points (0,1),(2,5),(4,9) -> pente 2
    expect(fit.slope).toBeCloseTo(2, 6);
  });
  it("null si moins de 3 points", () => {
    expect(linfit([1, 2])).toBeNull();
    expect(linfit([1, null, null])).toBeNull();
  });
});

describe("forecastNext", () => {
  it("projette au-delà du dernier point", () => {
    const fit = linfit([1, 3, 5, 7, 9])!; // dernier x = 4
    expect(forecastNext(fit, 3)).toBeCloseTo(15, 6); // x = 7 -> 2*7+1
  });
});

describe("etaToThreshold", () => {
  it("compte les pas jusqu'au franchissement (hausse défavorable)", () => {
    const fit = linfit([1, 3, 5, 7, 9])!; // y=2x+1, dernier point y=9 à x=4
    // seuil 15 -> x=7 -> 3 pas après le dernier
    expect(etaToThreshold(fit, 9, 15, true)).toBeCloseTo(3, 6);
  });
  it("0 si déjà au-delà du seuil", () => {
    const fit = linfit([10, 12, 14])!;
    expect(etaToThreshold(fit, 14, 10, true)).toBe(0);
  });
  it("null si la tendance s'éloigne du seuil", () => {
    const fit = linfit([9, 7, 5])!; // baisse
    expect(etaToThreshold(fit, 5, 15, true)).toBeNull();
  });
});

describe("trendDir", () => {
  it("classe selon la pente relative", () => {
    expect(trendDir(linfit([1, 3, 5])!, 3)).toBe("up");
    expect(trendDir(linfit([5, 3, 1])!, 3)).toBe("down");
    expect(trendDir(linfit([5, 5, 5])!, 5)).toBe("flat");
  });
});

describe("buildForecastNarrative", () => {
  it("risk si un seuil est déjà dépassé", () => {
    const n = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: 0 }]);
    expect(n.status).toBe("risk");
    expect(n.lines[0]).toContain("dépasse déjà");
  });
  it("watch si franchissement à venir sous 7 j", () => {
    const n = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: 2.3 }]);
    expect(n.status).toBe("watch");
    expect(n.lines[0]).toContain("J+3");
  });
  it("ok si rien à l'horizon", () => {
    const n = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: null }]);
    expect(n.status).toBe("ok");
    expect(n.lines[0]).toContain("Aucun indicateur");
  });
  it("un seul horizon, 7 jours, partout : texte, fenêtre d'alerte et projection", () => {
    // La narration disait « horizon de 3 jours » tout en signalant jusqu'à J+7.
    expect(HORIZON_JOURS).toBe(7);
    const ok = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: null }]);
    expect(ok.lines[0]).toContain("7 jours");
    expect(ok.lines[0]).not.toContain("3 jours");
    expect(buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: 6.5 }]).lines[0]).toContain("J+7");
    expect(buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: 7.5 }]).status).toBe("ok");
  });
});

describe("cleJour", () => {
  it("lit un Date de node-postgres par ses composantes locales, pas par String()", () => {
    // Un `date` PostgreSQL arrive en Date à minuit local.
    expect(cleJour(new Date(2026, 8, 22))).toBe("2026-09-22");
    expect(cleJour(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(cleJour("2026-09-22T00:00:00.000Z")).toBe("2026-09-22");
  });
});
