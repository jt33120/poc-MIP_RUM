// Containment NET. Ces tests portent la nuance commerciale du produit : afficher
// un containment brut seul, c'est afficher un chiffre de complaisance. Le net et
// sa phrase de lecture sont donc testés au même titre que le calcul.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { containment, containmentReading } from "../../apps/console/lib/svi-recall";

const c = (o: Partial<Parameters<typeof containment>[0]> = {}) => ({
  closed: 0, contained: 0, recalled: 0, unevaluable: 0, ...o,
});

describe("containment", () => {
  it("le scénario de référence : 100 résolus dont 30 rappels -> brut 100 %, net 70 %", () => {
    const r = containment(c({ closed: 100, contained: 100, recalled: 30 }));
    expect(r.brut).toBeCloseTo(100);
    expect(r.net).toBeCloseTo(70);
    expect(r.ecartPoints).toBeCloseTo(30);
  });

  it("sans rappel, net = brut et l'écart est nul", () => {
    const r = containment(c({ closed: 200, contained: 120 }));
    expect(r.brut).toBeCloseTo(60);
    expect(r.net).toBeCloseTo(60);
    expect(r.ecartPoints).toBeCloseTo(0);
  });

  it("le net est signalé comme BORNE SUPÉRIEURE dès qu'un appel n'est pas évaluable", () => {
    // Un appel sans empreinte d'appelant est compté comme non rappelé : le biais
    // penche donc TOUJOURS du côté flatteur, et il faut le dire.
    const sans = containment(c({ closed: 10, contained: 10, recalled: 2 }));
    expect(sans.borneSuperieure).toBe(false);
    const avec = containment(c({ closed: 10, contained: 10, recalled: 2, unevaluable: 3 }));
    expect(avec.borneSuperieure).toBe(true);
    expect(avec.unevaluable).toBe(3);
    // La valeur ne change pas : on n'extrapole pas le taux de rappel.
    expect(avec.net).toBeCloseTo(sans.net);
  });

  it("jeu vide : zéro partout, jamais NaN", () => {
    const r = containment(c());
    for (const v of [r.brut, r.net, r.ecartPoints]) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBe(0);
    }
  });

  it("donnée incohérente (plus de rappels que de résolus) : borné à 0, jamais négatif", () => {
    const r = containment(c({ closed: 10, contained: 3, recalled: 99 }));
    expect(r.net).toBe(0);
    expect(r.net).toBeGreaterThanOrEqual(0);
  });
});

describe("containmentReading", () => {
  it("nomme le net, l'écart au brut et la base de calcul", () => {
    const r = containment(c({ closed: 100, contained: 100, recalled: 30 }));
    const t = containmentReading(r, 100);
    expect(t).toContain("70.0 %");
    expect(t).toContain("100 appels clos");
    expect(t).toContain("30.0 point(s) de moins");
    expect(t).toContain("100.0 %");
  });

  it("mentionne explicitement la borne supérieure quand des appels ne sont pas vérifiables", () => {
    const r = containment(c({ closed: 50, contained: 40, recalled: 5, unevaluable: 12 }));
    const t = containmentReading(r, 50);
    expect(t).toContain("borne supérieure");
    expect(t).toContain("12 appel(s)");
  });

  it("n'invente pas d'écart quand il n'y en a pas", () => {
    const r = containment(c({ closed: 10, contained: 5 }));
    expect(containmentReading(r, 10)).not.toContain("point(s) de moins");
  });

  it("dit qu'il n'est pas calculable plutôt que d'afficher 0 %", () => {
    expect(containmentReading(containment(c()), 0)).toContain("pas calculable");
  });
});

// Garde de SOURCE (et non de DOM : ce fichier ne monte pas de composant React).
// Elle vérifie que la page de vue d'ensemble ne peut pas afficher le taux
// apparent sans le net à côté. C'est une protection contre une refonte
// d'interface qui, en simplifiant, ferait réapparaître le chiffre de complaisance
// seul — le mode de régression le plus probable sur cette page.
describe("garde d'affichage : jamais le brut sans le net", () => {
  const source = readFileSync(
    new URL("../../apps/console/app/svi/page.tsx", import.meta.url),
    "utf8",
  );

  it("la page affiche le containment net", () => {
    expect(source).toContain("c.net");
    expect(source).toContain("Containment net");
  });

  it("le taux apparent n'est jamais affiché sans être libellé « apparent »", () => {
    if (source.includes("c.brut")) {
      expect(source).toMatch(/apparent/i);
      // et le net doit être présent dans la même page
      expect(source).toContain("c.net");
    }
  });

  it("la phrase de lecture vient de la fonction testée, pas d'un texte en dur", () => {
    // Si la nuance était réécrite à la main dans le JSX, elle échapperait aux
    // tests ci-dessus et pourrait dériver sans que rien ne le signale.
    expect(source).toContain("containmentReading");
  });
});
