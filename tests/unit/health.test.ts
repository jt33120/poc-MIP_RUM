// F11 — composante « Erreurs navigateur » du score de santé (lib/health.ts, CP14).
//
// L'ancien facteur « Erreurs JS » divisait TOUTES les occurrences (serveur
// comprises) par les pages vues, et donnait 0 point sans page vue dès qu'une erreur
// existait. Le nouveau : occurrences navigateur seulement, aucun score sans
// dénominateur, et un détail chiffré « N occurrences pour P pages vues (x pour 100) ».
import { describe, expect, it } from "vitest";
import { facteurErreurs } from "../../apps/console/lib/health";

const espaces = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("facteurErreurs", () => {
  it("renommé « Erreurs navigateur », sur 30 points", () => {
    const f = facteurErreurs({ occurrences: 0, pageviews: 10, restreint: true });
    expect(f).toMatchObject({ key: "errors", label: "Erreurs navigateur", max: 30, earned: 30 });
  });

  it("0 page vue → hors du score (earned null), même avec des erreurs", () => {
    const f = facteurErreurs({ occurrences: 12, pageviews: 0, restreint: true });
    expect(f.earned).toBeNull();
    expect(f.detail).toBe("aucune page vue : ratio non calculable");
    // Pas de raison courte : la jauge écrit « n/a », le détail (visible) explique.
    expect(f.raisonNull).toBeUndefined();
  });

  it("détail : « N occurrences pour P pages vues (x pour 100) », jamais un pourcentage", () => {
    const f = facteurErreurs({ occurrences: 30, pageviews: 20, restreint: true });
    expect(espaces(f.detail)).toBe("30 occurrence(s) pour 20 page(s) vue(s) (150 pour 100)");
    expect(f.detail).not.toContain("%");
    // Plus d'occurrences que de vues : plancher à 0, jamais négatif.
    expect(f.earned).toBe(0);
  });

  it("points : 30 × (1 − occurrences / vues)", () => {
    expect(facteurErreurs({ occurrences: 1, pageviews: 4, restreint: true }).earned).toBe(22.5);
  });

  it("sans la colonne de source (v69) : toutes sources, et le détail le dit", () => {
    const f = facteurErreurs({ occurrences: 2, pageviews: 10, restreint: false });
    expect(f.detail).toContain("toutes sources : colonne de source absente");
  });
});
