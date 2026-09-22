// AIOps — prévision (régression linéaire). Logique pure.
import { describe, expect, it } from "vitest";
import {
  HORIZON_JOURS,
  buildForecastNarrative,
  cleJour,
  etaToThreshold,
  forecastNext,
  linfit,
  trendDir,
} from "../../apps/console/lib/forecast";
import {
  dispersionResidus,
  echeanceLcp,
  joursComplets,
  penteSignificative,
  pointsTendance,
  tendance,
} from "../../apps/console/lib/forecast";

describe("linfit", () => {
  it("ajuste une droite parfaite y = 2x + 1", () => {
    const fit = linfit([1, 3, 5, 7, 9])!;
    expect(fit.slope).toBeCloseTo(2, 6);
    expect(fit.intercept).toBeCloseTo(1, 6);
    expect(fit.n).toBe(5);
  });
  it("ignore les trous mais garde les positions", () => {
    const fit = linfit([1, null, 5, null, 9])!; // points (0,1),(2,5),(4,9) -> pente 2
    expect(fit.slope).toBeCloseTo(2, 6);
  });
  it("null si moins de 3 points", () => {
    expect(linfit([1, 2])).toBeNull();
    expect(linfit([1, null, null])).toBeNull();
  });
});

describe("forecastNext", () => {
  it("projette au-delà du dernier point", () => {
    const fit = linfit([1, 3, 5, 7, 9])!; // dernier x = 4
    expect(forecastNext(fit, 3)).toBeCloseTo(15, 6); // x = 7 -> 2*7+1
  });
});

describe("etaToThreshold", () => {
  it("compte les pas jusqu'au franchissement (hausse défavorable)", () => {
    const fit = linfit([1, 3, 5, 7, 9])!; // y=2x+1, dernier point y=9 à x=4
    // seuil 15 -> x=7 -> 3 pas après le dernier
    expect(etaToThreshold(fit, 9, 15, true)).toBeCloseTo(3, 6);
  });
  it("0 si déjà au-delà du seuil", () => {
    const fit = linfit([10, 12, 14])!;
    expect(etaToThreshold(fit, 14, 10, true)).toBe(0);
  });
  it("null si la tendance s'éloigne du seuil", () => {
    const fit = linfit([9, 7, 5])!; // baisse
    expect(etaToThreshold(fit, 5, 15, true)).toBeNull();
  });
});

describe("trendDir", () => {
  it("classe selon la pente relative", () => {
    expect(trendDir(linfit([1, 3, 5])!, 3)).toBe("up");
    expect(trendDir(linfit([5, 3, 1])!, 3)).toBe("down");
    expect(trendDir(linfit([5, 5, 5])!, 5)).toBe("flat");
  });
});

describe("buildForecastNarrative", () => {
  it("risk si un seuil est déjà dépassé", () => {
    const n = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: 0 }]);
    expect(n.status).toBe("risk");
    expect(n.lines[0]).toContain("dépasse déjà");
  });
  it("watch si franchissement à venir sous 7 j", () => {
    const n = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: 2.3 }]);
    expect(n.status).toBe("watch");
    expect(n.lines[0]).toContain("J+3");
  });
  it("ok si rien à l'horizon", () => {
    const n = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: null }]);
    expect(n.status).toBe("ok");
    expect(n.lines[0]).toContain("Aucun indicateur");
  });
  it("un seul horizon, 7 jours, partout : texte, fenêtre d'alerte et projection", () => {
    // La narration disait « horizon de 3 jours » tout en signalant jusqu'à J+7.
    expect(HORIZON_JOURS).toBe(7);
    const ok = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: null }]);
    expect(ok.lines[0]).toContain("7 jours");
    expect(ok.lines[0]).not.toContain("3 jours");
    expect(buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: 6.5 }]).lines[0]).toContain("J+7");
    expect(buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: 7.5 }]).status).toBe("ok");
  });
});

