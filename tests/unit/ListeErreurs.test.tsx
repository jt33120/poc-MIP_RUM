// ListeErreurs (F19, plan § 5.3.1-5.3.2) : ce que les deux listes d'erreurs
// partagent — l'échelle commune des sparklines (et la phrase qui la dit), la
// cellule qui devient une ligne de carte sous 640 px, et le filtre de statut.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "@/components/charts/Sparkline";
import { CelluleGroupe, FiltreStatut, echelleCommune, noteEchelle } from "@/components/errors/ListeErreurs";

const rendu = (el: ReactElement) => renderToStaticMarkup(el);
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** Premier point du premier tracé d'une sparkline : « M x y ». */
const premierPoint = (html: string) => /d="M ([\d.]+) ([\d.]+)/.exec(html)?.slice(1).map(Number) ?? [];

describe("echelleCommune", () => {
  it("le plus grand seau de TOUTES les lignes, pas de chaque ligne", () => {
    expect(echelleCommune([{ series: [1, 2, 3] }, { series: [0, 500, 4] }, { series: [7] }])).toBe(500);
  });

  it("aucune série, ou tout à zéro : pas d'échelle commune (il n'y a rien à comparer)", () => {
    expect(echelleCommune([])).toBeUndefined();
    expect(echelleCommune([{}, {}])).toBeUndefined();
    expect(echelleCommune([{ series: [0, 0] }])).toBeUndefined();
  });

  it("appliquée à la liste, deux valeurs égales ont la même hauteur", () => {
    const lignes = [{ series: [30, 10, 20] }, { series: [30, 500, 75] }];
    const max = echelleCommune(lignes);
    const a = rendu(<Sparkline valeurs={lignes[0].series} max={max} label="Groupe A" />);
    const b = rendu(<Sparkline valeurs={lignes[1].series} max={max} label="Groupe B" />);
    expect(premierPoint(a)).toEqual(premierPoint(b));
    // Et sans échelle commune, elles ne l'auraient pas eue : c'est bien elle qui agit.
    const seul = rendu(<Sparkline valeurs={lignes[0].series} label="Groupe A" />);
    expect(premierPoint(seul)).not.toEqual(premierPoint(a));
  });
});

describe("noteEchelle — le maximum est DIT", () => {
  it("nomme le haut de l'échelle et la largeur du seau", () => {
    expect(noteEchelle(1240, "1 h").replace(/[\u00a0\u202f]/g, " ")).toBe(
      "Tendances à l'échelle commune, de 0 à 1 240 occurrence(s) par seau de 1 h : deux lignes à la même valeur ont la même hauteur.",
    );
  });

  it("sans maximum, elle dit l'absence — jamais une tendance nulle", () => {
    expect(noteEchelle(undefined)).toContain("aucune occurrence sur la période");
    expect(noteEchelle(undefined)).not.toContain("de 0 à 0");
  });
});

describe("CelluleGroupe", () => {
  it("le libellé n'apparaît qu'en carte (sm:hidden), et la cellule redevient une cellule au-dessus", () => {
    const html = rendu(
      <CelluleGroupe libelle="Occurrences" testId="group-occurrences">
        <span>77</span>
      </CelluleGroupe>,
    );
    expect(html).toContain('data-testid="group-occurrences"');
    expect(html).toContain("sm:hidden");
    expect(html).toContain("sm:table-cell");
    expect(texte(html)).toBe("Occurrences 77");
  });
});

describe("FiltreStatut", () => {
  const caches: [string, string][] = [
    ["app", "boutique"],
    ["period", "24h"],
  ];

  it("formulaire GET : les filtres de population suivent, l'offset non", () => {
    const html = rendu(<FiltreStatut caches={caches} statut={null} hrefSansFiltre="/errors?app=boutique" />);
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/errors"');
    expect(html).toContain('name="app" value="boutique"');
    expect(html).toContain('name="period" value="24h"');
    expect(html).not.toContain('name="offset"');
  });

  it("quatre statuts et « Tous les statuts », choisi par défaut ; aucun lien de retour à afficher", () => {
    const html = rendu(<FiltreStatut caches={caches} statut={null} hrefSansFiltre="/errors?app=boutique" />);
    for (const libelle of ["Tous les statuts", "Ouverts", "Régressés", "Résolus", "Ignorés"]) {
      expect(texte(html)).toContain(libelle);
    }
    expect(html).toContain('value="" selected');
    expect(html).not.toContain("<a");
  });

  it("statut posé : l'option est sélectionnée et un lien revient à tous les statuts", () => {
    const html = rendu(<FiltreStatut caches={caches} statut="regressed" hrefSansFiltre="/errors?app=boutique" />);
    expect(html).toContain('value="regressed" selected');
    expect(html).toContain('href="/errors?app=boutique"');
  });
});
