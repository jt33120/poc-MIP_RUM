// Verdict d'ensemble de /admin/health (recette du 26/09/2026) : une phrase en
// tête, tirée des seuils que l'écran colorait déjà. Logique pure.
import { describe, expect, it } from "vitest";
import { verdictSante } from "../../apps/console/lib/health-verdict";
import type { HealthSnapshot } from "../../apps/console/lib/metrics-format";

const SAIN: HealthSnapshot = {
  ingest_metrics_5m: 0,
  ingest_pageviews_5m: 0,
  ingest_errors_5m: 0,
  ingest_sessions_5m: 0,
  apps_active: 3,
  alerts_unacked: 25,
  deliveries_queued: 0,
  deliveries_failed: 0,
  deliveries_dead: 0,
  metering_lag_hours: 4,
  apps_route_capped: 0,
  routes_max: 120,
  ingest_backlog: 0,
  ingest_backlog_blocked: 0,
  ingest_backlog_age_s: 0,
};
const RIEN = { identiteDegradee: false, causalesDegradees: false, collecteAilleurs: false };

describe("verdictSante", () => {
  it("tout sous les seuils : « Tout fonctionne », même avec des alertes à acquitter et zéro collecte", () => {
    const v = verdictSante(SAIN, RIEN);
    expect(v.niveau).toBe("ok");
    expect(v.titre).toMatch(/^Tout fonctionne/);
    expect(v.raisons).toEqual([]);
  });

  it("un calcul de consommation jamais exécuté est dit, pas rendu par un tiret", () => {
    const v = verdictSante({ ...SAIN, metering_lag_hours: null }, RIEN);
    expect(v.niveau).toBe("attention");
    expect(v.raisons[0]).toMatchObject({ texte: "Le calcul de la consommation n'a jamais été exécuté.", ancre: "#consommation" });
  });

  it("les seuils de l'écran : 26 h attention, 30 h incident, un lot abandonné est un incident", () => {
    expect(verdictSante({ ...SAIN, metering_lag_hours: 27 }, RIEN).niveau).toBe("attention");
    expect(verdictSante({ ...SAIN, metering_lag_hours: 31 }, RIEN).niveau).toBe("incident");
    const v = verdictSante({ ...SAIN, ingest_backlog_blocked: 1, deliveries_failed: 2 }, RIEN);
    expect(v.niveau).toBe("incident");
    // Les incidents d'abord.
    expect(v.raisons.map((r) => r.niveau)).toEqual(["incident", "attention"]);
    expect(v.raisons[0].texte).toBe("1 lot de données abandonné : il ne sera plus repris.");
    expect(v.raisons[1].texte).toBe("2 notifications d'alerte en échec, en attente d'un nouvel essai.");
  });

  it("les dégradations signalées par des bandeaux entrent dans le verdict", () => {
    const v = verdictSante(SAIN, { identiteDegradee: true, causalesDegradees: false, collecteAilleurs: true });
    expect(v.niveau).toBe("attention");
    expect(v.titre).toBe("À surveiller : 2 points à vérifier.");
  });
});
