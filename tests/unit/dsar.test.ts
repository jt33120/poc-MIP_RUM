// DSAR — périmètre, ordre de suppression FK-sûr, forme d'export. Logique pure.
import { describe, expect, it } from "vitest";
import {
  buildDsarExport,
  DSAR_ANCHOR,
  DSAR_CHILD_TABLES,
  DSAR_FK_EDGES,
  DSAR_TABLES,
  dsarDeleteOrder,
  dsarExportFilename,
  isSafeDeleteOrder,
  summarizeCounts,
  buildDsarIdentityExport,
  isDsarIdentityHash,
} from "../../apps/console/lib/dsar";

describe("périmètre DSAR", () => {
  it("l'ancre est rum_session et n'est pas dans les enfants", () => {
    expect(DSAR_ANCHOR).toBe("rum_session");
    expect(DSAR_CHILD_TABLES).not.toContain("rum_session");
  });
  it("DSAR_TABLES = enfants + ancre, sans doublon", () => {
    expect(DSAR_TABLES).toEqual([...DSAR_CHILD_TABLES, DSAR_ANCHOR]);
    expect(new Set(DSAR_TABLES).size).toBe(DSAR_TABLES.length);
  });
});

describe("dsarDeleteOrder / isSafeDeleteOrder", () => {
  it("supprime l'ancre en dernier", () => {
    const order = dsarDeleteOrder();
    expect(order[order.length - 1]).toBe("rum_session");
  });
  it("respecte toutes les arêtes FK (enfant avant parent)", () => {
    expect(isSafeDeleteOrder(dsarDeleteOrder())).toBe(true);
  });
  it("détecte un ordre non sûr (parent avant enfant)", () => {
    // rum_pageview avant rum_metric viole rum_metric -> rum_pageview
    expect(isSafeDeleteOrder(["rum_pageview", "rum_metric", "rum_session"])).toBe(false);
  });
  it("chaque arête référence des tables du périmètre", () => {
    for (const [child, parent] of DSAR_FK_EDGES) {
      expect(DSAR_TABLES).toContain(child);
      expect(DSAR_TABLES).toContain(parent);
    }
  });
});

describe("summarizeCounts / buildDsarExport", () => {
  const tables = {
    rum_session: [{ session_id: "s1" }, { session_id: "s2" }],
    rum_metric: [{ v: 1 }, { v: 2 }, { v: 3 }],
    rum_error: [],
  };
  it("résume le volume par table", () => {
    expect(summarizeCounts(tables)).toEqual({ rum_session: 2, rum_metric: 3, rum_error: 0 });
  });
  it("assemble un document stable avec session_count dérivé de l'ancre", () => {
    const doc = buildDsarExport({
      app: "demo",
      visitorId: "abc123def456",
      generatedAt: "2026-07-08T10:00:00.000Z",
      tables,
    });
    expect(doc.kind).toBe("mip-rum-dsar-export");
    expect(doc.version).toBe(2); // v2 : l'ancre est visitor_id, plus user_hash
    expect(doc.visitor_id).toBe("abc123def456");
    expect(doc.app).toBe("demo");
    expect(doc.session_count).toBe(2);
    expect(doc.summary.rum_metric).toBe(3);
    expect(doc.tables).toBe(tables);
  });
  it("session_count = 0 si aucune session", () => {
    const doc = buildDsarExport({
      app: "demo",
      visitorId: "x",
      generatedAt: "2026-07-08T10:00:00.000Z",
      tables: { rum_metric: [{ v: 1 }] },
    });
    expect(doc.session_count).toBe(0);
  });
});

describe("dsarExportFilename", () => {
  it("horodaté, identifiant tronqué, sans caractères problématiques", () => {
    const name = dsarExportFilename("abcdef0123456789zzz", "2026-07-08T10:00:00.000Z");
    expect(name).toBe("dsar-abcdef012345-2026-07-08T10-00-00-000Z.json");
    expect(name).not.toMatch(/[:.](?!json)/); // pas de ':' ni '.' hors extension
  });
  it("replie sur \"user\" si l'identifiant ne donne rien d'alphanumérique", () => {
    expect(dsarExportFilename("!!!", "2026-07-08T10-00-00Z")).toContain("dsar-user-");
  });
});

describe("DSAR par identité métier", () => {
  const hash = "a".repeat(64);
  it("n'accepte que le HMAC et assemble un export sans identifiant brut", () => {
    expect(isDsarIdentityHash(hash)).toBe(true);
    expect(isDsarIdentityHash("alice@example.test")).toBe(false);
    const doc = buildDsarIdentityExport({
      app: "demo",
      identityKind: "user",
      identityHash: hash,
      generatedAt: "2026-09-15T00:00:00.000Z",
      tables: { rum_session: [] },
    });
    expect(doc).toMatchObject({ version: 1, identity_kind: "user", identity_hash: hash });
    expect(JSON.stringify(doc)).not.toContain("alice@example.test");
  });
});
