// VitalCard (F03, plan § 4.1) : fenêtre écrite, jauge décrite pour qui ne la voit
// pas, sparkline de la p75, carte-lien à un seul arrêt de tabulation. La logique du
// verdict et de l'intervalle (P*.1) est testée dans vital-card.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VitalCard } from "@/components/VitalCard";

const texte = (s: string) => s.replace(/&#x27;/g, "'").replace(/[\u00a0\u202f]/g, " ");

describe("VitalCard", () => {
  it("la fenêtre passée est celle écrite sous la valeur", () => {
    const html = renderToStaticMarkup(<VitalCard name="LCP" p75={2700} n={1240} periodLabel="7 j" />);
    expect(html.replace(/<!-- -->/g, "")).toContain("p75 · 1240 mesures · 7 j");
  });

  it("la jauge des seuils est une image décrite : valeur et seuils de THRESHOLDS", () => {
    const html = renderToStaticMarkup(<VitalCard name="LCP" p75={2700} n={1240} periodLabel="24 h" />);
    const aria = /data-testid="meter-LCP" role="img" aria-label="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(texte(aria)).toBe("Jauge des seuils : p75 2,70 s ; bon ≤ 2,5 s, mauvais au-delà de 4,0 s");
  });

  it("serie → sparkline avec la bande « Bon »", () => {
    const html = renderToStaticMarkup(
      <VitalCard name="LCP" p75={2700} n={1240} periodLabel="24 h" serie={[2300, null, 2700]} />,
    );
    expect(html).toContain('data-testid="sparkline"');
    expect(html).toContain('data-bande="bon"');
  });

  it("href : la carte est un seul lien, sans bouton d'aide imbriqué", () => {
    const html = renderToStaticMarkup(
      <VitalCard name="LCP" p75={2700} n={1240} periodLabel="24 h" href="/pages?vital=LCP" />,
    );
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("<button");
    expect(html).toMatch(/<a [^>]*aria-label="LCP p75 2,70 s, À améliorer, 1240 mesures"/);
  });

  it("sans href : la bulle d'aide reste", () => {
    const html = renderToStaticMarkup(<VitalCard name="LCP" p75={2700} n={1240} periodLabel="24 h" />);
    expect(html).not.toContain("<a ");
    expect(html).toContain("<button");
  });
});
