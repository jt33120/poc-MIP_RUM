// Onglets du graphique principal de `/` (spec A2 § 6.1) : « Web Vitals | Erreurs |
// Trafic », Web Vitals par défaut. Les séries des onglets Erreurs et Trafic viennent
// de comptes DÉJÀ lus (rangée Trafic, « Charge, erreurs et LCP »).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OngletsHero, ongletVoisin } from "@/components/vue-ensemble/OngletsHero";
import { HeroErreurs, HeroTrafic } from "@/components/vue-ensemble/SeriesVueEnsemble";
import { ongletHeroDe, pointsHeroErreurs, pointsHeroTrafic } from "@/lib/vue-ensemble";

// « Réessayer » (SectionErreur, client) lit le routeur de Next : hors application, un
// routeur inerte (même procédé que SeriesVueEnsemble.test.tsx).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const GRILLE = ["2026-09-29T10:00:00Z", "2026-09-29T11:00:00Z", "2026-09-29T12:00:00Z"];
const VUES = [
  { bucket: "2026-09-29T10:00:00.000Z", chargements: 150, spa: 50, inconnu: 0 },
  { bucket: "2026-09-29T12:00:00.000Z", chargements: 10, spa: 0, inconnu: 0 },
];
const COMMUN = {
  grille: GRILLE,
  seauSecondes: 3600,
  zoomHref: "/?from={from}&to={to}",
  annotations: { annotations: [], indisponible: null },
  plage: "24 h",
};

describe("ongletHeroDe", () => {
  it("Web Vitals par défaut, pour toute valeur inconnue", () => {
    expect(ongletHeroDe(undefined)).toBe("vitaux");
    expect(ongletHeroDe("lcp")).toBe("vitaux");
    expect(ongletHeroDe(["erreurs"])).toBe("vitaux");
  });
  it("erreurs et trafic, casse ignorée", () => {
    expect(ongletHeroDe("erreurs")).toBe("erreurs");
    expect(ongletHeroDe(" Trafic ")).toBe("trafic");
  });
});

describe("pointsHeroErreurs", () => {
  it("occurrences pour 100 pages vues par seau ; un seau sans vue est un trou, jamais 0", () => {
    const p = pointsHeroErreurs(GRILLE, VUES, [
      { bucket: "2026-09-29T10:00:00.000Z", navigateur: 3 },
      { bucket: "2026-09-29T11:00:00.000Z", navigateur: 2 },
    ]);
    expect(p.map((x) => x.pour100)).toEqual([1.5, null, 0]);
    expect(p.map((x) => x.vues)).toEqual([200, 0, 10]);
    expect(p.map((x) => x.occurrences)).toEqual([3, 2, 0]);
  });
});

describe("pointsHeroTrafic", () => {
  it("pages vues et sessions par seau, un seau absent vaut 0", () => {
    const p = pointsHeroTrafic(GRILLE, VUES, [{ bucket: new Date("2026-09-29T11:00:00Z"), sessions: 7 }]);
    expect(p).toEqual([
      { t: GRILLE[0], vues: 200, sessions: 0 },
      { t: GRILLE[1], vues: 0, sessions: 7 },
      { t: GRILLE[2], vues: 10, sessions: 0 },
    ]);
  });
  it("une lecture en échec : pas de points (état d'erreur), jamais des zéros", () => {
    expect(pointsHeroTrafic(GRILLE, null, [])).toBeNull();
    expect(pointsHeroTrafic(GRILLE, VUES, null)).toBeNull();
  });
});

describe("ongletVoisin — clavier", () => {
  const cles = ["vitaux", "erreurs", "trafic"];
  it("flèches avec bouclage, Début et Fin", () => {
    expect(ongletVoisin(cles, "vitaux", "ArrowRight")).toBe("erreurs");
    expect(ongletVoisin(cles, "trafic", "ArrowRight")).toBe("vitaux");
    expect(ongletVoisin(cles, "vitaux", "ArrowLeft")).toBe("trafic");
    expect(ongletVoisin(cles, "erreurs", "Home")).toBe("vitaux");
    expect(ongletVoisin(cles, "erreurs", "End")).toBe("trafic");
    expect(ongletVoisin(cles, "erreurs", "Enter")).toBeNull();
  });
});

describe("OngletsHero — rendu", () => {
  const onglets = [
    { cle: "vitaux" as const, libelle: "Web Vitals", contenu: <p id="hero-LCP">vitaux</p> },
    { cle: "erreurs" as const, libelle: "Erreurs", contenu: <p>taux</p> },
    { cle: "trafic" as const, libelle: "Trafic", contenu: <p>trafic</p> },
  ];

  it("tablist, trois onglets, Web Vitals choisi ; seul son panneau est dans le DOM", () => {
    const html = renderToStaticMarkup(<OngletsHero onglets={onglets} initial="vitaux" />);
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*data-onglet="vitaux"/);
    // Un seul arrêt de tabulation : l'onglet actif.
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('id="hero-LCP"');
    expect(html).not.toContain("<p>taux</p>");
    // aria-controls ne vise que le panneau présent.
    expect(html.match(/aria-controls=/g)).toHaveLength(1);
  });

  it("?serie=trafic ouvre l'onglet Trafic", () => {
    const html = renderToStaticMarkup(<OngletsHero onglets={onglets} initial="trafic" />);
    expect(html).toMatch(/aria-selected="true"[^>]*data-onglet="trafic"/);
    expect(html).toContain("<p>trafic</p>");
    expect(html).not.toContain('id="hero-LCP"');
  });
});

describe("HeroErreurs et HeroTrafic — états", () => {
  it("une lecture en échec : état d'erreur, pas de graphique", () => {
    const html = renderToStaticMarkup(<HeroErreurs {...COMMUN} mode={{ kind: "simple" }} vues={{ ok: false }} erreurs={{ ok: false }} />);
    expect(html).toContain('id="hero-taux-erreurs"');
    expect(html).not.toContain("threshold-series");
    const trafic = renderToStaticMarkup(<HeroTrafic {...COMMUN} mode={{ kind: "simple" }} vues={{ ok: true, data: VUES }} sessions={{ ok: false }} />);
    expect(trafic).toContain('id="hero-trafic"');
    expect(trafic).not.toContain("threshold-series");
  });

  it("sans la colonne de source, le titre dit « toutes sources » (CP14)", () => {
    const html = renderToStaticMarkup(
      <HeroErreurs
        {...COMMUN}
        mode={{ kind: "simple" }}
        vues={{ ok: true, data: VUES }}
        erreurs={{ ok: true, data: { restreint: false, points: [] } }}
      />,
    );
    expect(html).toContain("toutes sources");
  });
});
