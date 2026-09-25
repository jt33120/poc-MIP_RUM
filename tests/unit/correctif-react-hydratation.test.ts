// Le correctif de React 19.3.0 sur l'hydratation, reporté dans le React de Next
// (apps/console/scripts/correctif-react-hydratation.cjs, branché par next.config.mjs).
//
// Le défaut, relevé sur /admin/composants (crawl E2E, erreur #418 « HTML » une
// visite sur quelques dizaines) : un élément hôte dont un enfant RSC n'est pas
// encore arrivé suspend pendant l'hydratation, puis est rejoué ; React ≤ 19.2 le
// rejoue sans ramener le curseur d'hydratation, l'élément réclame son nœud une
// seconde fois et tombe sur son premier enfant. Ce fichier tient le correctif sur
// les bundles que Next sert RÉELLEMENT, et son branchement dans le build.
//
// Pas de DOM dans l'outillage de tests : l'hydratation elle-même n'est pas jouée
// ici. La reproduction (navigateur, page servie en flux sous charge) : 12 visites
// en échec sur 36 sans le correctif, 0 sur 36 avec.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const depuisConsole = createRequire(`${process.cwd()}/apps/console/package.json`);
const correctif = depuisConsole("./scripts/correctif-react-hydratation.cjs") as ((source: string) => string) & {
  corrigerRejeu: (source: string) => string;
  BUNDLES_CLIENT: RegExp;
};

/** Les bundles clients de react-dom que Next sert à l'App Router (production et développement). */
const BUNDLES = ["production", "development"].map((mode) =>
  depuisConsole.resolve(`next/dist/compiled/react-dom/cjs/react-dom-client.${mode}.js`),
);
const PAR_NOM = BUNDLES.map((f) => [path.basename(f), f]);

/** La branche `HostComponent` du rejeu, jusqu'au `default:` qui la suit. */
function brancheDuRejeu(source: string): string {
  const debut = source.search(/function replayBeginWork\(|function replaySuspendedUnitOfWork\(/);
  expect(debut).toBeGreaterThanOrEqual(0);
  const corps = source.slice(debut);
  const cas = corps.indexOf("case 5:");
  return corps.slice(cas, corps.indexOf("default:", cas));
}

describe("correctif de React sur le rejeu pendant l'hydratation", () => {
  it.each(PAR_NOM)("le rejeu d'un élément hôte ramène le curseur d'hydratation sur lui (%s)", (_nom, fichier) => {
    const corrige = correctif(readFileSync(fichier, "utf8"));
    const branche = brancheDuRejeu(corrige);
    // Parent d'hydratation courant : remonter au parent, reposer le curseur sur le nœud de l'élément.
    expect(branche).toMatch(/(\w+) === hydrationParentFiber &&/);
    expect(branche).toContain("popToNextHostParent(");
    expect(branche).toMatch(/nextHydratableInstance = \w+\.stateNode/);
  });

  it.each(PAR_NOM)("le build ne touche ce bundle qu'une fois, et un second passage n'y change rien (%s)", (_nom, fichier) => {
    expect(fichier).toMatch(correctif.BUNDLES_CLIENT);
    const une = correctif(readFileSync(fichier, "utf8"));
    expect(correctif(une)).toBe(une);
    expect(une.match(/fibreRejouee === hydrationParentFiber/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("laisse intact un React qui porte déjà le correctif (≥ 19.3.0)", () => {
    const amont = `function replaySuspendedUnitOfWork(unitOfWork) {
  switch (next.tag) {
    case 5:
      resetHooksOnUnwind(next);
      var fiber = next;
      fiber === hydrationParentFiber &&
        (isHydrating ? (popToNextHostParent(fiber), 5 === fiber.tag && null != fiber.stateNode && (nextHydratableInstance = fiber.stateNode)) : (popToNextHostParent(fiber), (isHydrating = !0)));
    default:
      unwindInterruptedWork(current, next);
  }
}`;
    expect(correctif.corrigerRejeu(amont)).toBe(amont);
  });

  it("refuse un React dont la branche a changé de forme : la montée de Next se relit", () => {
    expect(() => correctif.corrigerRejeu("function replaySuspendedUnitOfWork(u) { switch (u.tag) { default: beginWork(u); } }")).toThrow(
      /branche\(s\) « case 5 »/,
    );
  });

  it("next.config.mjs branche le chargeur sur les bundles clients de react-dom", async () => {
    const { default: config } = await import(/* @vite-ignore */ pathToFileURL(path.resolve("apps/console/next.config.mjs")).href);
    const sortie = config.webpack({ module: { rules: [] } }, {});
    const regle = sortie.module.rules.find((r: { test?: RegExp }) => r.test instanceof RegExp && BUNDLES.every((f) => r.test!.test(f)));
    expect(regle).toBeDefined();
    expect(regle.use).toEqual([{ loader: depuisConsole.resolve("./scripts/correctif-react-hydratation.cjs") }]);
    // Ni le serveur Flight, ni le rendu serveur : seul le client hydrate.
    expect(regle.test.test(depuisConsole.resolve("next/dist/compiled/react-dom/cjs/react-dom-server.node.production.js"))).toBe(false);
  });
});
