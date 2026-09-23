// Concordance robot ↔ réel (P*.8) : le ρ de Spearman, son intervalle de Fisher,
// son refus sous 10 jours communs et les phrases qui l'accompagnent.
//
// Le coefficient est vérifié contre la formule des différences de rangs
// 1 − 6 Σd² / (n(n² − 1)), calculée ici, indépendante de l'implémentation (qui,
// elle, passe par un Pearson sur les rangs — le seul calcul correct avec des
// ex-aequo).
import { describe, expect, it } from "vitest";
import {
  concordance,
  fmtRho,
  intervalleFisher,
  joursCommuns,
  JOURS_MIN_CONCORDANCE,
  LIBELLE_ISSUE,
  MENTION_RHO,
  MESURES_MIN_JOUR,
  phraseConcordance,
  rangsMoyens,
  regleConcordance,
  SEUIL_SUIT,
  spearman,
  texteConcordanceCourt,
  type JourCommun,
} from "../../apps/console/lib/stats/concordance";

/** ρ par la formule des différences de rangs — valable SANS ex-aequo. */
function rhoParDifferences(x: readonly number[], y: readonly number[]): number {
  const rang = (v: readonly number[]) => v.map((a) => v.filter((b) => b < a).length + 1);
  const rx = rang(x);
  const ry = rang(y);
  const n = x.length;
  const somme = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0);
  return 1 - (6 * somme) / (n * (n * n - 1));
}

const ROBOT = [800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200, 1250, 1300, 1350];
/** Même sens que le robot, à quelques inversions près : le robot suit. */
const REEL_SUIT = [2000, 2100, 1900, 2300, 2200, 2500, 2400, 2700, 2600, 3000, 2900, 3100];
/** Sens inverse : le robot ne suit pas (ce n'est pas « pas de lien »). */
const REEL_CONTRE = [3100, 2900, 3000, 2600, 2700, 2400, 2500, 2200, 2300, 2000, 2100, 1900];

const jours = (robot: readonly number[], reel: readonly number[]): JourCommun[] =>
  robot.map((r, i) => ({ robot: r, reel: reel[i] }));

