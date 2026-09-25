// C9 — LE LINT DES ÉCRITURES : une ligne d'une application s'écrit DANS elle.
//
// Avant C8, activer une règle, supprimer un SLO ou un canal, révoquer un jeton
// filtrait par identifiant seul (`where id = $1`) : un administrateur d'une liste
// touchait la ligne d'une application hors de celle-ci en devinant un entier. Les
// commandes filtrent désormais chaque ligne par son application
// (`where id = $1 and app_id = $2`). Ce test relit TOUT le SQL d'écriture de la
// console et refuse un `update` ou un `delete` par identifiant sans `app_id` — sauf
// sur les tables listées ci-dessous, chacune avec la raison pour laquelle la ligne
// n'a pas d'application, ou pourquoi sa porte est ailleurs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(process.cwd(), "apps", "console");
const DOSSIERS = [join(RACINE, "lib"), join(RACINE, "app")];

/** Les tables dont une ligne s'écrit par son identifiant seul, et pourquoi c'est juste. */
const EXEMPTEES: Record<string, string> = {
  console_user: "un compte n'a pas d'application : ses écritures sont celles de l'administrateur de la plateforme (C9)",
  console_session: "une session appartient à un compte, pas à une application",
  dashboard:
    "un tableau peut être transverse (sans application) : la porte unique `lib/dashboard-access.ts` décide avant l'écriture, et la révision refuse toute écriture fondée sur une lecture dépassée",
  analytics_saved_view: "une vue est personnelle : la ligne est lue sous verrou et confrontée au propriétaire et au périmètre dans la même transaction",
  extension_install: "un poste de l'extension n'a pas d'application : il en observe plusieurs (administrateur de la plateforme)",
  app_registry: "la ligne EST l'application : sa clé est `app_id`",
};

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    return /\.(ts|tsx|mjs)$/.test(nom) ? [chemin] : [];
  });
}

/**
 * Chaque instruction `update …` / `delete from …` d'un fichier, jusqu'à la fin de
 * sa chaîne (une quote double ou un accent grave), son `returning` ou son `;`. Le
 * texte entier est lu, pas seulement les chaînes : une quote simple DANS une
 * requête (`'active'`) ne doit pas couper l'instruction.
 */
function ecritures(texte: string): { table: string; instruction: string }[] {
  const sortie: { table: string; instruction: string }[] = [];
  for (const i of texte.matchAll(/\b(?:update|delete\s+from)\s+([a-z_]+)\b([^`"]*?)(?=\breturning\b|;|`|"|$)/gi)) {
    sortie.push({ table: i[1].toLowerCase(), instruction: i[0].replace(/\s+/g, " ").trim() });
  }
  return sortie;
}

describe("C9 — une écriture par identifiant filtre aussi par application", () => {
  it("aucun `update` ni `delete` … `where id = $n` sans `app_id`, hors des tables exemptées", () => {
    const fautes: string[] = [];
    let vues = 0;
    for (const f of DOSSIERS.flatMap(fichiers)) {
      for (const { table, instruction } of ecritures(readFileSync(f, "utf8"))) {
        if (!/\bwhere\b[\s\S]*\bid\s*=\s*\$\d/i.test(instruction)) continue;
        vues++;
        if (/\bapp_id\b/i.test(instruction) || table in EXEMPTEES) continue;
        fautes.push(`${relative(process.cwd(), f)} : ${instruction.slice(0, 160)}`);
      }
    }
    expect(fautes).toEqual([]);
    // Anti-tautologie : la sonde voit bien les écritures par identifiant.
    expect(vues).toBeGreaterThan(10);
  });

  it("la sonde reconnaît une écriture fautive, et une écriture filtrée", () => {
    expect(ecritures("q(`update slo set active = $2 where id = $1`)")).toEqual([{ table: "slo", instruction: "update slo set active = $2 where id = $1" }]);
    expect(ecritures('q("delete from goal where id = $1 and app_id = $2 returning name")')[0].instruction).toContain("app_id");
  });
});
