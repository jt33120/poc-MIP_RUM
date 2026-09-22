// F10 — règles de valeur du domaine performance (lib/perf-domain.ts).
//
// Ce que l'écran a le droit de tirer des lectures : une part jamais au-dessus de
// 100 %, jamais calculée sur une base vide ni sur une population échantillonnée
// différemment (CP15) ; un ratio « pour 100 vues » qui peut dépasser 100 et vaut
// `null`, pas 0, sans vue.
import { describe, expect, it } from "vitest";
import { queryOf } from "../../apps/console/lib/filters";
import {
  RAISON_ECHANTILLONNAGE,
  avecCondition,
  partTouchees,
  ratioPour100,
  serieRatioPour100,
} from "../../apps/console/lib/perf-domain";

describe("partTouchees", () => {
  it("base 0 → null, avec la raison et la plage", () => {
    expect(partTouchees({ base: 0, touchees: 0, tauxMin: null }, "24 h")).toEqual({
      valeur: null,
      raison: "aucune session avec vue sur 24 h",
    });
  });

  it("tauxMin 0,1 → null : erreurs et vues échantillonnées différemment (CP15)", () => {
    expect(partTouchees({ base: 40, touchees: 4, tauxMin: 0.1 })).toEqual({ valeur: null, raison: RAISON_ECHANTILLONNAGE });
  });

  it("tauxMin inconnu sur une base non vide → null (jamais supposé à 1)", () => {
    expect(partTouchees({ base: 40, touchees: 4, tauxMin: null }).valeur).toBeNull();
  });

  it("touchees / base quand tout est collecté", () => {
    expect(partTouchees({ base: 40, touchees: 10, tauxMin: 1 })).toEqual({ valeur: 0.25, raison: null });
  });

  it("jamais > 1, même sur une entrée incohérente", () => {
    expect(partTouchees({ base: 3, touchees: 5, tauxMin: 1 }).valeur).toBe(1);
  });
});

describe("ratioPour100", () => {
  it("0 vue → null (aucun dénominateur), jamais 0", () => {
    expect(ratioPour100(12, 0)).toBeNull();
    expect(ratioPour100(0, 0)).toBeNull();
    expect(ratioPour100(5, null)).toBeNull();
  });

  it("30 occurrences pour 20 vues → 150 : un ratio, pas une part", () => {
    expect(ratioPour100(30, 20)).toBe(150);
  });

  it("0 occurrence sur des vues → 0 réel", () => {
    expect(ratioPour100(0, 20)).toBe(0);
  });
});

describe("serieRatioPour100", () => {
  it("seau sans vue → null (trou) ; seau absent des erreurs → null ; sinon le ratio", () => {
    const vues = [
      { bucket: "2026-09-22T10:00:00Z", chargements: 15, spa: 4, inconnu: 1 },
      { bucket: "2026-09-22T11:00:00Z", chargements: 0, spa: 0, inconnu: 0 },
      { bucket: "2026-09-22T12:00:00Z", chargements: 10, spa: 0, inconnu: 0 },
    ];
    const erreurs = [
      { bucket: "2026-09-22T10:00:00Z", navigateur: 30 },
      { bucket: "2026-09-22T11:00:00Z", navigateur: 2 },
    ];
    expect(serieRatioPour100(erreurs, vues)).toEqual([
      { bucket: "2026-09-22T10:00:00Z", ratio: 150 },
      { bucket: "2026-09-22T11:00:00Z", ratio: null },
      { bucket: "2026-09-22T12:00:00Z", ratio: null },
    ]);
  });
});

