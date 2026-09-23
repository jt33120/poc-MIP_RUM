// P**.5 — Partie 3 de la vitrine, rendue (components/presentation/Reste.tsx).
//
// Ce que ces tests tiennent, en rendu SSR réel (`renderToStaticMarkup`) : une
// carte par point de lib/presentation-reste.ts, dans l'ordre ; les trois lignes
// étiquetées du plan ; les pastilles des lignes du document que le point cite,
// avec le nom de la capacité et son verdict LUS dans lib/couverture.ts. La
// présence de D12 et D14 dans #reste sur la vraie page est la recette e2e TP4
// (tests/e2e/presentation.spec.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Reste } from "@/components/presentation/Reste";
import { VERDICT_LABEL } from "@/lib/couverture";
import { POINTS_RESTE, lignesCitees } from "@/lib/presentation-reste";

/** Texte lisible : balises retirées, entités et espaces insécables normalisés. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const HTML = renderToStaticMarkup(<Reste />);

/** Le HTML de chaque carte, dans l'ordre du rendu. */
const CARTES = HTML.split("<article ").slice(1).map((c) => `<article ${c.slice(0, c.indexOf("</article>"))}`);

describe("Partie 3 — la section, son titre et son chapeau", () => {
  it("section #reste, titre h2 exact, chapeau exact du plan", () => {
    expect(HTML).toContain('<section id="reste" aria-labelledby="reste-titre"');
    expect(texte(/<h2[^>]*>(.*?)<\/h2>/.exec(HTML)![1])).toBe("Ce qui reste pour un vrai outil de RUM");
    expect(texte(HTML)).toContain(
      "Ce qui sépare ce POC d'un outil qu'on met en service chez un client. Pour chaque point : ce qui manque, ce qui le débloquerait, et qui décide.",
    );
  });
});

describe("Partie 3 — une carte par point, dans l'ordre", () => {
  it("autant de cartes que de points, R1 à R9, chacune titrée par son h3", () => {
    expect(CARTES).toHaveLength(POINTS_RESTE.length);
    CARTES.forEach((carte, i) => {
      const p = POINTS_RESTE[i];
      expect(carte).toContain(`data-testid="reste-point" data-id="${p.id}" aria-labelledby="reste-${p.id}-titre"`);
      const h3 = new RegExp(`<h3 id="reste-${p.id}-titre"[^>]*>(.*?)</h3>`).exec(carte);
      expect(h3, p.id).not.toBeNull();
      expect(texte(h3![1])).toBe(p.titre);
    });
  });

  it("trois lignes étiquetées, dans l'ordre du plan, chacune avec le texte du point", () => {
    CARTES.forEach((carte, i) => {
      const p = POINTS_RESTE[i];
      const libelles = [...carte.matchAll(/<dt[^>]*>(.*?)<\/dt>/g)].map((m) => texte(m[1]));
      const valeurs = [...carte.matchAll(/<dd[^>]*>(.*?)<\/dd>/g)].map((m) => texte(m[1]));
      expect(libelles, p.id).toEqual(["Ce qui manque", "Ce qui le débloque", "Qui décide"]);
      expect(valeurs, p.id).toEqual([p.manque, p.debloque, p.decide]);
    });
  });

  it("les cartes sont les éléments d'une liste ordonnée", () => {
    expect(HTML).toMatch(/<ol class="[^"]*grid[^"]*">(<li class="min-w-0"><article [^]*?<\/article><\/li>){9}<\/ol>/);
  });
});

describe("Partie 3 — les pastilles des lignes du document", () => {
  const pastilles = (carte: string) =>
    [...carte.matchAll(/<span data-testid="reste-pastille" data-id="([^"]+)" data-verdict="([^"]+)" title="([^"]*)"[^>]*>([^<]*)<\/span>/g)].map(
      (m) => ({ id: m[1], verdict: m[2], title: texte(m[3]), affiche: m[4] }),
    );

  it("une pastille par ligne citée, avec la capacité et le verdict du document au survol", () => {
    CARTES.forEach((carte, i) => {
      const p = POINTS_RESTE[i];
      const attendues = lignesCitees(p).map((c) => ({
        id: c.id,
        verdict: c.verdict,
        title: `${c.capacite} — ${VERDICT_LABEL[c.verdict]}`,
        affiche: c.id,
      }));
      expect(pastilles(carte), p.id).toEqual(attendues);
    });
  });

  it("un point qui ne cite aucune ligne n'a ni pastille ni libellé de pastilles", () => {
    CARTES.forEach((carte, i) => {
      const p = POINTS_RESTE[i];
      if (lignesCitees(p).length > 0) {
        expect(texte(carte), p.id).toContain("Lignes du document de couverture");
        expect(carte).toContain(`<ul aria-labelledby="reste-${p.id}-lignes"`);
      } else {
        expect(texte(carte), p.id).not.toContain("Lignes du document de couverture");
        expect(carte, p.id).not.toContain("reste-pastille");
      }
    });
  });

  it("D12 et D14, déployées mais inertes, ont chacune leur pastille dans la partie 3", () => {
    for (const id of ["D12", "D14"]) {
      const trouvees = [...HTML.matchAll(new RegExp(`data-testid="reste-pastille" data-id="${id}" data-verdict="deploye_non_eprouve"`, "g"))];
      expect(trouvees, id).toHaveLength(1);
    }
  });
});
