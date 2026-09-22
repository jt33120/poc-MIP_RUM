// Sparkline (F03, plan § 4.2) : un trou reste un trou, l'axe part de 0, un point
// seul n'est pas une tendance, et une échelle commune compare des lignes entre elles.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Sparkline, geometrieSparkline } from "@/components/charts/Sparkline";

const rendu = (el: ReactElement) => renderToStaticMarkup(el);
const segments = (html: string) => html.match(/<path [^>]*data-segment/g) ?? [];
const ariaLabel = (html: string) => /aria-label="([^"]*)"/.exec(html)?.[1] ?? "";
/** Premier point du premier tracé : « M x y ». */
const premierPoint = (html: string) => /d="M ([\d.]+) ([\d.]+)/.exec(html)?.slice(1).map(Number) ?? [];

describe("Sparkline — trous", () => {
  it("[1, null, 3] → deux segments séparés, jamais une ligne continue", () => {
    const html = rendu(<Sparkline valeurs={[1, null, 3]} label="Occurrences, 3 seaux" />);
    expect(segments(html)).toHaveLength(2);
  });

  it("un null n'est jamais posé à 0 : son ordonnée est absente", () => {
    const g = geometrieSparkline([5, null, 5], { largeur: 96, hauteur: 24 });
    expect(g.ys[1]).toBeNull();
    expect(g.segments).toHaveLength(2);
  });

  it("une suite continue est un seul tracé", () => {
    const html = rendu(<Sparkline valeurs={[1, 2, 3, 4]} label="x" />);
    expect(segments(html)).toHaveLength(1);
  });
});

describe("Sparkline — pas assez de points", () => {
  it("moins de deux valeurs mesurées : rien n'est tracé, et le libellé le dit", () => {
    for (const valeurs of [[], [4], [null, 4, null, null]]) {
      const html = rendu(<Sparkline valeurs={valeurs} label="LCP p75, 4 seaux" />);
      expect(segments(html)).toHaveLength(0);
      expect(ariaLabel(html)).toBe("LCP p75, 4 seaux, pas assez de points");
    }
  });

  it("toutes les valeurs à 0 : un tracé au sol, sans NaN", () => {
    const html = rendu(<Sparkline valeurs={[0, 0, 0]} label="x" />);
    expect(html).not.toContain("NaN");
    expect(segments(html)).toHaveLength(1);
  });
});

describe("Sparkline — échelle", () => {
  it("même valeur et même max → même hauteur, quelle que soit la ligne", () => {
    const a = rendu(<Sparkline valeurs={[30, 10, 20]} label="Groupe A" max={90} />);
    const b = rendu(<Sparkline valeurs={[30, 90, 75]} label="Groupe B" max={90} />);
    expect(premierPoint(a)).toEqual(premierPoint(b));
    expect(premierPoint(a)).toHaveLength(2);
  });

  it("sans max, l'échelle suit la ligne : la même valeur n'a pas la même hauteur", () => {
    const a = geometrieSparkline([30, 10], { largeur: 96, hauteur: 24 });
    const b = geometrieSparkline([30, 90], { largeur: 96, hauteur: 24 });
    expect(a.ys[0]).not.toBe(b.ys[0]);
  });

  it("l'axe part de 0 : un écart de 2 % ne devient pas une falaise", () => {
    const g = geometrieSparkline([98, 100], { largeur: 96, hauteur: 24 });
    const [y98, y100] = g.ys as number[];
    expect(Math.abs(y98 - y100)).toBeLessThan(1);
  });

  it("avec max, le libellé annonce l'échelle commune", () => {
    const html = rendu(<Sparkline valeurs={[1, 2]} label="Groupe A, 2 seaux" max={1240} />);
    expect(ariaLabel(html).replace(/\u202f/g, " ")).toBe("Groupe A, 2 seaux, échelle commune, max 1 240");
  });
});

describe("Sparkline — seuils et accessibilité", () => {
  it("seuils → bande « Bon » en fond ; sans seuils, pas de bande", () => {
    expect(rendu(<Sparkline valeurs={[2300, 2700]} label="LCP" seuils={[2500, 4000]} />)).toContain('data-bande="bon"');
    expect(rendu(<Sparkline valeurs={[2300, 2700]} label="LCP" />)).not.toContain("data-bande");
  });

  it("la bande « Bon » reste visible quand toutes les valeurs sont bonnes", () => {
    const g = geometrieSparkline([100, 200], { largeur: 96, hauteur: 24, seuils: [2500, 4000] });
    expect(g.sommet).toBeGreaterThanOrEqual(2500);
    expect(g.bandeBon).toBeGreaterThan(0);
  });

  it("role=img et libellé de l'appelant", () => {
    const html = rendu(<Sparkline valeurs={[1, 2]} label="LCP p75, 24 seaux d'une heure" />);
    expect(html).toContain('role="img"');
    expect(ariaLabel(html)).toBe("LCP p75, 24 seaux d&#x27;une heure");
  });
});
