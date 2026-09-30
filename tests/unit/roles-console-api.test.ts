// C13 — les listes de `packages/db/roles/console-api.mjs` et migration-v93 disent la
// même chose : la garde CI (`verify-db-roles-console.mjs`) compare la base à ces
// listes ; si la migration en posait d'autres, elle comparerait à une liste
// qu'aucune migration n'a posée.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error module ESM, sans déclarations
import { MIP_CONSOLE, MIP_IDENTITY, ROLES, SUPPRIMEES } from "../../packages/db/roles/console-api.mjs";

const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const V93 = readFileSync(join(SQL_DIR, "migration-v93.sql"), "utf8");
const SQL = V93.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
/**
 * Ce que v93 nomme, moins les tables qu'une migration ultérieure a supprimées
 * (`SUPPRIMEES`) : les listes décrivent la base d'AUJOURD'HUI, v93 celle du 25/09.
 */
const liste = (brut: string) =>
  brut.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter((s) => s && !(s in SUPPRIMEES));
const trie = (l: readonly string[]) => [...l].sort();
/**
 * Les tables accordées à `mip_console` APRÈS v93, par la migration qui les crée :
 * v93 ne peut pas les nommer. Chacune est vérifiée dans SA migration (droit et
 * policy), et retirée de la comparaison avec v93.
 */
const APRES_V93: Record<string, { version: number; privileges: string[] }> = {
  collecte_fenetre: { version: 103, privileges: ["SELECT"] },
};
const sansApresV93 = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([t]) => !(t in APRES_V93)));

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
      expect(tablesAccordees(spec.nom)).toEqual(Object.fromEntries(Object.entries(sansApresV93(spec.tables)).map(([t, p]) => [t, trie(p)])));
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
    expect(consoleRls).toEqual(trie([...new Set([...Object.keys(sansApresV93(MIP_CONSOLE.tables)), ...Object.keys(MIP_CONSOLE.colonnes)])].filter((t) => !t.startsWith("v_"))));
    expect(identiteRls).toEqual(trie(Object.keys(MIP_IDENTITY.tables)));
  });

  it("une table accordée après v93 l'est par sa migration, avec sa policy, et figure dans la liste", () => {
    for (const [table, { version, privileges }] of Object.entries(APRES_V93)) {
      const sql = readFileSync(join(SQL_DIR, `migration-v${version}.sql`), "utf8");
      expect(sql, table).toContain(`grant ${privileges.join(", ").toLowerCase()} on ${table} to mip_console;`);
      expect(sql, table).toMatch(new RegExp(`create policy mip_console_acces on ${table}\\b`));
      expect(trie(MIP_CONSOLE.tables[table] ?? []), table).toEqual(trie(privileges));
    }
  });

  it("les fonctions retirées à PUBLIC : celles de la liste, à mip_console seulement", () => {
    const m = SQL.match(/p\.proname in \(([\s\S]+?)\)\s+loop/);
    expect(trie(liste(m![1]))).toEqual(trie(MIP_CONSOLE.fonctions));
    expect(SQL).toContain("grant execute on function %s to mip_console");
    expect(SQL).not.toContain("to mip_identity using (true) with check (true)', t);\n    end if;\n  end loop;\n  for");
  });

  it("chaque table retirée des listes a bien été supprimée par la migration qu'elle cite", () => {
    for (const [nom, raison] of Object.entries(SUPPRIMEES as Record<string, string>)) {
      const version = raison.match(/^v(\d+) /)?.[1];
      expect(version, nom).toBeDefined();
      const sql = readFileSync(join(SQL_DIR, `migration-v${version}.sql`), "utf8");
      expect(sql, nom).toMatch(new RegExp(`drop table if exists[^;]*\\b${nom}\\b`));
      for (const spec of ROLES as Spec[]) expect(spec.tables[nom], `${spec.nom}.${nom}`).toBeUndefined();
    }
  });

  it("aucun rôle ne lit un haché de mot de passe hors de l'identité, ni ne tronque une table", () => {
    expect(MIP_CONSOLE.colonnes.console_user.SELECT).not.toContain("password_hash");
    expect(MIP_CONSOLE.tables.console_user).toBeUndefined();
    expect(MIP_CONSOLE.tables.auth_throttle).toBeUndefined();
    expect(SQL).not.toMatch(/grant[^;]*truncate/i);
    expect(SQL).not.toMatch(/grant[^;]*all privileges/i);
  });
});
