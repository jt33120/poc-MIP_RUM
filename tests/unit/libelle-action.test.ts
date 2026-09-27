import { describe, expect, it } from "vitest";
import { libelleAction, libelleRepere } from "../../apps/console/lib/libelle-action";

describe("libelleAction — le nom d'action sans préfixe technique (recette du 26/09/2026)", () => {
  it("un bouton ou un lien : son nom accessible seul", () => {
    expect(libelleAction('button "Afficher la fiche SIRET"')).toBe("Afficher la fiche SIRET");
    expect(libelleAction('a "Accueil"')).toBe("Accueil");
    expect(libelleAction('button "→ /partners"')).toBe("→ /partners");
  });

  it("un champ : sa nature, puis son étiquette entre guillemets français", () => {
    expect(libelleAction('input:text "Raison sociale"')).toBe("Champ « Raison sociale »");
    expect(libelleAction('select "Région"')).toBe("Liste « Région »");
  });

  it("sans nom accessible : la nature de l'élément", () => {
    expect(libelleAction("input:checkbox")).toBe("Champ sans libellé");
    expect(libelleAction("button")).toBe("Bouton sans libellé");
  });

  it("un nom manuel reste tel quel", () => {
    expect(libelleAction("filtre_region")).toBe("filtre_region");
    expect(libelleAction("checkout")).toBe("checkout");
    expect(libelleAction("Valider le panier")).toBe("Valider le panier");
  });

  it("absent : « Action sans nom », jamais une chaîne vide", () => {
    expect(libelleAction(null)).toBe("Action sans nom");
    expect(libelleAction("  ")).toBe("Action sans nom");
  });
});

// Contre-recette du 26/09/2026 : sous l'action « Champ « Raison sociale » », le repère
// du même clic disait « Champ sans libellé » — le SDK n'y met que la balise.
describe("libelleRepere — le repère d'un clic ne prétend pas que le champ n'a pas de nom", () => {
  it("balise seule : la nature, sans « sans libellé »", () => {
    expect(libelleRepere("input")).toBe("Champ");
    expect(libelleRepere("button")).toBe("Bouton");
  });

  it("avec un nom : le même libellé que l'action ; une route ou un nom manuel, tels quels", () => {
    expect(libelleRepere('button "Afficher la fiche SIRET"')).toBe("Afficher la fiche SIRET");
    expect(libelleRepere('input:text "Raison sociale"')).toBe("Champ « Raison sociale »");
    expect(libelleRepere("/partners/:id")).toBe("/partners/:id");
    expect(libelleRepere("partner_search")).toBe("partner_search");
  });
});
