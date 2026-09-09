// Le masquage du rejeu de session.
//
// CE QUI ÉTAIT ENREGISTRÉ EN CLAIR. Le rejeu masquait les saisies et excluait
// les blocs marqués par l'application. Tout le reste partait tel quel : le texte
// affiché — un nom sur une fiche client, un montant, un numéro de dossier — et
// les médias, dont l'URL d'un justificatif. Un formulaire VIDE était protégé ;
// la même donnée, une fois AFFICHÉE, ne l'était plus. C'est l'inverse du risque
// réel.
//
// Ce fichier garde deux choses : que le plancher (saisies + blocs marqués) ne
// puisse être désactivé par AUCUN niveau, et que le défaut soit le niveau le
// plus protecteur — un masquage qu'il faut penser à activer n'en est pas un.
import { describe, expect, it } from "vitest";
import {
  CLASSE_BLOC,
  SELECTEUR_MEDIAS,
  optionsMasquage,
  type NiveauMasquage,
} from "../../packages/rum-sdk/src/replay";

const NIVEAUX: NiveauMasquage[] = ["all", "media", "inputs"];

describe("le plancher — ce qu'aucun niveau ne peut désactiver", () => {
  it("les saisies sont masquées dans les trois niveaux", () => {
    for (const n of NIVEAUX) expect(optionsMasquage(n).maskAllInputs, n).toBe(true);
  });

  it("un bloc marqué par l'application n'est jamais capturé", () => {
    for (const n of NIVEAUX) expect(optionsMasquage(n).blockClass, n).toBe(CLASSE_BLOC);
  });

  // Le nom de la classe est une INTERFACE : il vit dans le HTML des clients.
  // Le renommer casserait silencieusement leur exclusion — l'attribut resterait
  // en place et ne bloquerait plus rien.
  it("la classe d'exclusion garde son nom public", () => {
    expect(CLASSE_BLOC).toBe("mip-rum-block");
  });
});

describe("le défaut est le niveau le plus protecteur", () => {
  it("sans configuration, tout est masqué", () => {
    expect(optionsMasquage()).toEqual(optionsMasquage("all"));
  });

  it("une valeur absente (undefined) retombe sur « all », pas sur « rien »", () => {
    expect(optionsMasquage(undefined)).toEqual(optionsMasquage("all"));
  });

  it("« all » masque le texte ET les médias", () => {
    const o = optionsMasquage("all");
    expect(o.maskTextSelector).toBe("*"); // tout élément, donc tout nœud de texte
    expect(o.blockSelector).toBe(SELECTEUR_MEDIAS);
  });
});

describe("les niveaux intermédiaires disent exactement ce qu'ils disent", () => {
  it("« media » laisse le texte lisible et bloque les médias", () => {
    const o = optionsMasquage("media");
    expect(o.maskTextSelector).toBeUndefined();
    expect(o.blockSelector).toBe(SELECTEUR_MEDIAS);
  });

  it("« inputs » est l'ancien comportement, et rien de plus", () => {
    const o = optionsMasquage("inputs");
    expect(o.maskTextSelector).toBeUndefined();
    expect(o.blockSelector).toBeUndefined();
    expect(o).toEqual({ maskAllInputs: true, blockClass: CLASSE_BLOC });
  });
});

describe("le sélecteur de médias", () => {
  const cibles = SELECTEUR_MEDIAS.split(",");

  it("couvre les porteurs de contenu, y compris canvas et svg", () => {
    // Un graphique SVG porte des chiffres de client aussi sûrement qu'un canvas.
    // Un masquage par défaut qui laisse passer une catégorie entière n'en est pas un.
    for (const t of ["img", "video", "audio", "canvas", "svg", "picture", "object", "embed"])
      expect(cibles, t).toContain(t);
  });

  // rrweb enregistre une iframe de même origine comme un document à part,
  // auquel les mêmes règles s'appliquent. La bloquer perdrait l'enregistrement
  // au lieu de le protéger.
  it("ne bloque pas les iframes — ce serait perdre le rejeu, pas le protéger", () => {
    expect(cibles).not.toContain("iframe");
  });

  it("est un sélecteur CSS valide, sans espace parasite", () => {
    expect(SELECTEUR_MEDIAS).not.toMatch(/\s/);
    for (const t of cibles) expect(t).toMatch(/^[a-z]+$/);
  });
});