describe("cleJour", () => {
  it("lit un Date de node-postgres par ses composantes locales, pas par String()", () => {
    // Un `date` PostgreSQL arrive en Date à minuit local.
    expect(cleJour(new Date(2026, 8, 22))).toBe("2026-09-22");
    expect(cleJour(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(cleJour("2026-09-22T00:00:00.000Z")).toBe("2026-09-22");
  });
});

// ─────────────── F65 — tendance et bruit (§ 5.20.3, TE1, TE5) ───────────────
//
// Une droite n'est pas une tendance : sur 14 jours qui oscillent, `linfit` a
// toujours une pente. L'échéance ne s'écrit que si la variation décrite par la
// pente sur la fenêtre dépasse deux écarts types des résidus ; sous 7 jours
// d'au moins 30 mesures, aucune droite.

// Série plate bruitée : ±150 ms autour de 2 000 ms, sans dérive.
const PLATE_BRUITEE = [2000, 2150, 1850, 2100, 1900, 2140, 1860, 2000, 2150, 1850, 2100, 1900, 2140, 1860];
// 1 000 → 2 400 ms en 14 jours, un léger bruit.
const DERIVE = Array.from({ length: 14 }, (_v, i) => 1000 + (1400 * i) / 13 + (i % 2 === 0 ? 20 : -20));

describe("dispersionResidus", () => {
  it("droite parfaite → 0 ; moins de 3 points → null", () => {
    const fit = linfit([1, 3, 5, 7, 9])!;
    expect(dispersionResidus(fit, [1, 3, 5, 7, 9])).toBe(0);
    expect(dispersionResidus(fit, [1, null, null, null, 9])).toBeNull();
  });

  it("écart type des résidus, deux degrés de liberté pris par la droite", () => {
    // y = 0, 2, 0, 2 : droite y = 0,4x + 0,4 ; résidus −0,4 / 1,2 / −1,2 / 0,4 → Σr² = 3,2 ; /(4−2) → √1,6.
    const ys = [0, 2, 0, 2];
    const fit = linfit(ys)!;
    expect(dispersionResidus(fit, ys)).toBeCloseTo(Math.sqrt(1.6), 10);
  });
});

describe("penteSignificative", () => {
  it("série plate bruitée : la pente ne se distingue pas du bruit", () => {
    const fit = linfit(PLATE_BRUITEE)!;
    expect(fit.slope).not.toBe(0); // la droite a une pente…
    expect(penteSignificative(fit, PLATE_BRUITEE)).toBe(false); // … qui n'est pas une tendance.
  });

  it("dérive de 1 000 à 2 400 ms en 14 jours : établie, échéance ≤ 7 jours", () => {
    const fit = linfit(DERIVE)!;
    expect(penteSignificative(fit, DERIVE)).toBe(true);
    const courant = DERIVE[13];
    const eta = etaToThreshold(fit, courant, 2500, true)!;
    expect(eta).toBeGreaterThan(0);
    expect(eta).toBeLessThanOrEqual(7);
  });

  it("droite parfaite de pente non nulle : établie ; série constante : jamais", () => {
    expect(penteSignificative(linfit([1, 3, 5, 7])!, [1, 3, 5, 7])).toBe(true);
    const constante = [5, 5, 5, 5, 5, 5, 5];
    expect(penteSignificative(linfit(constante)!, constante)).toBe(false);
  });
});

describe("tendance — 7 jours d'au moins 30 mesures requis", () => {
  it("6 jours valides : insuffisante, aucune droite", () => {
    const ys = DERIVE;
    const n = ys.map((_v, i) => (i < 6 ? 40 : 12));
    const t = tendance(ys, n);
    expect(t).toMatchObject({ etat: "insuffisante", joursValides: 6, joursRequis: 7, jours: 14, fit: null });
  });

  it("un jour sous 30 mesures reste dessiné mais n'entre pas dans l'ajustement", () => {
    const ys = [...DERIVE];
    ys[13] = 9000; // un pic sur 3 mesures : exclu, il ne tire pas la droite
    const n = ys.map((_v, i) => (i === 13 ? 3 : 200));
    const t = tendance(ys, n);
    expect(t.etat).toBe("significative");
    expect(t.retenues[13]).toBeNull();
    expect(t.joursValides).toBe(13);
    expect(t.fit!.slope).toBeCloseTo(linfit(DERIVE.slice(0, 13))!.slope, 6);
  });

  it("série plate bruitée : « bruit » ; la narration n'annonce aucun franchissement", () => {
    const t = tendance(PLATE_BRUITEE.map((v) => v + 400), PLATE_BRUITEE.map(() => 100));
    expect(t.etat).toBe("bruit");
    // Même une échéance calculée n'est pas écrite quand la pente est dans le bruit.
    const n = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: 3.2, tendance: t }]);
    expect(n.lines.join(" ")).not.toContain("devrait franchir");
    expect(n.lines.join(" ")).toContain("non distinguable du bruit");
    expect(n.status).toBe("ok");
  });

  it("données insuffisantes : la narration le chiffre ; un seuil déjà dépassé reste dit", () => {
    const t = tendance([3000, null, 3100, null], [40, 0, 40, 0]);
    const n = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: 0, tendance: t }]);
    expect(n.status).toBe("risk");
    expect(n.lines[0]).toContain("dépasse déjà");
    expect(n.lines[1]).toBe("LCP p75 : pas assez de jours mesurés (2 sur 4, 7 requis) ; aucune tendance n'est calculée.");
  });
});

