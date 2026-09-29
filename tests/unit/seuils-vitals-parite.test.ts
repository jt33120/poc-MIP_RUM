// Parité des TROIS copies des seuils Web Vitals.
//
// Les bornes web.dev vivent en trois endroits, chacun avec une raison d'exister :
//   - `packages/rum-sdk/src/vitals.ts` : le SDK note la mesure au moment de l'émettre ;
//   - `packages/backend/shared/otlp.mjs` : l'ingestion RECALCULE la note, quoi
//     qu'envoie le SDK (c'est la source de vérité de `rum_metric.rating`) ;
//   - `apps/console/lib/rating.ts` : la console note les agrégats p75 au rendu.
// Les trois commentaires disent « miroir strict » des deux autres ; jusqu'au
// 29/09/2026, aucun test ne le vérifiait. Une borne qui bouge d'un seul côté
// ferait dire « bon » à la tuile et « à améliorer » au détail de la session, pour
// la même mesure.
//
// Deux vérifications, parce qu'elles n'attrapent pas la même dérive :
//   1. le TEXTE : les objets `THRESHOLDS` des deux copies non exportées, relus dans
//      leur source (mêmes noms, mêmes bornes — un vital ajouté d'un seul côté se voit) ;
//   2. le COMPORTEMENT : les trois `rating2026` rendent la même note sur chaque
//      borne et juste au-delà (« bon » inclusif, « mauvais » strict) — un `<` à la
//      place d'un `<=` se voit.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THRESHOLDS, rating2026 as noteConsole } from "../../apps/console/lib/rating";
import { rating2026 as noteIngestion } from "../../packages/backend/shared/otlp.mjs";
import { rating2026 as noteSdk } from "../../packages/rum-sdk/src/vitals";

const RACINE = join(__dirname, "..", "..");
const COPIES = {
  sdk: "packages/rum-sdk/src/vitals.ts",
  ingestion: "packages/backend/shared/otlp.mjs",
  console: "apps/console/lib/rating.ts",
} as const;

/** L'objet `THRESHOLDS` d'une source, relu comme un texte : { LCP: [2500, 4000], … }. */
function seuilsDuTexte(source: string): Record<string, [number, number]> {
  const bloc = /const THRESHOLDS\b[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!bloc) throw new Error("objet THRESHOLDS introuvable");
  const lignes = [...bloc[1].matchAll(/^\s*(\w+)\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/gm)];
  return Object.fromEntries(lignes.map(([, nom, bon, mauvais]) => [nom, [Number(bon), Number(mauvais)]]));
}

const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

describe("parité des seuils Web Vitals : SDK, ingestion, console", () => {
  it("la console expose les cinq vitals (référence des deux autres copies)", () => {
    expect(Object.keys(THRESHOLDS).sort()).toEqual(["CLS", "FCP", "INP", "LCP", "TTFB"]);
  });

  for (const [copie, chemin] of Object.entries(COPIES)) {
    it(`${copie} (${chemin}) : mêmes vitals, mêmes bornes que lib/rating.ts`, () => {
      expect(seuilsDuTexte(lire(chemin))).toEqual(THRESHOLDS);
    });
  }

  it("les trois rating2026 rendent la même note sur chaque borne et juste au-delà", () => {
    for (const [vital, [bon, mauvais]] of Object.entries(THRESHOLDS)) {
      const pas = vital === "CLS" ? 0.001 : 1;
      for (const valeur of [0, bon, bon + pas, mauvais, mauvais + pas]) {
        const attendu = noteConsole(vital, valeur);
        expect(noteIngestion(vital, valeur), `${vital} = ${valeur} (ingestion)`).toBe(attendu);
        expect(noteSdk(vital as Parameters<typeof noteSdk>[0], valeur), `${vital} = ${valeur} (SDK)`).toBe(attendu);
      }
      // « bon » inclusif, « mauvais » strict : la lecture web.dev, des trois côtés.
      expect(noteConsole(vital, bon)).toBe("good");
      expect(noteConsole(vital, mauvais)).toBe("needs-improvement");
      expect(noteConsole(vital, mauvais + pas)).toBe("poor");
    }
  });

  it("le relevé du texte voit une divergence (le test n'est pas vide par construction)", () => {
    const derive = lire(COPIES.ingestion).replace("LCP: [2500, 4000]", "LCP: [2000, 4000]");
    expect(derive).not.toBe(lire(COPIES.ingestion));
    expect(seuilsDuTexte(derive)).not.toEqual(THRESHOLDS);
    const vitalEnPlus = lire(COPIES.sdk).replace("TTFB: [800, 1800],", "TTFB: [800, 1800],\n  FID: [100, 300],");
    expect(Object.keys(seuilsDuTexte(vitalEnPlus))).toContain("FID");
  });
});