describe("avecCondition", () => {
  const f = { app: "a", period: "24h" as const, device: null, segment: [] };

  it("ajoute la condition au contrat, sans toucher la fenêtre ni le périmètre", () => {
    const base = queryOf(f);
    const g = avecCondition({ ...f, query: base }, "route", "/checkout");
    expect(g.query.range).toEqual(base.range);
    expect(g.query.scope).toEqual(base.scope);
    expect(g.query.filters.segments).toEqual([{ dimension: "route", operator: "eq", value: "/checkout" }]);
  });

  it("même dimension = ET : un filtre global n'est jamais remplacé", () => {
    const base = queryOf(f);
    const avecA = { ...f, query: { ...base, filters: { ...base.filters, segments: [{ dimension: "route" as const, operator: "eq" as const, value: "/a" }] } } };
    expect(avecCondition(avecA, "route", "/b").query.filters.segments).toHaveLength(2);
  });
});

// ─────────────────────────────── F18 — Erreurs ───────────────────────────────
import { autresGroupes, libelleGroupeErreur, referencePeriodePrecedente } from "../../apps/console/lib/perf-domain";

describe("F18 — autresGroupes", () => {
  it("« Autres » = trend − Σ4, seau par seau", () => {
    const trend = [10, 7, 0, 5];
    const series = [
      [4, 2, 0, 1],
      [3, 1, 0, 1],
      [1, 1, 0, 0],
      [1, 0, 0, 1],
    ];
    expect(autresGroupes(trend, series)).toEqual([1, 3, 0, 2]);
  });

  it("borné à 0 : des séries au-dessus de la tendance (ingestion concurrente) ne dessinent rien de négatif", () => {
    expect(autresGroupes([2, 0], [[3, 0], [1, 1]])).toEqual([0, 0]);
  });

  it("≤ 4 groupes : tout est dessiné, « Autres » vaut 0 partout", () => {
    expect(autresGroupes([5, 3], [[5, 3]])).toEqual([0, 0]);
    expect(autresGroupes([5, 3], [])).toEqual([5, 3]);
  });

  it("un seau absent d'une série compte 0 (des comptes), jamais NaN", () => {
    expect(autresGroupes([4, 4], [[1]])).toEqual([3, 4]);
  });
});

describe("F18 — libelleGroupeErreur", () => {
  it("message tronqué à 40 caractères + empreinte courte : jamais le seul type", () => {
    const long = "TypeError: Cannot read properties of undefined (reading 'panier')";
    const libelle = libelleGroupeErreur({ message: long, fingerprint: "a1b2c3d4e5f6a7b8" });
    expect(libelle).toBe(`${long.slice(0, 39)}… · a1b2c3d4`);
    expect(libelle.split(" · ")[0]).toHaveLength(40);
  });

  it("cinq groupes du même type « Error » ont cinq libellés distincts", () => {
    const libelles = [1, 2, 3, 4, 5].map((i) => libelleGroupeErreur({ message: `boom ${i}`, fingerprint: `fp-${i}-xxxxxxxx` }));
    expect(new Set(libelles).size).toBe(5);
    expect(libelles).not.toContain("Error");
  });

  it("sans message : « (sans message) » ; plusieurs apps : l'app nomme le groupe", () => {
    expect(libelleGroupeErreur({ message: null, fingerprint: "ffff0000aaaa" })).toBe("(sans message) · ffff0000");
    expect(libelleGroupeErreur({ message: "  boom\n  ", fingerprint: "ffff0000aaaa", app_id: "shop" })).toBe(
      "boom · ffff0000 · shop",
    );
  });
});

describe("F18 — referencePeriodePrecedente", () => {
  it("24 h : la plage précédente, datée en UTC", () => {
    expect(
      referencePeriodePrecedente({ from: "2026-09-21T14:00:00.000Z", to: "2026-09-22T14:00:00.000Z", preset: "24h" }),
    ).toBe("vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC)");
  });

  it("plage personnalisée : « période précédente », même durée, juste avant", () => {
    expect(
      referencePeriodePrecedente({ from: "2026-09-22T10:00:00.000Z", to: "2026-09-22T12:00:00.000Z", preset: null }),
    ).toBe("vs période précédente (22/09 08:00 → 22/09 10:00 UTC)");
  });
});
