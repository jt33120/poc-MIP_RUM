// Placement d'étiquettes sans chevauchement (recette du 26/09/2026) : annotations,
// repères d'histogramme, graduations, nuage de points.
import { describe, expect, it } from "vitest";
import { etendueCentree, etiquettesAxeLisibles, placerEtiquettesNuage, rangerEtiquettes } from "@/lib/etiquettes";

describe("rangerEtiquettes", () => {
  it("des étiquettes qui ne se touchent pas restent sur la première rangée", () => {
    expect(rangerEtiquettes([{ debut: 0, fin: 40 }, { debut: 60, fin: 90 }], 2)).toEqual([0, 0]);
  });

  it("une étiquette qui chevauche passe sur la rangée suivante ; sans rangée libre : -1", () => {
    const etendues = [
      { debut: 0, fin: 50 },
      { debut: 30, fin: 80 },
      { debut: 40, fin: 70 },
    ];
    expect(rangerEtiquettes(etendues, 2)).toEqual([0, 1, -1]);
    expect(rangerEtiquettes(etendues, 3)).toEqual([0, 1, 2]);
  });

  it("l'écart minimal compte comme un chevauchement", () => {
    expect(rangerEtiquettes([{ debut: 0, fin: 40 }, { debut: 42, fin: 60 }], 2, 4)).toEqual([0, 1]);
  });
});

describe("etendueCentree", () => {
  it("centrée sur x quand elle le peut, collée au bord sinon (jamais coupée)", () => {
    expect(etendueCentree(100, 40, 0, 320)).toMatchObject({ debut: 80, fin: 120, centre: 100 });
    expect(etendueCentree(5, 40, 0, 320)).toMatchObject({ debut: 0, fin: 40 });
    expect(etendueCentree(318, 40, 0, 320)).toMatchObject({ debut: 280, fin: 320 });
  });
});

describe("etiquettesAxeLisibles", () => {
  it("garde la première et la dernière, omet celle du milieu qui chevauche (« 0,000,100 »)", () => {
    const etendues = [
      { debut: 0, fin: 18 },
      { debut: 20, fin: 38 },
      { debut: 64, fin: 82 },
      { debut: 290, fin: 320 },
    ];
    expect(etiquettesAxeLisibles(etendues, 3)).toEqual([0, 2, 3]);
  });
});

describe("placerEtiquettesNuage", () => {
  const cadre = { gauche: 0, haut: 0, droite: 300, bas: 200 };
  const e = (x: number, y: number) => ({ x, y, rayon: 5, largeur: 60, hauteur: 12 });

  it("au-dessus du point quand il y a la place", () => {
    expect(placerEtiquettesNuage([e(150, 100)], cadre)).toEqual([{ x: 150, y: 92, ancre: "middle" }]);
  });

  it("le point le plus haut, collé au bord : l'étiquette ne sort pas du cadre", () => {
    const [p] = placerEtiquettesNuage([e(150, 4)], cadre);
    expect(p).not.toBeNull();
    // Pas de place au-dessus ni sur les côtés sans dépasser le haut : en dessous.
    expect(p!.y).toBeGreaterThan(4 + 5);
    expect(p!.y - 12).toBeGreaterThanOrEqual(cadre.haut);
  });

  it("deux points voisins : deux étiquettes qui ne se recouvrent pas", () => {
    const [a, b] = placerEtiquettesNuage([e(150, 100), e(160, 102)], cadre);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toEqual(b);
  });

  it("aucune place : null (le point garde son infobulle)", () => {
    const serre = { gauche: 0, haut: 0, droite: 20, bas: 20 };
    expect(placerEtiquettesNuage([e(10, 10)], serre)).toEqual([null]);
  });
});
