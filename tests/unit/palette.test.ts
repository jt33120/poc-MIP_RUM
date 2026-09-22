// F01 — la couleur porte un sens, un seul (principe P15 du plan).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIELLE, PALIERS_SEQUENTIELLE, RATING_HEX, SEQUENTIELLE, SEVERITE } from "../../apps/console/lib/palette";

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
