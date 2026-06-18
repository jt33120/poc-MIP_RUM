// C2 (P0 scale) — on teste les bouts PURS de la préparation ClickHouse prod :
//   • chSearchParams : binding serveur CH (param_<name>) — anti-injection, valeurs
//     jamais concaténées dans le SQL ;
//   • heavyQueries : la phase requêtes du bench bascule bien de dialecte (PG idioms
//     vs CH idioms) selon STORE.
// (Le schéma prod et l'égalité Δ=0 sont validés contre une instance CH live, pas en CI.)
import { describe, expect, it } from "vitest";
import { chSearchParams } from "../../infra/clickhouse/writer.mjs";
import { heavyQueries } from "../../scripts/load-bench.mjs";

describe("chSearchParams — binding serveur ClickHouse", () => {
  it("préfixe les params en param_<name> sans les concaténer au SQL", () => {
    const sp = chSearchParams("mip_rum", "SELECT 1 WHERE app_id = {app:String}", { app: "client-a" });
    expect(sp.get("database")).toBe("mip_rum");
    expect(sp.get("query")).toBe("SELECT 1 WHERE app_id = {app:String}");
    expect(sp.get("param_app")).toBe("client-a");
  });

  it("encode les valeurs hostiles (pas d'évasion possible)", () => {
    const sp = chSearchParams("db", "SELECT {x:String}", { x: "a' OR '1'='1" });
    // la valeur reste un param ; ré-encodée, elle ne peut pas casser le SQL
    expect(sp.get("param_x")).toBe("a' OR '1'='1");
    expect(sp.toString()).toContain("param_x=");
  });

  it("sans params : seulement database + query", () => {
    const sp = chSearchParams("db", "SELECT 1");
    expect([...sp.keys()].sort()).toEqual(["database", "query"]);
  });
});

describe("heavyQueries — dialecte selon le store", () => {
  it("postgres : idiomes PG", () => {
    const q = heavyQueries("postgres");
    expect(q.vitals_p75_24h).toContain("percentile_cont");
    expect(q.top_routes_sessions_7d).toContain("count(distinct");
    expect(q.daily_lcp_p75_14d).toContain("date_trunc");
    expect(q.vitals_p75_24h).toContain("$1"); // param positionnel PG
  });

  it("clickhouse : idiomes CH + binding nommé", () => {
    const q = heavyQueries("clickhouse");
    expect(q.vitals_p75_24h).toContain("quantileTDigest");
    expect(q.top_routes_sessions_7d).toContain("uniqExact");
    expect(q.daily_lcp_p75_14d).toContain("toDate(");
    expect(q.vitals_p75_24h).toContain("{app:String}"); // binding nommé CH
    expect(q.vitals_p75_24h).toContain("rum_metric_ch"); // tables suffixées _ch
  });

  it("même jeu de requêtes (mêmes clés logiques) dans les deux dialectes", () => {
    expect(Object.keys(heavyQueries("postgres")).sort()).toEqual(
      Object.keys(heavyQueries("clickhouse")).sort(),
    );
  });

  it("défaut (valeur inconnue) = postgres", () => {
    expect(heavyQueries("autre")).toBe(heavyQueries("postgres"));
  });
});
