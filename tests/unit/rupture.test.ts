// P*.7 — datation d'une rupture, test de Pettitt (plan § 7.2). Logique pure.
//
// Ce que ces cas verrouillent :
//   - une marche d'escalier nette est datée au BON jour, avec ses deux médianes ;
//   - une série sans marche n'est pas datée (et le p est rendu quand même) ;
//   - le refus CHIFFRÉ sous 10 jours valides (RM2), et les jours creux écartés ;
//   - la limite du test à 10 jours : même une marche parfaite n'y descend pas
//     sous 0,05 — l'écran n'a pas le droit de laisser croire le contraire ;
//   - un déploiement à 2 jours n'est pas cité, à 1 jour il l'est ;
//   - RM5 : aucun texte produit par le module ne parle de cause ni de responsable.
import { describe, expect, it } from "vitest";
import {
  ECART_DEPLOIEMENT_JOURS,
  JOURS_VALIDES_REQUIS_RUPTURE,
  MESURES_MIN_JOUR_RUPTURE,
  annotationRupture,
  daterRupture,
  deploiementCoincident,
  ecartJours,
  jourCourt,
  mediane,
  pettitt,
  phraseRupture,
  phraseSansRupture,
  type JourMesure,
} from "../../apps/console/lib/stats/rupture";

/** Jours « 2026-09-01 », « 2026-09-02 »… (le mois de septembre en compte 30). */
function jours(n: number, depuis = 1): string[] {
  return Array.from({ length: n }, (_v, i) => `2026-09-${String(depuis + i).padStart(2, "0")}`);
}

/** Une série quotidienne dont tous les jours sont valides (effectif au-dessus du minimum). */
function serie(valeurs: readonly number[], effectif = 200): JourMesure[] {
  return jours(valeurs.length).map((jour, i) => ({ jour, valeur: valeurs[i], effectif }));
}

const ms = (v: number) => `${v} ms`;

describe("pettitt", () => {
  it("marche parfaite sur 14 points : K = 49 au dernier jour de l'ancien niveau, p ≈ 0,015", () => {
    const xs = [...Array(7).fill(1900), ...Array(7).fill(2700)];
    const t = pettitt(xs)!;
    expect(t.t).toBe(6);
    expect(t.K).toBe(49);
    // 2·exp(−6·49² / (14³ + 14²)) = 2·exp(−4,9).
    expect(t.p).toBeCloseTo(2 * Math.exp(-4.9), 12);
    expect(t.p).toBeLessThan(0.05);
  });

  it("série plate : aucune séparation, K = 0 et p borné à 1 (jamais 2)", () => {
    const t = pettitt(Array(12).fill(1500))!;
    expect(t.K).toBe(0);
    expect(t.p).toBe(1);
  });

  it("sous deux points, ou avec une valeur illisible : null, jamais un p inventé", () => {
    expect(pettitt([])).toBeNull();
    expect(pettitt([1200])).toBeNull();
    expect(pettitt([1200, Number.NaN, 1400])).toBeNull();
  });

  it("la marche à la baisse est datée au même endroit que la marche à la hausse", () => {
    const monte = pettitt([...Array(6).fill(1000), ...Array(6).fill(2000)])!;
    const descend = pettitt([...Array(6).fill(2000), ...Array(6).fill(1000)])!;
    expect(descend.t).toBe(monte.t);
    expect(descend.K).toBe(monte.K);
    expect(descend.p).toBeCloseTo(monte.p, 12);
  });
});

describe("daterRupture — marche d'escalier", () => {
  const d = daterRupture(serie([...Array(6).fill(1900), ...Array(8).fill(2700)]));

  it("date la rupture au premier jour du nouveau niveau", () => {
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.rupture).not.toBeNull();
    expect(d.rupture!.jour).toBe("2026-09-07");
    expect(d.rupture!.jourPrecedent).toBe("2026-09-06");
    expect(d.rupture!.sens).toBe("hausse");
  });

  it("rend les deux médianes et les effectifs de jours des deux segments", () => {
    if (!d.ok || !d.rupture) return expect.fail("rupture attendue");
    expect(d.rupture.medianeAvant).toBe(1900);
    expect(d.rupture.medianeApres).toBe(2700);
    expect(d.rupture.joursAvant).toBe(6);
    expect(d.rupture.joursApres).toBe(8);
    expect(d.rupture.joursValides).toBe(14);
    expect(d.rupture.p).toBeLessThan(0.05);
  });
});

