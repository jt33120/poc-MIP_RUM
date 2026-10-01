// @mip/stats/standardisation — deux releases comparées à mix de trafic égal.
//
// Le critère de réception : deux releases au MÊME code (la valeur ne dépend que de la
// route et de l'appareil), l'une servie le jour (ordinateurs, panier), l'autre la nuit
// (mobiles, accueil), ont un écart BRUT net et un écart STANDARDISÉ d'environ 0.
import { describe, expect, it } from "vitest";
import {
  COUVERTURE_MIN,
  EFFECTIF_MIN_RELEASE,
  EFFECTIF_MIN_STRATE,
  partPonderee,
  ponderer,
  quantilePondere,
  standardiserPart,
  standardiserQuantile,
  verifierPonderation,
  type EffectifPart,
  type Observation,
} from "@mip/stats/standardisation";

const ROUTES = ["/accueil", "/panier"] as const;
const APPAREILS = ["desktop", "mobile"] as const;
type Route = (typeof ROUTES)[number];
type Appareil = (typeof APPAREILS)[number];
const strate = (r: Route, d: Appareil) => `${r}|${d}`;

/** LCP médian d'une strate : le « code » est le même pour les deux releases. */
const LCP_STRATE: Record<string, number> = {
  [strate("/accueil", "desktop")]: 1200,
  [strate("/panier", "desktop")]: 1800,
  [strate("/accueil", "mobile")]: 2400,
  [strate("/panier", "mobile")]: 3600,
};
/** Part de sessions en erreur d'une strate : même code, même probabilité. */
const ERREUR_STRATE: Record<string, number> = {
  [strate("/accueil", "desktop")]: 0.01,
  [strate("/panier", "desktop")]: 0.03,
  [strate("/accueil", "mobile")]: 0.1,
  [strate("/panier", "mobile")]: 0.2,
};

/**
 * Le mix d'une heure : le jour, 80 % d'ordinateurs et 70 % du trafic au panier ; la
 * nuit, 80 % de mobiles et 75 % à l'accueil. Une release servie le jour et une autre
 * la nuit ne voient donc pas le même trafic — sans que leur code diffère.
 */
function mix(heure: number): Record<string, number> {
  const jour = heure >= 8 && heure < 20;
  const pMobile = jour ? 0.2 : 0.8;
  const pPanier = jour ? 0.7 : 0.25;
  const parts: Record<string, number> = {};
  for (const r of ROUTES)
    for (const d of APPAREILS) parts[strate(r, d)] = (d === "mobile" ? pMobile : 1 - pMobile) * (r === "/panier" ? pPanier : 1 - pPanier);
  return parts;
}

/**
 * Mesures d'une release servie sur des heures données, `parHeure` mesures par heure.
 * Dans une strate, les valeurs sont une grille régulière de ±40 % autour de sa
 * médiane : la même LOI pour les deux releases, quel que soit l'effectif.
 */
function mesures(cote: "a" | "b", heures: readonly number[], parHeure: number): Observation[] {
  const effectifs = new Map<string, number>();
  for (const h of heures)
    for (const [s, p] of Object.entries(mix(h))) effectifs.set(s, (effectifs.get(s) ?? 0) + Math.round(p * parHeure));
  return [...effectifs].flatMap(([s, n]) =>
    Array.from({ length: n }, (_, i) => ({ cote, strate: s, valeur: LCP_STRATE[s] * (0.6 + (0.8 * (i + 0.5)) / n) })),
  );
}

/** Sessions et sessions en erreur par strate : n et k = n × taux de la strate (même code). */
function sessions(heures: readonly number[], parHeure: number): Map<string, { n: number; k: number }> {
  const m = new Map<string, { n: number; k: number }>();
  for (const h of heures)
    for (const [s, p] of Object.entries(mix(h))) {
      const d = m.get(s) ?? { n: 0, k: 0 };
      d.n += Math.round(p * parHeure);
      m.set(s, d);
    }
  for (const [s, d] of m) d.k = Math.round(d.n * ERREUR_STRATE[s]);
  return m;
}

