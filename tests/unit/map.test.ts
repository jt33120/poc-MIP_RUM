// Carte d'expérience (Lot B DEM) — logique pure : santé, tendance, mise en page.
import { describe, expect, it } from "vitest";
import {
  CAP_COLONNE,
  REGLE_SANTE_API,
  SEUIL_TENDANCE,
  apiHealth,
  atRisk,
  carteAffichee,
  idAutres,
  layoutGraph,
  pageHealth,
  tendancePct,
  texteRegleSanteApi,
  texteSanteNoeud,
  texteTendance,
  trend,
  type GEdge,
  type GNode,
} from "../../apps/console/lib/map";

describe("apiHealth", () => {
  it("bad si erreur >= 10% ou latence >= 3s", () => {
    expect(apiHealth(0.1, 100)).toBe("bad");
    expect(apiHealth(0, 3000)).toBe("bad");
  });
  it("warn si erreur >= 2% ou latence >= 1s", () => {
    expect(apiHealth(0.03, 100)).toBe("warn");
    expect(apiHealth(0, 1200)).toBe("warn");
  });
  it("good sinon", () => {
    expect(apiHealth(0, 200)).toBe("good");
  });
  // F40 (V3) : une latence inconnue ne vaut pas 0 ms.
  it("latence null -> unknown, sauf si le taux d'erreur suffit seul à conclure « dégradé »", () => {
    expect(apiHealth(0, null)).toBe("unknown");
    expect(apiHealth(0.05, null)).toBe("unknown"); // à surveiller OU dégradé : on ne sait pas
    expect(apiHealth(0.15, null)).toBe("bad"); // la règle est un OU : l'erreur décide
  });
});

describe("pageHealth", () => {
  it("verdict LCP lu dans lib/rating.ts (bornes web.dev, « bon » inclusif)", () => {
    expect(pageHealth(1500)).toBe("good");
    expect(pageHealth(2500)).toBe("good"); // « 2.5 seconds or less »
    expect(pageHealth(3000)).toBe("warn");
    expect(pageHealth(4000)).toBe("warn"); // « mauvais » strict : au-delà de 4,0 s
    expect(pageHealth(5000)).toBe("bad");
  });
  it("aucune mesure -> unknown, jamais « good »", () => {
    expect(pageHealth(null)).toBe("unknown");
  });
});

describe("texteRegleSanteApi (S6 : un seuil propre à l'écran est écrit avec sa source)", () => {
  it("dit les bornes lues dans REGLE_SANTE_API, et l'état inconnu", () => {
    const t = texteRegleSanteApi().replace(/\u00a0/g, " ");
    expect(t).toContain(`${REGLE_SANTE_API.erreurDegrade * 100} %`);
    expect(t).toContain(`${REGLE_SANTE_API.latenceDegradeMs / 1000} s`);
    expect(t).toContain(`${REGLE_SANTE_API.erreurSurveiller * 100} %`);
    expect(t).toContain("inconnu sans latence mesurée");
  });
});

describe("trend", () => {
  it("flat si trop peu de données", () => {
    expect(trend(2, 1)).toBe("flat");
  });
  it("up si volume récent nettement supérieur", () => {
    expect(trend(20, 5)).toBe("up");
  });
  it("down si volume récent nettement inférieur", () => {
    expect(trend(3, 20)).toBe("down");
  });
});

describe("atRisk", () => {
  it("hausse + santé dégradée = à risque", () => {
    expect(atRisk("up", "warn")).toBe(true);
    expect(atRisk("up", "good")).toBe(false);
    expect(atRisk("flat", "bad")).toBe(false);
  });
  it("santé inconnue : pas une dégradation observée, donc pas « à risque »", () => {
    expect(atRisk("up", "unknown")).toBe(false);
  });
});

describe("layoutGraph", () => {
  const mk = (id: string, tier: "front" | "back"): GNode => ({
    id, tier, route: id, calls: 1, health: "good", dir: "flat", risk: false,
  });
  it("place front/back en deux colonnes et empile", () => {
    const front = [mk("front:/a", "front"), mk("front:/b", "front")];
    const back = [mk("back:/x", "back")];
    const l = layoutGraph(front, back, []);
    expect(l.nodes).toHaveLength(3);
    // deux colonnes distinctes
    const xs = new Set(l.nodes.map((n) => n.x));
    expect(xs.size).toBe(2);
    // empilement vertical dans une colonne
    expect(l.nodes[1].y).toBeGreaterThan(l.nodes[0].y);
  });
  it("ne garde que les arêtes dont les 2 extrémités sont visibles", () => {
    const front = [mk("front:/a", "front")];
    const back = [mk("back:/x", "back")];
    const edges: GEdge[] = [
      { from: "front:/a", to: "back:/x", calls: 5 }, // visible
      { from: "front:/a", to: "back:/hidden", calls: 9 }, // extrémité absente
    ];
    const l = layoutGraph(front, back, edges);
    expect(l.edges).toHaveLength(1);
    expect(l.edges[0].to).toBe("back:/x");
    expect(l.edges[0].width).toBeGreaterThan(0);
  });
});

// ─────────────────────── F52 — § 5.10 : ce que la carte AFFICHE ───────────────

