// P*.1, incrément 0-b — la tuile d'un Web Vital n'affirme que ce que l'intervalle permet.
//
// La logique est dans lib/vital-lecture.ts, que components/VitalCard.tsx rend tel
// quel : moustache, texte de l'intervalle, badge et couleur du curseur viennent
// tous de `lireVital`.
import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "../../apps/console/lib/rating";
import { intervalleP75Lu } from "../../apps/console/lib/stats/incertitude";
import { echelleJauge, lireVital } from "../../apps/console/lib/vital-lecture";

const [BON, MAUVAIS] = THRESHOLDS.LCP;
const intervalle = (bas: number, haut: number) =>
  ({ bas, haut, niveau: 0.95, methode: "quantile_exact" }) as const;

describe("lireVital", () => {
  it("la moustache porte exactement les bornes de l'intervalle, sur l'échelle de la jauge", () => {
    const l = lireVital("LCP", 2000, 20, intervalle(1800, 2300));
    const max = echelleJauge("LCP")!;
    expect(max).toBe(MAUVAIS * 1.4);
    expect(l.moustache).toEqual({ basPct: (1800 / max) * 100, hautPct: (2300 / max) * 100, auDela: false });
    expect(l.texteIntervalle).toBe("entre 1,80 s et 2,30 s (95 %)");
    expect(l.verdict).toEqual({ kind: "etabli", rating: "good" });
  });

  it("un intervalle qui chevauche la borne Bon : verdict incertain, pas de couleur", () => {
    const l = lireVital("LCP", 2400, 20, intervalle(2100, BON + 500));
    expect(l.verdict).toEqual({ kind: "incertain", de: "good", a: "needs-improvement" });
    expect(l.ariaLabel).toContain("verdict incertain : entre Bon et À améliorer");
    expect(l.ariaLabel).toContain("20 mesures");
  });

  it("intervalle indisponible : pas de moustache, verdict non établi", () => {
    const l = lireVital("LCP", 2400, 7, { indisponible: "7 mesures, 13 requises" });
    expect(l.moustache).toBeNull();
    expect(l.verdict).toEqual({ kind: "non_etabli", raison: "7 mesures, 13 requises" });
    expect(l.texteIntervalle).toBe("intervalle non calculable : 7 mesures, 13 requises");
  });

  it("borne haute au-delà de l'échelle : rognée sur la jauge, et dit dans le texte", () => {
    const l = lireVital("LCP", 4500, 20, intervalle(3500, 9000));
    expect(l.moustache?.hautPct).toBe(100);
    expect(l.moustache?.auDela).toBe(true);
    expect(l.texteIntervalle).toContain("au-delà de l'échelle");
  });

  it("sans intervalle fourni : le comportement d'avant, verdict de la p75", () => {
    expect(lireVital("LCP", 2000, 50).verdict).toEqual({ kind: "etabli", rating: "good" });
    expect(lireVital("LCP", null, 0).verdict).toBeNull();
  });
});

describe("intervalleP75Lu — ce que lit vitalsP75", () => {
  it("sous 30 mesures : rangs exacts sur les valeurs triées ; sous 13 : refus", () => {
    const v = Array.from({ length: 20 }, (_, i) => 1000 + i * 100);
    // n = 20 → rangs exacts (11, 19) : la 11ᵉ et la 19ᵉ valeur.
    expect(intervalleP75Lu(20, v, null, null)).toEqual({ bas: 2000, haut: 2800, niveau: 0.95, methode: "quantile_exact" });
    expect(intervalleP75Lu(7, v.slice(0, 7), null, null)).toEqual({ indisponible: "7 mesures, 13 requises" });
  });
  it("à partir de 30 : les deux statistiques d'ordre lues en SQL", () => {
    expect(intervalleP75Lu(40, null, 1900, 2600)).toEqual({ bas: 1900, haut: 2600, niveau: 0.95, methode: "quantile_normal" });
    expect(intervalleP75Lu(40, null, null, null)).toEqual({ indisponible: "bornes de l'intervalle non lues" });
  });
});
