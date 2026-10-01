// TableDefilante (recette du 26/09/2026) : un tableau large défile dans SA zone,
// focalisable et nommée ; le cadre garde ses classes ; rien n'est « débordant » au
// rendu serveur (l'état se mesure après montage, sans écart d'hydratation) ; la
// mesure distingue le bord gauche du bord droit.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mesurerDebordement, TableDefilante } from "@/components/TableDefilante";

const TABLE = (
  <table>
    <tbody>
      <tr>
        <td>Colonne clé</td>
        <td>Actions</td>
      </tr>
    </tbody>
  </table>
);

describe("TableDefilante — rendu serveur", () => {
  it("une zone défilante focalisable, nommée par défaut, qui contient le tableau", () => {
    const html = renderToStaticMarkup(<TableDefilante>{TABLE}</TableDefilante>);
    const zone = html.match(/<div[^>]*role="region"[^>]*>/)?.[0];
    expect(zone).toBeDefined();
    expect(zone).toContain('aria-label="Tableau défilant"');
    expect(zone).toContain('tabindex="0"');
    expect(zone).toContain("overflow-x-auto");
    // `relative` : les `sr-only` des cellules restent dans la zone qui défile.
    expect(zone).toMatch(/class="relative /);
    expect(html.indexOf("<table")).toBeGreaterThan(html.indexOf('role="region"'));
  });

  it("le cadre garde les classes de l'appelant et le testid de l'ancien conteneur", () => {
    const html = renderToStaticMarkup(
      <TableDefilante className="card mb-6" label="Utilisateurs" testId="users-table">
        {TABLE}
      </TableDefilante>,
    );
    expect(html).toMatch(/^<div class="relative overflow-hidden card mb-6" data-testid="users-table">/);
    expect(html).toContain('aria-label="Utilisateurs"');
    // Le cadre ne défile jamais : c'est la zone intérieure qui le fait.
    expect(html.match(/^<div[^>]*>/)?.[0]).not.toContain("overflow-x-auto");
  });

  // 01/10/2026 : les écrans bornaient leurs listes de l'extérieur (`[&_ol]:max-h-[…]`),
  // et l'en-tête partait avec les lignes.
  it("hauteurMax : la zone défile aussi en hauteur, l'en-tête reste collé ; sans elle, rien", () => {
    const html = renderToStaticMarkup(<TableDefilante hauteurMax="20rem">{TABLE}</TableDefilante>);
    const zone = html.match(/<div[^>]*role="region"[^>]*>/)?.[0] ?? "";
    expect(zone).toContain("max-height:20rem");
    expect(zone).toContain("overflow-y-auto");
    expect(zone).toContain("overflow-x-auto");
    expect(zone).toContain("[&amp;_thead]:sticky");
    expect(zone).toContain("[&amp;_thead]:bg-panel");
    const sans = renderToStaticMarkup(<TableDefilante>{TABLE}</TableDefilante>).match(/<div[^>]*role="region"[^>]*>/)?.[0] ?? "";
    expect(sans).not.toContain("overflow-y-auto");
    expect(sans).not.toContain("max-height");
  });

  it("ni ombre ni consigne au rendu serveur : l'état se mesure après montage", () => {
    const html = renderToStaticMarkup(<TableDefilante>{TABLE}</TableDefilante>);
    expect(html).not.toContain("table-defilante-indice");
    expect(html).not.toContain("table-defilante-ombre");
    expect(html).not.toContain("Faites défiler");
  });
});

describe("mesurerDebordement", () => {
  it("contenu qui tient : aucun bord", () => {
    expect(mesurerDebordement({ scrollLeft: 0, scrollWidth: 390, clientWidth: 390 })).toEqual({ gauche: false, droite: false });
  });

  it("au début d'un tableau large : reste à droite seulement", () => {
    expect(mesurerDebordement({ scrollLeft: 0, scrollWidth: 981, clientWidth: 358 })).toEqual({ gauche: false, droite: true });
  });

  it("au milieu : les deux bords", () => {
    expect(mesurerDebordement({ scrollLeft: 200, scrollWidth: 981, clientWidth: 358 })).toEqual({ gauche: true, droite: true });
  });

  it("au bout : reste à gauche seulement", () => {
    expect(mesurerDebordement({ scrollLeft: 623, scrollWidth: 981, clientWidth: 358 })).toEqual({ gauche: true, droite: false });
  });

  it("un demi-pixel de sous-pixel n'est pas un débordement", () => {
    expect(mesurerDebordement({ scrollLeft: 0, scrollWidth: 358.5, clientWidth: 358 })).toEqual({ gauche: false, droite: false });
  });
});
