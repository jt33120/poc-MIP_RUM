// StackedBars, nouvelle forme (F04, plan § 4.2) : composant client recharts, non rendu
// ici (§ 0.4). On teste ce qui décide du dessin : chaque ton de sévérité est doublé
// d'un motif (§ 3.9 : aucune information portée par la seule couleur), une
// catégorie prend une couleur de CATEGORIELLE, et au-delà de cinq séries les
// suivantes sont nommées, pas empilées.
import { describe, expect, it } from "vitest";
import { dessinerSeries } from "@/components/charts/StackedBars";
import { CATEGORIELLE } from "@/lib/palette";

describe("dessinerSeries", () => {
  it("un ton de sévérité porte le motif de sa sévérité : critique plein, avertissement hachuré, info pointillé", () => {
    const { dessinees } = dessinerSeries(
      [
        { cle: "c", libelle: "Critique", ton: "bad" },
        { cle: "w", libelle: "Avertissement", ton: "warn" },
        { cle: "i", libelle: "Information", ton: "neutre" },
      ],
      "m",
    );
    expect(dessinees.map((s) => s.motifEffectif)).toEqual(["plein", "hachure", "points"]);
    expect(dessinees[0].remplissage).toBe("rgb(var(--c-bad))");
    expect(dessinees[1].remplissage).toBe("url(#m-1)");
  });

  it("un motif explicite l'emporte ; une catégorie prend sa couleur CATEGORIELLE", () => {
    const { dessinees } = dessinerSeries(
      [
        { cle: "a", libelle: "Chargements", categorieIndex: 0 },
        { cle: "b", libelle: "SPA", categorieIndex: 1, motif: "hachure" },
      ],
      "m",
    );
    expect(dessinees[0].remplissage).toBe(CATEGORIELLE[0]);
    expect(dessinees[1].couleur).toBe(CATEGORIELLE[1]);
    expect(dessinees[1].remplissage).toBe("url(#m-1)");
  });

  it("au-delà de cinq séries : les suivantes sont écartées et nommées", () => {
    const series = ["a", "b", "c", "d", "e", "f"].map((cle) => ({ cle, libelle: cle.toUpperCase() }));
    const { dessinees, ecartees } = dessinerSeries(series, "m");
    expect(dessinees).toHaveLength(5);
    expect(ecartees).toEqual(["F"]);
  });
});

// Recette du 26/09/2026 (sombre) : la barre de la période en cours, à 55 % d'opacité,
// devenait bleu nuit pendant que sa pastille de légende restait vive.
describe("barre de la période en cours", () => {
  it("garde la couleur PLEINE de sa série ; seules des rayures du fond disent « incomplète »", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MotifEnCours } = await import("@/components/charts/ThresholdSeries");
    const svg = renderToStaticMarkup(createElement(MotifEnCours, { id: "m", couleur: CATEGORIELLE[0] }));
    expect(svg).toContain(`fill="${CATEGORIELLE[0]}"`);
    expect(svg).not.toMatch(/fill-opacity="0\.\d+"/);
    expect(svg).toContain('stroke="rgb(var(--c-panel))"');
  });
});
