// MatriceCohortes (F49, plan § 4.3) : chaque case écrit « n / taille » et son taux ;
// la semaine en cours est hachurée et dite ; l'avenir est vide, jamais 0 ; l'échelle
// est SEQUENTIELLE, sans vert / ambre / rouge ; l'effectif faible est écrit.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatriceCohortes } from "@/components/charts/MatriceCohortes";
import { RATING_HEX } from "@/lib/palette";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const LIGNES = [
  {
    cohorte: "sem. du 07/09",
    taille: 28,
    cellules: [
      { offset: 0, retenus: 28, taux: 1, incomplete: false },
      { offset: 1, retenus: 12, taux: 12 / 28, incomplete: false },
      { offset: 2, retenus: 5, taux: 5 / 28, incomplete: true },
    ],
  },
  {
    cohorte: "sem. du 14/09",
    taille: 6,
    cellules: [
      { offset: 0, retenus: 6, taux: 1, incomplete: false },
      { offset: 1, retenus: 2, taux: 2 / 6, incomplete: true },
    ],
  },
];

describe("MatriceCohortes", () => {
  const html = renderToStaticMarkup(<MatriceCohortes lignes={LIGNES} colonnes={3} />);
  const cellules = html.split('data-testid="cohorte-cellule"').slice(1);

  it("aucune cellule sans « n / taille » ni son taux", () => {
    expect(cellules).toHaveLength(5);
    for (const c of cellules) {
      const t = texte(c.slice(0, c.indexOf("</td>")));
      expect(t).toMatch(/\d+ \/ \d+/);
      expect(t).toMatch(/\d+,\d %/);
    }
    expect(texte(html)).toContain("12 / 28");
    expect(texte(html)).toContain("42,9 %");
  });

  it("semaine en cours : hachurée et dite « semaine incomplète »", () => {
    expect(html.match(/data-incomplete="1"/g)).toHaveLength(2);
    expect(html).toContain("repeating-linear-gradient");
    expect(texte(html)).toContain("semaine incomplète");
  });

  it("au-delà de la semaine en cours : case vide (« semaine à venir »), jamais « 0 / 6 »", () => {
    expect(texte(html)).toContain("semaine à venir");
    expect(texte(html)).not.toContain("0 / 6");
  });

  it("cohorte sous 10 visiteurs : « effectif faible »", () => {
    expect(texte(html)).toContain("effectif faible");
    expect(html.match(/effectif faible/g)).toHaveLength(1);
  });

  it("échelle SEQUENTIELLE : aucune couleur de verdict", () => {
    for (const hex of Object.values(RATING_HEX)) expect(html.toLowerCase()).not.toContain(hex.toLowerCase());
    expect(html).not.toMatch(/rgba\(16, 185, 129/);
    expect(texte(html)).toContain("sans verdict");
  });

  it("la zone défilante est positionnée : ses sr-only n'élargissent pas la page (piège 16)", () => {
    expect(html).toMatch(/class="relative overflow-x-auto"/);
  });

  it("colonne « Cohorte » figée et en-têtes S+0..S+n", () => {
    expect(html).toContain("sticky left-0");
    expect(texte(html)).toMatch(/S\+0 S\+1 S\+2/);
  });
});
