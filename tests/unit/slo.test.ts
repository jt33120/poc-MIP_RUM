// F55 — un SLO sans aucune mesure sur sa fenêtre n'est ni tenu, ni manqué.
//
// slo_status() rend `attainment = null` quand la fenêtre ne porte aucune mesure
// (division par `nullif(count(*), 0)`). Le type TypeScript disait `number`, et
// sloView lisait ce null comme 0 % d'atteinte : « objectif manqué », budget
// consommé à 999 %, pour un SLO que rien n'a mesuré.
import { describe, expect, it } from "vitest";
import { etatSlo, sloView } from "../../apps/console/lib/alerting";

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
