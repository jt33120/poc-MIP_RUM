// La carte « Santé de la chaîne de mesure » (/admin/health, lot L2 des sondes) :
// ce qu'elle dit, sans base ni rendu. Le silence du canari se lit à l'âge du
// dernier passage (un canari qui ne passe plus ne laisse aucun échec à lire), puis
// la fenêtre ouverte de la plateforme décide.
import { describe, expect, it } from "vitest";
import {
  depuis,
  duree,
  fenetreOuvertePlateforme,
  niveauResultat,
  tauxAboutis,
  verdictChaine,
} from "../../apps/console/lib/chaine-mesure";
import type { FenetreRegistre, SanteChaineBrute } from "../../apps/console/lib/queries-chaine";

const MAINTENANT = Date.parse("2026-09-30T10:00:00Z");
const ilYa = (min: number) => new Date(MAINTENANT - min * 60_000).toISOString();

function brute(dernierMin: number | null, fenetres: FenetreRegistre[] = []): SanteChaineBrute {
  return {
    dernier: dernierMin === null ? null : { passage_id: "p", emis_at: ilYa(dernierMin) },
    etages: [],
    fenetres,
    taux7j: { total: 0, aboutis: 0 },
    battements: [],
  };
}

const fenetre = (f: Partial<FenetreRegistre>): FenetreRegistre => ({
  id: 1,
  portee: "*",
  etage: "chaine",
  etat: "interrompue",
  debut: ilYa(90),
  fin: null,
  cause: "le canari n'a pas été écrit",
  preuve: null,
  source: "sonde",
  ...f,
});

describe("le verdict de la carte", () => {
  it("sans schéma, sans passage : inconnu, et il le dit", () => {
    expect(verdictChaine(null, MAINTENANT, 15)).toMatchObject({ niveau: "inconnu", titre: "Sondes pas encore en service" });
    expect(verdictChaine(brute(null), MAINTENANT, 15)).toMatchObject({ niveau: "inconnu", titre: "Aucun passage du canari" });
  });

  it("en service : le dernier canari, daté", () => {
    expect(verdictChaine(brute(6), MAINTENANT, 15)).toEqual({
      niveau: "ok",
      titre: "Collecte en service · dernier canari il y a 6 min",
      detail: null,
    });
  });

  it("plus de 2 × cadence + 5 min sans passage : incident, même sans fenêtre ouverte (base coupée)", () => {
    expect(verdictChaine(brute(35), MAINTENANT, 15).niveau).toBe("ok");
    expect(verdictChaine(brute(36), MAINTENANT, 15)).toMatchObject({ niveau: "incident", titre: "Aucun passage du canari il y a 36 min" });
    // Cadence non publiée : 15 min par défaut ; à 5 min, le seuil tombe à 15 min.
    expect(verdictChaine(brute(36), MAINTENANT, null).niveau).toBe("incident");
    expect(verdictChaine(brute(16), MAINTENANT, 5).niveau).toBe("incident");
  });

  it("la fenêtre ouverte de la plateforme décide : interrompue → incident, dégradée → attention, avec sa cause", () => {
    expect(verdictChaine(brute(5, [fenetre({})]), MAINTENANT, 15)).toEqual({
      niveau: "incident",
      titre: "Collecte interrompue depuis 1 h",
      detail: "le canari n'a pas été écrit",
    });
    expect(verdictChaine(brute(5, [fenetre({ etat: "degradee", debut: ilYa(20), cause: "c" })]), MAINTENANT, 15)).toMatchObject({
      niveau: "attention",
      titre: "Collecte dégradée depuis 20 min",
    });
    // Une fenêtre close, ou propre à une application, ne dit rien de la plateforme.
    expect(verdictChaine(brute(5, [fenetre({ fin: ilYa(30) }), fenetre({ portee: "gip-plateforme", etage: "silence" })]), MAINTENANT, 15).niveau).toBe("ok");
    expect(fenetreOuvertePlateforme([fenetre({ portee: "x" })])).toBeNull();
  });
});

describe("les détails", () => {
  it("le résultat d'un étage : réussi, lent, échec, inconnu", () => {
    expect(niveauResultat("ok")).toBe("ok");
    expect(niveauResultat("lent")).toBe("attention");
    expect(niveauResultat("absent")).toBe("incident");
    expect(niveauResultat("saute")).toBe("inconnu");
    expect(niveauResultat(undefined)).toBe("inconnu");
  });

  it("âges et durées en clair", () => {
    expect(depuis(ilYa(0.5), MAINTENANT)).toBe("à l'instant");
    expect(depuis(ilYa(59), MAINTENANT)).toBe("il y a 59 min");
    expect(depuis(ilYa(47 * 60), MAINTENANT)).toBe("il y a 47 h");
    expect(depuis(ilYa(3 * 24 * 60), MAINTENANT)).toBe("il y a 3 j");
    // T1 : du 24/09 03:30 au 27/09 19:45 UTC.
    expect(duree("2026-09-24T03:30:00Z", "2026-09-27T19:45:00Z", MAINTENANT)).toBe("3 j 16 h");
    expect(duree(ilYa(45), null, MAINTENANT)).toBe("45 min");
    expect(duree(ilYa(125), null, MAINTENANT)).toBe("2 h 05");
  });

  it("le taux de canaris aboutis, sans division par zéro", () => {
    expect(tauxAboutis({ total: 0, aboutis: 0 })).toBeNull();
    expect(tauxAboutis({ total: 672, aboutis: 670 })).toBe(99.7);
    expect(tauxAboutis({ total: 3, aboutis: 3 })).toBe(100);
  });
});