describe("F52 — tendancePct / texteTendance (tendance chiffrée)", () => {
  it("variation en % de la moitié récente sur la moitié ancienne", () => {
    expect(tendancePct(20, 10)).toBe(100);
    expect(tendancePct(8, 10)).toBeCloseTo(-20, 12);
    expect(texteTendance(20, 10)).toBe("+100\u00a0%");
    expect(texteTendance(8, 10)).toBe("\u221220\u00a0%");
  });
  it("sous le seuil anti-bruit, aucune tendance n'est chiffrée", () => {
    expect(tendancePct(2, 1)).toBeNull();
    expect(texteTendance(2, 1)).toBeUndefined();
    // Le seuil est le même que celui de `trend` : les deux ne peuvent pas diverger.
    expect(trend(2, 1)).toBe("flat");
    expect(SEUIL_TENDANCE).toBe(5);
  });
  it("sans base ancienne : null, jamais « +∞ % » (une division par zéro n'est pas une mesure)", () => {
    expect(tendancePct(30, 0)).toBeNull();
    expect(texteTendance(30, 0)).toBeUndefined();
  });
});

describe("F52 — texteSanteNoeud (la santé ÉCRITE, § 3.9)", () => {
  it("« 2,4 % err · p75 1,2 s »", () => {
    expect(texteSanteNoeud(0.024, 1200).replace(/\u00a0/g, " ")).toBe("2,4 % err · p75 1,2 s");
  });
  it("une latence non mesurée s'écrit « — », jamais 0 ms (V3)", () => {
    expect(texteSanteNoeud(0, null).replace(/\u00a0/g, " ")).toBe("0,0 % err · p75 —");
  });
});

describe("F52 — carteAffichee : le nœud « Autres routes (N) » REÇOIT les arêtes masquées", () => {
  const noeud = (route: string, tier: "front" | "back", calls: number): GNode => ({
    id: `${tier}:${route}`,
    tier,
    route,
    calls,
    health: "good",
    dir: "flat",
    risk: false,
    href: `/map?panel=noeud:${tier}:${route}`,
  });

  it("au-delà du plafond, la colonne se termine par « Autres routes (N) » au volume cumulé", () => {
    const back = [noeud("/a", "back", 10), noeud("/b", "back", 4), noeud("/c", "back", 3)];
    const carte = carteAffichee([], back, [], 1);
    expect(carte.back.map((n) => n.route)).toEqual(["/a", "Autres routes (2)"]);
    const autres = carte.back[1];
    expect(autres.calls).toBe(7); // 4 + 3 : un compte d'appels est additif
    expect(autres.agrege).toBe(2);
    expect(autres.health).toBe("unknown"); // plusieurs routes : aucune santé commune
    expect(autres.href).toBeNull(); // rien à ouvrir : ce n'est pas une route
    expect(carte.masquees).toEqual({ front: 0, back: 2 });
  });

  it("une arête vers une route masquée arrive sur « Autres », au lieu d'être jetée", () => {
    const front = [noeud("/panier", "front", 20)];
    const back = [noeud("/api/visible", "back", 12), noeud("/api/masquee", "back", 5)];
    const edges: GEdge[] = [
      { from: "front:/panier", to: "back:/api/visible", calls: 12 },
      { from: "front:/panier", to: "back:/api/masquee", calls: 5 },
    ];
    const carte = carteAffichee(front, back, edges, 1);
    // Avant F52, `layoutGraph` supprimait la seconde : 5 appels disparaissaient sans le dire.
    expect(carte.edges).toEqual([
      { from: "front:/panier", to: "back:/api/visible", calls: 12 },
      { from: "front:/panier", to: idAutres("back"), calls: 5 },
    ]);
    // Et le graphe posé garde bien les deux arêtes : les deux extrémités existent.
    expect(layoutGraph(carte.front, carte.back, carte.edges).edges).toHaveLength(2);
  });

  it("deux routes masquées vers la même page fusionnent en UNE arête, volumes additionnés", () => {
    const front = [noeud("/panier", "front", 20)];
    const back = [noeud("/api/visible", "back", 12), noeud("/api/m1", "back", 5), noeud("/api/m2", "back", 3)];
    const edges: GEdge[] = [
      { from: "front:/panier", to: "back:/api/m1", calls: 5 },
      { from: "front:/panier", to: "back:/api/m2", calls: 3 },
    ];
    const carte = carteAffichee(front, back, edges, 1);
    expect(carte.edges).toEqual([{ from: "front:/panier", to: idAutres("back"), calls: 8 }]);
  });

  it("sans dépassement, aucune ligne « Autres » n'est inventée", () => {
    const back = [noeud("/a", "back", 10)];
    const carte = carteAffichee([], back, [], CAP_COLONNE);
    expect(carte.back.map((n) => n.route)).toEqual(["/a"]);
    expect(carte.masquees).toEqual({ front: 0, back: 0 });
  });

  it("une arête dont une extrémité n'a jamais été lue reste écartée (rien à lui rattacher)", () => {
    const front = [noeud("/panier", "front", 20)];
    const back = [noeud("/api/visible", "back", 12)];
    const edges: GEdge[] = [{ from: "front:/panier", to: "back:/api/hors-lecture", calls: 9 }];
    expect(carteAffichee(front, back, edges, CAP_COLONNE).edges).toEqual([]);
  });
});
