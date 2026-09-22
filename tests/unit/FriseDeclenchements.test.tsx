// FriseDeclenchements (F56, plan § 4.3, § 5.19 A5) : la forme dit la livraison, le
// contour l'acquittement, la sévérité a un second canal ; au plus 12 pistes visibles ;
// la troncature est dite ; un événement hors période n'est pas posé au bord.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FriseDeclenchements,
  livraison,
  texteMarqueur,
  type MarqueurDeclenchement,
  type PisteDeclenchements,
} from "@/components/charts/FriseDeclenchements";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const DEBUT = "2026-08-23T00:00:00Z";
const FIN = "2026-09-22T00:00:00Z";

const marqueur = (p: Partial<MarqueurDeclenchement>): MarqueurDeclenchement => ({
  t: "2026-09-07T00:00:00Z",
  severite: "critical",
  livre: true,
  enAttente: false,
  acquitte: true,
  href: "/alerts?evt=1#evt-1",
  ...p,
});

const piste = (p: Partial<PisteDeclenchements>): PisteDeclenchements => ({
  cle: "r1",
  libelle: "LCP /checkout",
  href: "/alerts#regle-r1",
  groupe: "regle",
  etatActuel: { libelle: "Franchie", ton: "bad" },
  marqueurs: [],
  ...p,
});

describe("FriseDeclenchements", () => {
  it("forme = livraison, contour épais = non acquitté, posé en temps", () => {
    const html = renderToStaticMarkup(
      <FriseDeclenchements
        debut={DEBUT}
        fin={FIN}
        pistes={[
          piste({
            marqueurs: [
              marqueur({}),
              marqueur({ t: "2026-09-10T00:00:00Z", livre: false, enAttente: false, acquitte: false, severite: "warning" }),
              marqueur({ t: "2026-09-12T00:00:00Z", livre: false, enAttente: true, severite: "info" }),
            ],
          }),
        ]}
      />,
    );
    expect(html).toContain('data-forme="plein"');
    expect(html).toContain('data-forme="creux"');
    expect(html).toContain('data-forme="losange"');
    // Milieu de la période : 50 %.
    expect(html).toMatch(/x="50%"/);
    expect(html).toContain('stroke-width="2.5"');
    expect(texte(html)).toContain("Déclenchement du 10/09 00:00 UTC : avertissement, non livré, non acquitté");
    // Sévérité : couleur ET taille.
    expect(html).toMatch(/class="text-bad"[\s\S]*?r="5.5"/);
  });

  it("un événement hors période n'est pas posé (jamais au bord)", () => {
    const html = renderToStaticMarkup(
      <FriseDeclenchements debut={DEBUT} fin={FIN} pistes={[piste({ marqueurs: [marqueur({ t: "2026-07-01T00:00:00Z" })] })]} />,
    );
    expect(html).not.toContain("data-marqueur");
    expect(texte(html)).toContain("aucun déclenchement sur la période");
  });

  it("piste sans événement mais franchie : piste vide + état « Franchie »", () => {
    const html = renderToStaticMarkup(<FriseDeclenchements debut={DEBUT} fin={FIN} pistes={[piste({})]} />);
    expect(texte(html)).toContain("aucun déclenchement sur la période");
    expect(html).toMatch(/data-testid="etat-actuel"[^>]*>Franchie</);
  });

  it("au plus 12 pistes visibles, les autres derrière « Voir les N autres sources » ; ancres SLO", () => {
    const pistes = [
      ...Array.from({ length: 13 }, (_v, i) => piste({ cle: `r${i}`, libelle: `Règle ${i}` })),
      piste({ cle: "s1", libelle: "SLO checkout", groupe: "slo", href: "/slo#definitions" }),
    ];
    const html = renderToStaticMarkup(<FriseDeclenchements debut={DEBUT} fin={FIN} pistes={pistes} />);
    const avantDetails = html.split('data-testid="pistes-cachees"')[0];
    expect(avantDetails.match(/data-testid="piste-declenchements"/g)).toHaveLength(12);
    expect(texte(html)).toContain("Voir les 2 autres sources");
    // La piste SLO est cachée : l'intertitre ancré passe dans le bloc replié, une seule fois.
    expect(html.match(/id="pistes-slo"/g)).toHaveLength(1);
    expect(html).toContain('id="slo-s1"');
  });

  it("troncature dite (partiel) ; alternative : une ligne par source", () => {
    const html = renderToStaticMarkup(
      <FriseDeclenchements
        debut={DEBUT}
        fin={FIN}
        tronque="2 000 déclenchements affichés sur 30 j"
        pistes={[piste({ marqueurs: [marqueur({}), marqueur({ livre: false, acquitte: false })] })]}
      />,
    );
    expect(html).toContain('data-etat="partiel"');
    expect(texte(html)).toContain("2 000 déclenchements affichés sur 30 j");
    expect(html).toContain('data-testid="alternative"');
    expect(texte(html)).toContain("LCP /checkout 2 1 1 07/09 00:00 UTC Franchie");
  });

  it("aucune piste : état vide", () => {
    const html = renderToStaticMarkup(<FriseDeclenchements debut={DEBUT} fin={FIN} pistes={[]} />);
    expect(html).toContain('data-etat="vide"');
  });

  it("livraison : livré prime, puis en attente, sinon non livré", () => {
    expect(livraison({ livre: true, enAttente: true })).toBe("livré");
    expect(livraison({ livre: false, enAttente: true })).toBe("en attente");
    expect(livraison({ livre: false, enAttente: false })).toBe("non livré");
    expect(texteMarqueur(marqueur({}))).toContain("critique, livré, acquitté");
  });
});
