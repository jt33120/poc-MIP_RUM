// GlobalFilters (P6.2) — ce que la barre montre selon l'écran (recette du 26/09/2026) :
// une période que l'écran n'applique pas n'est pas affichée (grisée, « 24 h »
// paraissait choisie à côté de la fenêtre propre à la Rétention), et un écran qui
// n'applique ni période ni filtre n'a pas de barre du tout.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `next` est une dépendance de la CONSOLE : le module simulé est désigné par son
// chemin résolu depuis apps/console (même procédé que Figure.test.tsx).
const { NAVIGATION, etat } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return {
    NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation"),
    etat: { chemin: "/", recherche: "" },
  };
});
vi.mock(NAVIGATION, () => ({
  usePathname: () => etat.chemin,
  useSearchParams: () => new URLSearchParams(etat.recherche),
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

const { GlobalFilters } = await import("@/components/GlobalFilters");

function rendu(chemin: string, recherche = "") {
  etat.chemin = chemin;
  etat.recherche = recherche;
  return renderToStaticMarkup(
    <GlobalFilters schema={["rum_session.device_type"]} timeZones={{}} defaultTimeZone="Europe/Paris" />,
  );
}

describe("GlobalFilters", () => {
  it("un écran qui applique la période la montre", () => {
    expect(rendu("/errors")).toContain('data-testid="filter-period"');
  });

  it("Rétention : pas de période (l'écran lit ses semaines), l'appareil reste", () => {
    const html = rendu("/retention");
    expect(html).toContain('data-testid="global-filters"');
    expect(html).not.toContain('data-testid="filter-period"');
    expect(html).toContain('data-testid="filter-device"');
  });

  it("sous 640 px, la barre est repliée dans une feuille dont le bouton résume le choix", () => {
    const html = rendu("/errors", "period=7d&device=mobile&browser=Chrome");
    expect(html).toContain('data-testid="filtres-feuille"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("7 j · Mobile · 1 filtre");
    // Fermée par défaut sous 640 px ; au-delà, sans boîte (`sm:contents`) : les
    // contrôles restent dans la barre, rendus au serveur.
    expect(html).toMatch(/id="filtres-globaux" class="hidden [^"]*sm:contents"/);
    expect(html).toContain('data-testid="filter-period"');
  });

  it("ni période ni filtre applicables : aucune barre", () => {
    for (const chemin of ["/sessions/abc", "/dashboards", "/slo", "/alerts", "/forecast"]) {
      expect(rendu(chemin), chemin).toBe("");
    }
  });
});
