// Composition des tableaux de bord : lecture et écriture du choix de blocs.
// Le choix est lu CÔTÉ SERVEUR pour que les requêtes d'un bloc éteint ne
// partent pas — une erreur ici ne masque donc pas un bloc, elle en supprime la
// donnée ou en relance le coût.
import { describe, expect, it } from "vitest";
import {
  CATALOGUES,
  catalogueDe,
  lireChoix,
  serialiserChoix,
} from "../../apps/console/lib/dashboard-blocs";
import { CATEGORIES } from "../../apps/console/components/nav-items";

const APERCU = catalogueDe("/")!;

describe("lireChoix", () => {
  it("sans cookie, applique les défauts du catalogue", () => {
    for (const cat of CATALOGUES) {
      const c = lireChoix(cat, undefined);
      for (const b of cat.blocs) expect(c[b.id]).toBe(b.defaut);
    }
  });

  it("respecte un choix explicite, dans les deux sens", () => {
    const c = lireChoix(APERCU, "vitals:0,reseau:1");
    expect(c.vitals).toBe(false); // allumé par défaut, éteint par l'utilisateur
    expect(c.reseau).toBe(true); // éteint par défaut, allumé par l'utilisateur
  });

  // Le point qui compte à la prochaine évolution : un bloc AJOUTÉ après coup
  // doit apparaître chez ceux qui ont déjà un cookie, pas rester invisible
  // pour eux seuls.
  it("un bloc absent du cookie retombe sur son défaut", () => {
    const c = lireChoix(APERCU, "vitals:0");
    expect(c.sante).toBe(true);
    expect(c.reseau).toBe(false);
  });

  it("ignore ce qui n'est pas exploitable plutôt que de tout perdre", () => {
    const c = lireChoix(APERCU, "inconnu:1,vitals:oui,,sante:0,bruit");
    expect(c.sante).toBe(false); // la paire valide au milieu est prise
    expect(c.vitals).toBe(true); // valeur illisible -> défaut, pas false
    expect(Object.keys(c).sort()).toEqual(APERCU.blocs.map((b) => b.id).sort());
  });

  // Les cookies sont distincts, mais rien n'empêcherait un identifiant partagé
  // de traverser : un catalogue ne lit QUE ses propres blocs.
  it("n'accepte pas un identifiant venu d'un autre catalogue", () => {
    const sessions = catalogueDe("/sessions")!;
    const c = lireChoix(sessions, "vitals:0,liste:0");
    expect(c.liste).toBe(false);
    expect("vitals" in c).toBe(false);
  });
});

describe("serialiserChoix", () => {
  // Une liste des seuls blocs actifs ne permettrait pas de distinguer « éteint
  // par l'utilisateur » de « éteint par défaut » : l'état écrit est complet.
  it("écrit l'état de TOUS les blocs, pas seulement les actifs", () => {
    for (const cat of CATALOGUES) {
      const tout = Object.fromEntries(cat.blocs.map((b) => [b.id, false]));
      const s = serialiserChoix(cat, tout);
      for (const b of cat.blocs) expect(s).toContain(`${b.id}:0`);
    }
  });

  it("fait un aller-retour fidèle", () => {
    for (const cat of CATALOGUES) {
      const choix = Object.fromEntries(cat.blocs.map((b, i) => [b.id, i % 2 === 0]));
      expect(lireChoix(cat, serialiserChoix(cat, choix))).toEqual(choix);
    }
  });
});

describe("catalogues", () => {
  it("n'a pas d'identifiant en double dans un même catalogue", () => {
    for (const cat of CATALOGUES) {
      expect(new Set(cat.blocs.map((b) => b.id)).size).toBe(cat.blocs.length);
    }
  });

  // Deux catalogues qui partageraient un cookie s'écraseraient l'un l'autre :
  // régler les sessions éteindrait des blocs de la vue d'ensemble.
  it("donne un cookie distinct à chaque catalogue", () => {
    const cookies = CATALOGUES.map((c) => c.cookie);
    expect(new Set(cookies).size).toBe(cookies.length);
  });

  // La roue est montée à côté d'une entrée de la sidebar : un catalogue dont le
  // href ne correspond à aucune catégorie ne serait jamais atteignable.
  it("s'accroche à une catégorie de navigation ouverte", () => {
    for (const cat of CATALOGUES) {
      const nav = CATEGORIES.find((c) => c.href === cat.href);
      expect(nav, `aucune catégorie pour ${cat.href}`).toBeDefined();
      expect(nav!.verrouille ?? false).toBe(false);
    }
  });

  it("garde au moins un bloc allumé par défaut", () => {
    for (const cat of CATALOGUES) {
      expect(cat.blocs.some((b) => b.defaut)).toBe(true);
    }
  });

  // Une liste d'indisponibles sans motif se lit comme une feuille de route ;
  // plusieurs de ces lignes ne seront jamais tenables et doivent le dire.
  it("motive chaque mesure non couverte", () => {
    for (const cat of CATALOGUES) {
      expect(cat.indisponibles.length).toBeGreaterThan(0);
      for (const m of cat.indisponibles) expect(m.raison.length).toBeGreaterThan(40);
    }
  });
});
