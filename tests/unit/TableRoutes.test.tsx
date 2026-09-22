// Table « Routes : robot et réel côte à côte » (§ 5.7 CR12) et sa colonne de
// concordance (P*.8) : un coefficient de RANG avec son intervalle, ou un refus
// chiffré — jamais une case vide, jamais un écart entre deux mesures.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableRoutes, type LigneRoute } from "@/components/correlation/TableRoutes";

const BASE: LigneRoute = {
  cle: "a|/checkout",
  app_id: "a",
  route: "/checkout",
  latenceRobot: 820,
  etatRobot: "ok",
  scoreRobot: 92,
  scenarios: "Parcours panier",
  robot: true,
  lcpReel: 2400,
  inpReel: 180,
  mesuresLcp: 1200,
  sessions: 300,
  reel: true,
  hrefHero: "/correlation?serie=a%3A%252Fcheckout#hero",
  hrefPages: "/pages?route=%2Fcheckout",
  concordance: { texte: "ρ 0,71 (0,21 à 0,92)", issue: "suit", jours: 12 },
};

describe("TableRoutes — colonne « Concordance robot ↔ réel »", () => {
  it("le coefficient, son intervalle, son issue et ses jours communs", () => {
    const html = renderToStaticMarkup(<TableRoutes lignes={[BASE]} avecApp={false} />);
    expect(html).toContain("Concordance robot ↔ réel");
    expect(html).toContain("ρ 0,71 (0,21 à 0,92)");
    expect(html).toContain("suit · 12 jours communs");
    expect(html).toContain('data-issue="suit"');
    // Aucun écart entre les deux mesures : ni pourcentage, ni soustraction.
    expect(html).not.toContain("écart");
    expect(html).not.toMatch(/−\d+\s*%/);
  });

  it("volume insuffisant : le refus est chiffré, et aucune issue n'est affichée", () => {
    const ligne: LigneRoute = {
      ...BASE,
      concordance: { texte: "Concordance non calculée : 4 jours communs, 10 requis", issue: null, jours: null },
    };
    const html = renderToStaticMarkup(<TableRoutes lignes={[ligne]} avecApp={false} />);
    expect(html).toContain("Concordance non calculée : 4 jours communs, 10 requis");
    expect(html).toContain('data-issue="non-calculee"');
    expect(html).not.toContain("jours communs<"); // pas de seconde ligne d'issue
  });

  it("une route sans robot garde sa cellule de concordance (refus), et ses messages d'absence", () => {
    const ligne: LigneRoute = {
      ...BASE,
      robot: false,
      latenceRobot: null,
      etatRobot: null,
      scoreRobot: null,
      scenarios: null,
      concordance: { texte: "Concordance non calculée : 0 jour commun, 10 requis", issue: null, jours: null },
    };
    const html = renderToStaticMarkup(<TableRoutes lignes={[ligne]} avecApp={false} />);
    expect(html).toContain("pas de scénario robot sur cette route");
    expect(html).toContain("Concordance non calculée : 0 jour commun, 10 requis");
  });

  it("le conteneur défilant reste positionné (un `sr-only` ne doit pas élargir la page)", () => {
    const html = renderToStaticMarkup(<TableRoutes lignes={[BASE]} avecApp />);
    expect(html).toContain('class="relative overflow-x-auto"');
    expect(html).toContain("Liens");
  });
});
