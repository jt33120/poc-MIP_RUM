// La vitrine des composants est une page de développement (recette du 26/09/2026) :
// jamais servie en production, toujours en aperçu, en CI et en local.
import { describe, expect, it } from "vitest";
import { vitrineOuverte } from "../../apps/console/lib/vitrine-composants";

describe("vitrineOuverte", () => {
  it("fermée sur le déploiement de production", () => {
    expect(vitrineOuverte({ VERCEL_ENV: "production" })).toBe(false);
  });

  it("ouverte en aperçu, en CI et en local", () => {
    expect(vitrineOuverte({ VERCEL_ENV: "preview" })).toBe(true);
    expect(vitrineOuverte({ VERCEL_ENV: "development" })).toBe(true);
    expect(vitrineOuverte({})).toBe(true);
  });
});
