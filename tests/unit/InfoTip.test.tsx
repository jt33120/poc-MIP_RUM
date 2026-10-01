// InfoTip borné (F09, § 2.4) : une bulle FERMÉE n'occupe aucune largeur — elle
// portait la page à 471 px sur une fenêtre de 390 —, et une bulle ouverte ne
// dépasse jamais la fenêtre.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoTip } from "@/components/InfoTip";

const bulle = (html: string) => /<span role="tooltip" class="([^"]+)"/.exec(html)?.[1].split(" ") ?? [];

describe("InfoTip", () => {
  it("fermée : display none, ouverte au survol ou au focus", () => {
    const c = bulle(renderToStaticMarkup(<InfoTip>Aide</InfoTip>));
    expect(c).toContain("hidden");
    expect(c).toContain("group-hover:block");
    expect(c).toContain("group-focus-within:block");
    expect(c).not.toContain("opacity-0");
  });

  it("jamais plus large que la fenêtre moins 2 rem ; posée au bord sous 640 px", () => {
    const c = bulle(renderToStaticMarkup(<InfoTip>Aide</InfoTip>));
    expect(c).toContain("max-w-[calc(100vw-2rem)]");
    expect(c).toEqual(expect.arrayContaining(["fixed", "inset-x-4", "bottom-4", "sm:absolute", "sm:inset-x-auto"]));
  });

  it("accroche au bord de l'icône à partir de 640 px", () => {
    expect(bulle(renderToStaticMarkup(<InfoTip align="end">Aide</InfoTip>))).toContain("sm:right-0");
    expect(bulle(renderToStaticMarkup(<InfoTip align="start">Aide</InfoTip>))).toContain("sm:left-0");
    expect(bulle(renderToStaticMarkup(<InfoTip>Aide</InfoTip>))).toContain("sm:-translate-x-1/2");
  });

  it("au-dessus : pas de bottom-auto qui annulerait bottom-full", () => {
    const c = bulle(renderToStaticMarkup(<InfoTip side="top">Aide</InfoTip>));
    expect(c).toContain("sm:bottom-full");
    expect(c).not.toContain("sm:bottom-auto");
  });

  it("Échap la masque (F69, WCAG 1.4.13) : groupe marqué `data-ferme`, îlot rendu dans le groupe", () => {
    const html = renderToStaticMarkup(<InfoTip>Aide</InfoTip>);
    // `!` : l'état fermé l'emporte sur l'ouverture au survol et au focus.
    expect(bulle(html)).toContain("group-data-[ferme]:!hidden");
    // L'îlot se repère à son parent : il doit être un enfant DIRECT du groupe.
    expect(html).toMatch(/^<span class="group [^"]*"[^>]*>.*<span hidden=""><\/span><\/span>$/);
  });

  // Recette du 01/10/2026 : une bulle dans une liste qui défile (classement, tableau
  // défilant) était coupée par son conteneur. Une fois placée par l'îlot (`data-place`),
  // elle passe en `fixed` aux coordonnées de fenêtre, hors de tout conteneur.
  it("au-delà de 640 px, placée par l'îlot : `fixed` aux coordonnées de fenêtre ; côté et alignement exposés", () => {
    const html = renderToStaticMarkup(
      <InfoTip side="top" align="end">
        Aide
      </InfoTip>,
    );
    expect(html).toMatch(/^<span class="group [^"]*" data-side="top" data-align="end">/);
    expect(bulle(html)).toEqual(
      expect.arrayContaining([
        "sm:group-data-[place]:fixed",
        "sm:group-data-[place]:left-[var(--bulle-x)]",
        "sm:group-data-[place]:top-[var(--bulle-y)]",
      ]),
    );
    // Sans JS, l'absolu d'avant reste (pas de `data-place` au rendu serveur).
    expect(html).not.toContain("data-place");
    expect(bulle(html)).toContain("sm:absolute");
  });
});
