// C-R — LE CLIQUET DE LA PISTE C : ce qui, dans la console, atteint la base.
//
// `docs/architecture/console-api/cliquet.json` liste nominativement les écrans,
// fichiers d'actions, routes et composants dont le graphe d'import à l'exécution
// atteint `lib/db.ts` (ou `pg`). La piste C vide cette liste jusqu'au jalon M4.
// Ce test la tient dans un seul sens :
//
//   · une entrée NOUVELLE est refusée — un écran branché sur la base pendant
//     qu'on en libère un autre ferait stagner le compte sans que rien ne le dise ;
//   · une entrée LIBÉRÉE doit sortir du cliquet dans la PR qui la libère — sinon
//     la place resterait ouverte, et un retour en arrière passerait inaperçu.
//
// Resserrer : `node scripts/dev/inventaire-console.mjs` (réécrit aussi l'inventaire).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cliquetDe,
  comparerCliquet,
  FICHIER_CLIQUET,
  relever,
  // @ts-expect-error module ESM, sans déclarations
} from "../../scripts/dev/inventaire-console.mjs";

const MESSAGE = "cliquet de la piste C : `node scripts/dev/inventaire-console.mjs` pour le resserrer, jamais pour l'élargir";

describe("C-R — le cliquet de la console sans base", () => {
  const releve = relever();
  const courant = cliquetDe(releve);
  const enregistre = JSON.parse(readFileSync(FICHIER_CLIQUET, "utf8"));

  it("aucun écran, action, route ou composant NOUVEAU n'atteint la base", () => {
    expect(comparerCliquet(enregistre, courant).nouveaux, MESSAGE).toEqual([]);
  });

  it("ce qui n'atteint plus la base est sorti du cliquet", () => {
    expect(comparerCliquet(enregistre, courant).liberes, MESSAGE).toEqual([]);
  });

  it("les pages publiques de la vitrine légale n'atteignent pas la base", () => {
    const legales = releve.ecrans.filter((e: { chemin: string }) => e.chemin.startsWith("/legal"));
    expect(legales.length).toBeGreaterThan(0);
    expect(legales.filter((e: { base: boolean }) => e.base)).toEqual([]);
  });

  it("chaque entrée du cliquet a sa chaîne d'import jusqu'à la base", () => {
    for (const k of releve.composants) expect(k.chaine?.at(-1), k.fichier).toMatch(/^(lib\/db\.ts|pg)$/);
  });
});

describe("C-R — comparerCliquet", () => {
  const vide = { ecrans: [], actions: [], routes: [], composants: [], layout: false };

  it("refuse une entrée nouvelle, dans chaque catégorie", () => {
    const r = comparerCliquet(vide, { ...vide, ecrans: ["/x"], routes: ["/api/y"], layout: true });
    expect(r.nouveaux).toEqual(["ecrans : /x", "routes : /api/y", "layout racine"]);
    expect(r.liberes).toEqual([]);
  });

  it("demande de resserrer quand une entrée disparaît", () => {
    const r = comparerCliquet({ ...vide, actions: ["app/a/actions.ts"], layout: true }, vide);
    expect(r.liberes).toEqual(["actions : app/a/actions.ts", "layout racine"]);
    expect(r.nouveaux).toEqual([]);
  });

  it("un échange un pour un n'est pas neutre : les deux sont signalés", () => {
    const r = comparerCliquet({ ...vide, ecrans: ["/a"] }, { ...vide, ecrans: ["/b"] });
    expect(r).toEqual({ nouveaux: ["ecrans : /b"], liberes: ["ecrans : /a"] });
  });
});
