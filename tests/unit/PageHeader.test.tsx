// PageHeader — le titre seul (recette du 30/09/2026) : ni surtitre, qui redisait la
// catégorie allumée dans la barre latérale, ni phrase-question sous le titre. Et sur
// l'écran d'un onglet (recette du 01/10/2026), le titre ne redit pas l'onglet : il
// reste aux lecteurs d'écran, ses actions restent rendues.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { NAVIGATION, chemin } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return {
    NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation"),
    chemin: { valeur: "/explorer" },
  };
});
vi.mock(NAVIGATION, () => ({ usePathname: () => chemin.valeur }));

const { PageHeader } = await import("@/components/PageHeader");

describe("PageHeader — le titre seul", () => {
  it("n'écrit pas la catégorie : la barre latérale la dit", () => {
    const html = renderToStaticMarkup(<PageHeader title="Pages" domain="perf" />);
    expect(html).toContain("Pages");
    expect(html).not.toContain("Performance");
  });

  it("n'écrit pas la phrase-question", () => {
    const html = renderToStaticMarkup(<PageHeader title="Vue d'ensemble" sub="Les vrais visiteurs vont-ils bien ?" />);
    expect(html).not.toContain("visiteurs");
  });
});

describe("PageHeader — l'écran d'un onglet", () => {
  it("le titre reste un h1, lu mais non redit à l'œil ; les actions sont rendues à part, à droite", () => {
    chemin.valeur = "/alerts";
    const html = renderToStaticMarkup(
      <PageHeader title="Alertes">
        <button type="button">Évaluer maintenant</button>
      </PageHeader>,
    );
    expect(html).toMatch(/<h1 class="titre-onglet[^"]*"[^>]*>Alertes<\/h1>/);
    // Au rendu serveur, l'action est dans son repli (la feuille de style le masque
    // quand la coquille offre la place à droite des onglets).
    expect(html).toContain('data-repli="entete"');
    expect(html).toContain("Évaluer maintenant");
  });

  it("une sous-page ou un écran d'administration garde son titre écrit", () => {
    for (const c of ["/dashboards/42", "/admin/users", "/api-docs"]) {
      chemin.valeur = c;
      const html = renderToStaticMarkup(<PageHeader title="Titre" />);
      expect(html, c).not.toContain("titre-onglet");
      expect(html, c).toContain(">Titre</h1>");
    }
  });
});
