// Seaux aux bords de la grille (recette du 30/09/2026) : la grille part du seau qui
// CONTIENT le début de la plage, et finit sur un seau qui n'est pas terminé. Le
// premier est marqué partiel, le dernier n'est pas dessiné pleine largeur.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formeBarreAuxBords } from "@/components/charts/ThresholdSeries";
import {
  bordsDeGrille,
  libellePremiereTranchePartielle,
  portionDeBarre,
  preparerPoints,
  rognerBarre,
  type SerieDef,
} from "@/lib/series";

const GRILLE = ["2026-09-29T10:00:00Z", "2026-09-29T11:00:00Z", "2026-09-29T12:00:00Z"];
const H = 3600;
const LCP: SerieDef = { cle: "lcp", libelle: "LCP p75", role: "principale" };

describe("bordsDeGrille", () => {
  it("plage commencée à 10:15 : le premier seau n'est couvert qu'aux trois quarts", () => {
    const b = bordsDeGrille(GRILLE, H, { debutPlage: "2026-09-29T10:15:00.000Z", maintenant: null });
    expect(b.premierPartiel).toBeCloseTo(0.75);
    // `maintenant` inconnu (avant le montage) : aucun seau n'est dit en cours.
    expect(b.dernierEnCours).toBeNull();
  });

  it("plage alignée sur le seau (zoom) ou début inconnu : premier seau entier", () => {
    expect(bordsDeGrille(GRILLE, H, { debutPlage: "2026-09-29T10:00:00.000Z", maintenant: null }).premierPartiel).toBeNull();
    expect(bordsDeGrille(GRILLE, H, { maintenant: null }).premierPartiel).toBeNull();
  });

  it("à 12:20, le seau de 12:00 est écoulé au tiers", () => {
    const b = bordsDeGrille(GRILLE, H, { maintenant: Date.parse("2026-09-29T12:20:00Z") });
    expect(b.dernierEnCours).toBeCloseTo(1 / 3);
  });

  it("seau fini (plage passée) : rien en cours", () => {
    expect(bordsDeGrille(GRILLE, H, { maintenant: Date.parse("2026-09-29T13:00:00Z") }).dernierEnCours).toBeNull();
  });

  it("grille de jours : lue dans le fuseau", () => {
    const jours = ["2026-09-28", "2026-09-29"];
    const b = bordsDeGrille(jours, 86_400, {
      fuseau: "Europe/Paris",
      // Minuit à Paris le 29/09 = 22:00 UTC le 28/09 : à 04:00 UTC, un quart du jour.
      maintenant: Date.parse("2026-09-29T04:00:00Z"),
      debutPlage: "2026-09-28T04:00:00Z",
    });
    expect(b.dernierEnCours).toBeCloseTo(0.25);
    expect(b.premierPartiel).toBeCloseTo(0.75);
  });
});

describe("portionDeBarre et rognerBarre", () => {
  const bords = { premierPartiel: 0.75, dernierEnCours: 0.25 };

  it("le premier seau garde sa fin, le dernier son début, les autres sont entiers", () => {
    expect(portionDeBarre(0, 3, bords)).toEqual({ debut: 0.25, fin: 1 });
    expect(portionDeBarre(1, 3, bords)).toBeNull();
    expect(portionDeBarre(2, 3, bords)).toEqual({ debut: 0, fin: 0.25 });
  });

  it("un seul seau, à la fois partiel et en cours", () => {
    expect(portionDeBarre(0, 1, bords)).toEqual({ debut: 0.25, fin: 0.25 });
    expect(rognerBarre(100, 40, { debut: 0.25, fin: 0.25 })).toEqual({ x: 110, largeur: 1 });
  });

  it("rognerBarre : x et largeur de la portion, jamais moins d'un pixel", () => {
    expect(rognerBarre(100, 40, { debut: 0.25, fin: 1 })).toEqual({ x: 110, largeur: 30 });
    expect(rognerBarre(100, 40, { debut: 0, fin: 0.25 })).toEqual({ x: 100, largeur: 10 });
    expect(rognerBarre(100, 40, { debut: 0, fin: 0 })).toEqual({ x: 100, largeur: 1 });
  });

  it("formeBarreAuxBords dessine la barre en cours au quart de sa largeur", () => {
    const Forme = formeBarreAuxBords(bords, 3);
    const svg = (index: number) =>
      renderToStaticMarkup(createElement("svg", null, createElement(Forme, { x: 100, y: 10, width: 40, height: 50, index, fill: "red" })));
    expect(svg(2)).toContain('d="M 100,10 h 10');
    expect(svg(1)).toContain('d="M 100,10 h 40');
    expect(svg(0)).toContain('d="M 110,10 h 30');
  });
});

describe("preparerPoints — premier seau partiel", () => {
  it("le premier point mesuré est creux, sans « faible effectif »", () => {
    const p = preparerPoints(GRILLE, GRILLE.map((t) => ({ t, lcp: 2000 })), [LCP], { premierPartiel: true });
    expect(p.creux.lcp).toEqual([0]);
    expect(p.faibleEffectif).toBe(false);
  });

  it("sans l'option, rien ne change", () => {
    const p = preparerPoints(GRILLE, GRILLE.map((t) => ({ t, lcp: 2000 })), [LCP]);
    expect(p.creux.lcp).toEqual([]);
  });
});

describe("libellePremiereTranchePartielle", () => {
  it("dit l'heure de début de la plage dans le fuseau d'affichage", () => {
    expect(libellePremiereTranchePartielle("2026-09-29T08:15:00.000Z", H, "Europe/Paris")).toBe(
      "première tranche partielle (plage commencée à 10:15)",
    );
    expect(libellePremiereTranchePartielle("2026-09-29T08:15:00.000Z", 86_400, "Europe/Paris")).toMatch(/^premier jour partiel/);
  });
});
