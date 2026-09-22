// Donut (F03, plan § 4.1) : la part inconnue est nommée, les parts à 0 restent dans
// la légende, et sans total une part vaut « — », jamais « 0 % ».
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Donut, partAffichee } from "@/components/charts/Donut";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

describe("Donut", () => {
  it("part inconnue nommée, dessinée et listée", () => {
    const html = renderToStaticMarkup(
      <Donut
        slices={[
          { label: "Nouvelles", value: 610, color: "#0891b2" },
          { label: "Revenantes", value: 240, color: "#8b5cf6" },
        ]}
        inconnu={{ label: "Non identifiées", value: 150 }}
      />,
    );
    expect(html).toContain('data-testid="donut-inconnu"');
    expect(html).toContain("data-inconnue");
    expect(texte(html)).toContain("Non identifiées 150 15 %");
  });

  it("une part à 0 reste dans la légende, à « 0 % »", () => {
    const html = renderToStaticMarkup(
      <Donut
        slices={[
          { label: "Direct", value: 10, color: "#0891b2" },
          { label: "Réseaux sociaux", value: 0, color: "#8b5cf6" },
        ]}
      />,
    );
    expect(texte(html)).toContain("Réseaux sociaux 0 0 %");
  });

  it("sans total : « — », jamais « 0 % »", () => {
    expect(partAffichee(0, 0)).toBe("—");
    const html = renderToStaticMarkup(<Donut slices={[{ label: "Nouvelles", value: 0, color: "#0891b2" }]} />);
    expect(texte(html)).not.toMatch(/0 %/);
  });

  it("une part non nulle qui s'arrondirait à 0 s'écrit « < 1 % »", () => {
    expect(partAffichee(1, 1000)).toBe("< 1 %");
  });

  it("nom accessible : l'énumération des parts par défaut, ou celui de l'appelant", () => {
    const parDefaut = renderToStaticMarkup(<Donut slices={[{ label: "A", value: 3, color: "#0891b2" }]} />);
    expect(parDefaut).toMatch(/role="img" aria-label="Répartition : A 3 \(100 %\)"/);
    const nomme = renderToStaticMarkup(
      <Donut slices={[{ label: "A", value: 3, color: "#0891b2" }]} ariaLabel="Sessions actives par type" />,
    );
    expect(nomme).toContain('aria-label="Sessions actives par type"');
  });
});
