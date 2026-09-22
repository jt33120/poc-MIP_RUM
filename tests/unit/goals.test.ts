// Objectifs — matching + taux de conversion. Logique pure.
import { describe, expect, it } from "vitest";
import { conversionRate, goalMatches } from "../../apps/console/lib/goals";
import {
  classerObjectifs,
  couvertureTaux,
  demiLargeurPoints,
  ecartPoints,
  echantillonFaibleObjectif,
  formaterPoints,
  libelleCondition,
  lignesAppareils,
  meilleurObjectif,
} from "../../apps/console/lib/goals";
import { intervalleWilson } from "../../apps/console/lib/stats/incertitude";

describe("goalMatches", () => {
  it("exact = égalité stricte", () => {
    expect(goalMatches("exact", "/merci", "/merci")).toBe(true);
    expect(goalMatches("exact", "/merci", "/merci/2")).toBe(false);
  });
  it("contains = sous-chaîne", () => {
    expect(goalMatches("contains", "checkout", "/app/checkout/step2")).toBe(true);
    expect(goalMatches("contains", "checkout", "/panier")).toBe(false);
  });
});

describe("conversionRate", () => {
  it("ratio des sessions converties", () => {
    expect(conversionRate(3, 12)).toBeCloseTo(0.25);
    expect(conversionRate(0, 12)).toBe(0); // vide réel : des sessions, aucune conversion
  });
  it("sans session, pas de taux : null, jamais « 0 % »", () => {
    expect(conversionRate(0, 0)).toBeNull();
    expect(conversionRate(5, 0)).toBeNull();
  });
});

// F66 (§ 5.14.4) — l'intervalle de chaque taux est celui de P*.1 (une seule
// implémentation de Wilson dans la console) ; les deux cas de recette du plan.
describe("intervalleWilson (G3)", () => {
  it("sans session : null (pas d'intervalle sans dénominateur)", () => {
    expect(intervalleWilson(0, 0)).toBeNull();
  });
  it("10 conversions sur 100 : ≈ [0,055 ; 0,174]", () => {
    const i = intervalleWilson(10, 100);
    expect(i && !("indisponible" in i)).toBe(true);
    if (!i || "indisponible" in i) return;
    expect(i.bas).toBeCloseTo(0.055, 3);
    expect(i.haut).toBeCloseTo(0.174, 3);
    expect(demiLargeurPoints(i)).toBeCloseTo(5.95, 1);
  });
});

describe("libelleCondition", () => {
  it("écrit la condition en mots", () => {
    expect(libelleCondition({ kind: "pageview", match_type: "exact", pattern: "/merci" })).toBe("page vue = /merci");
    expect(libelleCondition({ kind: "event", match_type: "contains", pattern: "checkout" })).toBe("événement contient checkout");
  });
});

describe("echantillonFaibleObjectif et classement (G3)", () => {
  it("faible sous 30 conversions OU 30 non-conversions ; sans session, rien à qualifier", () => {
    expect(echantillonFaibleObjectif(29, 500)).toBe(true);
    expect(echantillonFaibleObjectif(480, 500)).toBe(true); // 20 non-conversions
    expect(echantillonFaibleObjectif(30, 60)).toBe(false);
    expect(echantillonFaibleObjectif(0, 0)).toBe(false);
  });

  it("taux décroissant, échantillons faibles en fin, taux inconnus tout en bas", () => {
    const g = (name: string, conversions: number, sessions: number) => ({
      name,
      conversions,
      sessions,
      rate: conversionRate(conversions, sessions),
    });
    const classes = classerObjectifs([
      g("inconnu", 0, 0),
      g("faible-haut", 9, 10), // 90 % mais 1 non-conversion
      g("moyen", 100, 400), // 25 %
      g("fort", 200, 400), // 50 %
    ]);
    expect(classes.map((x) => x.name)).toEqual(["fort", "moyen", "faible-haut", "inconnu"]);
  });
});

