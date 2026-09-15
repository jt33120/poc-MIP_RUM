// Avant v65, l'absence de rum_event_index ne doit ni interrompre un DSAR ni
// déclencher une requête qui ferait rollback l'effacement existant.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { q, tx, clientQuery } = vi.hoisted(() => ({
  q: vi.fn(),
  tx: vi.fn(),
  clientQuery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ q, tx }));

import { dsarCounts, dsarErase, dsarExport } from "../../apps/console/lib/queries-dsar";

beforeEach(() => {
  q.mockImplementation(async (sql: string) => {
    if (sql.includes("to_regclass")) return [{ present: false }];
    if (sql.includes("count(*)")) return [{ n: sql.includes("rum_session") ? 1 : 0 }];
    return [];
  });
  clientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("to_regclass")) return { rows: [{ present: false }], rowCount: 0 };
    if (sql.startsWith("select session_id")) return { rows: [{ session_id: "session-a" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  tx.mockImplementation(async (fn: (client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }));
});

describe("DSAR avant rum_event_index", () => {
  it("compte et exporte un périmètre stable avec une projection vide", async () => {
    const counts = await dsarCounts("app-a", "visitor-a");
    expect(counts).toContainEqual({ table: "rum_event_index", rows: 0 });
    const exported = await dsarExport("app-a", "visitor-a", "2026-09-15T00:00:00.000Z");
    expect(exported.tables.rum_event_index).toEqual([]);
    expect(q.mock.calls.some(([sql]) => String(sql).includes("from rum_event_index"))).toBe(false);
  });

  it("efface les sources et la file sans tenter de supprimer la table absente", async () => {
    const deleted = await dsarErase("app-a", "visitor-a");
    expect(deleted).toContainEqual({ table: "rum_event_index", deleted: 0 });
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("delete from rum_event_index"))).toBe(false);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("delete from ingest_raw"))).toBe(true);
  });
});
