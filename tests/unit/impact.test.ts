// F05 (plan P3, § 4.4) — `classerParGravite` : la gravité d'abord, un petit
// échantillon ne passe pas devant, l'inconnu en dernier, et aucune ligne de
// synthèse (pas de total ni de moyenne de p75, V5).
import { describe, expect, it } from "vitest";
import {
  SEUIL_ECHANTILLON_FAIBLE,
  classerParGravite,
  ecartALaReference,
  estFaible,
} from "../../apps/console/lib/impact";

interface Ligne {
  cle: string;
  p75: number | null;
  n: number | null;
  sessions?: number;
}

const L = (cle: string, p75: number | null, n: number | null, sessions?: number): Ligne => ({ cle, p75, n, sessions });
const cles = (lignes: Ligne[]) => lignes.map((l) => l.cle);
const options = (tri: "gravite" | "volume" | "impact" | "fourni") => ({
  tri,
  pilote: (l: Ligne) => l.p75,
  effectif: (l: Ligne) => l.n,
});

describe("classerParGravite — tri gravité", () => {
  it("une ligne n = 12 passe après une ligne n = 400, quelle que soit sa p75", () => {
    const { lignes, faibles } = classerParGravite([L("rare", 6000, 12), L("frequente", 3000, 400)], options("gravite"));
    expect(cles(lignes)).toEqual(["frequente", "rare"]);
    expect(faibles).toBe(1);
  });

  it("pilote décroissant, puis les faibles, puis les inconnus", () => {
    const { lignes } = classerParGravite(
      [
        L("sans-mesure", null, 0),
        L("lente-rare", 9000, 5),
        L("rapide", 1200, 800),
        L("lente", 4100, 90),
        L("moyenne-rare", 2000, 29),
        L("moyenne", 2600, 30),
      ],
      options("gravite"),
    );
    expect(cles(lignes)).toEqual(["lente", "moyenne", "rapide", "lente-rare", "moyenne-rare", "sans-mesure"]);
  });

  it("`null` en dernier, même avec un gros effectif ; NaN compte comme inconnu", () => {
    const { lignes } = classerParGravite(
      [L("inconnue", null, 5000), L("nan", Number.NaN, 5000), L("mesuree", 100, 31)],
      options("gravite"),
    );
    expect(cles(lignes)).toEqual(["mesuree", "inconnue", "nan"]);
  });

  it("le seuil d'échantillon faible est 30 par défaut, et se règle", () => {
    expect(SEUIL_ECHANTILLON_FAIBLE).toBe(30);
    expect(estFaible(29)).toBe(true);
    expect(estFaible(30)).toBe(false);
    expect(estFaible(null)).toBe(true);
    const { lignes, faibles } = classerParGravite([L("a", 500, 8), L("b", 100, 12)], {
      ...options("gravite"),
      seuilFaible: 10,
    });
    expect(cles(lignes)).toEqual(["b", "a"]);
    expect(faibles).toBe(1);
  });

  it("stable : deux lignes à égalité gardent l'ordre de la lecture", () => {
    const { lignes } = classerParGravite([L("x", 2000, 50), L("y", 2000, 50), L("z", 2000, 50)], options("gravite"));
    expect(cles(lignes)).toEqual(["x", "y", "z"]);
  });
});

describe("classerParGravite — autres tris", () => {
  const lignes = [L("a", 4000, 40, 10), L("b", 1500, 100, 300), L("c", 6000, 12, 2)];

  it("volume : effectif décroissant par défaut", () => {
    expect(cles(classerParGravite(lignes, options("volume")).lignes)).toEqual(["b", "a", "c"]);
  });

  it("volume : accesseur de volume propre (sessions), inconnu en dernier", () => {
    const { lignes: parSessions } = classerParGravite([...lignes, L("d", 100, 50)], {
      ...options("volume"),
      volume: (l: Ligne) => l.sessions ?? null,
    });
    expect(cles(parSessions)).toEqual(["b", "a", "c", "d"]);
  });

  it("fourni : l'ordre reçu est conservé tel quel (chronologie des releases)", () => {
    const recu = [L("1.4.0", 1200, 400), L("1.4.1", null, 3), L("1.4.2", 5200, 900)];
    const { lignes: sortie, faibles } = classerParGravite(recu, options("fourni"));
    expect(cles(sortie)).toEqual(["1.4.0", "1.4.1", "1.4.2"]);
    expect(sortie).not.toBe(recu);
    expect(faibles).toBe(1);
  });

  it("impact : exige le compte des mesures « Mauvais » (B2), ne trie jamais au hasard", () => {
    expect(() => classerParGravite(lignes, options("impact"))).toThrow(/B2/);
    const { lignes: parImpact } = classerParGravite(lignes, { ...options("impact"), impact: (l: Ligne) => l.sessions ?? null });
    expect(cles(parImpact)).toEqual(["b", "a", "c"]);
  });
});

describe("classerParGravite — aucune ligne de synthèse", () => {
  it("pas de total de p75 : exactement les lignes reçues, ni « Autres » ni « Total »", () => {
    const recu = [L("a", 4000, 40), L("b", 1500, 100), L("c", 6000, 12), L("d", null, 0)];
    for (const tri of ["gravite", "volume", "fourni"] as const) {
      const { lignes } = classerParGravite(recu, options(tri));
      expect(lignes).toHaveLength(recu.length);
      // Mêmes objets, aucun construit : aucune valeur n'a été additionnée ni moyennée.
      for (const l of lignes) expect(recu).toContain(l);
      expect(lignes.some((l) => /autres|total|ensemble/i.test(l.cle))).toBe(false);
    }
  });
});

describe("ecartALaReference", () => {
  it("écart de p75 (valeur − référence), jamais une contribution", () => {
    expect(ecartALaReference(3400, 2200)).toBe(1200);
    expect(ecartALaReference(1800, 2200)).toBe(-400);
  });

  it("inconnu d'un côté → null, jamais 0", () => {
    expect(ecartALaReference(null, 2200)).toBeNull();
    expect(ecartALaReference(3400, null)).toBeNull();
  });
});
