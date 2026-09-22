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

// P*.1 — la jauge porte la moustache de l'intervalle, et un écart dont les deux
// intervalles se chevauchent n'a ni flèche ni couleur.
describe("VitalCard — intervalle et écart (P*.1)", () => {
  const iv = (bas: number, haut: number) => ({ bas, haut, niveau: 0.95 as const, methode: "quantile_normal" as const });
  const propre = (html: string) => texte(html.replace(/<!-- -->/g, "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("moustache aux bornes de l'intervalle, sur l'échelle warn × 1,4", () => {
    const html = renderToStaticMarkup(<VitalCard name="LCP" p75={2000} n={40} periodLabel="24 h" intervalle={iv(1800, 2240)} />);
    // max = 4 000 × 1,4 = 5 600 ms : 1 800 → 32,14 %, 2 240 → 40 %.
    const style = /style="left:([\d.]+)%;width:([\d.]+)%"[^>]*data-testid="moustache-LCP"/.exec(html);
    expect(style).not.toBeNull();
    expect(Number(style![1])).toBeCloseTo(32.14, 1);
    expect(Number(style![2])).toBeCloseTo(40 - 32.14, 1);
  });

  it("intervalle indisponible : pas de moustache, pas de couleur de verdict", () => {
    const html = renderToStaticMarkup(
      <VitalCard name="LCP" p75={2000} n={7} periodLabel="24 h" intervalle={{ indisponible: "7 mesures, 13 requises" }} />,
    );
    expect(html).not.toContain("moustache-LCP");
    expect(html).not.toMatch(/text-(good|warn|bad)-ink border/);
    expect(propre(html)).toContain("intervalle non calculable : 7 mesures, 13 requises");
  });

  it("écart non établi : delta écrit sans badge coloré, avec l'intervalle précédent", () => {
    const html = renderToStaticMarkup(
      <VitalCard
        name="LCP"
        p75={2200}
        prev={2000}
        n={40}
        periodLabel="24 h"
        intervalle={iv(1900, 2500)}
        ecart={{ etabli: false, regle: "écart non établi : intervalles à 95 % qui se chevauchent (période précédente entre 1,80 s et 2,30 s)" }}
      />,
    );
    expect(html).toContain('data-etabli="non"');
    expect(html).not.toContain('data-testid="delta"');
    expect(propre(html)).toContain("+10 % vs période précédente — écart non établi : intervalles à 95 % qui se chevauchent (période précédente entre 1,80 s et 2,30 s)");
  });

  it("écart établi (ou non fourni) : le badge de delta habituel", () => {
    const html = renderToStaticMarkup(
      <VitalCard name="LCP" p75={2200} prev={1000} n={40} periodLabel="24 h" ecart={{ etabli: true, regle: "disjoints" }} />,
    );
    expect(html).not.toContain('data-etabli="non"');
    expect(html).toContain('data-testid="trend"');
  });
});
