// Couche d'annotations des séries (recette du 26/09/2026) : trois alertes au même
// instant partagent UNE étiquette, chaque trait reste à son instant, et le détail
// reste dans l'infobulle.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoucheAnnotations, margeHauteAnnotations } from "@/components/charts/ThresholdSeries";
import { placerAnnotations, type Annotation } from "@/lib/series";

const HEURE = 3_600_000;
const GRILLE = Array.from({ length: 24 }, (_v, i) => new Date(Date.parse("2026-09-26T00:00:00Z") + i * HEURE).toISOString());
// Échelle en bandes de 20 px, comme celle que recharts passe à `Customized`.
const echelle = Object.assign((t: string) => 56 + GRILLE.indexOf(t) * 20, { bandwidth: () => 20 });

function rendu(annotations: Annotation[]) {
  const placees = placerAnnotations(annotations, GRILLE, 3600, "Europe/Paris");
  return renderToStaticMarkup(
    <svg>
      <CoucheAnnotations
        placees={placees}
        grille={GRILLE}
        fuseau="Europe/Paris"
        onAller={() => {}}
        xAxisMap={{ x: { scale: echelle } }}
        offset={{ top: 32, height: 150, left: 56, width: 480 }}
      />
    </svg>,
  );
}

describe("CoucheAnnotations", () => {
  it("trois alertes à 14:14 : une étiquette « 3 alertes à 14:14 », trois traits, le détail en infobulle", () => {
    const t = "2026-09-26T12:14:00Z";
    const html = rendu([
      { t, libelle: "Alerte log_errors", type: "alerte", href: "/alerts?evt=1" },
      { t, libelle: "Alerte error_rate", type: "alerte", href: "/alerts?evt=2" },
      { t, libelle: "Alerte LCP", type: "alerte", href: "/alerts?evt=3" },
    ]);
    expect(html.match(/<text/g)).toHaveLength(1);
    expect(html).toContain("3 alertes à 14:14");
    expect(html.match(/<line/g)).toHaveLength(3);
    expect(html).toContain("<title>Alerte log_errors · Alerte error_rate · Alerte LCP</title>");
    expect(html).toContain('data-groupe="3"');
  });

  it("deux annotations éloignées gardent leur libellé et leur lien", () => {
    const html = rendu([
      { t: "2026-09-26T02:00:00Z", libelle: "v1.4.1", type: "deploiement", href: "/?cmp=release" },
      { t: "2026-09-26T20:00:00Z", libelle: "v1.4.2", type: "deploiement", href: "/?cmp=release2" },
    ]);
    expect(html).toContain(">v1.4.1</text>");
    expect(html).toContain(">v1.4.2</text>");
    expect(html.match(/<a /g)).toHaveLength(2);
  });

  it("marge haute : une rangée d'étiquettes pour une annotation, deux au-delà", () => {
    expect(margeHauteAnnotations(0)).toBe(8);
    expect(margeHauteAnnotations(1)).toBe(20);
    expect(margeHauteAnnotations(3)).toBe(32);
  });
});
