// F01 — la couleur porte un sens, un seul (principe P15 du plan).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTRES,
  CATEGORIELLE,
  DIVERGENTE,
  PALIERS_SEQUENTIELLE,
  PALIERS_SEQUENTIELLE_JETONS,
  RATING_HEX,
  RATING_JETON,
  SEQUENTIELLE,
  SERIE,
  SEVERITE,
  sequentielleJeton,
} from "../../apps/console/lib/palette";

/** OKLab (Ottosson 2020) d'une couleur #rrggbb : pour la chroma et les écarts perçus. */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const chroma = (hex: string) => {
  const [, a, b] = oklab(hex);
  return Math.hypot(a, b);
};
const ecartOklab = (x: string, y: string) => {
  const [p, q] = [oklab(x), oklab(y)];
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** Luminance relative WCAG d'une couleur #rrggbb ou d'un triplet. */
function luminance(c: string | [number, number, number]): number {
  const rgb = typeof c === "string" ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a: string | [number, number, number], b: string | [number, number, number]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

// Les variables CSS du thème, lues dans globals.css : c'est ce que le navigateur affiche.
const CSS = readFileSync(join(__dirname, "../../apps/console/app/globals.css"), "utf8");
function variable(bloc: ":root" | ".dark", nom: string): [number, number, number] {
  const debut = CSS.indexOf(`${bloc} {`);
  const corps = CSS.slice(debut, CSS.indexOf("}", debut));
  const m = new RegExp(`--${nom}:\\s*(\\d+) (\\d+) (\\d+)`).exec(corps);
  if (!m) throw new Error(`--${nom} absent de ${bloc}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

describe("CATEGORIELLE", () => {
  it("ne contient aucune couleur de verdict", () => {
    const verdicts = Object.values(RATING_HEX).map((c) => c.toLowerCase());
    for (const c of CATEGORIELLE) expect(verdicts).not.toContain(c.toLowerCase());
    expect(new Set(CATEGORIELLE).size).toBe(CATEGORIELLE.length);
  });

  it("chaque teinte reste lisible comme élément graphique (≥ 3:1) sur fond clair ET sombre", () => {
    for (const c of CATEGORIELLE) {
      expect(contraste(c, variable(":root", "c-panel")), `${c} sur clair`).toBeGreaterThanOrEqual(3);
      expect(contraste(c, variable(".dark", "c-panel")), `${c} sur sombre`).toBeGreaterThanOrEqual(3);
    }
  });

  // Spec A2 § 3.6 : l'ancienne palette à huit passait le 3:1 mais avait deux gris
  // (ardoise, pierre) et deux voisines indiscernables (ciel ↔ ardoise, ΔE 10,6).
  it("aucune teinte ne se lit grise (chroma OKLab ≥ 0,10)", () => {
    for (const c of CATEGORIELLE) expect(chroma(c), c).toBeGreaterThanOrEqual(0.1);
  });

  it("deux voisines se distinguent en vision normale (ΔE OKLab × 100 ≥ 15)", () => {
    for (let i = 1; i < CATEGORIELLE.length; i++) {
      expect(ecartOklab(CATEGORIELLE[i - 1], CATEGORIELLE[i]), `${CATEGORIELLE[i - 1]} ↔ ${CATEGORIELLE[i]}`).toBeGreaterThanOrEqual(15);
    }
  });

  it("six teintes au plus ; au-delà, le gris du thème (« Autres »)", () => {
    expect(CATEGORIELLE).toHaveLength(6);
    expect(AUTRES).toBe("rgb(var(--c-ink-faint))");
  });
});

describe("SERIE (tracés)", () => {
  it("la série principale est un jeton qui tient 3:1 sur la carte, en clair ET en sombre (WCAG 1.4.11)", () => {
    expect(SERIE.principale).toBe("rgb(var(--c-serie))");
    expect(contraste(variable(":root", "c-serie"), variable(":root", "c-panel"))).toBeGreaterThanOrEqual(3);
    expect(contraste(variable(".dark", "c-serie"), variable(".dark", "c-panel"))).toBeGreaterThanOrEqual(3);
  });

  it("le robot suit le bleu du thème ; les états des figures SVG suivent les jetons", () => {
    expect(SERIE.robot).toBe("rgb(var(--c-brand))");
    expect(Object.values(RATING_JETON)).toEqual(["rgb(var(--c-good))", "rgb(var(--c-warn))", "rgb(var(--c-bad))"]);
  });
});

describe("signal et DIVERGENTE (spec A2 § 3.5, § 3.8)", () => {
  it("le signal tient 3:1 sur la carte dans les deux thèmes", () => {
    for (const bloc of [":root", ".dark"] as const) {
      expect(contraste(variable(bloc, "c-signal"), variable(bloc, "c-panel")), bloc).toBeGreaterThanOrEqual(3);
      expect(contraste(variable(bloc, "c-signal-favorable"), variable(bloc, "c-panel")), bloc).toBeGreaterThanOrEqual(3);
    }
  });

  it("sept pas, tous définis en clair et en sombre ; le pôle « pire » est le signal", () => {
    expect(DIVERGENTE).toHaveLength(7);
    for (const bloc of [":root", ".dark"] as const) {
      for (const k of ["m3", "m2", "m1", "0", "p1", "p2", "p3"]) expect(() => variable(bloc, `c-div-${k}`)).not.toThrow();
      expect(variable(bloc, "c-div-p3")).toEqual(variable(bloc, "c-signal"));
    }
  });
});

describe("SEQUENTIELLE", () => {
  it("une teinte, cinq paliers, de plus en plus soutenus (luminance strictement décroissante)", () => {
    expect(PALIERS_SEQUENTIELLE).toHaveLength(5);
    const l = PALIERS_SEQUENTIELLE.map((c) => luminance(c));
    for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1]);
  });
  it("monotone sur [0 ; 1], bornée hors de l'intervalle", () => {
    let precedente = Infinity;
    for (let t = 0; t <= 1; t += 0.01) {
      const lum = luminance(SEQUENTIELLE(t));
      expect(lum).toBeLessThanOrEqual(precedente);
      precedente = lum;
    }
    expect(SEQUENTIELLE(-3)).toBe(PALIERS_SEQUENTIELLE[0]);
    expect(SEQUENTIELLE(7)).toBe(PALIERS_SEQUENTIELLE[4]);
    expect(SEQUENTIELLE(Number.NaN)).toBe(PALIERS_SEQUENTIELLE[0]);
  });
});

describe("SEQUENTIELLE en jetons de thème (heatmap)", () => {
  const hex = (t: [number, number, number]) => `#${t.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

  it("en clair, les jetons --c-seq-* sont les paliers de lib/palette.ts", () => {
    for (let i = 0; i < 5; i++) expect(hex(variable(":root", `c-seq-${i}`))).toBe(PALIERS_SEQUENTIELLE[i].toLowerCase());
    expect(PALIERS_SEQUENTIELLE_JETONS[3]).toBe("rgb(var(--c-seq-3))");
    expect(sequentielleJeton(0.95)).toBe("rgb(var(--c-seq-4))");
  });

  it("en sombre, l'intensité croît avec le CONTRASTE sur le fond (la rampe claire, posée sur la nuit, criait sur les cases faibles)", () => {
    const fond = variable(".dark", "c-panel");
    const c = [0, 1, 2, 3, 4].map((i) => contraste(variable(".dark", `c-seq-${i}`), fond));
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
    expect(c[4]).toBeGreaterThanOrEqual(3);
  });
});

describe("SEVERITE", () => {
  it("chaque sévérité a un motif : jamais la seule couleur", () => {
    const motifs = Object.values(SEVERITE).map((s) => s.motif);
    expect(new Set(motifs).size).toBe(3);
  });
});

describe("jetons du thème (globals.css)", () => {
  it("le texte tertiaire tient 4,5:1 sur les trois fonds, en clair et en sombre", () => {
    for (const bloc of [":root", ".dark"] as const) {
      for (const fond of ["c-panel", "c-panel2", "c-app"]) {
        expect(contraste(variable(bloc, "c-ink-faint"), variable(bloc, fond)), `${bloc} ${fond}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("le texte d'un état tient 4,5:1 sur la teinte à 10 % de son propre badge", () => {
    const melange = (fond: [number, number, number], teinte: [number, number, number], a: number) =>
      fond.map((v, i) => Math.round(v * (1 - a) + teinte[i] * a)) as [number, number, number];
    for (const bloc of [":root", ".dark"] as const) {
      for (const etat of ["good", "warn", "bad"]) {
        const badge = melange(variable(bloc, "c-panel"), variable(bloc, `c-${etat}`), 0.1);
        expect(contraste(variable(bloc, `c-${etat}-ink`), badge), `${bloc} ${etat}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("un aplat « fond » porte du texte blanc à 4,5:1", () => {
    // Valeurs de tailwind.config.ts, constantes dans les deux modes.
    for (const c of ["#047857", "#b45309", "#b91c1c"]) expect(contraste(c, "#ffffff"), c).toBeGreaterThanOrEqual(4.5);
  });
});
