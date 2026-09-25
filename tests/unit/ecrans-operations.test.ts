// LA BASCULE, ÉCRAN PAR ÉCRAN : l'opération que la page nomme est bien celle que
// console-api sert AVEC LE MÊME CHARGEUR.
//
// Une page appelle `chargerEcran(ECRANS.overview, chargerOverview, sp)` : servie
// par la console, elle exécute `chargerOverview` ; servie par console-api, elle
// appelle `screens.overview`, que le service sert avec… le chargeur que
// `services/console-api/ecrans.mjs` lui associe. Si les deux divergent (une page
// qui nomme `ECRANS.pages` avec `chargerOverview`), la bascule changerait l'écran
// sans que rien ne compile de travers. Ce test lit les deux sources et les confronte.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ECRANS, ECRANS_ADMIN, ECRANS_SESSION } from "@mip/console-contract";

const RACINE = process.cwd();
const FAMILLES: Record<string, string> = { pages: "ECRANS", administration: "ECRANS_ADMIN", session: "ECRANS_SESSION" };

/** `services/console-api/ecrans.mjs` : chargeur → opération (`ECRANS.overview`). */
function registreDuService(): Map<string, string> {
  const carte = new Map<string, string>();
  let famille: string | null = null;
  for (const ligne of readFileSync(path.join(RACINE, "services/console-api/ecrans.mjs"), "utf8").split("\n")) {
    const f = ligne.match(/^\s*(pages|administration|session):\s*\{/);
    if (f) {
      famille = FAMILLES[f[1]];
      continue;
    }
    if (famille && /^\s*\},?\s*$/.test(ligne)) {
      famille = null;
      continue;
    }
    const m = famille && ligne.match(/^\s*(\w+):\s*page\((?:\([^)]*\)\s*=>\s*)?(charger\w+)/);
    if (m) carte.set(m[2], `${famille}.${m[1]}`);
  }
  return carte;
}

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const p = path.join(dossier, nom);
    if (statSync(p).isDirectory()) return fichiers(p);
    return /\.(ts|tsx)$/.test(nom) ? [p] : [];
  });
}

/** Les appels de la console : `chargerEcran(ECRANS.x, chargerY` ou `lireEcran(ECRANS.x, (p, s, c) => chargerY(`. */
function appelsDeLaConsole(): { fichier: string; operation: string; chargeur: string }[] {
  const motif = /\b(?:chargerEcran|lireEcran)\(\s*(ECRANS(?:_ADMIN|_SESSION)?\.\w+),\s*(?:\([^)]*\)\s*=>\s*)?(charger\w+)/g;
  return fichiers(path.join(RACINE, "apps/console/app")).flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(motif)].map((m) => ({ fichier: path.relative(RACINE, f), operation: m[1], chargeur: m[2] })),
  );
}

describe("bascule — chaque page nomme l'opération que le service sert avec SON chargeur", () => {
  const registre = registreDuService();
  const appels = appelsDeLaConsole();

  it("le registre du service est lu (garde contre un format qui aurait changé)", () => {
    const attendu = Object.keys(ECRANS).length + Object.keys(ECRANS_ADMIN).length + Object.keys(ECRANS_SESSION).length;
    expect(registre.size).toBe(attendu);
  });

  it("chaque appel associe une opération et un chargeur comme le service", () => {
    const ecarts = appels
      .filter((a) => registre.get(a.chargeur) !== a.operation)
      .map((a) => `${a.fichier} : ${a.operation} avec ${a.chargeur} (le service sert ${registre.get(a.chargeur) ?? "rien"} avec ce chargeur)`);
    expect(ecarts).toEqual([]);
  });

  it("chaque écran servi est appelé par la console (pas d'opération orpheline)", () => {
    const appelees = new Set(appels.map((a) => a.operation));
    expect([...registre.values()].filter((op) => !appelees.has(op))).toEqual([]);
  });

  it("plus aucun appel sans opération (l'ancienne signature `chargerEcran(chargeur, …)`)", () => {
    const anciens = fichiers(path.join(RACINE, "apps/console/app")).filter((f) => /\bchargerEcran\(\s*charger\w+/.test(readFileSync(f, "utf8")));
    expect(anciens.map((f) => path.relative(RACINE, f))).toEqual([]);
  });
});
