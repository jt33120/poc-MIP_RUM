// C13 — les listes de `packages/db/roles/console-api.mjs` et migration-v93 disent la
// même chose : la garde CI (`verify-db-roles-console.mjs`) compare la base à ces
// listes ; si la migration en posait d'autres, elle comparerait à une liste
// qu'aucune migration n'a posée.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error module ESM, sans déclarations
import { MIP_CONSOLE, MIP_IDENTITY, ROLES } from "../../packages/db/roles/console-api.mjs";

const V93 = readFileSync(join(__dirname, "..", "..", "packages", "db", "sql", "migration-v93.sql"), "utf8");
const SQL = V93.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const liste = (brut: string) => brut.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
const trie = (l: readonly string[]) => [...l].sort();

type Spec = { nom: string; tables: Record<string, string[]>; colonnes: Record<string, Record<string, string[]>>; fonctions: string[]; reglages: Record<string, string>; limiteConnexions: number };

function tablesAccordees(role: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [, privs, tables] of SQL.matchAll(new RegExp(`grant ([a-z, ]+) on table\\s+([^;]+?)\\s+to ${role};`, "g"))) {
    for (const t of liste(tables)) out[t] = trie(liste(privs).map((p) => p.toUpperCase()));
  }
  return out;
}

describe("C13 — migration-v93 ↔ packages/db/roles/console-api.mjs", () => {
  for (const spec of ROLES as Spec[]) {
    it(`${spec.nom} : les privilèges de table, table par table`, () => {
      expect(tablesAccordees(spec.nom)).toEqual(Object.fromEntries(Object.entries(spec.tables).map(([t, p]) => [t, trie(p)])));
    });

    it(`${spec.nom} : les privilèges par colonnes`, () => {
      const accordes: Record<string, Record<string, string[]>> = {};
      for (const [, priv, cols, table] of SQL.matchAll(new RegExp(`grant (\\w+) \\(([^)]+)\\) on (\\w+) to ${spec.nom};`, "g"))) {
        (accordes[table] ??= {})[priv.toUpperCase()] = trie(liste(cols));
      }
      expect(accordes).toEqual(
        Object.fromEntries(Object.entries(spec.colonnes).map(([t, parPriv]) => [t, Object.fromEntries(Object.entries(parPriv).map(([p, c]) => [p, trie(c)]))])),
      );
    });

    it(`${spec.nom} : ses réglages et son plafond de connexions`, () => {
      const poses = Object.fromEntries(
        [...SQL.matchAll(new RegExp(`alter role ${spec.nom} set (\\w+) = '?([^';]+)'?;`, "g"))].map(([, cle, valeur]) => [cle, valeur]),
      );
      expect(poses).toEqual(spec.reglages);
      expect(SQL).toContain(`alter role ${spec.nom} connection limit ${spec.limiteConnexions};`);
    });
  }

  it("une policy est prévue pour chaque table accordée de chaque rôle, et aucune autre", () => {
    const [consoleRls, identiteRls] = [...SQL.matchAll(/c\.relname in \(([\s\S]+?)\)\s+loop/g)].map((m) => trie(liste(m[1])));
    expect(consoleRls).toEqual(trie([...new Set([...Object.keys(MIP_CONSOLE.tables), ...Object.keys(MIP_CONSOLE.colonnes)])].filter((t) => !t.startsWith("v_"))));
    expect(identiteRls).toEqual(trie(Object.keys(MIP_IDENTITY.tables)));
  });

  it("les fonctions retirées à PUBLIC : celles de la liste, à mip_console seulement", () => {
    const m = SQL.match(/p\.proname in \(([\s\S]+?)\)\s+loop/);
    expect(trie(liste(m![1]))).toEqual(trie(MIP_CONSOLE.fonctions));
    expect(SQL).toContain("grant execute on function %s to mip_console");
    expect(SQL).not.toContain("to mip_identity using (true) with check (true)', t);\n    end if;\n  end loop;\n  for");
  });

  it("aucun rôle ne lit un haché de mot de passe hors de l'identité, ni ne tronque une table", () => {
    expect(MIP_CONSOLE.colonnes.console_user.SELECT).not.toContain("password_hash");
    expect(MIP_CONSOLE.tables.console_user).toBeUndefined();
    expect(MIP_CONSOLE.tables.auth_throttle).toBeUndefined();
    expect(SQL).not.toMatch(/grant[^;]*truncate/i);
    expect(SQL).not.toMatch(/grant[^;]*all privileges/i);
  });
});
