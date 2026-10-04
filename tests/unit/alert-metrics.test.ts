// Chantier A — séparation des métriques d'alerte vs SLO et libellés lisibles.
// Garde-fou : log_errors (métrique absolue) est une règle d'alerte mais PAS une
// cible de SLO (le modèle SLO « % conforme » ne s'y applique pas). La métrique
// ai_cost a été retirée avec la sortie de la supervision IA vers xSOM.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALERT_METRICS, isAlertMetric, METRIC_LABELS, metricLabel, SLO_METRICS } from "../../apps/console/lib/queries-v2";
import {
  estDureeDeMetrique,
  estPartDeMetrique,
  libelleCourtMetrique,
  MESURE_MIP_DE_METRIQUE,
  MESURES_MIP_SANS_ALERTE,
  METRIQUES_MIP_ALERTE,
  METRIQUES_RESEAU_ALERTE,
  METRIQUES_SEUIL_SEUL,
  origineSeuilPropose,
  seuilMauvaisDeMetrique,
} from "../../apps/console/lib/alertes-metriques";
import { seuilDeRegle, valeurDeMetrique } from "../../apps/console/lib/alertes-ecran";
import { regleDesChamps } from "../../apps/console/lib/commandes/alertes";
import { THRESHOLDS } from "../../apps/console/lib/rating";
import { SEUILS_MIP } from "../../apps/console/lib/seuils";

describe("séparation ALERT_METRICS / SLO_METRICS", () => {
  it("les métriques SLO d'origine restent inchangées (vitals + error_rate)", () => {
    expect([...SLO_METRICS]).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB", "error_rate"]);
  });

  it("log_errors est une règle d'alerte mais PAS une cible de SLO", () => {
    expect(ALERT_METRICS).toContain("log_errors");
    expect(SLO_METRICS as readonly string[]).not.toContain("log_errors");
  });

  it("ai_cost n'est plus une métrique d'alerte (supervision IA sortie vers xSOM)", () => {
    expect(ALERT_METRICS as readonly string[]).not.toContain("ai_cost");
    expect(METRIC_LABELS.ai_cost).toBeUndefined();
  });

  it("ALERT_METRICS ajoute les mesures MIP, les comptes log, événement et issue sans les rendre éligibles aux SLO", () => {
    expect([...ALERT_METRICS]).toEqual([
      ...SLO_METRICS,
      ...METRIQUES_RESEAU_ALERTE,
      ...METRIQUES_MIP_ALERTE,
      "log_errors",
      "event",
      "issue",
    ]);
    for (const m of [...METRIQUES_RESEAU_ALERTE, ...METRIQUES_MIP_ALERTE]) {
      expect(isAlertMetric(m)).toBe(true);
      expect(SLO_METRICS as readonly string[]).not.toContain(m);
    }
    expect(isAlertMetric("event:checkout")).toBe(true);
    expect(isAlertMetric("event")).toBe(false);
    expect(isAlertMetric("event:")).toBe(false);
    expect(isAlertMetric(`event:${"x".repeat(101)}`)).toBe(false);
  });

  it("issue:<uuid> exige un UUID en minuscules, comme la contrainte de migration-v73", () => {
    expect(isAlertMetric("issue:11111111-2222-4333-8444-555555555555")).toBe(true);
    expect(isAlertMetric("issue")).toBe(false);
    expect(isAlertMetric("issue:")).toBe(false);
    expect(isAlertMetric("issue:11111111-2222-4333-8444-55555555555G")).toBe(false);
    expect(isAlertMetric("issue:11111111-2222-4333-8444-555555555555 ")).toBe(false);
    expect(isAlertMetric("issue:AAAAAAAA-2222-4333-8444-555555555555")).toBe(false);
  });
});

describe("metricLabel", () => {
  it("libellé lisible avec unité pour chaque métrique connue", () => {
    expect(metricLabel("log_errors")).toBe("Logs en erreur (nombre)");
    expect(metricLabel("error_rate")).toBe("Taux d'erreur JS");
    expect(metricLabel("LCP")).toBe("LCP (ms)");
    expect(metricLabel("event:checkout")).toBe("Événement « checkout » (nombre)");
    expect(metricLabel("issue:11111111-2222-4333-8444-555555555555")).toBe("Issue 11111111 (occurrences)");
  });

  it("repli sur la clé brute si métrique inconnue", () => {
    expect(metricLabel("inconnue")).toBe("inconnue");
  });

  it("toutes les métriques d'alerte ont un libellé", () => {
    for (const m of ALERT_METRICS) expect(METRIC_LABELS[m]).toBeTruthy();
  });
});

