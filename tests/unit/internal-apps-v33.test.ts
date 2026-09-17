// v33 — apps internes (dogfooding) exclues de la vue « toutes apps », avec toggle.
// Depuis P6.2 : un seul point, `compileScope` (lib/query-compiler.ts), pour toutes les lectures.
import { describe, expect, it } from "vitest";
import { binder, compileScope } from "../../apps/console/lib/query-compiler.ts";
import { parseAnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract.ts";

const ADMIN: ScopePrincipal = { role: "admin", apps: null };

function requete(qs: string, principal: ScopePrincipal = ADMIN) {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: Date.parse("2026-09-17T12:00:00Z") });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

describe("includeInternal (v33) — lu par le contrat", () => {
  it("internal=1 -> includeInternal vrai", () => {
    expect(requete("internal=1").filters.includeInternal).toBe(true);
  });
  it("absent ou autre valeur -> faux (exclu par défaut)", () => {
    expect(requete("").filters.includeInternal).toBe(false);
    expect(requete("internal=0").filters.includeInternal).toBe(false);
  });
});

describe("compileScope — exclusion conditionnelle des apps internes (v33)", () => {
  it("vue « toutes apps », défaut -> exclut les apps internes, lignes sans app comprises", () => {
    const { params, bind } = binder();
    const sql = compileScope(requete(""), "m.app_id", bind);
    expect(sql).toBe(
      " and not exists (select 1 from app_registry internes where internes.internal and internes.app_id = m.app_id)",
    );
    // Sous-requête pure : aucun paramètre.
    expect(params).toEqual([]);
  });

  it("app précise sélectionnée -> aucune exclusion (app interne consultable), app liée", () => {
    const { params, bind } = binder();
    expect(compileScope(requete("app=mip-rum-console"), "m.app_id", bind)).toBe(" and m.app_id = any($1::text[])");
    expect(params).toEqual([["mip-rum-console"]]);
  });

  it("toggle « inclure les apps internes » -> aucune exclusion", () => {
    expect(compileScope(requete("internal=1"), "m.app_id", binder().bind)).toBe("");
  });

  it("viewer scopé en vue « toutes » : ses apps autorisées, liées, jamais une exclusion seule", () => {
    const { params, bind } = binder();
    const sql = compileScope(requete("", { role: "viewer", apps: ["b", "a"] }), "s.app_id", bind);
    expect(sql).toBe(" and s.app_id = any($1::text[])");
    expect(params).toEqual([["a", "b"]]);
  });

  it("refuse une colonne d'app qui ne vient pas du code", () => {
    expect(() => compileScope(requete(""), "m.app_id; drop table x", binder().bind)).toThrow();
  });
});