describe("écarts en points (G4)", () => {
  it("différence de deux taux en points ; null si l'un manque", () => {
    expect(ecartPoints(0.1, 0.124)).toBeCloseTo(-2.4);
    expect(ecartPoints(null, 0.1)).toBeNull();
    expect(ecartPoints(0.1, null)).toBeNull();
  });
  it("formaté avec son signe et une décimale", () => {
    expect(formaterPoints(-2.44)).toBe("−2,4 pt");
    expect(formaterPoints(1.8)).toBe("+1,8 pt");
    expect(formaterPoints(0.01)).toBe("0,0 pt");
  });
});

describe("lignesAppareils (G4)", () => {
  const lignes = [
    { goal_id: 1, device: "mobile", conversions: 2, sessions: 10 },
    { goal_id: 1, device: null, conversions: 1, sessions: 4 },
    { goal_id: 1, device: "tv", conversions: 0, sessions: 3 },
    { goal_id: 2, device: "desktop", conversions: 5, sessions: 5 },
  ];
  it("desktop, mobile, tablette, autres types, puis « Inconnu » : toujours, dans cet ordre", () => {
    expect(lignesAppareils(1, lignes).map((l) => l.libelle)).toEqual(["Desktop", "Mobile", "Tablette", "tv", "Inconnu"]);
  });
  it("un appareil sans session garde sa ligne, sans taux (jamais « 0 % »)", () => {
    const [desktop, mobile, , , inconnu] = lignesAppareils(1, lignes);
    expect(desktop).toMatchObject({ device: "desktop", sessions: 0, rate: null });
    expect(mobile).toMatchObject({ sessions: 10, conversions: 2, rate: 0.2 });
    expect(inconnu).toMatchObject({ device: null, sessions: 4, rate: 0.25 });
  });
  it("ne mélange jamais deux objectifs", () => {
    expect(lignesAppareils(2, lignes).find((l) => l.device === "mobile")?.sessions).toBe(0);
  });
});

// Revue F66 : la tuile « Meilleur taux » marquait « échantillon faible » sous 30
// SESSIONS, le hero et la table sous 30 conversions OU 30 non-conversions. Une
// seule règle, `echantillonFaibleObjectif`, décide pour les trois.
describe("tuile « Meilleur taux » : même règle que le hero et la table", () => {
  // La décision de `KpiTile` : « échantillon faible » si et seulement si n < faibleSous.
  const tuileFaible = (conversions: number, sessions: number) => {
    const c = couvertureTaux(conversions, sessions);
    return c.n < c.faibleSous;
  };

  it.each([
    [5, 400], // ≥ 30 sessions mais 5 conversions : faible (l'ancienne règle le laissait passer)
    [395, 400], // 5 non-conversions : faible
    [10, 25], // sous 30 sessions
    [200, 400],
    [30, 60],
    [0, 0], // pas de taux : rien à qualifier
  ])("%i conversions sur %i sessions : décision identique à echantillonFaibleObjectif", (conversions, sessions) => {
    expect(tuileFaible(conversions, sessions)).toBe(echantillonFaibleObjectif(conversions, sessions));
  });

  it("l'effectif affiché reste les sessions de l'objectif", () => {
    expect(couvertureTaux(5, 400)).toMatchObject({ n: 400, unite: "sessions" });
  });

  it("meilleur objectif : le premier taux connu dans l'ordre du hero", () => {
    const g = (name: string, conversions: number, sessions: number) => ({
      name,
      conversions,
      sessions,
      rate: conversionRate(conversions, sessions),
    });
    // « Rare » a le taux le plus haut mais 9 conversions : le hero le range en fin.
    expect(meilleurObjectif([g("Rare", 9, 30), g("Solide", 100, 400)])?.name).toBe("Solide");
    // Tous faibles : le premier taux connu, qui portera « échantillon faible ».
    expect(meilleurObjectif([g("Inconnu", 0, 0), g("Rare", 9, 30)])?.name).toBe("Rare");
    expect(meilleurObjectif([g("Inconnu", 0, 0)])).toBeNull();
  });
});
