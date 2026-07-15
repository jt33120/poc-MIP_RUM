// Voie A inc.3 — détection de régression post-déploiement (logique pure).
// « Plus haut = pire » (LCP, volume d'erreurs) : régression si l'après dépasse
// l'avant d'au moins +20 % (ratio par défaut).
import { describe, expect, it } from "vitest";
import { assessRegression } from "../../apps/console/lib/queries-deploys";

describe("assessRegression", () => {
  it("détecte une dégradation >= +20 %", () => {
    expect(assessRegression(2000, 2600)).toEqual({ regressed: true, deltaPct: 30 });
    expect(assessRegression(10, 12)).toEqual({ regressed: true, deltaPct: 20 });
  });

  it("ne signale pas une variation sous le seuil", () => {
    expect(assessRegression(2000, 2200)).toEqual({ regressed: false, deltaPct: 10 });
    expect(assessRegression(2000, 1500)).toEqual({ regressed: false, deltaPct: -25 });
  });

  it("neutre si donnée manquante ou avant <= 0", () => {
    expect(assessRegression(null, 3000)).toEqual({ regressed: false, deltaPct: null });
    expect(assessRegression(2000, null)).toEqual({ regressed: false, deltaPct: null });
    expect(assessRegression(0, 100)).toEqual({ regressed: false, deltaPct: null });
  });

  it("respecte un ratio personnalisé", () => {
    expect(assessRegression(100, 130, 1.5).regressed).toBe(false); // +30 % < +50 %
    expect(assessRegression(100, 160, 1.5).regressed).toBe(true);
  });
});
