// L'outil de diagnostic doit lui-même être fiable : c'est la dernière chose qui
// parle quand tout le reste s'est tu.
import { describe, expect, it } from "vitest";
import { contexteFichier, formaterDiagnostic, rendreValeur, surEchec } from "../outils/diagnostic";

describe("rendreValeur ne lève jamais", () => {
  it("aplatit les sauts de ligne — un diagnostic se grep, il ne se fait pas défiler", () => {
    expect(rendreValeur("a\n  b\nc")).toBe("a ⏎ b ⏎ c");
  });

  it("tronque en DISANT ce qu'il a coupé", () => {
    // Une troncature silencieuse ferait croire à une valeur courte, ce qui est
    // exactement le genre de mensonge par omission qu'on corrige ailleurs.
    const rendu = rendreValeur("x".repeat(1000));
    expect(rendu).toContain("(+400 car.)");
    expect(rendu.startsWith("x".repeat(600))).toBe(true);
  });

  it("survit à une référence circulaire", () => {
    const a: Record<string, unknown> = { nom: "a" };
    a.moi = a;
    expect(() => rendreValeur(a)).not.toThrow();
    expect(rendreValeur(a)).toContain("[object Object]");
  });

  it("survit à un getter qui lève", () => {
    const piege = {
      get boum() {
        throw new Error("non");
      },
    };
    expect(() => rendreValeur(piege)).not.toThrow();
  });

  it("distingue null, undefined et la chaîne vide", () => {
    // Les trois se ressemblent dans un journal, et ce sont trois pannes
    // différentes : absent, jamais posé, posé vide.
    expect(rendreValeur(null)).toBe("null");
    expect(rendreValeur(undefined)).toBe("undefined");
    expect(rendreValeur("")).toBe("");
  });
});

describe("formaterDiagnostic", () => {
  it("aligne les clés pour que deux exécutions se comparent à l'œil", () => {
    const bloc = formaterDiagnostic("mon test", { court: 1, beaucoupPlusLong: 2 });
    expect(bloc).toContain("┌─ DIAGNOSTIC ── mon test");
    expect(bloc).toContain("│ court            : 1");
    expect(bloc).toContain("│ beaucoupPlusLong : 2");
    expect(bloc.endsWith("└───")).toBe(true);
  });

  it("reste lisible sans aucun contexte", () => {
    expect(formaterDiagnostic("vide", {})).toBe("┌─ DIAGNOSTIC ── vide\n└───");
  });
});

describe("contexteFichier", () => {
  const CONTENU = ["premiere ligne", "  const seuil = 1.02;", "derniere"].join("\n");

  it("dit si la chaîne est là, et où le fichier parle du sujet quand elle ne l'est pas", () => {
    const c = contexteFichier("x.sql", CONTENU, "const seuil = 1.03;");
    expect(c["présente"]).toBe(false);
    // Le point du test : on ne dit pas seulement « absent », on montre la ligne
    // voisine — ce qui distingue une suppression d'une reformulation.
    expect(String(c["ligne la plus proche"])).toContain("const seuil = 1.02;");
  });

  it("le dit franchement quand rien ne ressemble", () => {
    const c = contexteFichier("x.sql", CONTENU, "quelquechose_absent_totalement");
    expect(c["ligne la plus proche"]).toBe("aucune ligne ne contient ce jeton");
  });
});

describe("surEchec", () => {
  it("n'imprime RIEN quand le test passe", () => {
    // La garantie de coût : un contexte coûteux ne doit pas se payer 1 100 fois
    // par exécution de la suite.
    let evalue = 0;
    const sortie = { error: () => {} };
    surEchec(
      "ne doit pas s'évaluer",
      () => {
        evalue++;
        return {};
      },
      sortie,
    );
    expect(evalue).toBe(0);
  });

  it("est utilisable dans un test qui passe sans le perturber", () => {
    surEchec("assertion témoin", () => ({ note: "si tu lis ceci, ce test a échoué" }));
    expect(1 + 1).toBe(2);
  });
});
