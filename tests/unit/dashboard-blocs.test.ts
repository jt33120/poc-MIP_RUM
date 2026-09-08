// Composition du tableau de bord : lecture et écriture du choix de blocs.
// Le choix est lu CÔTÉ SERVEUR pour que les requêtes d'un bloc éteint ne
// partent pas — une erreur ici ne masque donc pas un bloc, elle en supprime la
// donnée ou en relance le coût.
import { describe, expect, it } from "vitest";
import { BLOCS, INDISPONIBLES, lireChoix, serialiserChoix } from "../../apps/console/lib/dashboard-blocs";

describe("lireChoix", () => {
  it("sans cookie, applique les défauts du catalogue", () => {
    const c = lireChoix(undefined);
    for (const b of BLOCS) expect(c[b.id]).toBe(b.defaut);
  });

  it("respecte un choix explicite, dans les deux sens", () => {
    const c = lireChoix("vitals:0,reseau:1");
    expect(c.vitals).toBe(false); // allumé par défaut, éteint par l'utilisateur
    expect(c.reseau).toBe(true); // éteint par défaut, allumé par l'utilisateur
  });

  // Le point qui compte à la prochaine évolution : un bloc AJOUTÉ après coup
  // doit apparaître chez ceux qui ont déjà un cookie, pas rester invisible
  // pour eux seuls.
  it("un bloc absent du cookie retombe sur son défaut", () => {
    const c = lireChoix("vitals:0");
    expect(c.sante).toBe(true);
    expect(c.reseau).toBe(false);
  });

  it("ignore ce qui n'est pas exploitable plutôt que de tout perdre", () => {
    const c = lireChoix("inconnu:1,vitals:oui,,sante:0,bruit");
    expect(c.sante).toBe(false); // la paire valide au milieu est prise
    expect(c.vitals).toBe(true); // valeur illisible -> défaut, pas false
    expect(Object.keys(c).sort()).toEqual(BLOCS.map((b) => b.id).sort());
  });
});

describe("serialiserChoix", () => {
  // Une liste des seuls blocs actifs ne permettrait pas de distinguer « éteint
  // par l'utilisateur » de « éteint par défaut » : l'état écrit est complet.
  it("écrit l'état de TOUS les blocs, pas seulement les actifs", () => {
    const tout = Object.fromEntries(BLOCS.map((b) => [b.id, false])) as Record<string, boolean>;
    const s = serialiserChoix(tout as never);
    for (const b of BLOCS) expect(s).toContain(`${b.id}:0`);
  });

  it("fait un aller-retour fidèle", () => {
    const choix = Object.fromEntries(
      BLOCS.map((b, i) => [b.id, i % 2 === 0]),
    ) as Record<string, boolean>;
    expect(lireChoix(serialiserChoix(choix as never))).toEqual(choix);
  });
});

describe("catalogue", () => {
  it("n'a pas d'identifiant en double", () => {
    expect(new Set(BLOCS.map((b) => b.id)).size).toBe(BLOCS.length);
  });

  // Une liste d'indisponibles sans motif se lit comme une promesse ; deux de ces
  // trois lignes ne seront jamais tenables et doivent le dire.
  it("motive chaque mesure non couverte", () => {
    expect(INDISPONIBLES.length).toBeGreaterThan(0);
    for (const m of INDISPONIBLES) expect(m.raison.length).toBeGreaterThan(40);
  });
});
