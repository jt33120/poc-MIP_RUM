// P0 #5 — vue quota (lib/usage.ts), helper pur.
import { describe, expect, it, vi } from "vitest";
import { consommationDuMois } from "../../apps/console/lib/queries-usage";
import { quotaView } from "../../apps/console/lib/usage";

vi.mock("../../apps/console/lib/db", () => ({ q: async () => [] }));

describe("quotaView", () => {
  it("quota null → illimité, jamais en dépassement", () => {
    expect(quotaView(10_000, null)).toEqual({ pct: null, over: false, label: "illimité" });
  });
  it("quota ≤ 0 → illimité", () => {
    expect(quotaView(5, 0)).toMatchObject({ pct: null, over: false });
  });
  it("sous le quota → pct + over=false", () => {
    expect(quotaView(620, 1000)).toEqual({ pct: 62, over: false, label: "62%" });
  });
  it("au-dessus du quota → over=true, pct > 100", () => {
    const v = quotaView(1500, 1000);
    expect(v.over).toBe(true);
    expect(v.pct).toBe(150);
  });
  it("pile au quota → pas de dépassement", () => {
    expect(quotaView(1000, 1000).over).toBe(false);
  });
});

// Recette du 26/09/2026 : 0 partout sur /admin/usage alors que demo-app avait
// ~217 sessions. Le comptage ne porte que sur la veille, et `coalesce` faisait d'une
// ABSENCE de comptage un zéro. Sans aucun jour compté, les compteurs sont inconnus.
describe("consommationDuMois — une absence de comptage n'est pas un zéro", () => {
  const brute = { app_id: "demo-app", name: "Démo", events: null, sessions: null, errors: null, quota: 1000 };

  it("aucun jour compté ce mois-ci : « — » (null), jamais 0, et l'état le dit", () => {
    const c = consommationDuMois([brute], { dernier_jour: null, dernier_comptage: null });
    expect(c.lignes[0]).toMatchObject({ events: null, sessions: null, errors: null, quota: 1000 });
    expect(c.comptage).toEqual({ dernierJour: null, dernierComptage: null });
  });

  it("un jour compté : une app sans ligne a vraiment consommé 0 ; les autres gardent leurs comptes", () => {
    const c = consommationDuMois(
      [brute, { ...brute, app_id: "autre", events: 1200, sessions: 40, errors: 3 }],
      { dernier_jour: "2026-09-25", dernier_comptage: "2026-09-26T00:05:00Z" },
    );
    expect(c.lignes.map((l) => l.events)).toEqual([0, 1200]);
    expect(c.lignes[1]).toMatchObject({ sessions: 40, errors: 3 });
    expect(c.comptage.dernierJour).toBe("2026-09-25");
  });
});
