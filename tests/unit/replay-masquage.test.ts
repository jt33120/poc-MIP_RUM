// Le masquage du rejeu de session.
//
// CE QUI ÉTAIT ENREGISTRÉ EN CLAIR. Le rejeu masquait les saisies et excluait
// les blocs marqués par l'application. Tout le reste partait tel quel : le texte
// affiché — un nom sur une fiche client, un montant, un numéro de dossier — et
// les médias, dont l'URL d'un justificatif. Un formulaire VIDE était protégé ;
// la même donnée, une fois AFFICHÉE, ne l'était plus. C'est l'inverse du risque
// réel.
//
// Ce fichier garde trois choses : que le plancher (saisies + blocs marqués) ne
// puisse être désactivé par AUCUN niveau ni par le démasquage, que le défaut
// soit le niveau le plus protecteur — un masquage qu'il faut penser à activer
// n'en est pas un —, et que le démasquage (`mip-rum-unmask`, `replayUnmask`)
// échoue toujours du côté du masque.
//
// Pas de DOM ici : jsdom n'est pas une dépendance du dépôt. La logique se teste
// avec des éléments simulés ; le rendu réel par rrweb — texte en clair dans la
// zone, voisine en « * », saisie masquée, image démasquée — est vérifié dans un
// vrai Chromium par tests/e2e/rejeu-demasquage.spec.ts.
import { describe, expect, it, vi } from "vitest";
import { CATALOGUES } from "../../apps/console/lib/dashboard-blocs";
import { MESURES } from "../../apps/console/lib/specs";
import {
  CLASSE_BLOC,
  CLASSE_DEMASQUE,
  SELECTEUR_MEDIAS,
  SELECTEUR_TOUJOURS_MASQUE,
  estDemasque,
  masquerTexteHors,
  optionsMasquage,
  resoudreDemasquage,
  selecteurMediasBloques,
  selecteurValide,
  type Demasquage,
  type NiveauMasquage,
} from "../../packages/rum-sdk/src/replay";

const NIVEAUX: NiveauMasquage[] = ["all", "media", "inputs"];
const ZONE = `.${CLASSE_DEMASQUE}`;
/** Ce que rend `resoudreDemasquage` sans option, dans un navigateur de 2021 et après. */
const CLASSE_SEULE: Demasquage = { selecteur: ZONE, medias: true };

