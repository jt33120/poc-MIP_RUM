// Le glossaire LIT ses seuils de Web Vitals dans lib/rating.ts (F00). Il a
// longtemps annoncé « bon < 2,0 s » pour le LCP pendant que l'écran colorait à
// 2,5 s : ce test change la borne en mémoire et vérifie que le texte suit.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fmtBorne } from "../../apps/console/lib/format";

const RATING = "../../apps/console/lib/rating";
const GLOSSAIRE = "../../apps/console/lib/glossary";

afterEach(() => vi.resetModules());

describe("fmtBorne", () => {
  it("écrit une borne comme un texte la lit", () => {
    expect(fmtBorne("LCP", 2500)).toBe("2,5 s");
    expect(fmtBorne("LCP", 4000)).toBe("4,0 s");
    expect(fmtBorne("FCP", 1800)).toBe("1,8 s");
    expect(fmtBorne("INP", 200)).toBe("200 ms");
    expect(fmtBorne("TTFB", 800)).toBe("800 ms");
    expect(fmtBorne("CLS", 0.1)).toBe("0,1");
    expect(fmtBorne("CLS", 0.25)).toBe("0,25");
  });
});

describe("glossaire des Web Vitals", () => {
  it("chaque vital cite les deux bornes de THRESHOLDS, « bon » inclusif", async () => {
    const { THRESHOLDS, CORE_VITALS } = await import(RATING);
    const { GLOSSARY } = await import(GLOSSAIRE);
    for (const name of CORE_VITALS as string[]) {
      const [bon, mauvais] = THRESHOLDS[name];
      const term: string = GLOSSARY[name].term;
      expect(term, name).toContain(`bon ≤ ${fmtBorne(name, bon)}`);
      expect(term, name).toContain(`mauvais au-delà de ${fmtBorne(name, mauvais)}`);
      expect(term, name).not.toContain("2026");
    }
    expect(GLOSSARY.LCP.term).not.toContain("2,0 s");
  });

  it("suit une borne changée en mémoire : rien n'est recopié", async () => {
    const { THRESHOLDS } = await import(RATING);
    const avant = THRESHOLDS.LCP;
    THRESHOLDS.LCP = [3000, 5000];
    try {
      // Premier import du glossaire dans ce registre de modules : il est évalué
      // APRÈS la mutation, sur la même instance de lib/rating.ts.
      const { GLOSSARY } = await import(GLOSSAIRE);
      expect(GLOSSARY.LCP.term).toContain("bon ≤ 3,0 s, mauvais au-delà de 5,0 s");
      expect(GLOSSARY.LCP.business).toContain("Au-delà de 3,0 s");
      expect(GLOSSARY.forecast.term).toContain("borne « Bon » du LCP (3,0 s)");
    } finally {
      THRESHOLDS.LCP = avant;
    }
  });
});
