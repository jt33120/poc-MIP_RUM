// P*.1, incrément 0-c — « aucune anomalie » n'est pas « rien de testable ».
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { facteurAnomalies } from "../../apps/console/lib/health";

describe("facteurAnomalies", () => {
  it("aucune route éligible : non testable, hors du score (earned null)", () => {
    const f = facteurAnomalies({ filtree: false, eligibles: 0, anomalies: 0 });
    expect(f.earned).toBeNull();
    expect(f.raisonNull).toBe("non testable");
    expect(f.detail).toBe("non testable : 0 route avec 5 heures de mesures LCP sur 8 jours");
  });

  it("détection absente de la base : non testable aussi, jamais 10/10", () => {
    expect(facteurAnomalies({ filtree: false, eligibles: null, anomalies: 0 })).toMatchObject({ earned: null, raisonNull: "non testable" });
  });

  it("des routes testées sans anomalie : 10/10, et le texte dit combien ont été testées", () => {
    expect(facteurAnomalies({ filtree: false, eligibles: 3, anomalies: 0 })).toMatchObject({
      earned: 10,
      detail: "aucune anomalie détectée sur 3 route(s) testable(s)",
    });
  });

  it("anomalies trouvées : 2,5 points de moins chacune, plancher 0", () => {
    expect(facteurAnomalies({ filtree: false, eligibles: 3, anomalies: 2 }).earned).toBe(5);
    expect(facteurAnomalies({ filtree: false, eligibles: 3, anomalies: 9 }).earned).toBe(0);
  });

  it("sous filtre : non comptées, comme avant", () => {
    expect(facteurAnomalies({ filtree: true, eligibles: 3, anomalies: 1 })).toMatchObject({ earned: null, raisonNull: "sous filtre" });
  });
});

describe("la garde d'éligibilité est celle de v_anomaly", () => {
  it("≥ 5 heures et écart-type non nul, des deux côtés", () => {
    const garde = "having count(*) >= 5 and stddev_samp(p75) > 0";
    const vue = readFileSync(join(__dirname, "../../apps/ingest/sql/migration-v03.sql"), "utf8");
    const console_ = readFileSync(join(__dirname, "../../apps/console/lib/health.ts"), "utf8");
    expect(vue).toContain(garde);
    expect(console_).toContain(garde);
    expect(console_).toContain("interval '8 days'");
  });
});