describe("daterRupture — ce qui n'est pas une rupture", () => {
  it("bruit sans changement de niveau : aucune rupture, et le p est rendu quand même", () => {
    const d = daterRupture(serie([2000, 2100, 1950, 2050, 1980, 2120, 2010, 1970, 2080, 2030, 1990, 2060, 2000, 2040]));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.rupture).toBeNull();
    expect(d.p).not.toBeNull();
    expect(d.p!).toBeGreaterThan(0.05);
    expect(d.joursValides).toBe(14);
  });

  it("série plate : p = 1, aucune rupture", () => {
    const d = daterRupture(serie(Array(12).fill(1500)));
    expect(d.ok && d.rupture).toBeNull();
    expect(d.ok && d.p).toBe(1);
  });

  it("à 10 jours valides, même une marche parfaite reste au-dessus de 0,05 : le test ne peut pas trancher", () => {
    const d = daterRupture(serie([...Array(5).fill(1000), ...Array(5).fill(3000)]));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.rupture).toBeNull();
    // K maximal à n = 10 : 25 → p = 2·exp(−6·25² / 1100) ≈ 0,066.
    expect(d.p!).toBeCloseTo(2 * Math.exp(-3750 / 1100), 12);
    expect(d.p!).toBeGreaterThan(0.05);
  });
});

describe("daterRupture — refus chiffré (RM2)", () => {
  it("neuf jours valides : refus qui dit les deux nombres, jamais une rupture par défaut", () => {
    const d = daterRupture(serie([...Array(4).fill(1900), ...Array(5).fill(2700)]));
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.raison).toBe("datation non tentée : 9 jours valides, 10 requis");
    expect(d.manque).toEqual({ requis: JOURS_VALIDES_REQUIS_RUPTURE, observe: 9, unite: "jours valides" });
  });

  it("les jours creux et les trous ne comptent pas comme des jours valides", () => {
    const valeurs = [...Array(6).fill(1900), ...Array(8).fill(2700)];
    const creuse = serie(valeurs).map((j, i) => (i % 2 === 0 ? { ...j, effectif: MESURES_MIN_JOUR_RUPTURE - 1 } : j));
    const d = daterRupture(creuse);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.manque.observe).toBe(7);

    const trouee = serie(valeurs).map((j, i) => (i < 5 ? { ...j, valeur: null } : j));
    const t = daterRupture(trouee);
    expect(t.ok).toBe(false);
    if (t.ok) return;
    expect(t.manque.observe).toBe(9);
  });

  it("un jour sans effectif déclaré est accepté : l'appelant a déjà filtré", () => {
    const d = daterRupture(jours(14).map((jour, i) => ({ jour, valeur: i < 6 ? 1900 : 2700 })));
    expect(d.ok && d.rupture?.jour).toBe("2026-09-07");
  });
});

describe("deploiementCoincident", () => {
  const liste = [
    { jour: "2026-09-16", version: "1.4.2" },
    { jour: "2026-09-12", version: "1.4.1" },
  ];

  it("un déploiement le jour même est cité", () => {
    expect(deploiementCoincident("2026-09-16", liste)).toEqual({ jour: "2026-09-16", version: "1.4.2" });
  });

  it("un déploiement à un jour est cité ; à deux jours, il ne l'est pas", () => {
    expect(deploiementCoincident("2026-09-17", liste)?.version).toBe("1.4.2");
    expect(deploiementCoincident("2026-09-15", liste)?.version).toBe("1.4.2");
    expect(deploiementCoincident("2026-09-14", liste)).toBeNull();
    expect(deploiementCoincident("2026-09-18", liste)).toBeNull();
    expect(ECART_DEPLOIEMENT_JOURS).toBe(1);
  });

  it("à égalité de distance, celui qui porte une version (il est le seul nommable)", () => {
    const deux = [
      { jour: "2026-09-15", version: null },
      { jour: "2026-09-17", version: "1.4.2" },
    ];
    expect(deploiementCoincident("2026-09-16", deux)?.version).toBe("1.4.2");
  });

  it("aucun déploiement, ou un jour illisible : null", () => {
    expect(deploiementCoincident("2026-09-16", [])).toBeNull();
    expect(deploiementCoincident("2026-09-16", [{ jour: "hier", version: "1.0" }])).toBeNull();
  });
});

