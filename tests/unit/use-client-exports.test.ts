// Un module `"use client"` n'exporte, vu d'un composant serveur, que des
// RÉFÉRENCES client : un composant s'y rend très bien, mais une fonction ordinaire
// appelée côté serveur (`entreGuillemets(nom)`) y fait tomber la page en 500. La
// contre-recette du 26/09/2026 l'a trouvé sur huit écrans (liste des clients, mode
// édition des tableaux de bord, objectifs, SLO…) ; aucun test unitaire ne le voyait,
// puisqu'ils rendent les composants hors de Next.
//
// La garde : aucun fichier SERVEUR (sans `"use client"`) n'importe, depuis un module
// client, autre chose qu'un composant (PascalCase) ou un type.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(__dirname, "..", "..", "apps", "console");
const DOSSIERS = ["app", "components", "lib"];

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((nom) => {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) return nom === "node_modules" || nom.startsWith(".") ? [] : fichiers(chemin);
    return /\.(ts|tsx)$/.test(nom) ? [chemin] : [];
  });
}

const tous = DOSSIERS.flatMap((d) => fichiers(join(RACINE, d)));
const estClient = (src: string) => /^\s*(\/\/[^\n]*\n\s*)*["']use client["']/.test(src);
const sources = new Map(tous.map((f) => [f, readFileSync(f, "utf8")]));

/** Le module visé par un spécificateur `@/…` ou relatif, s'il est dans la console. */
function resoudre(depuis: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(RACINE, spec.slice(2)) : spec.startsWith(".") ? join(depuis, "..", spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (sources.has(c)) return c;
  }
  return null;
}

describe("modules « use client » : rien d'autre qu'un composant n'en sort vers le serveur", () => {
  it("aucun fichier serveur n'importe une fonction ou une valeur d'un module client", () => {
    const fautes: string[] = [];
    for (const [fichier, src] of sources) {
      if (estClient(src)) continue;
      for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
        if (m[1]) continue; // `import type { … }`
        const cible = resoudre(fichier, m[3]);
        if (!cible || !estClient(sources.get(cible)!)) continue;
        const noms = m[2]
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n && !n.startsWith("type "))
          .map((n) => n.split(/\s+as\s+/)[0].trim());
        for (const nom of noms) {
          if (!/^[A-Z]/.test(nom)) fautes.push(`${relative(RACINE, fichier)} importe « ${nom} » de ${relative(RACINE, cible)}`);
        }
      }
    }
    expect(fautes).toEqual([]);
  });
});
