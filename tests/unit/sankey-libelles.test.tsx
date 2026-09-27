// Libellés du Sankey (recette du 26/09/2026) : une route coupée AU MILIEU, le total
// toujours dans la marge, et les colonnes « Depuis » / « Vers » nommées ; sous 640 px,
// une liste des principales transitions remplace le dessin de 560 px.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sankey, libelleNoeud, transitionsPrincipales, tronquerMilieu } from "@/components/Sankey";
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

describe("liste mobile", () => {
  it("les transitions du dessin, par passages décroissants, huit au plus", () => {
    const model = buildSankey(
      Array.from({ length: 10 }, (_, i) => ({ from: `/d${i}`, to: `/a${i}`, count: i + 1 })),
      { maxNodes: 10 },
    );
    const liste = transitionsPrincipales(model);
    expect(liste).toHaveLength(8);
    expect(liste.map((l) => l.count)).toEqual([10, 9, 8, 7, 6, 5, 4, 3]);
  });

  it("chaque ligne mène où mène son ruban ; le dessin n'est rendu qu'au-delà de `sm`", () => {
    const model = buildSankey([
      { from: "/", to: "/panier", count: 3 },
      { from: "/panier", to: "/paiement", count: 1 },
    ]);
    const html = renderToStaticMarkup(<Sankey model={model} liens={{ sessions: (r) => `/sessions?q=${encodeURIComponent(r)}` }} />);
    expect(html).toContain('<div class="sm:hidden" data-testid="sankey-liste">');
    expect(html).toContain('class="hidden overflow-x-auto sm:block" data-testid="sankey-dessin"');
    expect(html).toContain('aria-label="/ vers /panier : 3 passages — ouvrir les sessions passées par /panier"');
    expect(html).toContain('href="/sessions?q=%2Fpaiement"');
  });
});
