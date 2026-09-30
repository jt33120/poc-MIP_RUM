// « Le manque se voit » (refonte du monitoring, vague 1) : les fenêtres hors collecte
// posées sur la grille, et l'heure de Paris aux changements d'heure.
//
// Un seau que couvre une fenêtre `interrompue` n'est plus un zéro mesuré : il est
// « non mesuré » (`null`), même pour un compte. Les dates des tests sont des
// FIXTURES : en production, les fenêtres viennent toutes du registre en base.
import { describe, expect, it } from "vitest";
import {
  alignerSeauxDetail,
  bornesSeau,
  collecteDesSeaux,
  decalageFuseau,
  fenetresDeLaGrille,
  minuitDans,
  preparerPoints,
  suitesDeSeaux,
  texteFenetreCollecte,
  type FenetreCollecte,
  type SerieDef,
} from "../../apps/console/lib/series";

const H = 3_600_000;
const PARIS = "Europe/Paris";
const grilleHoraire = (debut: string, n: number) =>
  Array.from({ length: n }, (_v, i) => new Date(Date.parse(debut) + i * H).toISOString().replace(/\.\d{3}Z$/, "Z"));

describe("heure de Paris — minuit et décalage", () => {
  it("décalage : +2 h l'été, +1 h l'hiver", () => {
    expect(decalageFuseau(Date.parse("2026-09-29T12:00:00Z"), PARIS)).toBe(2 * H);
    expect(decalageFuseau(Date.parse("2026-11-02T12:00:00Z"), PARIS)).toBe(1 * H);
  });

  it("minuit du 25/10/2026 (jour du passage à l'heure d'hiver) est encore en heure d'été", () => {
    expect(new Date(minuitDans("2026-10-25", PARIS)).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(new Date(minuitDans("2026-10-26", PARIS)).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("le jour du changement d'heure dure 25 h ; celui de mars, 23 h", () => {
    const [a, b] = bornesSeau("2026-10-25", 86_400, PARIS)!;
    expect((b - a) / H).toBe(25);
    const [c, d] = bornesSeau("2026-03-29", 86_400, PARIS)!;
    expect((d - c) / H).toBe(23);
  });
});

describe("collecteDesSeaux — l'état de la collecte de chaque seau", () => {
  const grille = grilleHoraire("2026-09-24T00:00:00Z", 6); // 00:00 → 05:00 UTC
  const coupure: FenetreCollecte = { debut: "2026-09-24T01:30:00Z", fin: "2026-09-24T04:00:00Z", etat: "interrompue" };
  const maintenant = Date.parse("2026-09-30T00:00:00Z");

  it("sans fenêtre : rien n'est marqué", () => {
    expect(collecteDesSeaux(grille, 3600, [], { maintenant })).toEqual([null, null, null, null, null, null]);
  });

  it("seau entièrement couvert → interrompue ; recoupé → partielle", () => {
    expect(collecteDesSeaux(grille, 3600, [coupure], { maintenant })).toEqual([
      null,
      "partielle",
      "interrompue",
      "interrompue",
      null,
      null,
    ]);
  });

  it("une fenêtre dégradée ne rend jamais « non mesuré »", () => {
    const degradee: FenetreCollecte = { ...coupure, etat: "degradee" };
    expect(collecteDesSeaux(grille, 3600, [degradee], { maintenant })).toEqual([null, "partielle", "partielle", "partielle", null, null]);
  });

  it("deux fenêtres bout à bout (plateforme puis app) couvrent le seau à elles deux", () => {
    const f = [
      { debut: "2026-09-24T02:00:00Z", fin: "2026-09-24T02:30:00Z", etat: "interrompue" as const },
      { debut: "2026-09-24T02:20:00Z", fin: "2026-09-24T03:00:00Z", etat: "interrompue" as const },
    ];
    expect(collecteDesSeaux(grille, 3600, f, { maintenant })[2]).toBe("interrompue");
  });

  it("fenêtre en cours (fin null) : le seau en cours est interrompu jusqu'à maintenant", () => {
    const enCours: FenetreCollecte = { debut: "2026-09-24T04:10:00Z", fin: null, etat: "interrompue" };
    const etats = collecteDesSeaux(grille, 3600, [enCours], { maintenant: Date.parse("2026-09-24T05:20:00Z") });
    expect(etats[4]).toBe("partielle");
    expect(etats[5]).toBe("interrompue");
  });

  it("suites de seaux : une zone hachurée par suite", () => {
    expect(suitesDeSeaux([null, "interrompue", "interrompue", null, "interrompue"], "interrompue")).toEqual([
      [1, 2],
      [4, 4],
    ]);
  });

  it("grille de jours : les bornes sont les minuits de Paris", () => {
    const jours = ["2026-09-23", "2026-09-24", "2026-09-25"];
    // Du 23/09 à minuit (Paris) au 25/09 à minuit (Paris) : le 23 et le 24 sont couverts.
    const f: FenetreCollecte = { debut: "2026-09-22T22:00:00Z", fin: "2026-09-24T22:00:00Z", etat: "interrompue" };
    expect(collecteDesSeaux(jours, 86_400, [f], { fuseau: PARIS, maintenant })).toEqual(["interrompue", "interrompue", null]);
  });
});

describe("preparerPoints — un seau interrompu n'est pas un zéro", () => {
  const grille = grilleHoraire("2026-09-24T00:00:00Z", 4);
  const vues: SerieDef = { cle: "vues", libelle: "Pages vues", role: "principale", forme: "barres", additive: true };
  const lcp: SerieDef = { cle: "lcp", libelle: "LCP p75", role: "principale" };
  const points = [
    { t: grille[0], vues: 12, lcp: 1800 },
    { t: grille[1], vues: 0, lcp: null },
    { t: grille[3], vues: 9, lcp: 2100 },
  ];
  const collecte = [null, "interrompue", "interrompue", null] as const;

  it("sans fenêtre : le compte absent vaut 0 (comportement historique)", () => {
    const p = preparerPoints(grille, points, [vues, lcp]);
    expect(p.lignes.map((l) => l.vues)).toEqual([12, 0, 0, 9]);
    expect(p.horsCollecte).toEqual([]);
  });

  it("avec la fenêtre : 0 reçu et seau absent deviennent null, et sont listés « non mesurés »", () => {
    const p = preparerPoints(grille, points, [vues, lcp], { collecte: [...collecte] });
    expect(p.lignes.map((l) => l.vues)).toEqual([12, null, null, 9]);
    expect(p.lignes.map((l) => l.lcp)).toEqual([1800, null, null, 2100]);
    expect(p.horsCollecte).toEqual([1, 2]);
    expect(p.segments.vues).toEqual([
      [0, 0],
      [3, 3],
    ]);
  });

  it("une valeur non nulle reçue dans un seau interrompu est gardée, en point creux", () => {
    const p = preparerPoints(grille, [{ t: grille[1], vues: 4 }], [vues], { collecte: [...collecte] });
    expect(p.lignes[1].vues).toBe(4);
    expect(p.horsCollecte).toEqual([2]);
    expect(p.collectePartielle).toEqual([1]);
    expect(p.creux.vues).toContain(1);
  });

  it("seau partiel : la valeur reste, marquée creuse", () => {
    const p = preparerPoints(grille, points, [vues], { collecte: [null, null, null, "partielle"] });
    expect(p.lignes[3].vues).toBe(9);
    expect(p.creux.vues).toEqual([3]);
  });
});

describe("alignerSeauxDetail — le remplissage à zéro s'arrête aux seaux interrompus", () => {
  it("additif : 0 hors panne, null pendant", () => {
    const starts = [0, 1, 2].map((i) => Date.parse("2026-09-24T00:00:00Z") + i * H);
    const rows = [{ bucket: "2026-09-24T00:00:00Z", n: 3 }];
    const { seaux } = alignerSeauxDetail(rows, starts, true, [null, "interrompue", null]);
    expect(seaux.map((s) => s?.n ?? null)).toEqual([3, null, 0]);
  });
});

describe("texte et légende des fenêtres", () => {
  const coupure: FenetreCollecte = { debut: "2026-09-24T03:28:00Z", fin: "2026-09-27T19:44:00Z", etat: "interrompue" };

  it("dit la fenêtre en heure de Paris", () => {
    expect(texteFenetreCollecte(coupure, PARIS)).toBe("Collecte interrompue du 24/09 05:28 au 27/09 21:44 (heure de Paris)");
    expect(texteFenetreCollecte({ ...coupure, fin: null, etat: "degradee" }, PARIS)).toBe(
      "Collecte dégradée depuis le 24/09 05:28 (heure de Paris)",
    );
  });

  it("ne garde que les fenêtres qui recoupent la grille", () => {
    const grille = grilleHoraire("2026-09-28T00:00:00Z", 24);
    expect(fenetresDeLaGrille([coupure], grille, 3600, PARIS)).toEqual([]);
    expect(fenetresDeLaGrille([coupure], grilleHoraire("2026-09-27T00:00:00Z", 24), 3600, PARIS)).toEqual([coupure]);
  });
});
