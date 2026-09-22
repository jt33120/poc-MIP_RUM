// EtenduePercentiles (F38, plan § 4.2) : une extrémité inconnue n'a pas de
// moustache et le dit ; aucune couleur de verdict ; alternative tabulaire.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EtenduePercentiles } from "@/components/charts/EtenduePercentiles";
import { RATING_HEX } from "@/lib/palette";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

describe("EtenduePercentiles", () => {
  it("p95 null → pas de moustache droite, « p95 non calculable » écrit", () => {
    const html = renderToStaticMarkup(
      <EtenduePercentiles format="ms" lignes={[{ libelle: "À froid", n: 42, p50: 620, p75: 800, p95: null }]} />,
    );
    expect(html).not.toContain('data-testid="etendue-p95"');
    expect(html).toContain('data-testid="etendue-p50"');
    expect(html).toContain('data-testid="etendue-p75"');
    expect(texte(html)).toContain("p95 non calculable");
    // L'alternative le dit aussi, sans inventer de valeur.
    expect(texte(html)).toMatch(/Alternative textuelle/);
  });

  it("p50 null → pas de moustache gauche ; l'étendue part du p75", () => {
    const html = renderToStaticMarkup(
      <EtenduePercentiles format="ms" lignes={[{ libelle: "À chaud", n: 40, p50: null, p75: 300, p95: 900 }]} />,
    );
    expect(html).not.toContain('data-testid="etendue-p50"');
    expect(html).toContain('data-testid="etendue-p95"');
    expect(texte(html)).toContain("p50 non calculable");
  });

  it("aucune mesure → « Non mesuré », aucun dessin, jamais « 0 ms »", () => {
    const html = renderToStaticMarkup(
      <EtenduePercentiles format="ms" lignes={[{ libelle: "À chaud", n: 0, p50: null, p75: null, p95: null }]} />,
    );
    expect(html).toContain('data-testid="etendue-non-mesure"');
    expect(html).not.toContain("<rect");
    expect(texte(html)).not.toMatch(/À chaud 0 ms/);
  });

  it("sous faibleSous mesures : « échantillon faible »", () => {
    const html = renderToStaticMarkup(
      <EtenduePercentiles format="ms" lignes={[{ libelle: "À froid", n: 12, p50: 600, p75: 700, p95: 900 }]} />,
    );
    expect(texte(html)).toContain("échantillon faible");
  });

  it("aucune couleur de verdict : ni vert, ni ambre, ni rouge des seuils", () => {
    const html = renderToStaticMarkup(
      <EtenduePercentiles
        format="ms"
        lignes={[
          { libelle: "À froid", n: 42, p50: 620, p75: 800, p95: 5200 },
          { libelle: "À chaud", n: 40, p50: 100, p75: 150, p95: 400 },
        ]}
      />,
    );
    for (const hex of Object.values(RATING_HEX)) expect(html.toLowerCase()).not.toContain(hex.toLowerCase());
    // Axe commun : deux étendues dans le même composant, une alternative à deux lignes.
    expect(html.match(/data-testid="etendue-ligne"/g)).toHaveLength(2);
  });
});
