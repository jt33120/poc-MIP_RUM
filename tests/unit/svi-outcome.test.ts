// Dérivations d'issues SVI. Ces taux sont affichés tels quels sur le tableau de
// bord : un taux faux se voit rarement à l'œil, d'où des tests sur les cas
// dégénérés autant que sur le cas nominal.
import { describe, expect, it } from "vitest";
import {
  fmtDuration,
  journeyCoverage,
  outcomeLabel,
  outcomeRates,
} from "../../apps/console/lib/svi-outcome";

const counts = (o: Partial<Parameters<typeof outcomeRates>[0]> = {}) => ({
  total: 0, contained: 0, transferred: 0, abandoned: 0, failed: 0, open: 0, ...o,
});

describe("outcomeRates", () => {
  it("calcule les taux sur les appels CLOS, pas sur le total", () => {
    // 10 clos + 90 en cours : le containment est de 60 %, pas de 6 %. Inclure les
    // appels ouverts ferait chuter tous les taux à mesure que du trafic arrive.
    const r = outcomeRates(counts({ total: 100, contained: 6, transferred: 3, abandoned: 1, open: 90 }));
    expect(r.closed).toBe(10);
    expect(r.contained).toBeCloseTo(60);
    expect(r.transferred).toBeCloseTo(30);
    expect(r.abandoned).toBeCloseTo(10);
  });

  it("les quatre taux somment à 100 % sur tout jeu non vide", () => {
    const jeux = [
      counts({ contained: 1 }),
      counts({ failed: 7 }),
      counts({ contained: 3, transferred: 3, abandoned: 3, failed: 3 }),
      counts({ contained: 1, transferred: 2, abandoned: 3, failed: 4 }),
      counts({ contained: 999, abandoned: 1 }),
    ];
    for (const j of jeux) {
      const r = outcomeRates(j);
      expect(r.contained + r.transferred + r.abandoned + r.failed).toBeCloseTo(100, 6);
    }
  });

  it("jeu vide et jeu 100 % ouvert : zéro, jamais NaN", () => {
    for (const j of [counts(), counts({ total: 50, open: 50 })]) {
      const r = outcomeRates(j);
      expect(r.closed).toBe(0);
      for (const v of [r.contained, r.transferred, r.abandoned, r.failed]) {
        expect(Number.isNaN(v)).toBe(false);
        expect(v).toBe(0);
      }
    }
  });
});

describe("journeyCoverage", () => {
  it("exprime la couverture réelle, jamais extrapolée", () => {
    expect(journeyCoverage(1000, 340)).toBeCloseTo(34);
    expect(journeyCoverage(0, 0)).toBe(0);
    expect(journeyCoverage(10, 0)).toBe(0);
  });
  it("ne dépasse jamais 100 % même sur donnée incohérente", () => {
    expect(journeyCoverage(10, 50)).toBe(100);
  });
});

describe("outcomeLabel", () => {
  it("nomme les quatre issues, et l'absence d'issue", () => {
    expect(outcomeLabel("contained")).toBe("résolu par le SVI");
    expect(outcomeLabel("transferred")).toBe("transféré");
    expect(outcomeLabel("abandoned")).toBe("abandonné");
    expect(outcomeLabel("failed")).toBe("échec technique");
    expect(outcomeLabel(null)).toBe("en cours");
    expect(outcomeLabel("inconnu")).toBe("en cours");
  });
});

describe("fmtDuration", () => {
  it("secondes sous la minute, minutes au-delà", () => {
    expect(fmtDuration(12_000)).toBe("12 s");
    expect(fmtDuration(125_000)).toBe("2 min 05 s");
    expect(fmtDuration(60_000)).toBe("1 min 00 s");
  });
  it("valeur absente ou aberrante -> tiret, jamais « 0 s »", () => {
    // Afficher « 0 s » pour une durée inconnue inventerait une mesure.
    expect(fmtDuration(null)).toBe("—");
    expect(fmtDuration(undefined)).toBe("—");
    expect(fmtDuration(Number.NaN)).toBe("—");
    expect(fmtDuration(-5)).toBe("—");
  });
});
