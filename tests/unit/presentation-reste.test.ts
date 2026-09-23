// P**.5 — « Ce qui reste pour un vrai outil de RUM » : les neuf points de la vitrine
// (apps/console/lib/presentation-reste.ts) disent ce que dit le relevé, ni moins ni plus.
//
// Que chaque source EXISTE est le contrôle n° 4 de couverture-site.test.ts. Ici, ce
// que ce contrôle ne peut pas voir : que les textes réécrits au relevé du 23/09/2026
// suivent leurs lignes. Chaque test pose d'abord le FAIT tel que le document l'écrit,
// puis le texte : si un nouveau relevé change le fait, le test rougit sur le fait, et
// quelqu'un relit le point au lieu de laisser la vitrine répéter l'ancien état.
import { describe, expect, it } from "vitest";
import { capaciteParId, type Capacite } from "@/lib/couverture";
import { POINTS_RESTE, lignesCitees } from "@/lib/presentation-reste";

function point(id: string) {
  const trouve = POINTS_RESTE.find((p) => p.id === id);
  if (!trouve) throw new Error(`point absent : ${id}`);
  return trouve;
}

/** Tout ce que la carte d'un point affiche, d'un seul tenant. */
function affiche(id: string): string {
  const p = point(id);
  return [p.titre, p.manque, p.debloque, p.decide].join(" ");
}

function ligne(id: string): Capacite {
  const c = capaciteParId(id);
  if (!c) throw new Error(`ligne absente du document : ${id}`);
  return c;
}

describe("les neuf points, dans l'ordre fixe du plan", () => {
  it("titres exacts, R1 à R9", () => {
    expect(POINTS_RESTE.map((p) => [p.id, p.titre])).toEqual([
      ["R1", "Une recette sur une vraie application"],
      ["R2", "P8.3 — Reprise de l'historique"],
      ["R3", "P8.4 — Source maps dans l'intégration continue du client"],
      ["R4", "P8.5 — Crashes natifs iOS et Android"],
      ["R5", "React Native : une matrice de compatibilité vide"],
      ["R6", "Le pays par adresse IP, inerte tant que la collecte passe par Vercel"],
      ["R7", "Tickets : le connecteur existe, la cible ITSM n'est pas confirmée"],
      ["R8", "Souveraineté et mise en service chez un client"],
      ["R9", "Une chaîne de livraison qui dit vrai"],
    ]);
  });

  it("chaque point dit ce qui manque, ce qui le débloque et qui décide", () => {
    for (const p of POINTS_RESTE) {
      for (const champ of [p.manque, p.debloque, p.decide]) expect(champ.trim(), p.id).not.toBe("");
    }
  });

  it("R1 et R2 disent que leurs chiffres n'ont pas été recontrôlés, comme le document (:303-304, D9)", () => {
    expect(ligne("D9").limite).toContain("n'ont pas été recontrôlés");
    expect(point("R1").manque).toContain("(non recontrôlé)");
    expect(point("R2").manque).toContain("(chiffre non recontrôlé)");
  });
});

