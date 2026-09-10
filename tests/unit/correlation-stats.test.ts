// Le noyau statistique de la matrice de corrélation.
//
// TOUT EST VÉRIFIÉ CONTRE DES VALEURS DE RÉFÉRENCE EXTÉRIEURES, jamais contre
// le module lui-même : le quartet d'Anscombe pour Pearson, la table de Student
// pour les p-valeurs. Un test statistique qui se compare à sa propre sortie ne
// prouve que sa stabilité, pas sa justesse.
import { describe, expect, it } from "vitest";
import {
  MIN_POINTS,
  apparier,
  betaIncomplete,
  correler,
  correlerAvecDecalage,
  pValeurCorrelation,
  pValeurStudent,
  pearson,
  rangs,
  spearman,
} from "../../apps/console/lib/correlation-stats";
import { surEchec } from "../outils/diagnostic";

const serie = (vs: (number | null)[]) => vs.map((v, i) => ({ t: i, v }));

// ═══════════════════════════ Pearson ═══════════════════════════════════════

describe("pearson, contre le quartet d'Anscombe", () => {
  // Quatre jeux construits en 1973 pour avoir la MÊME corrélation (0,816) avec
  // des formes radicalement différentes. C'est la référence canonique, et c'est
  // aussi la démonstration que Pearson seul ne suffit pas à décrire un lien.
  const X1 = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
  const Y1 = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];
  const Y2 = [9.14, 8.14, 8.74, 8.77, 9.26, 8.1, 6.13, 3.1, 9.13, 7.26, 4.74];
  const Y3 = [7.46, 6.77, 12.74, 7.11, 7.81, 8.84, 6.08, 5.39, 8.15, 6.42, 5.73];
  const X4 = [8, 8, 8, 8, 8, 8, 8, 19, 8, 8, 8];
  const Y4 = [6.58, 5.76, 7.71, 8.84, 8.47, 7.04, 5.25, 12.5, 5.56, 7.91, 6.89];

  it.each([
    ["I", X1, Y1],
    ["II", X1, Y2],
    ["III", X1, Y3],
    ["IV", X4, Y4],
  ])("jeu %s → r ≈ 0,8165", (nom, xs, ys) => {
    // 0,8165 et non 0,816 : la valeur publiée a quatre décimales, et les jeux
    // I à III donnent 0,81642 quand le IV donne 0,81652. Arrondir la référence
    // à trois décimales ferait rougir le IV pour cinq cent-millièmes — un test
    // qui échoue sur sa propre imprécision, pas sur celle du code.
    surEchec(`Anscombe ${nom}`, () => ({ r: pearson(xs, ys), attendu: 0.8165 }));
    expect(pearson(xs, ys)!).toBeCloseTo(0.8165, 3);
  });

  it("mais Spearman les DISTINGUE — c'est pour ça qu'on rend les deux", () => {
    // Le jeu II est une parabole : monotone par morceaux seulement. Le jeu IV
    // n'est qu'un point aberrant. Si les deux coefficients divergent, la forme
    // n'est pas linéaire, et l'utilisateur doit pouvoir le voir.
    const rhos = [Y1, Y2, Y3, Y4].map((ys, i) => spearman(i === 3 ? X4 : X1, ys)!);
    surEchec("Spearman doit varier là où Pearson ne varie pas", () => ({ rhos }));
    const ecart = Math.max(...rhos) - Math.min(...rhos);
    expect(ecart).toBeGreaterThan(0.2);
  });
});

describe("pearson, les cas où il n'y a rien à dire", () => {
  it("colinéaire parfait → 1 et −1, jamais 1,0000000002", () => {
    // Un |r| > 1 ferait ensuite prendre la racine d'un négatif dans la p-valeur.
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBe(1);
    expect(pearson([1, 2, 3, 4], [-2, -4, -6, -8])).toBe(-1);
  });

  it("une série CONSTANTE rend null, pas 0", () => {
    // « 0 » se lirait « aucune corrélation ». La vérité est qu'une des deux ne
    // varie pas : la question n'a pas de réponse.
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });

  it("longueurs différentes ou série trop courte → null", () => {
    expect(pearson([1, 2], [1])).toBeNull();
    expect(pearson([1], [1])).toBeNull();
  });
});

// ═══════════════════════════ Rangs et Spearman ═════════════════════════════