describe("le plancher — ce qu'aucun niveau ne peut désactiver", () => {
  it("les saisies sont masquées dans les trois niveaux", () => {
    for (const n of NIVEAUX) expect(optionsMasquage(n).maskAllInputs, n).toBe(true);
  });

  it("un bloc marqué par l'application n'est jamais capturé", () => {
    for (const n of NIVEAUX) expect(optionsMasquage(n).blockClass, n).toBe(CLASSE_BLOC);
  });

  it("le démasquage ne touche ni aux saisies ni aux blocs marqués", () => {
    const tout: Demasquage = { selecteur: `${ZONE},*`, medias: true };
    for (const n of NIVEAUX) {
      expect(optionsMasquage(n, tout).maskAllInputs, n).toBe(true);
      expect(optionsMasquage(n, tout).blockClass, n).toBe(CLASSE_BLOC);
    }
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

// ─────────────────────────── Démasquage sélectif ────────────────────────────

describe("la classe de démasquage", () => {
  // Même raison que pour `mip-rum-block` : le nom vit dans le HTML des clients.
  it("garde son nom public", () => {
    expect(CLASSE_DEMASQUE).toBe("mip-rum-unmask");
  });
});

describe("resoudreDemasquage — l'option replayUnmask", () => {
  const toutValide = () => true;

  it("sans option : la classe réservée seule, sans avertissement", () => {
    const avertir = vi.fn();
    expect(resoudreDemasquage(undefined, toutValide, avertir)).toEqual(CLASSE_SEULE);
    expect(resoudreDemasquage("  ", toutValide, avertir)).toEqual(CLASSE_SEULE);
    expect(avertir).not.toHaveBeenCalled();
  });

  it("un sélecteur valide s'AJOUTE à la classe réservée, il ne la remplace pas", () => {
    const d = resoudreDemasquage(" #commandes, [data-clair] ", toutValide, vi.fn());
    expect(d.selecteur).toBe(`${ZONE},#commandes, [data-clair]`);
  });

  it("un sélecteur invalide est ignoré, avec un avertissement en console", () => {
    const avertir = vi.fn();
    const refuse = (s: string) => !s.includes("[[");
    expect(resoudreDemasquage("td[[", refuse, avertir)).toEqual(CLASSE_SEULE);
    expect(avertir).toHaveBeenCalledTimes(1);
    expect(avertir.mock.calls[0][0]).toMatch(/^\[mip-rum\] replayUnmask ignoré : "td\[\["/);
  });

  it("une valeur qui n'est pas une chaîne est ignorée de même", () => {
    const avertir = vi.fn();
    expect(resoudreDemasquage(["#a"], toutValide, avertir).selecteur).toBe(ZONE);
    expect(resoudreDemasquage(42, toutValide, avertir).selecteur).toBe(ZONE);
    expect(avertir).toHaveBeenCalledTimes(2);
  });

  // Chrome 80 à 87 ont CompressionStream (le rejeu tourne) mais pas `:is()`.
  it("navigateur sans :is() : le texte se démasque, les médias restent bloqués", () => {
    const sansIs = (s: string) => !s.includes(":is(");
    const d = resoudreDemasquage(undefined, sansIs, vi.fn());
    expect(d).toEqual({ selecteur: ZONE, medias: false });
    const o = optionsMasquage("all", d);
    expect(o.blockSelector).toBe(SELECTEUR_MEDIAS);
    expect(o.maskTextFn).toBeTypeOf("function");
  });

  it("hors navigateur, aucun sélecteur n'est valide : rien n'est démasqué", () => {
    expect(selecteurValide(ZONE)).toBe(false); // pas de `document` sous Node
    const avertir = vi.fn();
    expect(resoudreDemasquage("#commandes", undefined, avertir)).toEqual({ selecteur: ZONE, medias: false });
    expect(avertir).toHaveBeenCalledTimes(1);
  });
});

describe("optionsMasquage avec démasquage", () => {
  it("« all » : texte masqué élément par élément, médias bloqués hors zone", () => {
    const o = optionsMasquage("all", CLASSE_SEULE);
    expect(o.maskTextSelector).toBe("*");
    expect(o.maskTextFn).toBeTypeOf("function");
    expect(o.blockSelector).toBe(selecteurMediasBloques(ZONE));
  });

  it("« media » : le texte est déjà en clair, seuls les médias se démasquent", () => {
    const o = optionsMasquage("media", CLASSE_SEULE);
    expect(o.maskTextSelector).toBeUndefined();
    expect(o.maskTextFn).toBeUndefined();
    expect(o.blockSelector).toBe(selecteurMediasBloques(ZONE));
  });

  it("« inputs » : rien à démasquer, l'option est sans effet", () => {
    expect(optionsMasquage("inputs", CLASSE_SEULE)).toEqual(optionsMasquage("inputs"));
  });

  it("sans démasquage résolu, le masquage reste entier", () => {
    const o = optionsMasquage("all");
    expect(o.maskTextFn).toBeUndefined();
    expect(o.blockSelector).toBe(SELECTEUR_MEDIAS);
  });
});

describe("selecteurMediasBloques", () => {
  it("garde TOUS les médias du masquage par défaut", () => {
    expect(selecteurMediasBloques(ZONE).startsWith(`:is(${SELECTEUR_MEDIAS}):not(`)).toBe(true);
  });

  // `.a, .b *` voudrait dire « .a, ou dans .b » : la zone .a démasquerait ses
  // propres médias, pas ceux de ses descendants.
  it("exclut la zone ET ses descendants, même pour une liste de sélecteurs", () => {
    expect(selecteurMediasBloques(".a, .b")).toBe(`:is(${SELECTEUR_MEDIAS}):not(:is(.a, .b),:is(.a, .b) *)`);
  });
});

/**
 * Un élément simulé : `closest(s)` trouve un ancêtre pour les sélecteurs listés.
 * Il suffit à tester la DÉCISION ; la correspondance CSS elle-même est celle du
 * navigateur, éprouvée par l'E2E.
 */
const element = (...ancetres: string[]) =>
  ({ closest: (s: string) => (ancetres.includes(s) ? {} : null) }) as unknown as HTMLElement;

describe("masquerTexteHors — le maskTextFn passé à rrweb", () => {
  const masque = masquerTexteHors(ZONE);

  it("en clair dans une zone démasquée", () => {
    expect(masque("Jeanne Martin", element(ZONE))).toBe("Jeanne Martin");
  });

  it("hors zone : le masquage de rrweb à l'identique, blancs compris", () => {
    expect(masque("Jeanne Martin", element())).toBe("****** ******");
    expect(masque(" 12 345,67 €\n", element())).toBe(" ** ****** *\n");
  });

  it("sans élément parent : masqué", () => {
    expect(masque("Jeanne Martin", null)).toBe("****** ******");
  });

  it("une saisie ou un bloc marqué DANS la zone reste masqué", () => {
    expect(masque("brouillon", element(ZONE, SELECTEUR_TOUJOURS_MASQUE))).toBe("*********");
  });

  it("un closest() qui lève vaut « masqué »", () => {
    const casse = { closest: () => { throw new Error("SyntaxError"); } } as unknown as HTMLElement;
    expect(masque("Jeanne Martin", casse)).toBe("****** ******");
  });
});

describe("ce qui reste masqué dans une zone démasquée", () => {
  const cibles = SELECTEUR_TOUJOURS_MASQUE.split(",");

  it("le bloc marqué, et le texte qu'un visiteur peut taper hors d'un <input>", () => {
    for (const c of [`.${CLASSE_BLOC}`, "textarea", "select", "[contenteditable]:not([contenteditable=false])"])
      expect(cibles, c).toContain(c);
  });

  it("estDemasque exige la zone ET l'absence de saisie ou de bloc", () => {
    expect(estDemasque(element(ZONE), ZONE)).toBe(true);
    expect(estDemasque(element(), ZONE)).toBe(false);
    expect(estDemasque(element(SELECTEUR_TOUJOURS_MASQUE), ZONE)).toBe(false);
    expect(estDemasque(element(ZONE, SELECTEUR_TOUJOURS_MASQUE), ZONE)).toBe(false);
  });
});

// L'écran ne doit pas dire le contraire du SDK : la ligne « Démasquage sélectif
// au rejeu » de la liste des indisponibles a été retirée le jour où il a existé.
describe("ce que la console en dit", () => {
  it("le démasquage n'est plus déclaré indisponible", () => {
    const labels = CATALOGUES.flatMap((c) => c.indisponibles.map((i) => i.label));
    expect(labels.filter((l) => /démasquage/i.test(l))).toEqual([]);
  });

  it("la mesure « Rejeu de session » nomme la classe et l'option", () => {
    const rejeu = MESURES.find((m) => m.quoi === "Rejeu de session");
    expect(rejeu?.detail).toContain(CLASSE_DEMASQUE);
    expect(rejeu?.detail).toContain("replayUnmask");
  });
});
