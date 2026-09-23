// F27 — gardes de code du domaine performance (plan § 6.5, preuve de fin de F27).
//
// Trois `grep` du plan, rejoués à chaque `pnpm test:unit` plutôt qu'une fois dans une
// PR — une régression doit rougir la CI du lot qui la commet, pas attendre la recette
// suivante :
//
//   - P2 (§ 1.2) : aucun seuil de Web Vital recopié hors de `lib/rating.ts` dans les
//     écrans du domaine — `app/` (ses fichiers de tête : la Vue d'ensemble) et
//     `app/{pages,errors,ux,actions,events,experience}` ; même expression que le plan ;
//   - `fired=` (§ 3.1) : `fired` est le NOMBRE d'alertes émises par « Évaluer
//     maintenant », jamais l'identifiant d'un déclenchement (`evt`) — aucun composant,
//     ni `lib/presets.ts`, ne l'écrit ;
//   - `blindSpots` (F13) : la tuile d'angle mort lit la concordance robot × réel (F57),
//     plus l'ancien champ `blindSpots` — ni la Vue d'ensemble ni `components/perf`.
//
// Un commentaire compte : le plan grep le texte, pas l'AST. Une borne se cite par son
// nom (`THRESHOLDS`, « borne Bon »), jamais par sa valeur.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const CONSOLE = join(__dirname, "..", "..", "apps", "console");

/** Fichiers d'un dossier ; `recursif: false` : ceux de tête seulement (le `app/` du plan). */
function fichiersDe(dossier: string, recursif = true): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) return recursif ? fichiersDe(chemin) : [];
    return e.isFile() ? [chemin] : [];
  });
}

/** Les lignes qui correspondent, « chemin:ligne: texte » — comme `grep -rn`. */
function lignesTrouvees(fichiers: string[], motif: RegExp): string[] {
  return fichiers.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((ligne, i) => (motif.test(ligne) ? [`${relative(CONSOLE, f)}:${i + 1}: ${ligne.trim()}`] : [])),
  );
}

const app = (...segments: string[]) => join(CONSOLE, "app", ...segments);

describe("gardes de code du domaine performance (F27)", () => {
  it("P2 : aucun seuil de Web Vital recopié dans les écrans du domaine", () => {
    const ecrans = [
      ...fichiersDe(app(), false),
      ...["pages", "errors", "ux", "actions", "events", "experience"].flatMap((d) => fichiersDe(app(d))),
    ];
    expect(ecrans.length).toBeGreaterThan(10);
    expect(lignesTrouvees(ecrans, /2500|4000|\b200\b.*500|0\.25/)).toEqual([]);
  });

  it("fired= : aucun lien de composant ni de vue préréglée ne désigne un déclenchement par le compte d'alertes", () => {
    const sources = [...fichiersDe(join(CONSOLE, "components")), join(CONSOLE, "lib", "presets.ts")];
    expect(lignesTrouvees(sources, /fired=/)).toEqual([]);
  });

  it("blindSpots : la Vue d'ensemble et components/perf ne lisent plus l'ancien champ d'angle mort", () => {
    const sources = [app("page.tsx"), ...fichiersDe(join(CONSOLE, "components", "perf"))];
    expect(lignesTrouvees(sources, /blindSpots/)).toEqual([]);
  });

  it("le motif P2 reconnaît bien une borne recopiée (le test n'est pas vide par construction)", () => {
    const motif = /2500|4000|\b200\b.*500|0\.25/;
    expect(motif.test("bandes 200 / 500 ms")).toBe(true);
    expect(motif.test("lcp: 2500")).toBe(true);
    expect(motif.test("un seau de 1200 ms")).toBe(false);
  });
});