// Vague 4 (lot 4c) — les alertes sur les mesures MIP. Aucun seuil n'est recopié :
// chacun est lu dans `THRESHOLDS` (vitals, web.dev) ou `SEUILS_MIP` (lib/seuils.ts).
describe("vague 4 — métriques d'alerte des mesures MIP", () => {
  it("chaque métrique MIP pointe une mesure de SEUILS_MIP, et chaque mesure a sa métrique", () => {
    for (const m of [...METRIQUES_RESEAU_ALERTE, ...METRIQUES_MIP_ALERTE]) {
      expect(SEUILS_MIP[MESURE_MIP_DE_METRIQUE[m]]).toBeTruthy();
    }
    // Les mesures sans alerte sont NOMMÉES (MESURES_MIP_SANS_ALERTE), jamais oubliées.
    for (const m of MESURES_MIP_SANS_ALERTE) expect(Object.values(MESURE_MIP_DE_METRIQUE)).not.toContain(m);
    expect(new Set([...Object.values(MESURE_MIP_DE_METRIQUE), ...MESURES_MIP_SANS_ALERTE])).toEqual(
      new Set(Object.keys(SEUILS_MIP)),
    );
  });

  it("le seuil proposé est la borne « mauvais » : web.dev pour un vital, SEUILS_MIP sinon", () => {
    for (const v of ["LCP", "INP", "CLS", "FCP", "TTFB"]) {
      expect(seuilMauvaisDeMetrique(v)).toEqual({ seuil: THRESHOLDS[v][1], comparateur: ">" });
    }
    expect(seuilMauvaisDeMetrique("DNS")).toEqual({ seuil: SEUILS_MIP.DNS.mauvais, comparateur: ">" });
    expect(seuilMauvaisDeMetrique("api_p75")).toEqual({ seuil: SEUILS_MIP.API.mauvais, comparateur: ">" });
    expect(seuilMauvaisDeMetrique("rage_rate")).toEqual({ seuil: SEUILS_MIP.RAGE_CLICKS.mauvais, comparateur: ">" });
    // Sens inverse : un débit est mauvais EN DESSOUS de sa borne.
    expect(seuilMauvaisDeMetrique("DOWNLINK")).toEqual({ seuil: SEUILS_MIP.DOWNLINK.mauvais, comparateur: "<" });
    // Sans borne publiée ni MIP : rien de proposé, jamais un zéro.
    for (const m of ["error_rate", "log_errors", "event", "issue", "constructor", "toString", ""]) {
      expect(seuilMauvaisDeMetrique(m)).toBeNull();
    }
  });

  it("l'origine du seuil proposé est écrite : web.dev ou la règle MIP", () => {
    expect(origineSeuilPropose("LCP")).toMatch(/^LCP : bon ≤ .*, mauvais au-delà de .* \(web\.dev\)$/);
    expect(origineSeuilPropose("DNS")).toBe("règle MIP : DNS > 150 ms");
    expect(origineSeuilPropose("DOWNLINK")).toBe("règle MIP : Débit descendant < 1 Mbit/s");
    expect(origineSeuilPropose("log_errors")).toBe("");
  });

  it("parts en pour cent, durées en millisecondes, débit en Mbit/s", () => {
    expect(["error_rate", "rage_rate", "dead_rate", "browser_error_session_rate"].every(estPartDeMetrique)).toBe(true);
    expect(estPartDeMetrique("api_p75")).toBe(false);
    expect(estPartDeMetrique("constructor")).toBe(false);
    expect(["LCP", "DNS", "RTT", "longtask_p75", "loaf_p75", "resource_p75", "api_p75"].every(estDureeDeMetrique)).toBe(true);
    expect(estDureeDeMetrique("CLS")).toBe(false);
    expect(estDureeDeMetrique("DOWNLINK")).toBe(false);
    expect(seuilDeRegle("rage_rate", 0.05)).toBe("5,0 %");
    expect(valeurDeMetrique("dead_rate", 0.125)).toBe("12,5 %");
    expect(valeurDeMetrique("DOWNLINK", 0.75)).toBe("0,75 Mbit/s");
    expect(libelleCourtMetrique("loaf_p75")).toBe(SEUILS_MIP.LOAF.libelle);
    expect(metricLabel("browser_error_session_rate")).toBe("Erreurs navigateur (part des sessions)");
  });

  it("seuil fixe seulement : la console refuse l'écart à l'habitude sur ces métriques", () => {
    const champs = (metric: string, mode: string) => ({ app_id: "demo", metric, mode, threshold: "1", comparator: "<" });
    for (const m of METRIQUES_SEUIL_SEUL) {
      expect(() => regleDesChamps(champs(m, "baseline"))).toThrow(/seuil fixe seulement/);
      expect(regleDesChamps(champs(m, "threshold")).metric).toBe(m);
    }
    // Les phases de `rum_metric` gardent l'habitude (p75 horaire des deux côtés).
    expect(regleDesChamps(champs("DNS", "baseline")).mode).toBe("baseline");
    expect(regleDesChamps(champs("DOWNLINK", "threshold")).comparator).toBe("<");
  });

  it("migration-v100 : chaque métrique hors rum_metric a sa branche, et la garde de l'habitude les nomme toutes", () => {
    const v100 = readFileSync(join(__dirname, "..", "..", "packages", "db", "sql", "migration-v100.sql"), "utf8");
    for (const m of METRIQUES_MIP_ALERTE) expect(v100).toContain(`'${m}'`);
    expect(v100).toContain("percentile_cont(0.25) within group (order by m.value) into v from rum_metric m");
    const garde = /elsif r\.mode = 'baseline' and r\.metric in \(([^)]*)\)/.exec(v100)?.[1] ?? "";
    const nommees = [...garde.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(new Set(nommees)).toEqual(new Set(METRIQUES_SEUIL_SEUL));
  });
});
