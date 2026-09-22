// TabLink (F44, § 4.1) : onglet compté. Compte inconnu « (—) », jamais « (0) » ; un
// vrai zéro reste « (0) » ; sans compte, rien n'est ajouté.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TabLink, texteCompte } from "@/components/sessions/TabLink";

const texte = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

describe("TabLink", () => {
  it("compte inconnu → « (—) », vrai zéro → « (0) », compte → « (3) »", () => {
    expect(texte(renderToStaticMarkup(<TabLink href="#e" active={false} compte={null}>Erreurs</TabLink>))).toBe("Erreurs (—)");
    expect(texte(renderToStaticMarkup(<TabLink href="#e" active={false} compte={0}>Erreurs</TabLink>))).toBe("Erreurs (0)");
    expect(texte(renderToStaticMarkup(<TabLink href="#e" active compte={3}>Erreurs</TabLink>))).toBe("Erreurs (3)");
    expect(texteCompte(Number.NaN)).toBe("—");
  });

  it("sans compte : le libellé seul ; l'onglet actif se dit par aria-current", () => {
    const html = renderToStaticMarkup(
      <TabLink href="#d" active>
        Déroulé
      </TabLink>,
    );
    expect(texte(html)).toBe("Déroulé");
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("onglet-compte");
  });
});
