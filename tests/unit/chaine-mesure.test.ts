// La carte « Santé de la chaîne de mesure » (/admin/health, lot L2 des sondes) :
// ce qu'elle dit, sans base ni rendu. Le silence du canari se lit à l'âge du
// dernier passage (un canari qui ne passe plus ne laisse aucun échec à lire), puis
// la fenêtre ouverte de la plateforme décide.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SanteChaine } from "@/components/SanteChaine";
import {
  ETATS_FRISE_CHAINE,
  HEURES_FRISE,
  casesFrise,
  debutsFrise,
  depuis,
  duree,
  fenetreOuvertePlateforme,
  libelleBadgeMesure,
  libelleLatences,
  niveauResultat,
  tauxAboutis,
  verdictChaine,
  verdictMesure,
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
    heures: [],
    latences7j: [],
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

describe("le badge de l'en-tête : le même verdict, depuis la petite lecture de la coquille", () => {
  it("verdictMesure rend ce que rend la carte, pour chaque cas", () => {
    const f = fenetre({ etat: "degradee", debut: ilYa(20), cause: "c" });
    const cas: Array<[number | null, FenetreRegistre[], number | null]> = [
      [null, [], 15],
      [6, [], 15],
      [36, [], 15],
      [16, [], 5],
      [5, [fenetre({})], 15],
      [5, [f], null],
    ];
    for (const [min, fenetres, cadence] of cas) {
      const b = brute(min, fenetres);
      const ouverte = fenetreOuvertePlateforme(fenetres);
      expect(
        verdictMesure(
          { dernier: b.dernier?.emis_at ?? null, ouverte: ouverte && { etat: ouverte.etat, debut: ouverte.debut, cause: ouverte.cause }, cadenceMin: cadence },
          MAINTENANT,
        ),
      ).toEqual(verdictChaine(b, MAINTENANT, cadence));
    }
    expect(verdictMesure(null, MAINTENANT)).toEqual(verdictChaine(null, MAINTENANT, 15));
  });

  it("vert, ambre, rouge : trois libellés courts, et « non sondée » faute de canari", () => {
    const etat = (dernierMin: number, ouverte: "degradee" | "interrompue" | null) => ({
      dernier: ilYa(dernierMin),
      ouverte: ouverte && { etat: ouverte, debut: ilYa(30), cause: null },
      cadenceMin: 15,
    });
    expect(libelleBadgeMesure(verdictMesure(etat(3, null), MAINTENANT).niveau)).toBe("Mesure OK");
    expect(libelleBadgeMesure(verdictMesure(etat(3, "degradee"), MAINTENANT).niveau)).toBe("Mesure dégradée");
    expect(libelleBadgeMesure(verdictMesure(etat(3, "interrompue"), MAINTENANT).niveau)).toBe("Mesure interrompue");
    // Le cache de 60 s ne fige pas le verdict : l'âge se lit au rendu.
    expect(libelleBadgeMesure(verdictMesure(etat(40, null), MAINTENANT).niveau)).toBe("Mesure interrompue");
    expect(libelleBadgeMesure(verdictMesure({ dernier: null, ouverte: null, cadenceMin: 15 }, MAINTENANT).niveau)).toBe("Mesure non sondée");
  });
});

describe("la frise de 7 jours", () => {
  it("168 heures, la dernière est l'heure en cours", () => {
    const debuts = debutsFrise(MAINTENANT + 25 * 60_000);
    expect(debuts).toHaveLength(HEURES_FRISE);
    expect(new Date(debuts.at(-1)!).toISOString()).toBe("2026-09-30T10:00:00.000Z");
    expect(new Date(debuts[0]).toISOString()).toBe("2026-09-23T11:00:00.000Z");
  });

  it("une case par heure lue : le pire passage, le compte de chacun ; `absent` (lignes) ne se confond pas avec « aucun passage »", () => {
    const cases = casesFrise(
      [
        { etage: "ingest_console", heure: "2026-09-30T08:00:00Z", resultats: { ok: 3, lent: 1 } },
        { etage: "ingest_console", heure: "2026-09-30T09:00:00Z", resultats: { ok: 2, echec: 1, repli: 1 } },
        { etage: "ecriture", heure: "2026-09-30T09:00:00Z", resultats: { absent: 1, ok: 3 } },
        { etage: "ingest_console", heure: "2026-09-30T10:00:00Z", resultats: { ok: 1 } },
      ],
      "ingest_console",
    );
    expect(cases).toEqual([
      { t: "2026-09-30T08:00:00Z", etat: "lent", detail: "4 passages : 3 réussi, 1 lent" },
      { t: "2026-09-30T09:00:00Z", etat: "echec", detail: "4 passages : 2 réussi, 1 repli local, 1 échec" },
      { t: "2026-09-30T10:00:00Z", etat: "ok", detail: "1 passage : 1 réussi" },
    ]);
    expect(casesFrise([{ etage: "ecriture", heure: "2026-09-30T09:00:00Z", resultats: { absent: 1, ok: 3 } }], "ecriture")[0].etat).toBe("lignes_absentes");
    // Chaque état rendu a sa définition, et « absent » reste la hachure d'une heure sans passage.
    const cles = ETATS_FRISE_CHAINE.map((e) => e.cle);
    for (const etat of ["ok", "lent", "repli", "echec", "lignes_absentes", "saute"]) expect(cles).toContain(etat);
    expect(ETATS_FRISE_CHAINE.find((e) => e.cle === "absent")?.forme).toBe("hachure");
  });

  it("les latences p50/p95, et rien sans mesure", () => {
    expect(libelleLatences({ etage: "ingest_console", p50: 420, p95: 1800, n: 672 })).toBe("p50 420 ms · p95 1 800 ms, sur 672 passages");
    expect(libelleLatences({ etage: "ingest_console", p50: null, p95: null, n: 0 })).toBeNull();
    expect(libelleLatences(undefined)).toBeNull();
  });
});

// Le rendu de la carte (recette du 01/10/2026) : un fait par ligne. Le verdict tient sur
// une ligne, sa phrase d'explication et la cause d'une fenêtre se replient — elles
// restent dans le document, elles ne sont plus étalées.
describe("la carte : une ligne par fait", () => {
  const rendre = (b: SanteChaineBrute | null) => renderToStaticMarkup(createElement(SanteChaine, { brute: b, cadenceMin: 15, maintenant: MAINTENANT }));

  it("verdict avec explication : titre sur une ligne, la phrase repliée sous « Pourquoi »", () => {
    const html = rendre(brute(5, [fenetre({})]));
    const verdict = html.split('data-testid="sante-chaine-verdict"')[1]?.split("</details>")[0] ?? "";
    expect(html).toMatch(/<details class="group" data-testid="sante-chaine-verdict"/);
    expect(verdict).toMatch(/<summary[^>]*>.*Collecte interrompue depuis 1 h.*Pourquoi.*<\/summary><p[^>]*>le canari n&#x27;a pas été écrit<\/p>/);
    expect(verdict).toContain("truncate");
  });

  it("verdict sans explication : une ligne, rien à ouvrir", () => {
    const html = rendre(brute(6));
    expect(html).toMatch(/<p class="[^"]*" data-testid="sante-chaine-verdict">/);
    expect(html).not.toContain("Pourquoi");
  });

  it("aucune fenêtre : « 0 » sur la ligne du titre, la phrase lue ; une fenêtre : cause et preuve repliées", () => {
    const vide = rendre(brute(6));
    expect(vide).toContain('data-testid="sante-chaine-fenetres-aucune"');
    expect(vide).toMatch(/<span class="sr-only">[^<]*la collecte a été nominale sur la période\.<\/span>/);
    const avec = rendre(brute(5, [fenetre({ fin: ilYa(30), preuve: "passage p-12" })]));
    const liste = avec.split('data-testid="sante-chaine-fenetres"')[1] ?? "";
    expect(liste).toMatch(/<li[^>]*><details><summary[^>]*>.*Interrompue.*<\/summary><div[^>]*>le canari/);
    expect(liste).toContain("passage p-12");
  });
});
