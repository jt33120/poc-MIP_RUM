// Vague 3b — la heatmap de latence (A2 § 6.2) : tranches logarithmiques, part
// normalisée PAR HEURE, case sans mesure vide, colonne faible hachurée, p75 lue sur
// les mêmes seaux.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeatmapLatence } from "@/components/vue-ensemble/HeatmapLatence";
import { seau } from "@/lib/histogramme";
import { bornesTranches, construireHeatmap, positionLog, TRANCHES, trancheDe } from "@/lib/heatmap-latence";

const H = 3_600_000;
const T0 = Date.parse("2026-09-29T08:00:00Z");
const GRILLE = [0, 1, 2].map((i) => new Date(T0 + i * H).toISOString());

describe("tranches", () => {
  const b = bornesTranches(100, 20_000);
  it("25 bornes logarithmiques de 100 ms à 20 s", () => {
    expect(b).toHaveLength(TRANCHES + 1);
    expect(b[0]).toBe(100);
    expect(b[TRANCHES]).toBeCloseTo(20_000, 6);
    expect(b[1] / b[0]).toBeCloseTo(b[13] / b[12], 9);
  });
  it("une valeur hors bornes tombe dans la tranche extrême, jamais hors de la grille", () => {
    expect(trancheDe(10, b)).toBe(0);
    expect(trancheDe(60_000, b)).toBe(TRANCHES - 1);
    expect(trancheDe(2_500, b)).toBeGreaterThan(trancheDe(1_000, b));
    expect(positionLog(100, b)).toBe(0);
    expect(positionLog(20_000, b)).toBe(1);
  });
});

describe("construireHeatmap", () => {
  const lignes = [
    // Heure 0 : chargée (1 000 mesures), tout à ~1 s.
    { heure: GRILLE[0], bucket: seau(1_000), poids: 1_000, mesures: 1_000 },
    // Heure 1 : 10 mesures, moitié ~1 s, moitié ~5 s.
    { heure: GRILLE[1], bucket: seau(1_000), poids: 5, mesures: 5 },
    { heure: GRILLE[1], bucket: seau(5_000), poids: 5, mesures: 5 },
  ];
  const h = construireHeatmap("LCP", GRILLE, lignes)!;

  it("la part est normalisée par heure : l'heure chargée n'écrase pas l'heure creuse", () => {
    const k1 = trancheDe(1_000, h.bornes);
    expect(h.colonnes[0].parts[k1]).toBe(1);
    expect(h.colonnes[1].parts[k1]).toBeCloseTo(0.5, 9);
    expect(h.partMax).toBe(1);
  });
  it("une case sans mesure est vide (null), une heure sans ligne est une colonne vide", () => {
    expect(h.colonnes[0].parts.filter((p) => p === null)).toHaveLength(TRANCHES - 1);
    expect(h.colonnes[2]).toMatchObject({ n: 0, p75: null, faible: false });
    expect(h.colonnes[2].parts.every((p) => p === null)).toBe(true);
  });
  it("sous 13 mesures, la colonne est faible ; la p75 se lit sur les seaux de l'heure", () => {
    expect(h.colonnes[0].faible).toBe(false);
    expect(h.colonnes[1].faible).toBe(true);
    expect(h.colonnes[1].p75).toBeGreaterThan(4_900);
    expect(h.colonnes[0].p75).toBeCloseTo(1_000, -1);
  });
  it("un vital sans bornes (CLS) n'a pas de heatmap", () => {
    expect(construireHeatmap("CLS", GRILLE, [])).toBeNull();
  });
  it("le rendu : une case par tranche mesurée, une colonne hachurée, la p75 et les seuils, la légende 0 % → part max", () => {
    const html = renderToStaticMarkup(<HeatmapLatence heatmap={h} plage="24 dernières heures" />);
    expect((html.match(/<rect x=/g) ?? []).length).toBe(1 + 2 + 1);
    expect(html).toContain("data-faible");
    expect(html).toContain("<polyline");
    expect(html).toContain("0 %");
    expect(html).toContain("100 % des mesures de l&#x27;heure");
    expect(html).toContain("seuils web.dev");
  });
});
