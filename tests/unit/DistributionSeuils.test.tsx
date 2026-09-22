// DistributionSeuils (F05, plan § 4.2, P2, P7) et ContrastBars : la forme avec ses
// repères, la barre « ≥ plafond » dite, l'absence dite ; et une figure de contraste
// qui dit « non disponible » plutôt que de dessiner des zéros.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContrastBars, ordonnerContraste, rapport } from "@/components/charts/ContrastBars";
import { DistributionSeuils, bacsDeHistogramme } from "@/components/charts/DistributionSeuils";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

describe("bacsDeHistogramme", () => {
  it("20 bacs linéaires + le bac « ≥ plafond » ; un bac absent vaut 0", () => {
    const bacs = bacsDeHistogramme(
      [
        { bucket: 0, count: 1 },
        { bucket: 1, count: 4 },
        { bucket: 5, count: 7 },
        { bucket: 21, count: 3 },
      ],
      6000,
    );
    expect(bacs).toHaveLength(21);
    expect(bacs[0]).toEqual({ debut: 0, fin: 300, n: 5 });
    expect(bacs[4]).toEqual({ debut: 1200, fin: 1500, n: 7 });
    expect(bacs[1].n).toBe(0);
    expect(bacs[20]).toEqual({ debut: 6000, fin: Number.POSITIVE_INFINITY, n: 3 });
  });
});

describe("DistributionSeuils", () => {
  const bacs = bacsDeHistogramme(
    Array.from({ length: 21 }, (_v, i) => ({ bucket: i + 1, count: i === 20 ? 9 : 10 + i })),
    6000,
  );
  const n = bacs.reduce((s, b) => s + b.n, 0);

  it("repères p50 / p75 / p95 étiquetés ; la barre « ≥ plafond » est dite", () => {
    const html = renderToStaticMarkup(
      <DistributionSeuils vital="LCP" bacs={bacs} plafond={6000} percentiles={{ p50: 2100, p75: 2900, p95: 5200 }} n={n} />,
    );
    for (const r of ["p50", "p75", "p95"]) expect(html).toContain(`data-repere="${r}"`);
    expect(texte(html)).toContain("p75 2,9 s");
    expect(texte(html)).toContain("9 mesure(s) ≥ 6,0 s");
    // Une barre à cheval sur 2,5 s (bac 2 400-2 700) est coupée en deux morceaux.
    expect(texte(html).match(/2,4 s – 2,7 s : /g)).toHaveLength(2);
    expect(html).toContain('data-testid="alternative"');
  });

  it("percentiles null : aucun repère, « percentiles non calculables »", () => {
    const html = renderToStaticMarkup(<DistributionSeuils vital="LCP" bacs={bacs} plafond={6000} percentiles={null} n={n} />);
    expect(html).not.toContain("data-repere");
    expect(texte(html)).toContain("Percentiles non calculables");
  });

  it("n = 0 : état vide, aucun dessin", () => {
    const html = renderToStaticMarkup(<DistributionSeuils vital="INP" bacs={[]} plafond={1000} percentiles={null} n={0} />);
    expect(html).not.toContain("<svg");
    expect(texte(html)).toContain("Aucune mesure INP");
  });
});

describe("ContrastBars", () => {
  it("B3 manquant : « Non disponible, raison : … », aucune barre ni zéro", () => {
    const html = renderToStaticMarkup(
      <ContrastBars
        dimensionLibelle="Navigateur"
        populationTouchee="sessions avec cette erreur"
        populationBase="toutes les sessions"
        lignes={[]}
        indisponible="dénominateurs par navigateur pas encore lus (B3)"
      />,
    );
    expect(texte(html)).toContain("Non disponible, raison : dénominateurs par navigateur pas encore lus (B3)");
    expect(html).toContain('data-etat="indisponible"');
    expect(texte(html)).not.toMatch(/\b0 %|× /);
  });

  it("rapport des parts ; sans part de base, pas de rapport", () => {
    expect(rapport({ partTouches: 0.6, partBase: 0.25 })).toBeCloseTo(2.4);
    expect(rapport({ partTouches: 0.6, partBase: null })).toBeNull();
    expect(rapport({ partTouches: 0.6, partBase: 0 })).toBeNull();
  });

  it("classé par rapport à partir de 10 touchés ; les autres et « Inconnu » en fin", () => {
    const l = (valeur: string, nTouches: number, partTouches: number, partBase: number | null) => ({
      valeur,
      nTouches,
      nBase: 100,
      partTouches,
      partBase,
      href: "#",
    });
    const ordre = ordonnerContraste([
      l("rare", 4, 0.5, 0.01),
      l("Inconnu", 50, 0.5, 0.01),
      l("x1,2", 30, 0.3, 0.25),
      l("x2,4", 20, 0.6, 0.25),
      l("sans-base", 40, 0.2, null),
    ]);
    expect(ordre.map((x) => x.valeur)).toEqual(["x2,4", "x1,2", "rare", "Inconnu", "sans-base"]);
  });
});
