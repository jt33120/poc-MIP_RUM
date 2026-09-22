// F55 — un SLO sans aucune mesure sur sa fenêtre n'est ni tenu, ni manqué.
//
// slo_status() rend `attainment = null` quand la fenêtre ne porte aucune mesure
// (division par `nullif(count(*), 0)`). Le type TypeScript disait `number`, et
// sloView lisait ce null comme 0 % d'atteinte : « objectif manqué », budget
// consommé à 999 %, pour un SLO que rien n'a mesuré.
import { describe, expect, it } from "vitest";
import { etatSlo, sloView } from "../../apps/console/lib/alerting";
import { statutBudget } from "../../apps/console/components/charts/BudgetBars";
import {
  alertesParSlo,
  comptesSlo,
  detailSlo,
  hrefConsommation,
  hrefCreerAlerte,
  metriqueEnClair,
  raisonSlo,
} from "../../apps/console/lib/slo-ecran";

describe("etatSlo", () => {
  it("sans mesure : non mesurable, jamais « objectif manqué »", () => {
    expect(etatSlo(null, 0.99)).toEqual({ status: "non_mesurable" });
  });

  it("avec mesure : la vue d'error-budget habituelle", () => {
    expect(etatSlo(0.95, 0.99)).toEqual(sloView(0.95, 0.99));
    expect(etatSlo(0.95, 0.99).status).toBe("breached");
    expect(etatSlo(1, 0.99).status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// F63 — écran /slo (plan § 5.18) : règles pures de la page (lib/slo-ecran.ts).
// ---------------------------------------------------------------------------

describe("F63 — comptesSlo (SL1, SL2, SL2b, SL2c)", () => {
  it("un SLO non mesurable n'est compté que dans « Non mesurables », jamais épuisé ni « brûle vite »", () => {
    const c = comptesSlo([
      { attainment: 1, burned_pct: 0, fast_burn: false },
      { attainment: 0.6, burned_pct: 800, fast_burn: true },
      { attainment: 0.97, burned_pct: 100, fast_burn: null },
      { attainment: null, burned_pct: null, fast_burn: null },
      // Défensif : une atteinte nulle avec un consommé ne compte pas comme épuisé.
      { attainment: null, burned_pct: 999, fast_burn: true },
    ]);
    expect(c).toEqual({ actifs: 5, epuises: 2, nonInterpretables: 0, brulent: 1, nonMesurables: 2, burnInconnu: 1 });
  });

  it("atteinte négative (error_rate) : consommé ≥ 100 % mais « non interprétable », compté à part, jamais épuisé", () => {
    // 300 occurrences pour 200 pages vues sur la fenêtre, objectif 99 % : atteinte
    // 1 − 300/200 = −0,5 ; slo_status() rend consommé = min(1,5 / 0,01 × 100, 999) = 999.
    const erreurs = { attainment: -0.5, burned_pct: 999, fast_burn: true };
    const c = comptesSlo([erreurs, { attainment: 0.6, burned_pct: 800, fast_burn: false }]);
    expect(c.epuises).toBe(1);
    expect(c.nonInterpretables).toBe(1);
    expect(c.nonMesurables).toBe(0);
    // La tuile et la barre suivent la même règle (statutBudget de BudgetBars).
    expect(statutBudget({ consomme: erreurs.burned_pct, atteinte: erreurs.attainment })).toBe("non_interpretable");
    expect(comptesSlo([erreurs])).toMatchObject({ epuises: 0, nonInterpretables: 1 });
  });
});

describe("F63 — textes et liens d'un SLO", () => {
  it("métrique en clair : la formule, pas l'identifiant", () => {
    expect(metriqueEnClair("LCP")).toBe("Part des mesures LCP notées Bon");
    expect(metriqueEnClair("error_rate")).toBe("1 − occurrences d'erreurs par page vue");
  });

  it("raison : aucune mesure sur la fenêtre ; atteinte négative non interprétable ; sinon rien", () => {
    expect(raisonSlo({ metric: "INP", window_days: 28, attainment: null })).toBe("aucune mesure INP sur 28 j");
    expect(raisonSlo({ metric: "error_rate", window_days: 7, attainment: null })).toBe("aucune page vue sur 7 j");
    expect(raisonSlo({ metric: "error_rate", window_days: 7, attainment: -0.4 })).toMatch(/non interprétable/);
    expect(raisonSlo({ metric: "LCP", window_days: 7, attainment: 0.9 })).toBeUndefined();
  });

  it("drill « qu'est-ce qui consomme » : pages du vital, ou erreurs de la route ; app posée", () => {
    expect(hrefConsommation({ app_id: "demo", metric: "LCP", route: "/checkout" })).toBe(
      "/pages?app=demo&vital=LCP&route=%2Fcheckout",
    );
    expect(hrefConsommation({ app_id: "demo", metric: "error_rate", route: null })).toBe("/errors?app=demo");
  });

  it("« Créer une alerte » : paramètres regle_*, jamais `route` (paramètre du contrat)", () => {
    const href = hrefCreerAlerte({ metric: "LCP", route: "/checkout" });
    expect(href).toBe("/alerts?regle_metrique=LCP&regle_route=%2Fcheckout#nouvelle-regle");
    expect(new URL(href, "http://x").searchParams.has("route")).toBe(false);
  });

  it("détail d'une barre : métrique, route, fenêtre, objectif", () => {
    expect(detailSlo({ metric: "LCP", route: null, window_days: 28, objective: 0.95 }).replace(/\u00a0/g, " ")).toBe(
      "LCP · toutes routes · 28 j · objectif 95,0 %",
    );
  });

  it("alertes sur 7 j : seuls les déclenchements de SLO, comptés par SLO", () => {
    const parSlo = alertesParSlo([
      { source: "slo", source_id: "4" },
      { source: "slo", source_id: "4" },
      { source: "regle", source_id: "4" },
      { source: "slo", source_id: "9" },
    ]);
    expect(parSlo.get(4)).toBe(2);
    expect(parSlo.get(9)).toBe(1);
    expect(parSlo.get(7)).toBeUndefined();
  });
});
