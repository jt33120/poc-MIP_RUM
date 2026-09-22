// SupervisionHero.state (F02, § 4.1) : un état remplace le graphe — jamais un axe
// vide dessiné à côté d'un « Aucune mesure », qui se lirait comme une période calme.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroStat, SupervisionHero } from "@/components/SupervisionHero";

const GRAPHE = <div data-testid="graphe">courbe</div>;

describe("SupervisionHero — state", () => {
  it("sans état : le graphe est rendu", () => {
    const html = renderToStaticMarkup(
      <SupervisionHero chartTitle="LCP p75" chart={GRAPHE}>
        <HeroStat label="Sessions" value="12" />
      </SupervisionHero>,
    );
    expect(html).toContain('data-testid="graphe"');
  });

  it("état vide : rendu À LA PLACE du graphe, tuiles conservées", () => {
    const html = renderToStaticMarkup(
      <SupervisionHero
        chartTitle="LCP p75"
        chart={GRAPHE}
        state={{ kind: "vide", population: "mesure LCP", plage: "24 h" }}
      >
        <HeroStat label="Sessions" value="12" />
      </SupervisionHero>,
    );
    expect(html).not.toContain('data-testid="graphe"');
    expect(html.replace(/\u00a0/g, " ")).toContain("Aucune mesure LCP sur 24 h.");
    expect(html).toContain("Sessions");
  });

  it("explorer : un lien « Ouvrir dans l'Explorer » dans l'en-tête du graphe", () => {
    const html = renderToStaticMarkup(
      <SupervisionHero chartTitle="LCP p75" chart={GRAPHE} explorer="/explorer?dataset=vitals&run=1">
        <HeroStat label="Sessions" value="12" />
      </SupervisionHero>,
    );
    expect(html).toContain('href="/explorer?dataset=vitals&amp;run=1"');
    expect(html).toContain("Ouvrir dans l&#x27;Explorer");
  });
});
