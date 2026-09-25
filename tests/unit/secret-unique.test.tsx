// C9c — un secret à usage unique va de la commande à SON formulaire, jamais dans
// une URL ni dans un stash du processus ; au rendu serveur, aucun écran ne le porte.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeAvecSecret, SecretAffiche } from "@/components/secret/SecretUnique";

const CONSOLE = join(__dirname, "../../apps/console");

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (nom === "node_modules" || nom === ".next") return [];
    return statSync(chemin).isDirectory() ? fichiers(chemin) : /\.(ts|tsx)$/.test(nom) ? [chemin] : [];
  });
}

describe("secret à usage unique (C9c)", () => {
  const sources = [...fichiers(join(CONSOLE, "app")), ...fichiers(join(CONSOLE, "lib")), ...fichiers(join(CONSOLE, "components"))].map((f) => ({
    f: f.slice(CONSOLE.length + 1),
    texte: readFileSync(f, "utf8"),
  }));

  it("le stash mémoire a disparu : ni stashSecret ni popSecret", () => {
    expect(sources.filter((s) => /\b(stashSecret|popSecret)\b/.test(s.texte)).map((s) => s.f)).toEqual([]);
  });

  it("aucune server action ne met un secret dans l'URL d'une redirection", () => {
    const fautives = sources
      .filter((s) => /^\s*["']use server["']/m.test(s.texte))
      .flatMap((s) =>
        [...s.texte.matchAll(/redirect\(`[^`]*`\)/g)]
          .map((m) => m[0])
          .filter((r) => /\$\{[^}]*\b(motDePasse|cle|jeton|secret|token)\b[^}]*\}/.test(r))
          .map((r) => `${s.f} : ${r}`),
      );
    expect(fautives).toEqual([]);
  });

  it("au rendu serveur, le bandeau est vide et le code garde son repère", () => {
    expect(renderToStaticMarkup(<SecretAffiche nom="cle:demo-app" prefixe="Clé de" suffixe=":" />)).toBe("");
    const code = `apiKey:${JSON.stringify("COLLE_ICI_LA_CLE_API")}`;
    const html = renderToStaticMarkup(<CodeAvecSecret nom="cle:demo-app" code={code} repere="COLLE_ICI_LA_CLE_API" rendu="copie" />);
    expect(html).toContain("COLLE_ICI_LA_CLE_API");
  });
});
