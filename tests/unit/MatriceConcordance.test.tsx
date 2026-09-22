// MatriceConcordance (F56, plan § 4.3, § 5.7 CR8) : une table à en-têtes, un zéro
// écrit « 0 », une intensité séquentielle sans verdict, seules les cases nommées
// portent une teinte de sens, et ce qui sort de la matrice est compté à côté.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatriceConcordance, compteCellule, type MatriceConcordanceProps } from "@/components/charts/MatriceConcordance";
import { PALIERS_SEQUENTIELLE } from "@/lib/palette";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const props: MatriceConcordanceProps = {
  lignes: [
    { cle: "ok", libelle: "ok" },
    { cle: "warn", libelle: "avertissement" },
    { cle: "incident", libelle: "incident" },
  ],
  colonnes: [
    { cle: "good", libelle: "Bon" },
    { cle: "needs-improvement", libelle: "À améliorer" },
    { cle: "poor", libelle: "Mauvais" },
  ],
  cellules: { ok: { good: 40, poor: 3 }, incident: { good: 2, poor: 5 } },
  nommees: [
    { ligne: "ok", colonne: "poor", nom: "angle mort", href: "#angles-morts", ton: "bad" },
    { ligne: "incident", colonne: "good", nom: "alerte robot non ressentie", ton: "warn" },
  ],
  horsMatrice: [
    { libelle: "heures robot seul", n: 12 },
    { libelle: "heures réel seul", n: 0 },
    { libelle: "heures au réel insuffisant (moins de 30 mesures)", n: 4 },
    { libelle: "état robot inconnu", n: 1 },
  ],
  unite: "heures × route",
};

/** La cellule (ligne, colonne) du rendu. */
const cellule = (html: string, l: string, c: string) =>
  html.match(new RegExp(`<td[^>]*data-ligne="${l}" data-colonne="${c}"[\\s\\S]*?</td>`))?.[0] ?? "";

describe("MatriceConcordance", () => {
  const html = renderToStaticMarkup(<MatriceConcordance {...props} />);

  it("table à <th scope> : trois colonnes de verdict, trois lignes d'état", () => {
    expect(html).toContain("<table");
    expect(html.match(/<th scope="col"/g)).toHaveLength(4);
    expect(html.match(/<th scope="row"/g)).toHaveLength(3);
    expect(texte(html)).toContain("heures × route");
  });

  it("cellule absente de la lecture : « 0 », sans fond d'intensité", () => {
    const td = cellule(html, "warn", "good");
    expect(texte(td).trim()).toBe("0");
    expect(td).not.toContain("background-color");
  });

  it("intensité séquentielle proportionnelle au compte ; aucune teinte de verdict hors cases nommées", () => {
    expect(cellule(html, "ok", "good")).toContain(`background-color:${PALIERS_SEQUENTIELLE[4]}`);
    expect(cellule(html, "ok", "poor")).toContain(`background-color:${PALIERS_SEQUENTIELLE[0]}`);
    // Une case NON nommée ne porte ni ring ni texte de couleur de sens.
    expect(cellule(html, "ok", "good")).not.toMatch(/ring-bad|ring-warn|text-bad|text-warn/);
    expect(cellule(html, "incident", "poor")).not.toMatch(/ring-bad|ring-warn|text-bad|text-warn/);
  });

  it("cases nommées : contour de sens, nom écrit ; l'angle mort est un lien, l'autre non", () => {
    const angle = cellule(html, "ok", "poor");
    expect(angle).toContain('data-nommee="bad"');
    expect(angle).toContain("ring-bad");
    expect(angle).toContain('href="#angles-morts"');
    expect(texte(angle)).toContain("angle mort");
    const alerte = cellule(html, "incident", "good");
    expect(alerte).toContain("ring-warn");
    expect(alerte).not.toContain("href=");
    expect(texte(alerte)).toContain("alerte robot non ressentie");
  });

  it("hors matrice : compté à côté, y compris un 0 réel", () => {
    const hors = html.match(/data-testid="concordance-hors-matrice"[\s\S]*?<\/dl>/)?.[0] ?? "";
    expect(texte(hors)).toContain("heures robot seul 12");
    expect(texte(hors)).toContain("heures réel seul 0");
    expect(texte(hors)).toContain("état robot inconnu 1");
  });

  it("compteCellule : absent = 0, non fini = 0", () => {
    expect(compteCellule({ a: { b: 3 } }, "a", "b")).toBe(3);
    expect(compteCellule({ a: { b: 3 } }, "a", "c")).toBe(0);
    expect(compteCellule({ a: { b: Number.NaN } }, "a", "b")).toBe(0);
  });
});
