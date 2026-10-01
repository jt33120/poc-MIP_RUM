// La carte des pages (30/09/2026) : un découpage « squarified » dont les aires sont
// proportionnelles aux volumes, sans chevauchement, et un verdict non établi en gris.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CartePages, decouper } from "@/components/charts/CartePages";

describe("decouper — squarified", () => {
  const volumes = [600, 300, 200, 120, 60, 30, 10];
  const r = decouper(volumes, 1000, 260);

  it("des aires proportionnelles aux volumes, et le cadre entièrement pavé", () => {
    const total = volumes.reduce((a, b) => a + b, 0);
    r.forEach((x, i) => expect(x.w * x.h).toBeCloseTo((volumes[i] / total) * 1000 * 260, 3));
    expect(r.reduce((a, x) => a + x.w * x.h, 0)).toBeCloseTo(1000 * 260, 3);
  });

  it("tout dans le cadre, aucun chevauchement", () => {
    for (const x of r) {
      expect(x.x).toBeGreaterThanOrEqual(-1e-6);
      expect(x.y).toBeGreaterThanOrEqual(-1e-6);
      expect(x.x + x.w).toBeLessThanOrEqual(1000 + 1e-6);
      expect(x.y + x.h).toBeLessThanOrEqual(260 + 1e-6);
    }
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i], b = r[j];
        const inter = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        expect(inter).toBeLessThan(1e-6);
      }
  });

  it("un volume nul n'a pas de place ; rien à découper : des rectangles vides", () => {
    expect(decouper([10, 0], 100, 100)[1]).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(decouper([0, 0], 100, 100).every((x) => x.w === 0)).toBe(true);
  });
});

describe("CartePages — rendu", () => {
  it("couleur = verdict établi, gris sinon ; un lien par route ; légende des seuils", () => {
    const html = renderToStaticMarkup(
      <CartePages
        elements={[
          { cle: "a", libelle: "/checkout", volume: 500, texteValeur: "4,8 s", verdict: "poor", href: "/pages?panel=route:%2Fcheckout" },
          { cle: "b", libelle: "/", volume: 300, texteValeur: "1,9 s", verdict: "good" },
          { cle: "c", libelle: "/aide", volume: 100, texteValeur: "2,7 s", verdict: null },
        ]}
      />,
    );
    expect(html).toContain("fill-bad/60");
    expect(html).toContain("fill-good/60");
    expect(html).toContain("fill-ink-faint/25");
    expect(html).toContain('href="/pages?panel=route:%2Fcheckout"');
    expect(html).toContain("seuils web.dev");
    expect(html).toContain("/checkout");
  });
});
