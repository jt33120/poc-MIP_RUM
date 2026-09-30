// Une série quotidienne analysée d'un bloc (`@mip/stats/serie-quotidienne`) : ce que
// l'écran « Tendances », la Vue d'ensemble et `GET /api/v1/trends` lisent tous trois.
//
// Ce que ces cas verrouillent :
//   - l'enchaînement rend EXACTEMENT ce que rendent les briques appelées à la main
//     (tendance, échéance, datation, déploiement) — c'est la garantie « un seul
//     calcul » ;
//   - l'échéance écrite suit la règle de la synthèse : un dépassement se dit
//     toujours, une date à venir seulement sur une pente établie et dans l'horizon ;
//   - sans borne (mesure sans seuil publié), ni échéance ni verdict.
import { describe, expect, it } from "vitest";
import { analyserSerieQuotidienne } from "../../packages/stats/src/serie-quotidienne";
import { daterRupture, deploiementCoincident, type JourMesure } from "../../packages/stats/src/rupture";
import {
  HORIZON_JOURS,
  buildForecastNarrative,
  echeanceEcrite,
  echeanceSeuil,
  jourDecale,
  linfit,
  tendance,
} from "../../packages/stats/src/tendance";

const jours = (n: number) => Array.from({ length: n }, (_v, i) => jourDecale("2026-09-01", i));

/** Quatorze jours : une marche de 1 900 à 2 700 ms au 8ᵉ jour, 200 mesures par jour. */
function marche(): JourMesure[] {
  return jours(14).map((jour, i) => ({ jour, valeur: i < 7 ? 1900 + (i % 3) * 10 : 2700 + (i % 3) * 10, effectif: 200 }));
}

describe("analyserSerieQuotidienne — l'enchaînement, écrit une fois", () => {
  it("rend ce que rendent les briques appelées à la main", () => {
    const serie = marche();
    const deploiements = [{ jour: "2026-09-08", version: "1.4.2" }];
    const a = analyserSerieQuotidienne(serie, { borne: 2500, deploiements });

    const t = tendance(
      serie.map((j) => j.valeur),
      serie.map((j) => j.effectif ?? null),
    );
    expect(a.tendance).toEqual(t);
    const courant = [...t.retenues].reverse().find((v) => v !== null) ?? null;
    expect(a.courant).toBe(courant);
    expect(a.eta).toBe(echeanceSeuil(t.fit, courant, 2500));
    const d = daterRupture(serie);
    expect(a.datation).toEqual(d);
    expect(d.ok && d.rupture?.jour).toBe("2026-09-08");
    expect(a.deploiement).toEqual(deploiementCoincident("2026-09-08", deploiements));
    expect(a.deploiement?.version).toBe("1.4.2");
  });

  it("dernière valeur au-dessus de la borne : « dépassé », daté du dernier jour", () => {
    const a = analyserSerieQuotidienne(marche(), { borne: 2500 });
    expect(a.eta).toBe(0);
    expect(a.echeance).toEqual({ etat: "depasse", dans: 0, jour: "2026-09-14", borne: 2500, horizon: HORIZON_JOURS });
  });

  it("sans borne : ni échéance ni pas avant franchissement, la datation reste", () => {
    const a = analyserSerieQuotidienne(marche());
    expect(a.eta).toBeNull();
    expect(a.echeance).toBeNull();
    expect(a.datation.ok).toBe(true);
  });

  it("sans effectif du tout, toute valeur mesurée compte ; un effectif absent parmi d'autres est un jour creux", () => {
    const sansEffectif = jours(8).map((jour, i) => ({ jour, valeur: 1000 + i * 100 }));
    expect(analyserSerieQuotidienne(sansEffectif).tendance.joursValides).toBe(8);
    const mele: JourMesure[] = sansEffectif.map((j, i) => (i === 0 ? { ...j, effectif: null } : { ...j, effectif: 100 }));
    expect(analyserSerieQuotidienne(mele).tendance.joursValides).toBe(7);
  });

  it("série trop courte : la tendance est insuffisante, la datation refuse EN CHIFFRES", () => {
    const a = analyserSerieQuotidienne(jours(5).map((jour) => ({ jour, valeur: 2000, effectif: 100 })), { borne: 2500 });
    expect(a.tendance.etat).toBe("insuffisante");
    expect(a.echeance?.etat).toBe("non_ecrit");
    expect(a.datation.ok).toBe(false);
    if (!a.datation.ok) expect(a.datation.manque).toEqual({ requis: 10, observe: 5, unite: "jours valides" });
  });
});

describe("echeanceEcrite — la règle de la synthèse, en données", () => {
  const monte = linfit([1000, 1100, 1200, 1300, 1400, 1500, 1600])!; // +100 ms / jour
  const significative = { etat: "significative" as const };

  it("pente établie, franchissement dans l'horizon : « prévu », J+k arrondi au jour supérieur", () => {
    const eta = echeanceSeuil(monte, 1600, 2150)!; // 5,5 jours
    expect(echeanceEcrite(eta, significative, 2150, "2026-09-07")).toEqual({
      etat: "prevu",
      dans: 6,
      jour: "2026-09-13",
      borne: 2150,
      horizon: HORIZON_JOURS,
    });
  });

  it("au-delà de l'horizon, ou droite qui descend : « aucun » — jamais une date lointaine", () => {
    expect(echeanceEcrite(echeanceSeuil(monte, 1600, 2500), significative, 2500, "2026-09-07").etat).toBe("aucun");
    expect(echeanceEcrite(null, significative, 2500, "2026-09-07").etat).toBe("aucun");
  });

  it("pente dans le bruit : rien n'est écrit, sauf un dépassement déjà mesuré", () => {
    expect(echeanceEcrite(3, { etat: "bruit" }, 2500, "2026-09-07")).toMatchObject({ etat: "non_ecrit", dans: null, jour: null });
    expect(echeanceEcrite(0, { etat: "bruit" }, 2500, "2026-09-07")).toMatchObject({ etat: "depasse", dans: 0 });
  });

  it("dit la même chose que la synthèse de l'écran", () => {
    for (const [eta, etat] of [
      [0, "significative"],
      [3, "significative"],
      [HORIZON_JOURS + 1, "significative"],
      [3, "bruit"],
      [null, "insuffisante"],
    ] as const) {
      const synthese = buildForecastNarrative([
        { label: "LCP p75", thresholdLabel: "2,5 s", eta, tendance: { etat, joursValides: 7, joursRequis: 7, jours: 14 } },
      ]);
      const ecrite = echeanceEcrite(eta, { etat }, 2500, "2026-09-07");
      const attendu = synthese.status === "risk" ? "depasse" : synthese.status === "watch" ? "prevu" : null;
      if (attendu) expect(ecrite.etat, `${eta} ${etat}`).toBe(attendu);
      else expect(["aucun", "non_ecrit"], `${eta} ${etat}`).toContain(ecrite.etat);
    }
  });
});
