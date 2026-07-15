// v33 — apps internes (dogfooding) exclues de la vue « toutes apps », avec toggle.
import { describe, expect, it } from "vitest";
import { parseFilters } from "../../apps/console/lib/filters.ts";
import { internalClause } from "../../apps/console/lib/queries.ts";

describe("parseFilters — includeInternal (v33)", () => {
  it("internal=1 -> includeInternal vrai", () => {
    expect(parseFilters({ internal: "1" }).includeInternal).toBe(true);
  });
  it("absent -> falsy (exclu par défaut)", () => {
    expect(parseFilters({}).includeInternal).toBeFalsy();
  });
  it("internal=0 (ou autre) -> falsy", () => {
    expect(parseFilters({ internal: "0" }).includeInternal).toBeFalsy();
  });
});

describe("internalClause — exclusion conditionnelle (v33)", () => {
  const base = { app: null, period: "24h", device: null, segment: [] } as const;

  it("vue « toutes apps », défaut -> exclut les apps internes", () => {
    const c = internalClause({ ...base }, "m.app_id");
    expect(c).toContain("m.app_id not in (select app_id from app_registry where internal)");
  });

  it("app précise sélectionnée -> aucune exclusion (app interne consultable)", () => {
    expect(internalClause({ ...base, app: "mip-rum-console" }, "m.app_id")).toBe("");
  });

  it("toggle « inclure les apps internes » -> aucune exclusion", () => {
    expect(internalClause({ ...base, includeInternal: true }, "m.app_id")).toBe("");
  });

  it("n'ajoute aucun paramètre $n (sous-requête pure)", () => {
    expect(internalClause({ ...base }, "s.app_id")).not.toContain("$");
  });
});
