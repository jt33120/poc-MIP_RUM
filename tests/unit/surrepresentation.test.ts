// P*.6 — valeurs sur-représentées, test publié (plan § 7.2). Logique pure.
//
// Ce que ces cas verrouillent :
//   - Fisher unilatéral contre des valeurs TABULÉES (la dégustation de thé de
//     Fisher : 1/70 et 17/70 exactement) ;
//   - Benjamini-Hochberg contre une liste connue, et sa monotonie ;
//   - les trois volumes minimaux, et le refus CHIFFRÉ en dessous (RM2) ;
//   - « Inconnu » jamais testé ;
//   - RM5 : aucun texte produit par le module ne parle de cause ni de responsable.
import { describe, expect, it } from "vitest";
import {
  BASE_MIN_TEST,
  TOUCHES_MIN_TEST,
  TOUCHES_VALEUR_MIN,
  analyserSurrepresentation,
  benjaminiHochberg,
  fisherUnilateral,
  formaterP,
  phraseSurrepresentation,
  type DimensionObservee,
} from "../../apps/console/lib/stats/surrepresentation";

const pct = (v: number) => `${Math.round(v * 100)} %`;

describe("fisherUnilateral", () => {
  it("dégustation de thé de Fisher : 4 justes sur 4 → p = 1/70 ; 3 justes → 17/70", () => {
    // 8 tasses, 4 « lait d'abord », 4 désignées : hypergéométrique exacte.
    expect(fisherUnilateral(4, 4, 4, 8)).toBeCloseTo(1 / 70, 12);
    expect(fisherUnilateral(3, 4, 4, 8)).toBeCloseTo(17 / 70, 12);
  });

  it("l'exemple du plan : 9 des 12 sessions touchées sur Safari, 63 des 210 de base", () => {
    const p = fisherUnilateral(9, 12, 63, 210);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(0.0009);
    expect(p!).toBeLessThan(0.0015);
  });

  it("aucune sur-représentation : p vaut 1 quand toutes les touchées portent la valeur de toute la base", () => {
    expect(fisherUnilateral(0, 10, 50, 100)).toBe(1);
    expect(fisherUnilateral(10, 10, 100, 100)).toBe(1);
  });

  it("table incohérente (touchés hors de la base) : null, jamais un p inventé", () => {
    expect(fisherUnilateral(5, 4, 10, 100)).toBeNull(); // plus de touchés portant v que de touchés
    expect(fisherUnilateral(5, 10, 4, 100)).toBeNull(); // plus de touchés portant v que de base portant v
    expect(fisherUnilateral(5, 200, 10, 100)).toBeNull(); // plus de touchés que de base
    expect(fisherUnilateral(0, 0, 0, 0)).toBeNull(); // base vide
    expect(fisherUnilateral(1.5, 10, 20, 100)).toBeNull(); // des unités, pas des fractions
  });
});

describe("benjaminiHochberg", () => {
  it("liste connue : p ajustés dans l'ordre reçu, monotones, bornés à 1", () => {
    // Exemple classique : m = 5, p triés 0,01 0,02 0,03 0,04 0,05
    // → p × 5 / rang = 0,05 0,05 0,05 0,05 0,05 après la borne monotone.
    const { pAjuste, retenu } = benjaminiHochberg([0.05, 0.01, 0.03, 0.02, 0.04]);
    for (const p of pAjuste) expect(p).toBeCloseTo(0.05, 12);
    expect(retenu).toEqual([true, true, true, true, true]);
  });

  it("un seul p très significatif parmi 14 : retenu, les autres non", () => {
    const ps = [0.0012, ...Array.from({ length: 13 }, (_, i) => 0.2 + i * 0.05)];
    const { pAjuste, retenu } = benjaminiHochberg(ps);
    expect(pAjuste[0]).toBeCloseTo(0.0012 * 14, 12);
    expect(retenu[0]).toBe(true);
    expect(retenu.slice(1).every((r) => r === false)).toBe(true);
  });

  it("l'ordre de sortie est celui de l'entrée, et la suite ajustée reste croissante avec p", () => {
    const ps = [0.4, 0.001, 0.02];
    const { pAjuste } = benjaminiHochberg(ps);
    expect(pAjuste[1]).toBeLessThan(pAjuste[2]);
    expect(pAjuste[2]).toBeLessThan(pAjuste[0]);
  });

  it("famille vide : rien, pas une division par zéro", () => {
    expect(benjaminiHochberg([])).toEqual({ pAjuste: [], retenu: [] });
  });
});