describe("outils de série", () => {
  it("mediane : centre d'une liste impaire, moyenne des deux centres d'une paire", () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([4, 1, 3, 2])).toBe(2.5);
    expect(mediane([7])).toBe(7);
  });

  it("jourCourt et ecartJours lisent des étiquettes, sans fuseau", () => {
    expect(jourCourt("2026-09-16")).toBe("16/09");
    expect(jourCourt("")).toBe("—");
    expect(ecartJours("2026-10-01", "2026-09-30")).toBe(1);
    expect(ecartJours("2026-09-30", "2026-10-01")).toBe(-1);
  });
});

describe("textes publiés", () => {
  const d = daterRupture(serie([...Array(5).fill(1900), ...Array(9).fill(2700)]));

  it("la phrase dit les deux médianes, le test, le p et les jours valides", () => {
    if (!d.ok || !d.rupture) return expect.fail("rupture attendue");
    const texte = phraseRupture(d.rupture, "Le LCP p75", ms, { jour: "2026-09-06", version: "1.4.2" });
    expect(texte).toBe(
      "Le LCP p75 a changé de niveau autour du 06/09 : médiane des p75 quotidiennes de 1900 ms sur les 5 jours " +
        "d'avant, 2700 ms sur les 9 jours d'après (test de Pettitt, p = 0,032, 14 jours valides). " +
        "Un déploiement (1.4.2) a eu lieu le 06/09 : coïncidence de date.",
    );
  });

  it("sans déploiement proche, la phrase s'arrête au test ; un déploiement sans version est nommé comme tel", () => {
    if (!d.ok || !d.rupture) return expect.fail("rupture attendue");
    expect(phraseRupture(d.rupture, "Le LCP p75", ms)).not.toMatch(/déploiement/);
    expect(phraseRupture(d.rupture, "Le LCP p75", ms, { jour: "2026-09-06", version: null })).toContain(
      "Un déploiement sans version a eu lieu le 06/09",
    );
  });

  it("sans rupture, le texte change selon qu'une tendance est établie par ailleurs", () => {
    const plate = daterRupture(serie(Array(12).fill(1500)));
    if (!plate.ok) return expect.fail("datation attendue");
    expect(phraseSansRupture(plate)).toBe("Aucune rupture datée (test de Pettitt, p = 1, 12 jours valides).");
    expect(phraseSansRupture(plate, true)).toBe(
      "Évolution progressive, pas de rupture datée (test de Pettitt, p = 1, 12 jours valides).",
    );
  });

  it("l'annotation porte le type « rupture », son sens et le lien du jour", () => {
    if (!d.ok || !d.rupture) return expect.fail("rupture attendue");
    expect(annotationRupture(d.rupture, "2026-09-05T22:00:00Z", "/?from=a&to=b")).toEqual({
      t: "2026-09-05T22:00:00Z",
      libelle: "Rupture à la hausse",
      type: "rupture",
      href: "/?from=a&to=b",
    });
    expect(annotationRupture(d.rupture, "2026-09-05T22:00:00Z")).not.toHaveProperty("href");
  });
});

describe("RM5 — une coïncidence de date n'est pas une explication", () => {
  it("aucun texte produit par le module ne parle de cause ni de responsable", () => {
    const d = daterRupture(serie([...Array(5).fill(1900), ...Array(9).fill(2700)]));
    const refuse = daterRupture(serie(Array(4).fill(1900)));
    const textes = [
      d.ok ? d.regle : "",
      d.ok && d.rupture ? phraseRupture(d.rupture, "Le LCP p75", ms, { jour: "2026-09-06", version: "1.4.2" }) : "",
      d.ok ? phraseSansRupture(d, true) : "",
      refuse.ok ? "" : refuse.raison,
      d.ok && d.rupture ? annotationRupture(d.rupture, "2026-09-05T22:00:00Z").libelle : "",
    ];
    for (const t of textes) expect(t).not.toMatch(/cause|responsable/i);
  });
});