const JOUR = [9, 10, 11, 14, 15, 16];
const NUIT = [21, 22, 23, 0, 1, 2];
const relatif = (a: number, b: number) => (b - a) / a;

describe("même code, mix jour/nuit et mobile/ordinateur différents (critère de réception)", () => {
  it("LCP p75 : écart brut net, écart à mix égal d'environ 0", () => {
    const obs = [...mesures("a", JOUR, 400), ...mesures("b", NUIT, 400)];
    const r = standardiserQuantile(obs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Brut : la release de nuit paraît bien plus lente — c'est son trafic, pas son code.
    expect(Math.abs(relatif(r.brut.a!, r.brut.b!))).toBeGreaterThan(0.2);
    // À mix égal : moins de 2 % d'écart (la grille de chaque strate est discrète).
    expect(Math.abs(relatif(r.a, r.b))).toBeLessThan(0.02);
    expect(r.ponderation.couverture).toEqual({ a: 1, b: 1, ensemble: 1 });
    expect(r.ponderation.nbStrates).toEqual({ communes: 4, total: 4 });
  });

  it("part de sessions en erreur : écart brut net, écart à mix égal d'environ 0", () => {
    const a = sessions(JOUR, 1000);
    const b = sessions(NUIT, 1000);
    const lignes: EffectifPart[] = [...a.keys()].map((s) => ({ strate: s, a: a.get(s)!, b: b.get(s)! }));
    const r = standardiserPart(lignes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Brut : la nuit, plus de mobiles, donc plus de sessions en erreur (≈ 5 points).
    expect(Math.abs(r.brut.b! - r.brut.a!)).toBeGreaterThan(0.03);
    // Les taux par strate sont les mêmes à l'arrondi de k près : moins de 0,2 point d'écart.
    expect(Math.abs(r.b - r.a)).toBeLessThan(0.002);
  });

  it("un vrai écart de code, lui, reste visible à mix égal", () => {
    const a = mesures("a", JOUR, 400);
    // B est 25 % plus lent dans CHAQUE strate : la standardisation ne doit pas l'effacer.
    const b = mesures("b", NUIT, 400).map((o) => ({ ...o, valeur: o.valeur * 1.25 }));
    const r = standardiserQuantile([...a, ...b]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(relatif(r.a, r.b)).toBeGreaterThan(0.22);
    expect(relatif(r.a, r.b)).toBeLessThan(0.28);
  });
});

describe("poids, couverture et refus", () => {
  it("poids = part de la strate dans la référence ÷ sa part dans la release", () => {
    const p = ponderer([
      { strate: "x", a: 80, b: 20 },
      { strate: "y", a: 20, b: 80 },
    ]);
    const x = p.strates.find((s) => s.strate === "x")!;
    // Référence : x pèse 100 / 200 = 50 % ; dans A 80 %, dans B 20 %.
    expect(x.partReference).toBeCloseTo(0.5);
    expect(x.poidsA).toBeCloseTo(0.5 / 0.8);
    expect(x.poidsB).toBeCloseTo(0.5 / 0.2);
    // Le poids total d'une release vaut son effectif dans les strates communes.
    const totalA = p.strates.reduce((s, t) => s + t.a * t.poidsA, 0);
    expect(totalA).toBeCloseTo(100);
  });

  it("une strate rare d'un côté n'est pas commune, et la couverture le dit", () => {
    const p = ponderer([
      { strate: "commune", a: 90, b: 60 },
      { strate: "rare-en-b", a: 10, b: EFFECTIF_MIN_STRATE - 1 },
      { strate: "absente-de-a", a: 0, b: 31 },
    ]);
    expect(p.nbStrates).toEqual({ communes: 1, total: 3 });
    expect(p.effectifs).toEqual({ a: 90, b: 60 });
    expect(p.couverture!.a).toBeCloseTo(0.9);
    expect(p.couverture!.b).toBeCloseTo(0.6);
    expect(p.couverture!.ensemble).toBeCloseTo(150 / 200);
  });

  it("les refus se disent en une ligne chiffrée", () => {
    const aucune = verifierPonderation(ponderer([{ strate: "x", a: 50, b: 0 }]), "mesures", "route × appareil");
    expect(aucune?.raison).toBe(`aucune strate route × appareil commune aux deux releases (${EFFECTIF_MIN_STRATE} mesures au moins de chaque côté)`);
    const peu = verifierPonderation(ponderer([{ strate: "x", a: 20, b: 200 }]), "mesures", "route × appareil");
    expect(peu?.raison).toBe(`20 mesures de A dans des strates communes, ${EFFECTIF_MIN_RELEASE} requises`);
    const couverture = verifierPonderation(
      ponderer([
        { strate: "x", a: 100, b: 100 },
        { strate: "y", a: 0, b: 300 },
      ]),
      "sessions",
      "route d'entrée × appareil",
    );
    expect(couverture?.raison).toBe(`couverture 25 % des sessions de B, ${Math.round(COUVERTURE_MIN * 100)} % requis`);
    expect(verifierPonderation(ponderer([{ strate: "x", a: 100, b: 100 }]), "mesures", "route × appareil")).toBeNull();
  });

  it("sous un seuil, la standardisation se tait au lieu de rendre un chiffre", () => {
    const r = standardiserQuantile([
      ...Array.from({ length: 30 }, (_, i): Observation => ({ cote: "a", strate: "x", valeur: i })),
      ...Array.from({ length: 30 }, (_, i): Observation => ({ cote: "b", strate: "x", valeur: i })),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.manque).toEqual({ requis: EFFECTIF_MIN_RELEASE, observe: 30, unite: "mesures" });
  });

  it("aucun texte du module ne parle de cause", () => {
    const textes = [
      verifierPonderation(ponderer([]), "mesures", "route × appareil")?.raison,
      verifierPonderation(ponderer([{ strate: "x", a: 20, b: 200 }]), "mesures", "route × appareil")?.raison,
    ].join(" ");
    expect(textes).not.toMatch(/caus|effet|impact/i);
  });
});

describe("quantile et part pondérés", () => {
  it("poids égaux : le quantile empirique (inverse de la répartition)", () => {
    const obs = [5, 1, 4, 2, 3, 8, 7, 6].map((valeur) => ({ valeur, poids: 1 }));
    expect(quantilePondere(obs, 0.75)).toBe(6);
    expect(quantilePondere(obs, 0.5)).toBe(4);
    expect(quantilePondere(obs, 1)).toBe(8);
  });

  it("un poids lourd déplace le quantile vers sa valeur", () => {
    expect(quantilePondere([{ valeur: 1, poids: 1 }, { valeur: 10, poids: 9 }], 0.75)).toBe(10);
    expect(quantilePondere([{ valeur: 1, poids: 9 }, { valeur: 10, poids: 1 }], 0.75)).toBe(1);
  });

  it("une somme de poids inexacte tombe sur la même mesure (tolérance de la somme cumulée)", () => {
    // 3 × 0,1 ≠ 0,3 en flottant : sans tolérance, la cible 0,75 × 0,4 serait manquée d'un ulp.
    const obs = [1, 2, 3, 4].map((valeur) => ({ valeur, poids: 0.1 }));
    expect(quantilePondere(obs, 0.75)).toBe(3);
  });

  it("rien à lire : null, jamais 0", () => {
    expect(quantilePondere([], 0.75)).toBeNull();
    expect(quantilePondere([{ valeur: 3, poids: 0 }], 0.75)).toBeNull();
    expect(partPonderee([])).toBeNull();
  });

  it("part pondérée = Σ poids·k ÷ Σ poids·n", () => {
    expect(
      partPonderee([
        { n: 100, k: 10, poids: 2 },
        { n: 100, k: 30, poids: 1 },
      ]),
    ).toBeCloseTo((2 * 10 + 30) / (2 * 100 + 100));
  });
});
