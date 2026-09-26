// AGENTS.md est le premier fichier que lit un agent de code (Codex, Claude Code),
// et il le suit à la lettre : un chemin qui n'existe plus l'envoie chercher ce qui
// n'est pas là. Ce test ne garde que ce qui se vérifie mécaniquement — chaque
// chemin cité entre accents graves existe ; le reste se relit (/doctor prompt-audit).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const texte = readFileSync("AGENTS.md", "utf8");

/** Les chemins cités : entre accents graves, avec un « / » ou une extension, sans joker ni gabarit (`vNN`). */
function chemins(): string[] {
  const cites = [...texte.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]);
  return [...new Set(cites)].filter(
    (c) => /[/.]/.test(c) && !/NN/.test(c) && /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/.test(c) && !/[*<>{}]|^\.\.\.|^\d/.test(c) && !c.startsWith("next/"),
  );
}

describe("AGENTS.md", () => {
  it("cite des chemins", () => {
    expect(chemins().length).toBeGreaterThan(20);
  });

  it("chaque chemin cité existe", () => {
    const racine = ["apps/console/public/", "apps/extension/vendor/", "packages/rum-sdk/dist/", "apps/console/public/downloads/"];
    const absents = chemins().filter((c) => {
      if (existsSync(c)) return false;
      // Un nom de fichier seul (`mip-rum-replay.js`, `cliquet.json`) : cherché dans les dossiers qu'AGENTS.md nomme.
      if (!c.includes("/")) return !racine.some((d) => existsSync(d + c)) && !existsSync(`docs/architecture/console-api/${c}`) && !existsSync(`docs/architecture/${c}`) && !existsSync(`docs/operations/${c}`);
      return true;
    });
    expect(absents).toEqual([]);
  });
});
