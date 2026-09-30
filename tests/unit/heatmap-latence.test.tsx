// Vague 3b — la heatmap de latence (A2 § 6.2) : tranches logarithmiques, part
// normalisée PAR HEURE, case sans mesure vide, colonne faible hachurée, p75 lue sur
// les mêmes seaux.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HeatmapLatence } from "@/components/vue-ensemble/HeatmapLatence";
import { seau } from "@/lib/histogramme";
import { BORNES_HEATMAP, bornesTranches, construireHeatmap, positionLog, TRANCHES, trancheDe, VITAUX_HEATMAP } from "@/lib/heatmap-latence";
import { histogrammesHoraires } from "@/lib/queries-heatmap";
import { parseAnalyticsQuery } from "@/lib/query-contract";
import { THRESHOLDS } from "@/lib/rating";

const base = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock("@/lib/db", () => ({ q: base.q }));

const H = 3_600_000;
const T0 = Date.parse("2026-09-29T08:00:00Z");
const GRILLE = [0, 1, 2].map((i) => new Date(T0 + i * H).toISOString());

describe("tranches", () => {
  const b = bornesTranches(100, 20_000);
  it("25 bornes logarithmiques de 100 ms à 20 s", () => {
    expect(b).toHaveLength(TRANCHES + 1);
    expect(b[0]).toBe(100);
    expect(b[TRANCHES]).toBeCloseTo(20_000, 6);
    expect(b[1] / b[0]).toBeCloseTo(b[13] / b[12], 9);
  });
  it("une valeur hors bornes tombe dans la tranche extrême, jamais hors de la grille", () => {
    expect(trancheDe(10, b)).toBe(0);
    expect(trancheDe(60_000, b)).toBe(TRANCHES - 1);
    expect(trancheDe(2_500, b)).toBeGreaterThan(trancheDe(1_000, b));
    expect(positionLog(100, b)).toBe(0);
    expect(positionLog(20_000, b)).toBe(1);
  });
});

describe("construireHeatmap", () => {
  const lignes = [
    // Heure 0 : chargée (1 000 mesures), tout à ~1 s.
    { heure: GRILLE[0], bucket: seau(1_000), poids: 1_000, mesures: 1_000 },
    // Heure 1 : 10 mesures, moitié ~1 s, moitié ~5 s.
    { heure: GRILLE[1], bucket: seau(1_000), poids: 5, mesures: 5 },
    { heure: GRILLE[1], bucket: seau(5_000), poids: 5, mesures: 5 },
  ];
  const h = construireHeatmap("LCP", GRILLE, lignes)!;

  it("la part est normalisée par heure : l'heure chargée n'écrase pas l'heure creuse", () => {
    const k1 = trancheDe(1_000, h.bornes);
    expect(h.colonnes[0].parts[k1]).toBe(1);
    expect(h.colonnes[1].parts[k1]).toBeCloseTo(0.5, 9);
    expect(h.partMax).toBe(1);
  });
  it("une case sans mesure est vide (null), une heure sans ligne est une colonne vide", () => {
    expect(h.colonnes[0].parts.filter((p) => p === null)).toHaveLength(TRANCHES - 1);
    expect(h.colonnes[2]).toMatchObject({ n: 0, p75: null, faible: false });
    expect(h.colonnes[2].parts.every((p) => p === null)).toBe(true);
  });
  it("sous 13 mesures, la colonne est faible ; la p75 se lit sur les seaux de l'heure", () => {
    expect(h.colonnes[0].faible).toBe(false);
    expect(h.colonnes[1].faible).toBe(true);
    expect(h.colonnes[1].p75).toBeGreaterThan(4_900);
    expect(h.colonnes[0].p75).toBeCloseTo(1_000, -1);
  });
  it("un vital sans bornes (CLS) n'a pas de heatmap", () => {
    expect(construireHeatmap("CLS", GRILLE, [])).toBeNull();
  });
  it("le rendu : une case par tranche mesurée, une colonne hachurée, la p75 et les seuils, la légende 0 % → part max", () => {
    const html = renderToStaticMarkup(<HeatmapLatence heatmap={h} plage="24 dernières heures" />);
    expect((html.match(/<rect x=/g) ?? []).length).toBe(1 + 2 + 1);
    expect(html).toContain("data-faible");
    expect(html).toContain("<polyline");
    expect(html).toContain("0 %");
    expect(html).toContain("100 % des mesures de l&#x27;heure");
    expect(html).toContain("seuils web.dev");
  });
});

