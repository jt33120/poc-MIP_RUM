import { describe, expect, it } from "vitest";
import { lieuDeLigne, nomDeFichier, premiereLigneDePile, texteDistinction } from "../../apps/console/lib/erreurs-distinction";

// Recette du 26/09/2026 : neuf groupes « Uncaught Error: Erreur de démo MIP RUM »
// qu'une empreinte hexadécimale seule séparait. Sous le titre, la liste écrit ce qui
// les distingue : la première ligne de pile, puis la route principale.
describe("premiereLigneDePile", () => {
  it("V8 : la première ligne d'appel, pas l'en-tête du message", () => {
    const pile = "TypeError: Cannot read properties of undefined (reading 'siret')\n    at afficherFiche (http://localhost:8080/js/app.js:42:13)\n    at HTMLButtonElement.<anonymous> (http://localhost:8080/js/app.js:88:5)";
    expect(premiereLigneDePile(pile)).toBe("afficherFiche · app.js:42");
  });

  it("V8 sans nom de fonction : le fichier et la ligne", () => {
    expect(premiereLigneDePile("Error: boom\n    at http://localhost:8080/demo.js?v=3:7:1")).toBe("demo.js:7");
  });

  it("Gecko / JavaScriptCore : `fonction@url:ligne:colonne`", () => {
    expect(premiereLigneDePile("payer@https://exemple.fr/assets/panier.min.js:1:2048\n@debugger eval code:1:1")).toBe(
      "payer · panier.min.js:1",
    );
  });

  it("Python : le fichier, la ligne et la fonction", () => {
    const pile = 'Traceback (most recent call last):\n  File "/app/api/routes.py", line 12, in lister\n    raise ValueError("x")';
    expect(premiereLigneDePile(pile)).toBe("lister · routes.py:12");
  });

  it("script intégré à une page : le chemin de la page, sans requête ; fonction anonyme omise", () => {
    // Le cas de la recette : neuf groupes au même titre, un par page où le script intégré tournait.
    expect(
      premiereLigneDePile(
        "Error: Erreur de démo MIP RUM\n    at HTMLButtonElement.<anonymous> (http://localhost:8080/recherche?q=menuiserie:79:13)",
      ),
    ).toBe("page /recherche, ligne 79");
    expect(premiereLigneDePile("Error: x\n    at HTMLButtonElement.<anonymous> (http://localhost:8080/:79:13)")).toBe(
      "page /, ligne 79",
    );
  });

  it("aucune ligne d'appel : rien n'est deviné", () => {
    expect(premiereLigneDePile("Script error.")).toBeNull();
    expect(premiereLigneDePile(null)).toBeNull();
    expect(premiereLigneDePile("")).toBeNull();
  });
});

describe("texteDistinction", () => {
  const base = { pile: null, fichier: null, ligne: null, route: null, partRoute: null };

  it("ligne de pile et route principale, avec sa part", () => {
    expect(
      texteDistinction({
        ...base,
        pile: "Error: x\n    at f (https://a.fr/app.js:3:1)",
        route: "/partners/:id",
        partRoute: 0.78,
      }),
    ).toEqual({ lieu: "f · app.js:3", route: "surtout sur /partners/:id (78\u00a0%)" });
  });

  it("une seule route : « toujours sur »", () => {
    expect(texteDistinction({ ...base, route: "/panier", partRoute: 1 })?.route).toBe("toujours sur /panier");
  });

  it("sans pile, le fichier et la ligne déclarés par le navigateur", () => {
    expect(texteDistinction({ ...base, fichier: "https://a.fr/js/vendor.js?x=1", ligne: 12 })?.lieu).toBe("vendor.js:12");
  });

  it("rien de connu : pas de phrase", () => {
    expect(texteDistinction(base)).toBeNull();
    expect(texteDistinction(undefined)).toBeNull();
  });

  it("lieuDeLigne : un script par son nom, une page par son chemin", () => {
    expect(lieuDeLigne("https://a.fr/js/app.min.js?v=2", 3)).toBe("app.min.js:3");
    expect(lieuDeLigne("http://localhost:8080/partners/108", 79)).toBe("page /partners/108, ligne 79");
    expect(lieuDeLigne("/app/api/routes.py", "12")).toBe("routes.py:12");
  });

  it("nomDeFichier : dernier segment, sans requête ni ancre", () => {
    expect(nomDeFichier("https://a.fr/js/app.js?v=2#x")).toBe("app.js");
    expect(nomDeFichier("C:\\projet\\src\\index.ts")).toBe("index.ts");
  });
});
