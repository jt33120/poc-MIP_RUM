import { describe, expect, it } from "vitest";
import { libelleAction } from "../../apps/console/lib/libelle-action";

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