// ───────────── Le choix du vital (suite du 30/09/2026) ─────────────

describe("le choix du vital : LCP, INP, FCP, TTFB — le CLS exclu", () => {
  // Une lecture de plusieurs vitaux : chaque ligne dit le sien.
  const lignes = [
    { vital: "LCP", heure: GRILLE[0], bucket: seau(2_000), poids: 40, mesures: 40 },
    { vital: "INP", heure: GRILLE[0], bucket: seau(150), poids: 20, mesures: 20 },
    { vital: "INP", heure: GRILLE[1], bucket: seau(600), poids: 20, mesures: 20 },
    { vital: "TTFB", heure: GRILLE[2], bucket: seau(900), poids: 30, mesures: 30 },
  ];
  const h = construireHeatmap("LCP", GRILLE, lignes)!;

  it("VITAUX_HEATMAP : les quatre vitaux à durée, le CLS n'y est pas (score sans unité)", () => {
    expect([...VITAUX_HEATMAP]).toEqual(["LCP", "INP", "FCP", "TTFB"]);
    expect(VITAUX_HEATMAP).not.toContain("CLS");
    for (const v of VITAUX_HEATMAP) expect(BORNES_HEATMAP[v]).toBeDefined();
  });

  it("une heatmap par vital, dans l'ordre du sélecteur, chacune sur SES lignes et SES bornes", () => {
    expect(h.vital).toBe("LCP");
    expect(h.choix?.map((c) => c.vital)).toEqual(["LCP", "INP", "FCP", "TTFB"]);
    const [lcp, inp, fcp, ttfb] = h.choix!;
    expect(lcp.colonnes.map((c) => c.n)).toEqual([40, 0, 0]);
    expect(inp.colonnes.map((c) => c.n)).toEqual([20, 20, 0]);
    expect(inp.bornes[0]).toBe(BORNES_HEATMAP.INP.bas);
    // Un vital sans ligne reste proposé : une heatmap vide, pas un retrait silencieux.
    expect(fcp.colonnes.every((c) => c.n === 0)).toBe(true);
    expect(ttfb.colonnes.map((c) => c.n)).toEqual([0, 0, 30]);
    // La heatmap affichée d'abord est celle du vital demandé, sans les lignes des autres.
    expect(h.colonnes.map((c) => c.n)).toEqual([40, 0, 0]);
  });

  it("le vital demandé ouvre la carte, même s'il n'est pas le premier du sélecteur", () => {
    const i = construireHeatmap("INP", GRILLE, lignes)!;
    expect(i.vital).toBe("INP");
    expect(i.choix?.map((c) => c.vital)).toEqual(["LCP", "INP", "FCP", "TTFB"]);
  });

  it("une lecture d'un seul vital (lignes sans `vital`) : pas de choix, la carte d'origine", () => {
    const seul = construireHeatmap("LCP", GRILLE, [{ heure: GRILLE[0], bucket: seau(1_000), poids: 5, mesures: 5 }])!;
    expect(seul.choix).toBeUndefined();
    const html = renderToStaticMarkup(<HeatmapLatence heatmap={seul} plage="24 dernières heures" />);
    expect(html).not.toContain('type="radio"');
    expect(html).toContain("Heatmap de latence LCP");
  });

  describe("le rendu", () => {
    const html = renderToStaticMarkup(<HeatmapLatence heatmap={h} plage="24 dernières heures" />);
    const panneau = (v: string) => {
      const debut = html.indexOf(`data-vital-panneau="${v}"`);
      const fin = html.indexOf("data-vital-panneau=", debut + 1);
      return html.slice(debut, fin < 0 ? undefined : fin);
    };

    it("un groupe de boutons radio natifs, nommé, le vital demandé coché", () => {
      expect(html).toContain('<fieldset class="relative');
      expect(html).toContain('<legend class="sr-only">Vital affiché dans la heatmap</legend>');
      // L'ordre des attributs est celui du rendu : on lit chaque entrée en entier.
      const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
      const valeur = (r: string) => r.match(/value="(\w+)"/)?.[1];
      expect(radios.map(valeur)).toEqual(["LCP", "INP", "FCP", "TTFB"]);
      expect(radios.every((r) => r.includes('name="heatmap-vital"'))).toBe(true);
      expect(radios.filter((r) => /\bchecked=""/.test(r)).map(valeur)).toEqual(["LCP"]);
      // Masquée à la vue seulement : un `sr-only` dans un parent positionné.
      expect(radios.every((r) => r.includes("sr-only"))).toBe(true);
      expect(html).toMatch(/<label class="relative [^"]*"><input[^>]*type="radio"/);
      expect(html).not.toContain(">CLS<");
    });

    it("un dessin par vital ; sans CSS `:has`, seul celui du vital coché est affiché", () => {
      const panneaux = [...html.matchAll(/data-vital-panneau="(\w+)" class="(\w+) min-w-0"/g)].map((m) => [m[1], m[2]]);
      expect(panneaux).toEqual([
        ["LCP", "block"],
        ["INP", "hidden"],
        ["FCP", "hidden"],
        ["TTFB", "hidden"],
      ]);
      // Les règles du choix sont écrites en entier (compilateur Tailwind), une par vital.
      for (const v of VITAUX_HEATMAP) expect(html).toContain(`[&amp;:has([data-vital-choix=${v}]:checked)_[data-vital-panneau=${v}]]:block`);
    });

    it("chaque dessin garde les seuils web.dev de SON vital (lib/rating.ts)", () => {
      for (const v of ["LCP", "INP", "TTFB"]) {
        const [bon, mauvais] = THRESHOLDS[v];
        expect(panneau(v)).toContain(`data-seuil="${bon}"`);
        expect(panneau(v)).toContain(`data-seuil="${mauvais}"`);
        expect(panneau(v)).toContain(`seuils web.dev du ${v}`);
      }
    });

    it("un vital sans mesure le dit dans son panneau, le sélecteur reste", () => {
      expect(panneau("FCP")).not.toContain("<svg");
      expect(panneau("FCP")).toContain("mesure FCP agrégée par heure");
    });

    it("une alternative textuelle par vital dessiné, le CLS dit exclu, aucun identifiant en double", () => {
      expect(html).toContain("Alternative textuelle — LCP");
      expect(html).toContain("Alternative textuelle — INP");
      expect(html).toContain("Le CLS n&#x27;est pas proposé");
      const motifs = [...html.matchAll(/<pattern id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(motifs).size).toBe(motifs.length);
    });
  });
});

describe("histogrammesHoraires : les quatre vitaux d'une requête, chaque ligne dit le sien", () => {
  it("le vital demandé d'abord, puis les autres ; `vital` recopié de `name`", async () => {
    base.q.mockResolvedValueOnce([{ name: "INP", hour: new Date(T0), bucket: seau(200), poids: 3, mesures: 3 }]);
    const p = parseAnalyticsQuery(new URLSearchParams("app=demo-app&period=24h"), { principal: { role: "admin", apps: null }, nowMs: Date.now() });
    if (!p.ok) throw new Error(p.error.code);
    const lu = await histogrammesHoraires(p.value, "LCP");
    expect(base.q.mock.calls[0][1][1]).toEqual(["LCP", "INP", "FCP", "TTFB"]);
    expect(lu).toEqual({
      etat: "ok",
      app: "demo-app",
      lignes: [{ vital: "INP", heure: new Date(T0).toISOString(), bucket: seau(200), poids: 3, mesures: 3 }],
    });
  });
});
