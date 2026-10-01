import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperienceUnavailable } from "@/components/ExperienceUnavailable";
import { BoutonFenetre } from "@/components/perf/BoutonFenetre";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("rendu Expérience sans avis noté", () => {
  it("emploie le panneau données insuffisantes sans inventer un score /100", () => {
    const page = readFileSync(join(process.cwd(), "apps/console/app/experience/page.tsx"), "utf8");
    const component = readFileSync(join(process.cwd(), "apps/console/components/ExperienceUnavailable.tsx"), "utf8");
    expect(page).toContain("<ExperienceUnavailable />");
    expect(component).toContain("Données insuffisantes");
    expect(component).not.toContain("/100");
  });

  // Recette du 30/09/2026 : « Données insuffisantes » remplaçait le graphique par une
  // boîte de 260 px au texte centré ; c'est désormais une ligne, dans la figure.
  it("tient sur une ligne : ni boîte de 260 px, ni cadre centré", () => {
    const html = renderToStaticMarkup(createElement(ExperienceUnavailable));
    expect(texte(html)).toContain("Données insuffisantes");
    expect(texte(html)).toContain("la satisfaction ne se trace pas");
    expect(html).not.toContain("h-[260px]");
    expect(html).not.toContain("text-center");
  });
});

// Le module d'avis n'est plus proposé dans une grande boîte (un paragraphe et un bloc
// de code) : une ligne, et un bouton qui ouvre la fenêtre du geste d'installation.
describe("BoutonFenetre — une ligne qui ouvre une fenêtre", () => {
  const html = renderToStaticMarkup(
    createElement(
      BoutonFenetre,
      { libelle: "Installer →", titre: "Installer le module d'avis", testId: "ouvrir" },
      createElement("pre", null, `<script src="/mip-rum-feedback.js"></script>`),
    ),
  );

  it("un bouton annoncé comme ouvrant une fenêtre, et un <dialog> natif nommé et fermé", () => {
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*data-testid="ouvrir"/);
    expect(html).toMatch(/<dialog[^>]*aria-label="Installer le module d&#x27;avis"/);
    expect(html).not.toMatch(/<dialog[^>]* open/);
  });

  it("le contenu de la fenêtre reste dans la page, et la fenêtre se ferme par un bouton nommé", () => {
    expect(texte(html)).toContain('<script src="/mip-rum-feedback.js"></script>');
    expect(html).toContain('aria-label="Fermer"');
  });

  it("l'écran Satisfaction propose le module ainsi, sans l'ancienne carte d'installation", () => {
    const page = readFileSync(join(process.cwd(), "apps/console/app/experience/page.tsx"), "utf8");
    expect(page).toContain("<LigneInstallation />");
    expect(page).toContain("<BoutonFenetre");
    expect(page).not.toContain("CarteInstallation");
  });
});
