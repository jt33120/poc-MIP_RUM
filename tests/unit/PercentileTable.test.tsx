// PercentileTable (components/Distribution.tsx) — P*.1 : le p75 de `/pages` ne se
// teinte que si son verdict tient sur tout l'intervalle à 95 %, et l'intervalle
// (ou la raison de son absence) est écrit dans sa colonne.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PercentileTable } from "@/components/Distribution";

const texte = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ");

const ligne = (p75: number, n: number, intervalle?: Parameters<typeof PercentileTable>[0]["rows"][number]["intervalle"]) => ({
  name: "LCP",
  pcts: [1500, p75, 3500, 4200, 6000],
  n,
  intervalle,
});

describe("PercentileTable — intervalle du p75 (P*.1)", () => {
  it("intervalle dans une zone : verdict teinté, intervalle écrit", () => {
    const html = renderToStaticMarkup(
      <PercentileTable rows={[ligne(2000, 400, { bas: 1900, haut: 2200, niveau: 0.95, methode: "quantile_normal" })]} />,
    );
    expect(html).toContain("text-good-ink");
    expect(texte(html)).toContain("entre 1,90 s et 2,20 s (95 %)");
    expect(html).toContain("Intervalle p75 (95 %)");
  });

  it("intervalle qui chevauche 2,5 s : « verdict incertain », aucune teinte", () => {
    const html = renderToStaticMarkup(
      <PercentileTable rows={[ligne(2400, 40, { bas: 2100, haut: 3000, niveau: 0.95, methode: "quantile_normal" })]} />,
    );
    expect(html).not.toMatch(/text-(good|warn|bad)-ink/);
    expect(texte(html)).toContain("verdict incertain : entre Bon et À améliorer");
  });

  it("moins de 13 mesures : « intervalle non calculable », verdict non établi, aucune teinte", () => {
    const html = renderToStaticMarkup(<PercentileTable rows={[ligne(2000, 7, { indisponible: "7 mesures, 13 requises" })]} />);
    expect(html).not.toMatch(/text-(good|warn|bad)-ink/);
    const t = texte(html);
    expect(t).toContain("intervalle non calculable : 7 mesures, 13 requises");
    expect(t).toContain("verdict non établi (7 mesures, 13 requises)");
  });

  it("sans intervalle fourni : la table d'avant (pas de colonne, verdict du p75)", () => {
    const html = renderToStaticMarkup(<PercentileTable rows={[ligne(2000, 400)]} />);
    expect(html).not.toContain("Intervalle p75");
    expect(html).toContain("text-good-ink");
  });
});
