// Libellés du Sankey (recette du 26/09/2026) : une route coupée AU MILIEU, le total
// toujours dans la marge, et les colonnes « Depuis » / « Vers » nommées.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sankey, libelleNoeud, tronquerMilieu } from "@/components/Sankey";
import { buildSankey } from "@/lib/sankey";

describe("libellés de nœud", () => {
  it("coupe au milieu : le début et la fin de la route restent lisibles", () => {
    expect(tronquerMilieu("/partners/:id/documents", 15)).toBe("/partne…cuments");
    expect(tronquerMilieu("/panier", 15)).toBe("/panier");
  });

  it("le total tient toujours : la route cède la place, jamais le nombre", () => {
    const l = libelleNoeud("/partners/:id/documents", 1240);
    expect(l.endsWith(" · 1 240") || l.endsWith(" · 1 240") || l.endsWith(" · 1 240")).toBe(true);
    expect(l.length).toBeLessThanOrEqual(21);
    expect(l.startsWith("/partn")).toBe(true);
    expect(l).toContain("…");
  });
});

describe("Sankey", () => {
  it("en-têtes « Depuis » et « Vers »", () => {
    const model = buildSankey([{ from: "/", to: "/panier", count: 3 }]);
    const html = renderToStaticMarkup(<Sankey model={model} />);
    expect(html).toContain(">Depuis</text>");
    expect(html).toContain(">Vers</text>");
  });
});
