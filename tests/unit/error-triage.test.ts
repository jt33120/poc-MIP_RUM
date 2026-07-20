// Triage d'erreurs — garde-fou sur l'allow-list de statuts. `setErrorStatusAction`
// rejette toute valeur hors ERROR_STATUSES ; si cette liste dérive, l'action
// accepterait/refuserait de mauvais statuts. Ce test fige le contrat.
import { describe, expect, it } from "vitest";
import { ERROR_STATUSES } from "../../apps/console/lib/queries-v2";

describe("triage d'erreurs — statuts", () => {
  it("l'allow-list est exactement {open, resolved, ignored}", () => {
    expect([...ERROR_STATUSES]).toEqual(["open", "resolved", "ignored"]);
  });

  it("open est le premier (statut par défaut en base)", () => {
    expect(ERROR_STATUSES[0]).toBe("open");
  });
});