describe("analyserSurrepresentation — volumes minimaux (RM2)", () => {
  const dims: DimensionObservee[] = [
    { cle: "browser", valeurs: [{ valeur: "Safari", nTouches: 9, nBase: 63 }] },
  ];

  it("9 unités touchées : pas de test, et le refus dit combien il en faut", () => {
    const r = analyserSurrepresentation(dims, { touches: 9, base: 210 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raison).toBe("pas de test : 9 sessions touchées, 10 requises");
    expect(r.manque).toEqual({ requis: TOUCHES_MIN_TEST, observe: 9, unite: "sessions touchées" });
  });

  it("base trop petite : refus chiffré sur la base, pas sur les touchées", () => {
    const r = analyserSurrepresentation(dims, { touches: 12, base: 29 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.manque).toEqual({ requis: BASE_MIN_TEST, observe: 29, unite: "sessions" });
  });

  it("une valeur sous 3 touchées n'entre pas dans la famille testée", () => {
    const r = analyserSurrepresentation(
      [
        {
          cle: "browser",
          valeurs: [
            { valeur: "Safari", nTouches: 9, nBase: 63 },
            { valeur: "Firefox", nTouches: TOUCHES_VALEUR_MIN - 1, nBase: 40 },
          ],
        },
      ],
      { touches: 12, base: 210 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.testees).toBe(1);
    expect(Object.keys(r.dimensions[0].tests)).toEqual(["Safari"]);
  });

  it("« Inconnu » est affiché mais JAMAIS testé", () => {
    const r = analyserSurrepresentation(
      [
        {
          cle: "browser",
          valeurs: [
            { valeur: "Inconnu", nTouches: 11, nBase: 12 },
            { valeur: "Safari", nTouches: 9, nBase: 63 },
          ],
        },
      ],
      { touches: 12, base: 210 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dimensions[0].tests).not.toHaveProperty("Inconnu");
    expect(r.testees).toBe(1);
  });
});

describe("analyserSurrepresentation — l'exemple du plan", () => {
  // 14 valeurs testées : Safari sur-représenté, treize autres proches de la base.
  const autres: DimensionObservee = {
    cle: "route",
    valeurs: Array.from({ length: 13 }, (_, i) => ({ valeur: `/r${i}`, nTouches: 3, nBase: 52 })),
  };
  const dims: DimensionObservee[] = [
    { cle: "browser", valeurs: [{ valeur: "Safari", nTouches: 9, nBase: 63 }] },
    autres,
  ];

  it("14 valeurs testées, Safari retenu, p ajusté ≈ 0,02", () => {
    const r = analyserSurrepresentation(dims, { touches: 12, base: 210 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.testees).toBe(14);
    expect(r.retenues.map((x) => x.valeur)).toEqual(["Safari"]);
    expect(r.retenues[0].test.pAjuste).toBeGreaterThan(0.01);
    expect(r.retenues[0].test.pAjuste).toBeLessThan(0.03);
    expect(r.dimensions.find((d) => d.cle === "browser")!.tests.Safari.retenu).toBe(true);
  });

  it("la correction porte sur TOUTE la famille de l'écran : le p ajusté dépasse le p brut", () => {
    const r = analyserSurrepresentation(dims, { touches: 12, base: 210 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const safari = r.dimensions.find((d) => d.cle === "browser")!.tests.Safari;
    expect(safari.pAjuste).toBeGreaterThan(safari.pBrut);
  });

  it("la règle affichée nomme le test, la correction et les trois volumes (RM4)", () => {
    const r = analyserSurrepresentation(dims, { touches: 12, base: 210 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.regle).toContain("Fisher");
    expect(r.regle).toContain("Benjamini-Hochberg");
    expect(r.regle).toContain(`${TOUCHES_MIN_TEST} sessions touchées`);
    expect(r.regle).toContain(`${BASE_MIN_TEST} sessions de base`);
  });
});

describe("phraseSurrepresentation et formaterP", () => {
  it("la phrase publie les deux effectifs, les deux parts, le test et le nombre de valeurs testées", () => {
    const texte = phraseSurrepresentation(
      { valeur: "Safari", nTouches: 9, nBase: 63, test: { pAjuste: 0.0173 } },
      { touches: 12, base: 210 },
      14,
      pct,
    );
    expect(texte).toBe(
      "Safari : 9 des 12 sessions touchées (75 %) contre 63 des 210 sessions (30 %). " +
        "Test exact de Fisher, p ajusté = 0,017 sur 14 valeurs testées.",
    );
  });

  it("un p minuscule s'écrit « < 0,0001 », jamais « 0 »", () => {
    expect(formaterP(1e-9)).toBe("< 0,0001");
    expect(formaterP(0.0173)).toBe("0,017");
    expect(formaterP(Number.NaN)).toBe("—");
  });
});

describe("RM5 — association n'est pas une explication", () => {
  it("aucun texte produit par le module ne parle de cause ni de responsable", () => {
    const analyse = analyserSurrepresentation(
      [{ cle: "browser", valeurs: [{ valeur: "Safari", nTouches: 9, nBase: 63 }] }],
      { touches: 12, base: 210 },
    );
    const refuse = analyserSurrepresentation([], { touches: 2, base: 10 });
    const textes = [
      analyse.ok ? analyse.regle : "",
      refuse.ok ? "" : refuse.raison,
      phraseSurrepresentation(
        { valeur: "Safari", nTouches: 9, nBase: 63, test: { pAjuste: 0.02 } },
        { touches: 12, base: 210 },
        14,
        pct,
      ),
      formaterP(0.02),
    ];
    for (const t of textes) expect(t).not.toMatch(/cause|responsable/i);
  });
});