describe("rangs et coefficient de Spearman", () => {
  it("ex-aequo : rangs MOYENS, jamais l'ordre d'arrivée", () => {
    expect(rangsMoyens([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(rangsMoyens([5, 5, 5])).toEqual([2, 2, 2]);
    expect(rangsMoyens([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it("séries monotones : ρ = 1 dans le même sens, −1 en sens inverse", () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBe(1);
    expect(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBe(-1);
    // Les ÉCHELLES ne comptent pas : seul l'ordre est lu.
    expect(spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 10_000])).toBe(1);
  });

  it("sans ex-aequo : même valeur que la formule des différences de rangs", () => {
    expect(spearman(ROBOT, REEL_SUIT)).toBeCloseTo(rhoParDifferences(ROBOT, REEL_SUIT), 12);
    expect(spearman(ROBOT, REEL_SUIT)).toBeCloseTo(0.951048951, 9);
    expect(spearman(ROBOT, REEL_CONTRE)).toBeCloseTo(rhoParDifferences(ROBOT, REEL_CONTRE), 12);
  });

  it("avec ex-aequo : Pearson sur les rangs moyens, pas la formule abrégée", () => {
    const x = [1, 2, 3, 4];
    const y = [10, 20, 20, 30];
    // Rangs : x = 1,2,3,4 ; y = 1 ; 2,5 ; 2,5 ; 4 → Pearson de ces deux vecteurs.
    const rx = [1, 2, 3, 4];
    const ry = [1, 2.5, 2.5, 4];
    const moy = (v: number[]) => v.reduce((s, a) => s + a, 0) / v.length;
    const mx = moy(rx);
    const my = moy(ry);
    const num = rx.reduce((s, a, i) => s + (a - mx) * (ry[i] - my), 0);
    const den = Math.sqrt(rx.reduce((s, a) => s + (a - mx) ** 2, 0) * ry.reduce((s, a) => s + (a - my) ** 2, 0));
    expect(spearman(x, y)).toBeCloseTo(num / den, 12);
    // La formule abrégée donnerait 1 − 6·0,5/(4·15) = 0,95 : elle est fausse ici.
    expect(spearman(x, y)).not.toBeCloseTo(0.95, 3);
  });

  it("une série constante : aucun ordre à comparer, `null` et non 0", () => {
    expect(spearman([1, 2, 3, 4], [7, 7, 7, 7])).toBeNull();
    expect(spearman([1, 2], [3, 4])).toBeNull(); // moins de 3 points
  });
});

describe("intervalle de Fisher", () => {
  it("l'exemple du plan : ρ = 0,71 sur 12 jours → entre 0,21 et 0,92", () => {
    const i = intervalleFisher(0.71, 12);
    expect(i.bas).toBeCloseTo(0.2113041, 6);
    expect(i.haut).toBeCloseTo(0.9153932, 6);
    expect(i.methode).toBe("fisher");
    expect(fmtRho(i.bas)).toBe("0,21");
    expect(fmtRho(i.haut)).toBe("0,92");
  });

  it("l'intervalle rétrécit quand les jours s'ajoutent", () => {
    const large = intervalleFisher(0.6, 10);
    const serre = intervalleFisher(0.6, 30);
    expect(serre.haut - serre.bas).toBeLessThan(large.haut - large.bas);
  });

  it("à |ρ| = 1, aucune NaN : l'intervalle se réduit au point", () => {
    const i = intervalleFisher(1, 12);
    expect(Number.isNaN(i.bas)).toBe(false);
    expect(i.bas).toBeCloseTo(1, 6);
    expect(i.haut).toBeCloseTo(1, 6);
  });
});

describe("jours communs", () => {
  it("un jour ne compte qu'avec un passage du robot ET assez de mesures réelles", () => {
    expect(MESURES_MIN_JOUR).toBe(13);
    const lus = [
      { robot: 800, reel: 2000, mesures: 40 }, // retenu
      { robot: null, reel: 2000, mesures: 40 }, // aucun passage du robot
      { robot: 800, reel: null, mesures: 0 }, // aucune mesure réelle
      { robot: 800, reel: 2000, mesures: 12 }, // sous le minimum de la p75
      { robot: 800, reel: 2000, mesures: null }, // effectif non lu
      { robot: 900, reel: 2100, mesures: 13 }, // retenu, à la limite
    ];
    expect(joursCommuns(lus)).toEqual([
      { robot: 800, reel: 2000 },
      { robot: 900, reel: 2100 },
    ]);
    // L'effectif minimal est un paramètre, jamais un littéral recopié à l'écran.
    expect(joursCommuns(lus, 12)).toHaveLength(3);
  });
});

describe("concordance : trois issues et refus chiffré", () => {
  it("9 jours communs : refus, avec ce qui manque en nombre", () => {
    const res = concordance(jours(ROBOT.slice(0, 9), REEL_SUIT.slice(0, 9)));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.raison).toBe("9 jours communs, 10 requis");
    expect(res.manque).toEqual({ requis: 10, observe: 9, unite: "jours communs" });
    expect(texteConcordanceCourt(res)).toBe("Concordance non calculée : 9 jours communs, 10 requis");
    expect(JOURS_MIN_CONCORDANCE).toBe(10);
  });

  it("aucun jour commun : refus au singulier, jamais une case vide", () => {
    const res = concordance([]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(texteConcordanceCourt(res)).toBe("Concordance non calculée : 0 jour commun, 10 requis");
  });

  it("le robot suit : borne basse au-dessus du seuil", () => {
    const res = concordance(jours(ROBOT, REEL_SUIT));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.n).toBe(12);
    expect(res.rho).toBeCloseTo(0.951049, 6);
    expect(res.intervalle.bas).toBeCloseTo(0.824273, 6);
    expect(res.intervalle.haut).toBeCloseTo(0.987015, 6);
    expect(res.issue).toBe("suit");
    expect(res.seuil).toBe(SEUIL_SUIT);
    expect(res.degenere).toBe(false);
    expect(texteConcordanceCourt(res)).toBe("ρ 0,95 (0,82 à 0,99)");
  });

  it("le robot ne suit pas : borne haute sous le seuil (ce n'est pas « pas de lien »)", () => {
    const res = concordance(jours(ROBOT, REEL_CONTRE));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rho).toBeCloseTo(-0.965035, 6);
    expect(res.intervalle.haut).toBeLessThan(SEUIL_SUIT);
    expect(res.issue).toBe("ne_suit_pas");
  });

  it("intervalle à cheval sur le seuil : rien n'est établi", () => {
    // Un ex-aequo réel (2 000 ms deux jours) et un ordre brouillé.
    const reel = [2600, 2000, 3100, 2100, 2900, 2200, 2400, 2000, 2700, 2050, 2500, 2300];
    const res = concordance(jours(ROBOT, reel));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rho).toBeCloseTo(-0.119089, 6);
    expect(res.intervalle.bas).toBeLessThan(SEUIL_SUIT);
    expect(res.intervalle.haut).toBeGreaterThan(SEUIL_SUIT);
    expect(res.issue).toBe("non_etabli");
  });

  it("ordre parfaitement identique : ρ = 1, dégénéré, et c'est dit", () => {
    const res = concordance(jours(ROBOT, [...ROBOT].map((r) => r * 3)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rho).toBe(1);
    expect(res.degenere).toBe(true);
    expect(res.issue).toBe("suit");
    expect(texteConcordanceCourt(res)).toBe("ρ 1,00 (intervalle réduit à ce point)");
  });

  it("deux séries sans variation : refus, pas un ρ de 0", () => {
    const res = concordance(jours(ROBOT, new Array(12).fill(2000)));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.raison).toContain("ne varie pas");
  });

  it("le seuil et le nombre de jours sont des paramètres, pas des littéraux", () => {
    const res = concordance(jours(ROBOT.slice(0, 9), REEL_SUIT.slice(0, 9)), { joursMin: 9, seuil: 0.9 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.n).toBe(9); // le refus est levé par le paramètre, pas par la donnée
    expect(res.seuil).toBe(0.9);
    // Neuf jours élargissent l'intervalle : il enjambe un seuil de 0,90.
    expect(res.issue).toBe("non_etabli");
  });
});

describe("phrases affichées", () => {
  it("la phrase du plan, mot pour mot", () => {
    const phrase = phraseConcordance({
      ok: true,
      rho: 0.71,
      n: 12,
      intervalle: intervalleFisher(0.71, 12),
      issue: "suit",
      seuil: SEUIL_SUIT,
      degenere: false,
    });
    expect(phrase).toBe(
      "Sur 12 jours communs, le robot et le réel évoluent ensemble (ρ de Spearman = 0,71, entre 0,21 et 0,92). " +
        "ρ mesure si les deux montent et descendent ensemble, pas si leurs valeurs sont égales.",
    );
  });

  it("la mention accompagne AUSSI un refus : on ne laisse jamais croire à un écart", () => {
    const phrase = phraseConcordance(concordance(jours(ROBOT.slice(0, 4), REEL_SUIT.slice(0, 4))));
    expect(phrase).toBe(`Concordance non calculée : 4 jours communs, 10 requis. ${MENTION_RHO}`);
    expect(phrase).toContain("pas si leurs valeurs sont égales");
  });

  it("la règle écrite à l'écran nomme le seuil comme un choix, et ses volumes", () => {
    const regle = regleConcordance();
    expect(regle).toContain("Spearman");
    expect(regle).toContain("0,30 est un choix de produit");
    expect(regle).toContain("au moins 13 mesures LCP réelles");
    expect(regle).toContain("il en faut 10");
    // Aucun écart, aucune soustraction : le mot n'y est pas.
    expect(regle).not.toContain("écart");
  });

  it("les issues s'écrivent en toutes lettres", () => {
    expect(LIBELLE_ISSUE).toEqual({ suit: "suit", ne_suit_pas: "ne suit pas", non_etabli: "non établi" });
  });

  it("un coefficient s'écrit à deux décimales, virgule française", () => {
    expect(fmtRho(-0.119089)).toBe("-0,12");
    expect(fmtRho(0)).toBe("0,00");
    expect(fmtRho(1)).toBe("1,00");
  });
});
