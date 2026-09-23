// P**.6 — L'annexe de la vitrine : le document de couverture tel quel, puis les Specs
// sous <Suspense> (plan § 8.2, PS11).
//
// Ce que ces tests tiennent, en rendu SSR réel (`renderToStaticMarkup`) :
//   - une famille du document par `<details>`, toutes ses capacités, dans son ordre,
//     avec leur verdict ÉCRIT et leur limite — rien de tapé, tout lu dans
//     lib/couverture.ts ;
//   - le Markdown des cellules est rendu (gras, code), jamais montré brut, et une
//     balise dans une cellule reste du texte ;
//   - Specs est derrière une frontière <Suspense> dont le repli est le squelette
//     `aria-busy` : le composant Specs est remplacé ici par un composant qui reste
//     suspendu, et c'est le squelette qui s'affiche à sa place.
// Le comportement dans le navigateur (ouverture, clavier, largeurs) est la recette
// e2e TP11 / TP6 (tests/e2e/presentation.spec.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Specs lit la base : ici, il reste suspendu pour toujours, comme une lecture lente.
vi.mock("@/components/presentation/Specs", () => ({
  Specs: () => {
    throw new Promise(() => {});
  },
}));

import { Annexe, DetailCouverture, SpecsChargement } from "@/components/presentation/Annexe";
import { CAPACITES, RELEVE, VERDICT_LABEL, parFamille, type Capacite } from "@/lib/couverture";
import { lireEnLigne, texteDe } from "@/lib/markdown-en-ligne";

/** Texte lisible : balises retirées (sans espace : le code est EN LIGNE), entités décodées. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Le texte lu d'une cellule, tel que le rendu doit le montrer. */
const lu = (source: string) => texteDe(lireEnLigne(source)).replace(/\s+/g, " ").trim();

const DEBUT_LIGNE = '<tr role="row" data-testid="annexe-capacite"';

/** Le HTML de chaque ligne de capacité, dans l'ordre du rendu. */
function lignes(html: string): string[] {
  return html.split(DEBUT_LIGNE).slice(1).map((l) => l.slice(0, l.indexOf("</tr>")));
}

