// La recherche qui alimente les gardes d'absence du dépôt.
//
// Ce fichier existe parce qu'un test a échoué DEUX FOIS en suite complète sans
// être reproductible seul. La cause n'était pas le test : c'était son outil, qui
// rendait la même chaîne vide qu'on ne trouve rien ou qu'on ne puisse pas
// chercher. Les deux modes d'échec sont reproduits ici, à volonté.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXCLUS, EchecRecherche, chercher, lignesTrouvees } from "../outils/recherche";
import { surEchec } from "../outils/diagnostic";

let racine: string;

beforeAll(() => {
  racine = mkdtempSync(join(tmpdir(), "recherche-"));
  mkdirSync(join(racine, "src"), { recursive: true });
  mkdirSync(join(racine, "docs", "archive"), { recursive: true });
  mkdirSync(join(racine, "node_modules", "paquet"), { recursive: true });
  mkdirSync(join(racine, ".next", "server"), { recursive: true });
  writeFileSync(join(racine, "src", "a.ts"), "const x = 1;\nconst motifPresent = true;\n");
  writeFileSync(join(racine, "docs", "archive", "vieux.md"), "motifPresent d'avant\n");
  writeFileSync(join(racine, "node_modules", "paquet", "index.js"), "motifPresent dans une dépendance\n");
  writeFileSync(join(racine, ".next", "server", "page.js"), "motifPresent dans la sortie de build\n");
});
afterAll(() => rmSync(racine, { recursive: true, force: true }));

describe("ce qui vaut « rien trouvé », et ce qui n'en est pas", () => {
  it("rend \"\" quand la chaîne est réellement absente", () => {
    expect(chercher("chaine-vraiment-absente", ["src"], racine)).toBe("");
  });

  it("LÈVE quand la cible n'existe pas, au lieu de conclure à une absence", () => {
    // LE défaut d'origine. Un fichier renommé faisait passer la garde au vert
    // pour toujours : elle ne cherchait plus rien et disait « absent ».
    surEchec("une cible inexistante doit lever", () => ({
      racine,
      resultat: (() => {
        try {
          return chercher("x", ["src/inexistant.ts"], racine);
        } catch (e) {
          return `a levé : ${(e as Error).name}`;
        }
      })(),
    }));
    expect(() => chercher("x", ["src/inexistant.ts"], racine)).toThrow(EchecRecherche);
  });

  it("le message d'erreur dit que ce n'est PAS une absence", () => {
    // Celui qui lit le journal de CI doit comprendre en une ligne qu'il ne peut
    // rien conclure, plutôt que de croire la garde satisfaite.
    try {
      chercher("x", ["src/inexistant.ts"], racine);
      expect.unreachable("aurait dû lever");
    } catch (e) {
      expect((e as Error).message).toContain("n'est PAS une absence");
      expect((e as EchecRecherche).code).toBe(2);
    }
  });

  it("trouve ce qui est là", () => {
    const r = chercher("motifPresent", ["src"], racine);
    expect(r).toContain("src/a.ts:2:");
  });
});

describe("ce qui n'est pas du code source n'est pas cherché", () => {
  it.each(["node_modules", ".next"])("%s est exclu", (dossier) => {
    // Ce ne sont pas des sources, et les balayer coûtait 350 Mo par appel dans
    // le dépôt réel — c'est ce coût qui rendait l'échec sous charge probable.
    expect(EXCLUS).toContain(dossier);
    const trouve = chercher("motifPresent", ["."], racine);
    expect(trouve).not.toContain(dossier);
  });

  it("mais le reste EST cherché — sinon l'exclusion masquerait tout", () => {
    // Anti-tautologie : sans cette ligne, une exclusion trop large passerait.
    expect(chercher("motifPresent", ["."], racine)).toContain("src/a.ts");
  });
});

describe("l'archive est écartée des gardes, pas de la recherche", () => {
  it("lignesTrouvees ignore /archive/ par défaut", () => {
    // L'archive décrit le produit tel qu'il ÉTAIT. La réécrire pour verdir une
    // garde reviendrait à effacer la trace de l'erreur corrigée.
    const lignes = lignesTrouvees("motifPresent", ["."], racine);
    expect(lignes.some((l) => l.includes("src/a.ts"))).toBe(true);
    expect(lignes.some((l) => l.includes("/archive/"))).toBe(false);
  });

  it("mais sait la montrer quand on la demande", () => {
    const lignes = lignesTrouvees("motifPresent", ["."], racine, { horsArchive: false });
    expect(lignes.some((l) => l.includes("/archive/"))).toBe(true);
  });
});