describe("joursComplets — la journée en cours est exclue", () => {
  it("Paris, 10/09 à 23:30 locale : le dernier jour complet est le 09/09", () => {
    const jours = joursComplets("Europe/Paris", Date.parse("2026-09-10T21:30:00Z"));
    expect(jours).toHaveLength(14);
    expect(jours[13]).toBe("2026-09-09");
    expect(jours[0]).toBe("2026-08-27");
  });

  it("Paris, 11/09 à 00:30 locale (22:30 UTC la veille) : le 10/09 est devenu complet", () => {
    expect(joursComplets("Europe/Paris", Date.parse("2026-09-10T22:30:00Z")).at(-1)).toBe("2026-09-10");
  });

  it("fuseau inconnu : UTC plutôt qu'une exception", () => {
    expect(joursComplets("Pas/UnFuseau", Date.parse("2026-09-10T22:30:00Z")).at(-1)).toBe("2026-09-09");
  });
});

describe("pointsTendance — droite sur les 14 jours, projection seulement si établie", () => {
  const jours = Array.from({ length: 14 }, (_v, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);

  it("établie : droite sur les jours observés, projection de 7 jours partant du dernier, bande ± dispersion", () => {
    const t = tendance(DERIVE, DERIVE.map(() => 100));
    const { grille, points } = pointsTendance(jours, DERIVE, DERIVE.map(() => 100), t);
    expect(grille).toHaveLength(14 + HORIZON_JOURS);
    expect(grille.slice(14)).toEqual(["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21"]);
    expect(points.slice(0, 14).every((p) => p.ajuste !== null)).toBe(true);
    expect(points.slice(0, 13).every((p) => p.projection === null)).toBe(true);
    expect(points[13].projection).toBeCloseTo(points[13].ajuste!, 10);
    expect(points[14].projection).toBeCloseTo(forecastNext(t.fit!, 1), 10);
    expect(points[20].haut! - points[20].projection!).toBeCloseTo(t.dispersion!, 10);
    expect(points.slice(14).every((p) => p.observe === null)).toBe(true);
  });

  it("dans le bruit : droite grise sur 14 jours, aucune projection ni bande, aucun jour futur", () => {
    const ys = PLATE_BRUITEE;
    const t = tendance(ys, ys.map(() => 100));
    const { grille, points } = pointsTendance(jours, ys, ys.map(() => 100), t);
    expect(grille).toEqual(jours);
    expect(points.every((p) => p.projection === null && p.bas === null && p.haut === null)).toBe(true);
    expect(points.every((p) => p.ajuste !== null)).toBe(true);
  });

  it("jour sans mesure : un trou (null), jamais 0", () => {
    const ys = [...DERIVE] as (number | null)[];
    ys[4] = null;
    const { points } = pointsTendance(jours, ys, ys.map((v) => (v === null ? 0 : 100)), tendance(ys, ys.map((v) => (v === null ? 0 : 100))));
    expect(points[4]).toMatchObject({ observe: null, n: 0 });
  });
});

// ─────────────── F65, revue — « franchi » au sens de lib/rating.ts ───────────────
//
// `rating2026` classe « Bon » jusqu'à la borne INCLUSE : un LCP p75 de 2 500 ms est
// Bon. L'écran disait « dépasse déjà son seuil » à 2 500 ms (`>=`).
describe("echeanceLcp — la borne « Bon » est incluse", () => {
  const plat = linfit([2500, 2500, 2500, 2500, 2500, 2500, 2500])!;

  it("2 500 ms, tendance plate : pas franchi, aucune échéance", () => {
    expect(echeanceLcp(plat, 2500)).toBeNull();
    const n = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: "2,5 s", eta: echeanceLcp(plat, 2500) }]);
    expect(n.status).toBe("ok");
    expect(n.lines.join(" ")).not.toContain("dépasse déjà");
  });

  it("2 501 ms : déjà franchi (« À améliorer »), même sans droite", () => {
    expect(echeanceLcp(null, 2501)).toBe(0);
    expect(echeanceLcp(plat, 2501)).toBe(0);
  });

  it("2 500 ms sur une droite montante : une échéance à venir, jamais 0", () => {
    const monte = linfit([2200, 2250, 2300, 2350, 2400, 2450, 2500])!;
    const eta = echeanceLcp(monte, 2500)!;
    expect(eta).toBeGreaterThan(0);
    expect(Math.ceil(eta)).toBe(1);
  });

  it("droite montante sous la borne : pas comptés depuis le dernier jour", () => {
    const fit = linfit([1000, 1100, 1200, 1300, 1400, 1500, 1600])!; // +100 ms / jour, 1 600 au dernier jour
    expect(echeanceLcp(fit, 1600)).toBeCloseTo(9, 6);
  });

  it("droite descendante ou aucune valeur : null", () => {
    expect(echeanceLcp(linfit([2400, 2300, 2200])!, 2200)).toBeNull();
    expect(echeanceLcp(plat, null)).toBeNull();
  });
});