describe("PS11 — le document de couverture, tel quel", () => {
  const html = renderToStaticMarkup(<DetailCouverture />);
  const familles = parFamille();

  it("une famille par <details>, fermée, dans l'ordre du document, avec son nombre de capacités", () => {
    const blocs = html.split("<details").slice(1);
    expect(blocs).toHaveLength(familles.length);
    familles.forEach(({ famille, capacites }, i) => {
      const resume = texte(blocs[i].slice(blocs[i].indexOf("<summary"), blocs[i].indexOf("</summary>")));
      expect(resume).toBe(`${famille}${capacites.length} capacités`);
      expect(blocs[i].slice(0, blocs[i].indexOf(">"))).not.toContain(" open");
    });
  });

  it("toutes les capacités du relevé, chacune une fois, dans l'ordre du document", () => {
    const vues = [...html.matchAll(/<tr role="row" data-testid="annexe-capacite" data-id="([^"]+)" data-verdict="([^"]+)"/g)];
    expect(vues.map((m) => [m[1], m[2]])).toEqual(CAPACITES.map((c) => [c.id, c.verdict]));
    expect(new Set(vues.map((m) => m[1])).size).toBe(CAPACITES.length);
  });

  it("chaque table a ses quatre colonnes nommées, et chaque ligne son identifiant en en-tête", () => {
    const tables = html.split("<table").slice(1);
    expect(tables).toHaveLength(familles.length);
    for (const t of tables) {
      const entetes = [...t.matchAll(/<th role="columnheader" scope="col"[^>]*>(.*?)<\/th>/g)].map((m) => texte(m[1]));
      expect(entetes).toEqual(["#Identifiant", "Capacité", "Verdict", "Limite"]);
      expect(t).toMatch(/<caption class="sr-only">[^<]+ : chaque capacité, son verdict et sa limite<\/caption>/);
    }
    lignes(html).forEach((l, i) => {
      expect(l).toContain(`<th role="rowheader" scope="row"`);
      expect(l).toContain(`<span class="chip-mono whitespace-nowrap">${CAPACITES[i].id}</span>`);
    });
  });

  it("chaque ligne écrit son verdict avec les mots du document, et reprend capacité et limite", () => {
    const vues = lignes(html);
    expect(vues).toHaveLength(CAPACITES.length);
    vues.forEach((l, i) => {
      const c = CAPACITES[i];
      const t = texte(l);
      expect(t, c.id).toContain(VERDICT_LABEL[c.verdict]);
      expect(t, c.id).toContain(lu(c.capacite));
      expect(t, c.id).toContain(lu(c.limite));
    });
  });

  it("le Markdown des cellules du relevé est rendu, jamais montré brut", () => {
    expect(texte(html)).not.toMatch(/\*\*|`/);
    expect(html).toContain('<strong class="font-semibold text-ink">');
    expect(html).toMatch(/<code class="[^"]*font-mono[^"]*">/);
  });

  it("du gras qui contient du code ; une balise ou un script dans une cellule restent du texte", () => {
    const piege: Capacite = {
      id: "Z1",
      famille: "Piège",
      capacite: "<script>alert(1)</script>",
      verdict: "non_commence",
      preuve: "",
      limite: "**gras avec `code`**, *italique* et <b>balise</b>",
      ligne: 1,
    };
    const rendu = renderToStaticMarkup(<DetailCouverture familles={[{ famille: "Piège", capacites: [piege] }]} />);
    expect(rendu).not.toContain("<script>");
    expect(rendu).not.toContain("<b>");
    expect(rendu).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendu).toContain("&lt;b&gt;balise&lt;/b&gt;");
    expect(rendu).toMatch(/<strong class="font-semibold text-ink">gras avec <code [^>]*>code<\/code><\/strong>, <em>italique<\/em> et &lt;b&gt;/);
    // Une famille d'une seule capacité le dit au singulier.
    expect(texte(rendu)).toContain("1 capacité");
    expect(texte(rendu)).not.toContain("1 capacités");
  });

  it("petits textes en ink-soft, verdict sans teinte : aucune couleur ne porte le verdict (§ 8.2)", () => {
    expect(html).not.toContain("text-ink-faint");
    expect(html).not.toMatch(/\b(bg|text|border)-(good|warn|bad)\b/);
  });
});

describe("PS11 — les Specs derrière une frontière <Suspense>", () => {
  it("la partie « Le détail » : chapeau daté du relevé, les familles, puis le squelette tant que Specs lit", () => {
    const html = renderToStaticMarkup(<Annexe />);
    expect(html).toContain('<section id="detail" aria-labelledby="detail-titre"');
    expect(texte(html)).toContain(
      `Le document de couverture du ${RELEVE}, tel quel : une ligne par capacité, son verdict et sa limite.`,
    );
    const familles = html.indexOf('data-testid="annexe-couverture"');
    const squelette = html.indexOf('data-testid="specs-chargement"');
    expect(familles).toBeGreaterThan(-1);
    expect(squelette).toBeGreaterThan(familles);
    expect(texte(html)).toContain("Chargement du détail technique");
  });

  it("le squelette est annoncé occupé, et ne s'anime pas si le mouvement est réduit", () => {
    const html = renderToStaticMarkup(<SpecsChargement />);
    expect(html).toMatch(/^<div role="status" aria-busy="true" data-testid="specs-chargement"/);
    expect(texte(html)).toBe("Chargement du détail technique");
    const animes = html.match(/animate-pulse/g) ?? [];
    expect(animes.length).toBeGreaterThan(0);
    expect((html.match(/motion-reduce:animate-none/g) ?? []).length).toBe(animes.length);
  });
});
