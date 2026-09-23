// P**.7 — La légende de la capture de la vitrine (components/presentation/LegendeCapture.tsx,
// plan § 8.2, PS0) : texte exact du plan, datée par le manifeste des captures et par
// lui seul. La recette TP8 (tests/e2e/presentation.spec.ts) tient la même règle sur
// la page servie : une date si et seulement si public/portail/manifest.json existe.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegendeCapture } from "@/components/presentation/LegendeCapture";

/** Texte lisible : balises retirées, apostrophes et espaces normalisés. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Le motif de date de TP8 : « JJ/MM/AAAA » ou « AAAA-MM-JJ ». */
const DATE_TP8 = /\b\d{2}\/\d{2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/;

describe("LegendeCapture", () => {
  it("sans date établie : le texte du plan, sans le segment « prise le », sans aucune date", () => {
    const html = renderToStaticMarkup(<LegendeCapture date={null} />);
    expect(texte(html)).toBe(
      "Capture réelle de la console. Les chiffres affichés viennent d'un jeu de démonstration, pas d'un client en production.",
    );
    expect(DATE_TP8.test(texte(html))).toBe(false);
    expect(html).not.toContain("<time");
  });

  it("datée par le manifeste : « , prise le JJ/MM/AAAA », et la date machine sur <time>", () => {
    const html = renderToStaticMarkup(<LegendeCapture date="2026-09-23" />);
    expect(texte(html)).toBe(
      "Capture réelle de la console, prise le 23/09/2026. Les chiffres affichés viennent d'un jeu de démonstration, pas d'un client en production.",
    );
    expect(DATE_TP8.test(texte(html))).toBe(true);
    expect(html).toMatch(/<time datetime="2026-09-23">23\/09\/2026<\/time>/i);
  });

  it("un seul paragraphe : TP8 le trouve par « Capture réelle de la console »", () => {
    const html = renderToStaticMarkup(<LegendeCapture date="2026-09-23" />);
    expect(html.match(/<p\b/g)).toHaveLength(1);
  });
});