describe("rangs", () => {
  it("les ex æquo partagent la MOYENNE de leurs rangs", () => {
    // Sans ça, une série qui reste au même niveau toute la journée produirait
    // des rangs dépendant de l'ordre d'arrivée — donc une corrélation inventée.
    expect(rangs([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(rangs([5, 5, 5])).toEqual([2, 2, 2]);
  });

  it("Spearman vaut 1 sur n'importe quelle relation croissante, même courbe", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(spearman(xs, xs.map((x) => x ** 3))!).toBeCloseTo(1, 12);
    // Pearson, lui, ne vaut PAS 1 : c'est exactement la différence entre les deux.
    expect(pearson(xs, xs.map((x) => x ** 3))!).toBeLessThan(0.98);
  });
});

// ═══════════════════════ p-valeurs, contre la table de Student ══════════════

describe("p-valeur de Student, contre la table publiée", () => {
  // Valeurs critiques bilatérales classiques. Si l'implémentation de la fonction
  // bêta incomplète dérive, ces lignes rougissent.
  it.each([
    [12.706, 1, 0.05],
    [4.303, 2, 0.05],
    [2.306, 8, 0.05],
    [2.228, 10, 0.05],
    [1.812, 10, 0.1],
    [2.086, 20, 0.05],
    [2.042, 30, 0.05],
    [2.845, 20, 0.01],
  ])("t=%s df=%s → p ≈ %s", (t, df, attendu) => {
    surEchec(`Student t=${t} df=${df}`, () => ({ calcule: pValeurStudent(t, df), attendu }));
    expect(pValeurStudent(t, df)).toBeCloseTo(attendu, 3);
  });

  it("t = 0 → p = 1 : aucune preuve contre l'hypothèse nulle", () => {
    expect(pValeurStudent(0, 10)).toBeCloseTo(1, 12);
  });

  it("est symétrique en t — le SENS de la corrélation ne change pas sa significativité", () => {
    expect(pValeurStudent(2.5, 12)).toBeCloseTo(pValeurStudent(-2.5, 12), 12);
  });
});

describe("bêta incomplète, contre des valeurs analytiques connues", () => {
  it("I_x(1,1) = x — le cas uniforme", () => {
    for (const x of [0.1, 0.25, 0.5, 0.9]) expect(betaIncomplete(1, 1, x)).toBeCloseTo(x, 12);
  });

  it("I_x(a,b) = 1 − I_{1−x}(b,a) — la symétrie qui fait basculer les deux branches", () => {
    // Les deux côtés du point de bascule de la fraction continue doivent se
    // raccorder : c'est là qu'une implémentation fautive se voit.
    for (const [a, b, x] of [[2, 5, 0.3], [5, 2, 0.7], [0.5, 4, 0.9], [4, 0.5, 0.1]] as const) {
      expect(betaIncomplete(a, b, x)).toBeCloseTo(1 - betaIncomplete(b, a, 1 - x), 10);
    }
  });

  it("borne les extrêmes sans lever", () => {
    expect(betaIncomplete(2, 3, 0)).toBe(0);
    expect(betaIncomplete(2, 3, 1)).toBe(1);
  });
});

describe("p-valeur d'une corrélation", () => {
  it("|r| = 1 → p = 0, sans NaN", () => {
    // (n−2)/(1−r²) diverge ; la limite est bien une p-valeur nulle.
    expect(pValeurCorrelation(1, 10)).toBe(0);
    expect(pValeurCorrelation(-1, 10)).toBe(0);
  });

  it("JUSTIFIE le seuil MIN_POINTS annoncé dans le module", () => {
    // Le commentaire affirme qu'à n = 8 il faut |r| ≥ 0,707 pour atteindre 5 %.
    // Une affirmation chiffrée dans un commentaire doit être vérifiable.
    surEchec("seuil critique à n = 8", () => ({
      "p pour r=0,707": pValeurCorrelation(0.707, MIN_POINTS),
      "p pour r=0,70": pValeurCorrelation(0.7, MIN_POINTS),
    }));
    expect(pValeurCorrelation(0.707, MIN_POINTS)!).toBeLessThanOrEqual(0.05);
    expect(pValeurCorrelation(0.7, MIN_POINTS)!).toBeGreaterThan(0.05);
  });
});

// ═══════════════════════════ Appariement ════════════════════════════════════

describe("apparier ne corrèle que ce qui coïncide, et dit ce qu'il jette", () => {
  it("ne garde que les instants présents des deux côtés", () => {
    const a = [{ t: "h1", v: 1 }, { t: "h2", v: 2 }, { t: "h3", v: 3 }];
    const b = [{ t: "h2", v: 20 }, { t: "h3", v: 30 }, { t: "h9", v: 90 }];
    const { xs, ys, ecartes } = apparier(a, b);
    expect(xs).toEqual([2, 3]);
    expect(ys).toEqual([20, 30]);
    // h1 à gauche, h9 à droite : deux écartés.
    expect(ecartes).toBe(2);
  });

  it("écarte les valeurs nulles et non finies SANS les compter comme appariées", () => {
    const a = [{ t: 1, v: null }, { t: 2, v: NaN }, { t: 3, v: 5 }];
    const b = [{ t: 1, v: 10 }, { t: 2, v: 20 }, { t: 3, v: 50 }];
    const { xs, ys } = apparier(a, b);
    expect(xs).toEqual([5]);
    expect(ys).toEqual([50]);
  });
});

// ═══════════════════════════ Le verdict ═════════════════════════════════════

describe("correler refuse de conclure quand il ne peut pas", () => {
  it("moins de MIN_POINTS → verdict « insuffisant », aucun coefficient", () => {
    // Le piège n°1 d'une matrice de corrélation : un 0,95 magnifique sur 4 points.
    const a = serie([1, 2, 3, 4, 5]);
    const b = serie([2, 4, 6, 8, 10]);
    const c = correler(a, b);
    surEchec("5 points ne doivent pas produire de coefficient", () => ({ c }));
    expect(c.verdict).toBe("insuffisant");
    expect(c.pearson).toBeNull();
    expect(c.n).toBe(5);
  });

  it("série plate → « aucune_variation », pas « pas de corrélation »", () => {
    const a = serie([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    const b = serie([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(correler(a, b).verdict).toBe("aucune_variation");
  });

  it("relation forte et assez de points → « significatif »", () => {
    const a = serie([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const b = serie([2.1, 3.9, 6.2, 8.1, 9.8, 12.2, 13.9, 16.1, 18.2, 19.9]);
    const c = correler(a, b);
    expect(c.verdict).toBe("significatif");
    expect(c.pearson!).toBeGreaterThan(0.99);
    expect(c.p!).toBeLessThan(0.001);
  });

  it("bruit pur et assez de points → « non_significatif », et le coefficient EST rendu", () => {
    // On rend quand même le coefficient : le cacher empêcherait de voir qu'il
    // est proche de zéro, ce qui est une information.
    const a = serie([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8]);
    const b = serie([2, 7, 1, 8, 2, 8, 1, 8, 2, 8, 4, 5]);
    const c = correler(a, b);
    expect(c.verdict).toBe("non_significatif");
    expect(c.pearson).not.toBeNull();
    expect(c.significatif).toBe(false);
  });
});

describe("décalage temporel", () => {
  it("retrouve un décalage INJECTÉ, et son signe", () => {
    // b est a décalé de 2 seaux vers l'avant : le meilleur alignement doit se
    // trouver à ±2, pas à 0. C'est ce qui répond à « qui voit la dégradation
    // en premier, le robot ou l'utilisateur ».
    const base = [1, 3, 2, 8, 9, 4, 2, 1, 5, 7, 8, 3, 2, 6, 9, 4];
    const a = serie(base);
    const b = serie([0, 0, ...base.slice(0, base.length - 2)]);
    const { meilleur, tous } = correlerAvecDecalage(a, b, 4);
    surEchec("le décalage injecté doit ressortir", () => ({
      meilleur: meilleur && { decalage: meilleur.decalage, r: meilleur.correlation.pearson },
      profil: tous.map((t) => `${t.decalage}:${t.correlation.pearson?.toFixed(2) ?? "—"}`).join(" "),
    }));
    expect(meilleur).not.toBeNull();
    expect(Math.abs(meilleur!.decalage)).toBe(2);
    expect(Math.abs(meilleur!.correlation.pearson!)).toBeGreaterThan(0.95);
  });

  it("ordonne les instants NUMÉRIQUEMENT, pas lexicographiquement", () => {
    // Le bug d'origine : String().sort() donne 0, 1, 10, 11, …, 2, 3. « Décaler
    // d'un seau » décalait alors d'une position arbitraire, et la fonction
    // rendait un décalage plausible mais faux. Il faut plus de dix points pour
    // que ça se voie — c'est pour ça que ça avait passé la relecture.
    const base = [1, 3, 2, 8, 9, 4, 2, 1, 5, 7, 8, 3, 2, 6, 9, 4, 7, 2, 5, 8];
    const a = serie(base);
    const b = serie([0, 0, 0, ...base.slice(0, base.length - 3)]);
    const { meilleur } = correlerAvecDecalage(a, b, 5);
    surEchec("décalage de 3 sur 20 points numérotés 0..19", () => ({ meilleur }));
    expect(meilleur!.decalage).toBe(3);
  });

  it("ne rend AUCUN meilleur décalage quand rien n'est significatif", () => {
    // Sans ce refus, on afficherait toujours un « meilleur » décalage, y compris
    // sur du bruit — la forme la plus convaincante de mensonge statistique.
    const a = serie([1, 2, 1, 2, 1, 2, 1, 2, 1, 2]);
    const b = serie([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(correlerAvecDecalage(a, b, 3).meilleur).toBeNull();
  });
});
