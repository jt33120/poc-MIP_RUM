// Les SLO en cases (recette du 30/09/2026) : une case par objectif, atteinte en grand,
// cible écrite, jauge chiffrée du budget ; la fenêtre du SLO au clic.
//
// Ce que ces tests verrouillent — les MÊMES règles que les barres (`BudgetBars`) :
//   · un SLO sans mesure n'a PAS de jauge (aucun `data-barre`) : « Non mesurable » et
//     sa raison, jamais « 0 % » ;
//   · une seule couleur de verdict, `bad`, à partir de 100 % ; sous 100 %, neutre ;
//   · chaque repère de test (`budget-valeur`, `data-barre`) ne désigne qu'UN élément
//     par case : la jauge de la fenêtre n'en porte pas ;
//   · « Créer une alerte » n'est rendu que si la page le donne (administrateur).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CasesSlo, type InfoSlo } from "@/components/slo/CasesSlo";
import type { BudgetLigne } from "@/components/charts/BudgetBars";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ");

const ligne = (p: Partial<BudgetLigne> = {}): BudgetLigne => ({
  cle: "7",
  libelle: "LCP 95 %",
  detail: "LCP · toutes routes · 28 j · objectif 95,0 %",
  consomme: 40,
  atteinte: 0.98,
  objectif: 0.95,
  brule: false,
  href: "/pages?app=demo&vital=LCP",
  ...p,
});

const info = (p: Partial<InfoSlo> = {}): InfoSlo => ({
  metrique: "LCP",
  metriqueEnClair: "Part des mesures LCP notées Bon",
  route: null,
  app: "demo",
  fenetreJours: 28,
  alertes: 2,
  creerAlerte: null,
  ...p,
});

const rendre = (lignes: BudgetLigne[], infos: [string, InfoSlo][] = []) =>
  renderToStaticMarkup(<CasesSlo lignes={lignes} infos={new Map(infos)} luA="14:02:00" />);

/** Le HTML de la case seule (le bouton), sans sa fenêtre. */
const caseSeule = (html: string) => html.slice(0, html.indexOf("<dialog"));

describe("CasesSlo", () => {
  it("sans mesure : aucune jauge, « Non mesurable » et sa raison, jamais « 0 % »", () => {
    const html = rendre([ligne({ consomme: null, atteinte: null, raison: "aucune mesure LCP sur 28 j" })]);
    expect(html).toContain('data-statut="non_mesurable"');
    expect(html).not.toContain("data-barre");
    expect(html).not.toContain('data-testid="budget-valeur"');
    expect(texte(html)).toContain("Non mesurable : aucune mesure LCP sur 28 j");
    expect(texte(caseSeule(html))).not.toMatch(/(^|\s)0 %/);
  });

  it("dans le budget : jauge neutre, valeur écrite une fois, aucune couleur de verdict dans la case", () => {
    const html = rendre([ligne()]);
    const c = caseSeule(html);
    // La barre remplie est neutre ; seul le trait « épuisé » à 100 % est rouge (un repère, pas un verdict).
    const barre = /<span data-barre="dans_budget" class="([^"]*)"/.exec(c)?.[1] ?? "";
    expect(barre).toContain("bg-ink-soft");
    expect(barre).not.toContain("bg-bad");
    expect(c).not.toContain("text-bad-ink");
    expect(html.match(/data-testid="budget-valeur"/g)).toHaveLength(1);
    expect(html.match(/data-barre=/g)).toHaveLength(1);
    expect(texte(c)).toContain("98,0 % atteint · cible 95,0 %");
    expect(texte(c)).toContain("40 % consommé");
  });

  it("épuisé : rouge à partir de 100 %, le dépassement hachuré, le mot « épuisé »", () => {
    const html = caseSeule(rendre([ligne({ consomme: 312, atteinte: 0.844 })]));
    expect(html).toContain('data-statut="epuise"');
    expect(html).toContain('data-barre="epuise"');
    expect(html).toContain('data-barre="depassement"');
    expect(texte(html)).toContain("312 % épuisé");
  });

  it("atteinte négative : jauge hachurée grise, « non interprétable »", () => {
    const html = caseSeule(rendre([ligne({ consomme: 1200, atteinte: -0.2, raison: "plus d'occurrences d'erreurs que de pages vues" })]));
    expect(html).toContain('data-statut="non_interpretable"');
    expect(html).toContain('data-barre="hachuree"');
    expect(html).not.toContain('data-barre="epuise"');
  });

  it("la fenêtre dit la formule, le périmètre, les alertes et la source ; « Créer une alerte » seulement si donné", () => {
    const lecteur = rendre([ligne()], [["7", info()]]);
    expect(texte(lecteur)).toContain("(1 − atteinte) ÷ (1 − objectif)");
    expect(texte(lecteur)).toContain("Part des mesures LCP notées Bon");
    expect(texte(lecteur)).toContain("toutes routes · app demo");
    expect(texte(lecteur)).toContain("slo_status()");
    expect(lecteur).not.toContain("Créer une alerte");
    const admin = rendre([ligne()], [["7", info({ creerAlerte: "/alerts?regle_metrique=LCP#nouvelle-regle" })]]);
    expect(admin).toContain("Créer une alerte");
    expect(admin).toContain('href="/alerts?regle_metrique=LCP#nouvelle-regle"');
  });

  it("l'ordre des lignes est gardé (non mesurables en dernier, décidé par `lignesBudget`)", () => {
    const html = rendre([ligne({ cle: "1", libelle: "A" }), ligne({ cle: "2", libelle: "B", consomme: null, atteinte: null })]);
    expect(html.indexOf('data-statut="dans_budget"')).toBeLessThan(html.indexOf('data-statut="non_mesurable"'));
  });
});
