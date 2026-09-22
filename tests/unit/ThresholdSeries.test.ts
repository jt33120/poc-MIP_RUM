// ThresholdSeries (F04, plan § 4.2) : composant client recharts, non rendu ici (§ 0.4) —
// on teste la fonction PURE qui prépare ses points, exportée par le composant, et le
// domaine et les bandes qu'il dessine.
import { describe, expect, it } from "vitest";
import { SERIE_MARGES, preparerPoints, type SerieDef } from "@/components/charts/ThresholdSeries";
import { THRESHOLDS } from "@/lib/rating";
import { bandesSeuils, domaineY } from "@/lib/series";

const H0 = "2026-09-22T10:00:00Z";
const H1 = "2026-09-22T11:00:00Z";
const H2 = "2026-09-22T12:00:00Z";
const GRILLE = [H0, H1, H2];
const LCP: SerieDef = { cle: "lcp", libelle: "LCP p75", role: "principale" };
const txt = (s: string | null) => (s ?? "").replace(/[\u00a0\u202f]/g, " ");

describe("preparerPoints — trous et zéros", () => {
  it("points [h0, h2] sur la grille [h0, h1, h2] → deux segments séparés, h1 est un trou", () => {
    const p = preparerPoints(GRILLE, [{ t: H0, lcp: 2100 }, { t: H2, lcp: 2900 }], [LCP]);
    expect(p.lignes.map((l) => l.t)).toEqual(GRILLE);
    expect(p.lignes[1].lcp).toBeNull();
    expect(p.segments.lcp).toEqual([
      [0, 0],
      [2, 2],
    ]);
  });

  it("même cas avec `additive: true` → h1 = 0, un seul segment", () => {
    const occ: SerieDef = { cle: "occ", libelle: "Occurrences", role: "categorie", forme: "barres", additive: true };
    const p = preparerPoints(GRILLE, [{ t: H0, occ: 4 }, { t: H2, occ: 1 }], [occ]);
    expect(p.lignes[1].occ).toBe(0);
    expect(p.segments.occ).toEqual([[0, 2]]);
  });

  it("une valeur null REÇUE reste null, même additive : un inconnu déclaré n'est pas un zéro", () => {
    const occ: SerieDef = { cle: "occ", libelle: "Occurrences", role: "categorie", additive: true };
    const p = preparerPoints(GRILLE, [{ t: H0, occ: 4 }, { t: H1, occ: null }, { t: H2, occ: 1 }], [occ]);
    expect(p.lignes[1].occ).toBeNull();
    expect(p.segments.occ).toHaveLength(2);
  });

  it("une suite continue est un seul segment", () => {
    const p = preparerPoints(GRILLE, GRILLE.map((t, i) => ({ t, lcp: 2000 + i })), [LCP]);
    expect(p.segments.lcp).toEqual([[0, 2]]);
  });

  it("un point hors grille est ignoré et compté ; les formats ISO équivalents se rapprochent", () => {
    const p = preparerPoints(
      GRILLE,
      [
        { t: "2026-09-22T10:00:00.000Z", lcp: 2100 },
        { t: "2026-09-22T10:30:00Z", lcp: 9999 },
      ],
      [LCP],
    );
    expect(p.lignes[0].lcp).toBe(2100);
    expect(p.ignores).toBe(1);
    expect(p.lignes.some((l) => l.lcp === 9999)).toBe(false);
  });

  it("chaque ligne porte aussi les autres clés du point (effectif, bande) ; un effectif absent vaut 0", () => {
    const serie: SerieDef = { ...LCP, effectifCle: "n" };
    const p = preparerPoints(GRILLE, [{ t: H0, lcp: 2100, n: 40, bas: 1900 }], [serie]);
    expect(p.lignes[0]).toMatchObject({ lcp: 2100, n: 40, bas: 1900 });
    expect(p.lignes[1]).toMatchObject({ lcp: null, n: 0 });
  });
});

