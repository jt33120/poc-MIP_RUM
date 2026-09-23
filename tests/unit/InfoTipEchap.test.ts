// Échap et la bulle d'`InfoTip` (F69, WCAG 1.4.13 ; revue de fin de vague 8).
//
// La bulle s'ouvre au survol ET au focus. Une bulle fermée par Échap ne se rouvre
// qu'au passage suivant : quand le groupe n'est plus NI survolé NI focalisé. Le
// défaut vu en revue : le pointeur qui sortait réarmait seul, et
// `group-focus-within` rouvrait sans geste une bulle dont l'icône gardait le focus.
//
// Pas de DOM dans l'outillage de tests (ni jsdom ni happy-dom) : le groupe et le
// document sont des doubles bâtis sur l'`EventTarget` de Node, et les événements
// portent seulement ce que l'îlot lit (`key`, `relatedTarget`).
import { afterEach, describe, expect, it } from "vitest";
import { brancherEchap } from "@/components/InfoTipEchap";

class GroupeDouble extends EventTarget {
  readonly attributs = new Map<string, string>();
  readonly enfants = new Set<object>();
  survole = false;
  contains(n: unknown): boolean {
    return n === this || (typeof n === "object" && n !== null && this.enfants.has(n));
  }
  matches(selecteur: string): boolean {
    return selecteur === ":hover" && this.survole;
  }
  setAttribute(nom: string, valeur: string) {
    this.attributs.set(nom, valeur);
  }
  removeAttribute(nom: string) {
    this.attributs.delete(nom);
  }
  get ferme() {
    return this.attributs.has("data-ferme");
  }
}

class DocumentDouble extends EventTarget {
  activeElement: object | null = null;
}

const icone = { nom: "bouton de l'icône" };
const ailleurs = { nom: "lien hors du groupe" };

function monter() {
  const groupe = new GroupeDouble();
  groupe.enfants.add(icone);
  const doc = new DocumentDouble();
  const debrancher = brancherEchap(groupe as unknown as HTMLElement, doc as unknown as Document);
  debranchements.push(debrancher);
  const echap = () => doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  const focaliser = () => {
    doc.activeElement = icone;
  };
  /** Le focus quitte l'icône pour `vers` (dans ou hors du groupe). */
  const focusVers = (vers: object | null) => {
    doc.activeElement = null; // pendant `focusout`, le focus est déjà parti de l'icône
    groupe.dispatchEvent(Object.assign(new Event("focusout"), { relatedTarget: vers }));
    doc.activeElement = vers;
  };
  const pointeurSort = () => {
    groupe.survole = false;
    groupe.dispatchEvent(new Event("mouseleave"));
  };
  return { groupe, doc, debrancher, echap, focaliser, focusVers, pointeurSort };
}

const debranchements: (() => void)[] = [];
afterEach(() => {
  while (debranchements.length) debranchements.pop()!();
});

describe("InfoTipEchap — Échap, puis le passage suivant", () => {
  it("scénario de la revue : focus + survol, Échap ; le pointeur sort, le focus reste → la bulle RESTE fermée", () => {
    const b = monter();
    b.focaliser();
    b.groupe.survole = true;
    b.echap();
    expect(b.groupe.ferme).toBe(true);
    b.pointeurSort();
    // Avant la correction, `data-ferme` tombait ici et `group-focus-within` rouvrait la bulle.
    expect(b.groupe.ferme).toBe(true);
    // Le focus part à son tour : plus rien ne tient la bulle, elle est réarmée.
    b.focusVers(ailleurs);
    expect(b.groupe.ferme).toBe(false);
  });

  it("le focus sort sous le pointeur : la bulle reste fermée jusqu'à ce que le pointeur sorte", () => {
    const b = monter();
    b.focaliser();
    b.groupe.survole = true;
    b.echap();
    b.focusVers(ailleurs);
    expect(b.groupe.ferme).toBe(true);
    b.pointeurSort();
    expect(b.groupe.ferme).toBe(false);
  });

  it("clavier seul (F69) : Échap ferme, le focus s'en va puis revient → la bulle se rouvre", () => {
    const b = monter();
    b.focaliser();
    b.echap();
    expect(b.groupe.ferme).toBe(true);
    b.focusVers(ailleurs);
    expect(b.groupe.ferme).toBe(false);
  });

  it("survol seul : Échap ferme, le pointeur sort → réarmée", () => {
    const b = monter();
    b.groupe.survole = true;
    b.echap();
    expect(b.groupe.ferme).toBe(true);
    b.pointeurSort();
    expect(b.groupe.ferme).toBe(false);
  });

  it("un passage de focus INTERNE au groupe ne réarme pas", () => {
    const b = monter();
    const autreDuGroupe = { nom: "second élément du groupe" };
    b.groupe.enfants.add(autreDuGroupe);
    b.focaliser();
    b.echap();
    b.focusVers(autreDuGroupe);
    expect(b.groupe.ferme).toBe(true);
  });

  it("Échap ailleurs (ni focus ni pointeur sur le groupe) ne ferme rien ; une autre touche non plus", () => {
    const b = monter();
    b.echap();
    expect(b.groupe.ferme).toBe(false);
    b.focaliser();
    b.doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Enter" }));
    expect(b.groupe.ferme).toBe(false);
  });

  it("débranché : Échap ne pose plus rien, et la sortie ne retire plus rien", () => {
    const b = monter();
    b.focaliser();
    b.echap();
    b.debrancher();
    b.focusVers(ailleurs);
    expect(b.groupe.ferme).toBe(true);
    b.groupe.removeAttribute("data-ferme");
    b.focaliser();
    b.echap();
    expect(b.groupe.ferme).toBe(false);
  });
});
