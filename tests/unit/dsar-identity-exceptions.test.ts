// P5.3 — une exception backend sans session reste atteignable par l'identité
// HMAC qu'elle porte : comptage, export et effacement la visent directement, sans
// jamais s'appuyer sur la ressemblance d'un message. Avant v69, rum_error ne porte
// pas d'identité : le DSAR garde son chemin par les sessions. La preuve sur
// PostgreSQL est dans tests/integration/error-backend-otel-sql.test.ts.
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

vi.mock("@/lib/db", () => ({ q: vi.fn(), tx: vi.fn() }));

import { dsarIdentityCounts, dsarIdentityErase, type IdentityDsarIo } from "../../apps/console/lib/queries-dsar";

const APP = "dsar-exceptions";
const HASH = "c".repeat(64);

interface Appel {
  sql: string;
  params: unknown[];
}

function io(rumErrorPorteIdentite: boolean) {
  const appels: Appel[] = [];
  const repondre = (sql: string, params: unknown[] = []) => {
    appels.push({ sql, params });
    if (sql.includes("to_regclass")) return [{ present: true }];
    if (sql.includes("information_schema.columns")) return [{ present: rumErrorPorteIdentite }];
    if (sql.startsWith("select session_id from rum_session")) return [{ session_id: "session-identifiee" }];
    if (sql.includes("count(*)")) return [{ n: 0 }];
    return [];
  };
  const client = {
    query: async (sql: string, params?: unknown[]) => ({ rows: repondre(sql, params), rowCount: 0 }),
  } as unknown as PoolClient;
  const seam: IdentityDsarIo = {
    query: async <T,>(sql: string, params?: unknown[]) => repondre(sql, params) as T[],
    transaction: async (fn) => fn(client),
  };
  return { appels, seam };
}

const surTable = (appels: Appel[], debut: string, table: string) =>
  appels.filter(({ sql }) => sql.startsWith(debut) && new RegExp(`from ${table}\\s`).test(sql));

describe("DSAR par identité — exceptions sans session (P5.3)", () => {
  it("compte les exceptions sans session portant le HMAC, et seulement dans rum_error", async () => {
    const { appels, seam } = io(true);
    await dsarIdentityCounts(APP, "user", HASH, seam);
    const [erreurs] = surTable(appels, "select count(*)", "rum_error");
    expect(erreurs.sql).toContain("(app_id = $1 and session_id is null and user_id_hash = $2)");
    expect(erreurs.params).toEqual([APP, HASH]);
    for (const table of ["rum_metric", "rum_span", "rum_event"]) {
      expect(surTable(appels, "select count(*)", table)[0].sql, table).not.toContain("session_id is null");
    }
  });

  it("efface ces exceptions avec les lignes des sessions verrouillées, par le HMAC du bon type", async () => {
    const { appels, seam } = io(true);
    await dsarIdentityErase(APP, "account", HASH, seam);
    const [erreurs] = surTable(appels, "delete from", "rum_error");
    // P8.1 : `app_id` est lié en TÊTE, donc sur les DEUX branches. Il ne l'était
    // que sur celle des exceptions sans session : la branche par sessions
    // supprimait sur un identifiant émis par le client, que deux applications
    // peuvent porter à l'identique.
    expect(erreurs.sql).toMatch(/app_id = \$2 and \(session_id = any\(\$1::text\[\]\) or \(session_id is null and account_id_hash = \$3\)\)/);
    expect(erreurs.params).toEqual([["session-identifiee"], APP, HASH]);
    expect(surTable(appels, "delete from", "rum_metric")[0].sql).toContain("app_id = $2 and session_id = any($1::text[])");
    expect(surTable(appels, "delete from", "rum_metric")[0].params).toEqual([["session-identifiee"], APP]);
  });

  it("avant v69, rum_error ne porte pas d'identité : le chemin par les sessions reste le seul", async () => {
    const { appels, seam } = io(false);
    await dsarIdentityCounts(APP, "user", HASH, seam);
    await dsarIdentityErase(APP, "user", HASH, seam);
    expect(appels.some(({ sql }) => sql.includes("session_id is null"))).toBe(false);
  });
});