describe("preparerPoints — points creux", () => {
  const serie: SerieDef = { ...LCP, effectifCle: "n" };

  it("effectif sous faibleSous (défaut 30) → point creux, légende « moins de 30 mesures »", () => {
    const p = preparerPoints(GRILLE, [{ t: H0, lcp: 2100, n: 12 }, { t: H1, lcp: 2200, n: 30 }, { t: H2, lcp: 2300, n: 400 }], [serie]);
    expect(p.creux.lcp).toEqual([0]);
    expect(p.faibleEffectif).toBe(true);
  });

  it("faibleSous est réglable", () => {
    const p = preparerPoints(GRILLE, [{ t: H0, lcp: 2100, n: 80 }], [serie], { faibleSous: 100 });
    expect(p.creux.lcp).toEqual([0]);
  });

  it("un effectif inconnu (null) ne rend pas le point creux : on ne sait pas qu'il est faible", () => {
    const p = preparerPoints(GRILLE, [{ t: H0, lcp: 2100, n: null }], [serie]);
    expect(p.creux.lcp).toEqual([]);
    expect(p.faibleEffectif).toBe(false);
  });

  it("seau en cours : le dernier point mesuré est creux, sans « faible effectif »", () => {
    const p = preparerPoints(GRILLE, GRILLE.map((t) => ({ t, lcp: 2000, n: 500 })), [serie], { seauEnCours: true });
    expect(p.creux.lcp).toEqual([2]);
    expect(p.faibleEffectif).toBe(false);
  });

  it("un trou n'est jamais un point creux", () => {
    const p = preparerPoints(GRILLE, [{ t: H0, lcp: 2000, n: 5 }], [serie], { seauEnCours: true });
    expect(p.creux.lcp).toEqual([0]);
  });
});

describe("domaine y et bandes", () => {
  const lignes = (valeurs: (number | null)[]) =>
    preparerPoints(GRILLE, GRILLE.map((t, i) => ({ t, lcp: valeurs[i] })), [LCP]).lignes;

  it("vital : la bande « Bon » reste visible quand tout est bon (seuilBon × 1,1)", () => {
    const [bas, haut] = domaineY(lignes([900, 1000, 800]), [LCP], { vital: "LCP" });
    expect(bas).toBe(0);
    expect(haut).toBeCloseTo(THRESHOLDS.LCP[0] * 1.1);
  });

  it("vital : au-delà, maxDonnées × 1,2", () => {
    expect(domaineY(lignes([5000, 3000, null]), [LCP], { vital: "LCP" })[1]).toBeCloseTo(6000);
  });

  it("sans vital : maxDonnées × 1,2 ; sans aucune valeur, [0, 1]", () => {
    expect(domaineY(lignes([10, 20, 5]), [LCP])[1]).toBeCloseTo(24);
    expect(domaineY(lignes([null, null, null]), [LCP])).toEqual([0, 1]);
  });

  it("la bande d'incertitude compte dans le maximum", () => {
    const l = preparerPoints(GRILLE, [{ t: H0, lcp: 100, haut: 500 }], [LCP]).lignes;
    expect(domaineY(l, [LCP], { bande: { basseCle: "bas", hauteCle: "haut" } })[1]).toBeCloseTo(600);
  });

  it("trois bandes pleines, bornes de lib/rating.ts, coupées au haut du domaine", () => {
    const b = bandesSeuils("LCP", 6000);
    expect(b.bon).toEqual({ y1: 0, y2: 2500 });
    expect(b.ameliorer).toEqual({ y1: 2500, y2: 4000 });
    expect(b.mauvais).toEqual({ y1: 4000, y2: 6000 });
    expect(b.horsEchelle).toBeNull();
    expect(b.seuils).toBe(THRESHOLDS.LCP);
  });

  it("borne « Mauvais » au-dessus du domaine : pas de bande, et elle est DITE", () => {
    const b = bandesSeuils("LCP", 2750);
    expect(b.ameliorer).toEqual({ y1: 2500, y2: 2750 });
    expect(b.mauvais).toBeNull();
    expect(txt(b.horsEchelle)).toBe("seuil Mauvais à 4,0 s, hors échelle");
  });

  it("CLS : borne formatée sans unité", () => {
    expect(txt(bandesSeuils("CLS", 0.2).horsEchelle)).toBe("seuil Mauvais à 0,250, hors échelle");
  });
});

describe("contrat du composant", () => {
  it("SERIE_MARGES est exporté par ThresholdSeries (panneaux empilés sur un même axe x)", () => {
    expect(SERIE_MARGES.gauche).toBeGreaterThan(0);
    expect(SERIE_MARGES.droite).toBeGreaterThanOrEqual(0);
  });
});
