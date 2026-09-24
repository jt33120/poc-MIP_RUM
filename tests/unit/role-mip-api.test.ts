// P4 — la liste blanche de `mip_api` et migration-v89 disent la même chose.
//
// `packages/db/roles/mip-api.mjs` est ce que la garde CI compare à la base ;
// migration-v89.sql est ce que la base reçoit. Si l'un bouge sans l'autre, la
// garde comparerait la base à une liste qu'aucune migration n'a posée.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLONNES,
  FONCTIONS,
  HORS_LECTURE,
  LIMITE_CONNEXIONS,
  REGLAGES,
  RETIREES_A_PUBLIC,
  TABLES,
  // @ts-expect-error module ESM, sans déclarations
} from "../../packages/db/roles/mip-api.mjs";
// @ts-expect-error module ESM, sans déclarations
import { nomme } from "../../scripts/ci/verify-db-roles.mjs";

const V89 = readFileSync(join(__dirname, "..", "..", "packages", "db", "sql", "migration-v89.sql"), "utf8");
/** Le SQL seul, sans les commentaires : ce que la base exécute. */
const SQL = V89.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const liste = (brut: string) => brut.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
const trie = (l: readonly string[]) => [...l].sort();

describe("P4 — migration-v89 ↔ packages/db/roles/mip-api.mjs", () => {
  it("les tables lues en entier sont celles de la liste", () => {
    const m = SQL.match(/grant select on table\s+([\s\S]+?)\s+to mip_api;/);
    expect(trie(liste(m![1]))).toEqual(trie(TABLES));
  });

  it("les tables lues par colonnes, colonne par colonne", () => {
    const accordees = Object.fromEntries(
      [...SQL.matchAll(/grant select \(([^)]+)\) on (\w+) to mip_api;/g)].map(([, cols, table]) => [table, trie(liste(cols))]),
    );
    expect(accordees).toEqual(Object.fromEntries(Object.entries(COLONNES).map(([t, c]) => [t, trie(c as string[])])));
  });

  it("une policy de lecture est prévue pour chaque table accordée, et aucune autre", () => {
    const m = SQL.match(/c\.relname in \(([\s\S]+?)\)\s+loop/);
    expect(trie(liste(m![1]))).toEqual(trie([...TABLES.filter((t: string) => t !== "v_anomaly"), ...Object.keys(COLONNES)]));
    expect(SQL).toContain("for select to mip_api using (true)");
    expect(SQL).not.toMatch(/create policy[^;]*for (all|insert|update|delete)/i);
  });

  it("les fonctions : la lecture accordée, les écritures retirées à PUBLIC", () => {
    expect([...SQL.matchAll(/p\.proname = '(\w+)'/g)].map((m) => m[1])).toEqual([...FONCTIONS]);
    const m = SQL.match(/p\.proname in \(([\s\S]+?)\)\s+loop/);
    expect(trie(liste(m![1]))).toEqual(trie(RETIREES_A_PUBLIC));
    expect(SQL).toContain("revoke execute on function %s from public");
  });

  it("les réglages et le plafond de connexions", () => {
    const poses = Object.fromEntries(
      [...SQL.matchAll(/alter role mip_api set (\w+) = '?([^';]+)'?;/g)].map(([, cle, valeur]) => [cle, valeur]),
    );
    expect(poses).toEqual(REGLAGES);
    expect(SQL).toContain(`alter role mip_api connection limit ${LIMITE_CONNEXIONS};`);
  });

  it("le rôle naît sans connexion ni privilège de rôle, et sans privilège par défaut", () => {
    expect(SQL).toContain("create role mip_api nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;");
    expect(SQL).not.toMatch(/alter default privileges/i);
    expect(SQL).not.toMatch(/password/i);
    expect(SQL).not.toMatch(/grant (insert|update|delete|truncate|all)\b/i);
  });

  it("aucune relation n'est à la fois accordée et déclarée hors lecture", () => {
    const accordees = new Set([...TABLES, ...Object.keys(COLONNES)]);
    expect(Object.keys(HORS_LECTURE).filter((t) => accordees.has(t))).toEqual([]);
  });

  it("`nomme` reconnaît un identifiant entier, pas un préfixe", () => {
    expect(nomme("from rum_event_index e", "rum_event")).toBe(false);
    expect(nomme("from rum_event e", "rum_event")).toBe(true);
    expect(nomme('table: "syn_snapshot",', "syn_snapshot")).toBe(true);
    expect(nomme("my_slo_status", "slo_status")).toBe(false);
  });
});
