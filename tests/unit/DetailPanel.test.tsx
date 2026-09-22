// DetailPanel (F07, plan § 3.5 et § 4.2) : ce que le rendu serveur garantit SANS
// JavaScript — une <aside> nommée par son titre, un titre focalisable, de vrais
// liens « Fermer », « Ouvrir en page », « Précédent », « Suivant », des onglets
// comptés où l'inconnu s'écrit « (—) ». Le clavier (Échap, ↑ / ↓, focus) est joué
// par tests/e2e/panneau.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DetailPanel, TITRE_PANNEAU_ID, libelleOnglet } from "@/components/DetailPanel";

// L'îlot clavier lit le routeur de Next : hors application, un routeur inerte (même
// mécanisme que tests/unit/Figure.test.tsx).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&");

const BASE = {
  type: "route" as const,
  titre: "/checkout",
  fermerHref: "/pages",
  pageHref: "/pages?route=%2Fcheckout",
};

describe("DetailPanel", () => {
  it("<aside> nommée par un titre focalisable (tabindex=-1), type en badge", () => {
    const html = renderToStaticMarkup(<DetailPanel {...BASE}>contenu</DetailPanel>);
    expect(html).toMatch(new RegExp(`<aside aria-labelledby="${TITRE_PANNEAU_ID}"`));
    expect(html).toMatch(new RegExp(`<h2 id="${TITRE_PANNEAU_ID}" tabindex="-1"[^>]*>/checkout</h2>`));
    expect(texte(html)).toContain("Route");
    expect(html).toContain('data-type="route"');
  });

  it("plein écran sous 1280 px, moitié de la zone de contenu au-delà", () => {
    const html = renderToStaticMarkup(<DetailPanel {...BASE}>contenu</DetailPanel>);
    expect(html).toMatch(/class="fixed inset-0 [^"]*xl:w-\[calc\(\(100vw-16rem\)\/2\)\]/);
  });

  it("« Fermer » et « Ouvrir en page » sont de vrais liens (sans JavaScript)", () => {
    const html = renderToStaticMarkup(<DetailPanel {...BASE}>contenu</DetailPanel>);
    expect(html).toMatch(/<a [^>]*href="\/pages"[^>]*aria-keyshortcuts="Escape"|<a [^>]*aria-keyshortcuts="Escape"[^>]*href="\/pages"/);
    expect(html).toMatch(/<a [^>]*href="\/pages\?route=%2Fcheckout"[^>]*>Ouvrir en page<\/a>/);
  });

  it("précédent / suivant : lien, ou bouton éteint en bout de liste ; absents sans liste", () => {
    const bout = renderToStaticMarkup(
      <DetailPanel {...BASE} precedentHref={null} suivantHref="/pages?panel=route%3A%252Fpanier">
        contenu
      </DetailPanel>,
    );
    expect(bout).toMatch(/<span aria-disabled="true"[^>]*>.*Précédent<\/span>/);
    expect(bout).toMatch(/<a aria-keyshortcuts="ArrowDown"[^>]*href="\/pages\?panel=route%3A%252Fpanier"[^>]*>.*Suivant<\/a>/);
    const sansListe = renderToStaticMarkup(<DetailPanel {...BASE}>contenu</DetailPanel>);
    expect(sansListe).not.toContain("Précédent");
    expect(sansListe).not.toContain("Parcourir la liste");
  });

  it("onglets comptés : compte inconnu « (—) », jamais « (0) » ; un vrai zéro reste « (0) »", () => {
    expect(libelleOnglet({ libelle: "Erreurs", compte: null })).toBe("Erreurs (—)");
    expect(libelleOnglet({ libelle: "Erreurs", compte: 0 })).toBe("Erreurs (0)");
    expect(libelleOnglet({ libelle: "Sessions", compte: 1204 }).replace(/[  ]/g, " ")).toBe("Sessions (1 204)");
    const html = renderToStaticMarkup(
      <DetailPanel
        {...BASE}
        onglets={[
          { cle: "vitals", libelle: "Web Vitals", compte: 3, href: "#v", actif: true },
          { cle: "erreurs", libelle: "Erreurs", compte: null, href: "#e", actif: false },
        ]}
      >
        contenu
      </DetailPanel>,
    );
    const t = texte(html);
    expect(t).toContain("Web Vitals (3)");
    expect(t).toContain("Erreurs (—)");
    expect(t).not.toContain("Erreurs (0)");
    // L'onglet actif se dit par `aria-current` (TabLink), pas par un texte masqué en plus.
    expect(html).toMatch(/aria-current="page"[^>]*>(?:<[^>]+>)*Web Vitals/);
    expect(t).not.toContain("onglet affiché");
  });

  it("puces : la provenance d'une valeur estimée est écrite", () => {
    const html = renderToStaticMarkup(
      <DetailPanel {...BASE} puces={[{ label: "Pays estimé", valeur: "France", provenance: "géolocalisation IP" }]}>
        contenu
      </DetailPanel>,
    );
    expect(texte(html)).toContain("Pays estiméFrance (provenance : géolocalisation IP)");
  });
});