describe("relevé du 23/09/2026 : les points réécrits suivent leurs lignes", () => {
  it("R2 suit D8 — v83 est appliquée, et c'est une déduction, pas une lecture de la base", () => {
    const d8 = ligne("D8");
    expect(d8.verdict).toBe("livre_non_deploye");
    expect(d8.preuve).toContain("v83 appliquée en production");
    expect(d8.preuve).toContain("déduit des journaux du runner, pas lu en base");
    expect(d8.limite).toContain("Aucun environnement ne lance l'outil");

    const r2 = point("R2");
    expect(r2.manque).toContain("sa migration v83 est appliquée en production : c'est déduit des journaux de déploiement, pas lu en base");
    expect(r2.manque).toContain("Aucun environnement ne lance l'outil");
    // Ni l'ancien état, ni une certitude que le document n'a pas.
    expect(affiche("R2")).not.toMatch(/non appliquée|n'est pas appliquée|appliquer la migration|vérifiée? en base/i);
    // Ce qu'une reprise demanderait désormais (§ 12.2) : rien côté schéma, lancer l'outil.
    expect(r2.debloque).toContain("plus rien n'est à faire côté schéma");
  });

  it("R9 suit F1 à F3 et D7 — la CI type la console, les SDK et l'agent Node, pas l'extension", () => {
    expect(ligne("F1")).toMatchObject({ verdict: "livre_avec_defaut_connu" });
    expect(ligne("F1").limite).toContain("échoue sur un dépôt fraîchement installé");
    expect(ligne("F2").verdict).toBe("deploye_non_eprouve");
    expect(ligne("F2").preuve).toContain("`@mip/rum-core`, `@mip/rum-sdk`, `@mip/rum-mobile` et `@mip/agent-node`");
    expect(ligne("F2").limite).toContain("L'extension navigateur (`apps/extension`, en TypeScript) n'est **pas** typée par la CI");
    expect(ligne("F3")).toMatchObject({ verdict: "livre_avec_defaut_connu" });
    expect(ligne("F3").limite).toContain("les deux bancs de mesure ne tournent jamais en CI");
    expect(ligne("F3").limite).toContain("est jouée par la CI depuis #213, et passe");
    expect(ligne("D7").verdict).toBe("non_commence");

    const r9 = point("R9");
    expect(r9.manque).toContain("La construction échoue sur un dépôt fraîchement installé");
    expect(r9.manque).toContain("la CI vérifie les types de la console, des SDK et de l'agent Node, mais pas ceux de l'extension navigateur");
    expect(r9.manque).toContain("les deux bancs de mesure ne tournent jamais en CI");
    expect(r9.manque).toContain("n'est ni écrite, ni éprouvée");
    // Les deux phrases du plan que le relevé a rendues fausses.
    expect(affiche("R9")).not.toMatch(/ne vérifie pas les types|rouge/i);
  });

  it("R6 suit D14 — c'est la résolution par base IP→pays qui ne donne rien, pas le pays estimé", () => {
    expect(ligne("D14").limite).toContain("Le GeoIP ne résout aucun pays sur le trafic actuel");
    expect(point("R6").manque).toContain("Cette résolution ne donne donc aucun pays aujourd'hui.");
    expect(point("R6").manque).not.toContain("Aucun pays n'est résolu");
  });
});

describe("les pastilles d'un point : les lignes du document qu'il cite", () => {
  it("dans l'ordre des sources ; une source « chemin:ligne » n'en est pas une", () => {
    const ids = (id: string) => lignesCitees(point(id)).map((c) => c.id);
    expect(ids("R5")).toEqual(["C1", "C2", "C3", "C4", "C9", "C10"]);
    expect(ids("R6")).toEqual(["D14"]);
    expect(ids("R9")).toEqual(["F1", "F2", "F3", "D7"]);
    // R1 ne cite que des passages du document, R8 que des fichiers du dépôt.
    expect(ids("R1")).toEqual([]);
    expect(ids("R8")).toEqual([]);
  });

  it("un identifiant inconnu du document ne devient pas une pastille", () => {
    const faux = { ...point("R3"), sources: ["Z9", "D10", "docs/CONFORMITE.md:1"] };
    expect(lignesCitees(faux).map((c) => c.id)).toEqual(["D10"]);
  });

  it("D12 et D14, déployées mais inertes, sont des pastilles de « Ce qui reste » (règle 3 du § 8.0)", () => {
    for (const [id, porteur] of [["D12", "R7"], ["D14", "R6"]] as const) {
      expect(ligne(id).verdict, id).toBe("deploye_non_eprouve");
      expect(lignesCitees(point(porteur)).map((c) => c.id), id).toContain(id);
    }
  });
});
