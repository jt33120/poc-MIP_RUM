// Le menu des pages publiques (30/09/2026) : Installation (trois parcours), À faire,
// Graphe technique. Ce que ces tests tiennent :
//   - chaque chemin du menu a sa page, et est public ; le menu n'en invente pas ;
//   - la page À faire : des hypothèses et des chantiers identifiés une seule fois,
//     chacun avec des sources qui existent dans le dépôt (fichier:ligne) ;
//   - la barre de navigation mène à chaque page du menu.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { estCheminPublic } from "@/lib/chemins-publics";
import { CHANTIERS, HYPOTHESES } from "@/lib/presentation-hypotheses";
import { CHEMINS_MENU, CHEMIN_A_FAIRE, CHEMIN_GRAPHE, CHEMIN_INSTALLATION, SEGMENT_PARCOURS, parcoursDuSegment } from "@/lib/vitrine-navigation";

vi.mock("next/navigation", () => ({ usePathname: () => "/presentation" }));
const { NavVitrine } = await import("@/components/presentation/vitrine/NavVitrine");

const RACINE = join(__dirname, "..", "..");
const APP = join(RACINE, "apps/console/app");

describe("le menu des pages publiques", () => {
  it("chaque chemin du menu a sa page et est public", () => {
    for (const c of CHEMINS_MENU) {
      expect(estCheminPublic(c), c).toBe(true);
      const statique = join(APP, c, "page.tsx");
      const parParcours = join(APP, CHEMIN_INSTALLATION, "[parcours]", "page.tsx");
      expect(existsSync(statique) || (c.startsWith(`${CHEMIN_INSTALLATION}/`) && existsSync(parParcours)), c).toBe(true);
    }
  });

  it("un segment de parcours se relit, un autre n'ouvre rien", () => {
    for (const [p, s] of Object.entries(SEGMENT_PARCOURS)) expect(parcoursDuSegment(s)).toBe(p);
    expect(parcoursDuSegment("snippet")).toBeNull();
    expect(parcoursDuSegment("")).toBeNull();
  });

  it("la barre mène aux trois pages et aux trois parcours ; un visiteur y trouve la connexion", () => {
    const html = renderToStaticMarkup(<NavVitrine connecte={false} demoOuverte />);
    for (const c of CHEMINS_MENU) expect(html, c).toContain(`href="${c}"`);
    expect(html).toMatch(/<a href="\/login" data-testid="nav-connexion"/);
    expect(html).toMatch(/<a href="\/login\?demo=1" data-testid="nav-demo"/);
    expect(html).toMatch(/<a href="https:\/\/github\.com\/jt33120\/poc-MIP_RUM" target="_blank" rel="noopener noreferrer"[^>]*data-testid="nav-github"/);
    expect(html).not.toContain("nav-console");
    // Démo fermée : pas de bouton vers une démo qui refuserait.
    expect(renderToStaticMarkup(<NavVitrine connecte={false} demoOuverte={false} />)).not.toContain("nav-demo");
    const connecte = renderToStaticMarkup(<NavVitrine connecte demoOuverte />);
    expect(connecte).toMatch(/<a href="\/" data-testid="nav-console"/);
    expect(connecte).not.toMatch(/nav-demo|nav-connexion/);
    expect([CHEMIN_A_FAIRE, CHEMIN_GRAPHE].every((c) => CHEMINS_MENU.includes(c))).toBe(true);
  });
});

describe("la page À faire : des affirmations sourcées", () => {
  const entrees = [...HYPOTHESES, ...CHANTIERS];

  it("des identifiants uniques", () => {
    const ids = entrees.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("chaque source nomme un fichier du dépôt, et ses lignes y existent", () => {
    for (const e of entrees) {
      expect(e.sources.length, e.id).toBeGreaterThan(0);
      for (const s of e.sources) {
        const [fichier, lignes] = s.split(":");
        const chemin = join(RACINE, fichier);
        expect(existsSync(chemin), `${e.id} → ${fichier}`).toBe(true);
        const nb = readFileSync(chemin, "utf8").split("\n").length;
        for (const n of (lignes ?? "").split(/[,-]/).filter(Boolean).map(Number)) {
          expect(n, `${e.id} → ${s}`).toBeLessThanOrEqual(nb);
        }
      }
    }
  });
});
