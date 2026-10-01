// SloRow (F63, plan § 5.18 SL5) : la ligne « Définitions et état » d'un SLO.
//
// Ce que la ligne ne doit jamais faire : écrire « 0 % » ou « objectif manqué » pour
// un SLO que rien n'a mesuré (V3), colorer un budget sous 100 % (R-S), ou RENDRE un
// bouton d'écriture pour un viewer (V9).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Les actions serveur tirent la base : seules leurs références comptent ici.
vi.mock("@/app/alerts/actions", () => ({ toggleSloAction: () => undefined, deleteSloAction: () => undefined }));

import { SloRow } from "@/components/slo/SloStatusRow";
import { CasesSlo, type InfoSlo } from "@/components/slo/CasesSlo";
import type { BudgetLigne } from "@/components/charts/BudgetBars";
import type { SloRaw, SloStatusRow } from "@/lib/queries-alerting";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const raw = (p: Partial<SloRaw> = {}): SloRaw => ({
  id: 7,
  app_id: "demo",
  name: "INP sans mesure",
  metric: "INP",
  objective: 0.9,
  window_days: 7,
  route: null,
  active: true,
  ...p,
});

const statut = (p: Partial<SloStatusRow> = {}): SloStatusRow => ({
  slo_id: 7,
  app_id: "demo",
  name: "INP sans mesure",
  metric: "INP",
  route: null,
  objective: 0.9,
  window_days: 7,
  attainment: null,
  budget: 0.1,
  burned_pct: null,
  fast_burn: null,
  ...p,
});

const rendre = (el: React.ReactElement) => renderToStaticMarkup(<table><tbody>{el}</tbody></table>);

describe("SloRow", () => {
  it("sans mesure : « non mesurable », ni « 0 % » ni « objectif manqué » ; métrique en clair, route « toutes »", () => {
    const t = texte(rendre(<SloRow raw={raw()} status={statut()} alertes7j={0} admin={false} />));
    expect(t).toContain("non mesurable");
    expect(t).not.toMatch(/(^|\s)0 %/);
    expect(t).not.toContain("objectif manqué");
    expect(t).toContain("Part des mesures INP notées Bon");
    expect(t).toContain("toutes");
    expect(t).toContain("inconnu");
  });

  it("viewer : aucun bouton ni lien d'écriture rendu", () => {
    const html = rendre(<SloRow raw={raw()} status={statut()} alertes7j={2} admin={false} />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Créer une alerte");
    // La lecture reste : le compte d'alertes mène à la piste du SLO.
    expect(html).toContain('href="/alerts#slo-7"');
  });

  it("admin : activer / désactiver, supprimer et « Créer une alerte » (paramètres regle_*)", () => {
    const html = rendre(
      <SloRow raw={raw({ route: "/checkout", metric: "LCP" })} status={statut({ metric: "LCP" })} alertes7j={0} admin />,
    );
    expect(html).toContain('data-testid="toggle-slo-7"');
    expect(html).toContain('data-testid="delete-slo-7"');
    expect(html).toContain("/alerts?regle_metrique=LCP&amp;regle_route=%2Fcheckout#nouvelle-regle");
  });

  it("épuisé : seul verdict coloré ; sous 100 % : neutre", () => {
    const epuise = rendre(
      <SloRow raw={raw()} status={statut({ attainment: 0.6, burned_pct: 400, fast_burn: true })} alertes7j={1} admin={false} />,
    );
    expect(texte(epuise)).toContain("400 % épuisé");
    expect(epuise).toContain("text-bad-ink");
    const tenu = rendre(<SloRow raw={raw()} status={statut({ attainment: 0.96, burned_pct: 40, fast_burn: false })} alertes7j={0} admin={false} />);
    expect(texte(tenu)).toContain("40 % dans le budget");
    expect(tenu).not.toMatch(/text-(good|warn|bad)/);
  });

  it("SLO désactivé : ligne grisée, « désactivé », état « — » ; lecture d'alertes en échec : « — »", () => {
    const html = rendre(<SloRow raw={raw({ active: false })} alertes7j={null} admin={false} />);
    expect(html).toContain("opacity-60");
    expect(texte(html)).toContain("désactivé");
    expect(html).not.toContain("/alerts#slo-7");
  });
});

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

const rendreCases = (lignes: BudgetLigne[], infos: [string, InfoSlo][] = []) =>
  renderToStaticMarkup(<CasesSlo lignes={lignes} infos={new Map(infos)} luA="14:02:00" />);

/** Le HTML de la case seule (le bouton), sans sa fenêtre. */
const caseSeule = (html: string) => html.slice(0, html.indexOf("<dialog"));

describe("CasesSlo", () => {
  it("sans mesure : aucune jauge, « Non mesurable » et sa raison, jamais « 0 % »", () => {
    const html = rendreCases([ligne({ consomme: null, atteinte: null, raison: "aucune mesure LCP sur 28 j" })]);
    expect(html).toContain('data-statut="non_mesurable"');
    expect(html).not.toContain("data-barre");
    expect(html).not.toContain('data-testid="budget-valeur"');
    expect(texte(html)).toContain("Non mesurable : aucune mesure LCP sur 28 j");
    expect(texte(caseSeule(html))).not.toMatch(/(^|\s)0 %/);
  });

  it("dans le budget : jauge neutre, valeur écrite une fois, aucune couleur de verdict dans la case", () => {
    const html = rendreCases([ligne()]);
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
    const html = caseSeule(rendreCases([ligne({ consomme: 312, atteinte: 0.844 })]));
    expect(html).toContain('data-statut="epuise"');
    expect(html).toContain('data-barre="epuise"');
    expect(html).toContain('data-barre="depassement"');
    expect(texte(html)).toContain("312 % épuisé");
  });

  it("atteinte négative : jauge hachurée grise, « non interprétable »", () => {
    const html = caseSeule(rendreCases([ligne({ consomme: 1200, atteinte: -0.2, raison: "plus d'occurrences d'erreurs que de pages vues" })]));
    expect(html).toContain('data-statut="non_interpretable"');
    expect(html).toContain('data-barre="hachuree"');
    expect(html).not.toContain('data-barre="epuise"');
  });

  it("la fenêtre dit la formule, le périmètre, les alertes et la source ; « Créer une alerte » seulement si donné", () => {
    const lecteur = rendreCases([ligne()], [["7", info()]]);
    expect(texte(lecteur)).toContain("(1 − atteinte) ÷ (1 − objectif)");
    expect(texte(lecteur)).toContain("Part des mesures LCP notées Bon");
    expect(texte(lecteur)).toContain("toutes routes · app demo");
    expect(texte(lecteur)).toContain("slo_status()");
    expect(lecteur).not.toContain("Créer une alerte");
    const admin = rendreCases([ligne()], [["7", info({ creerAlerte: "/alerts?regle_metrique=LCP#nouvelle-regle" })]]);
    expect(admin).toContain("Créer une alerte");
    expect(admin).toContain('href="/alerts?regle_metrique=LCP#nouvelle-regle"');
  });

  it("l'ordre des lignes est gardé (non mesurables en dernier, décidé par `lignesBudget`)", () => {
    const html = rendreCases([ligne({ cle: "1", libelle: "A" }), ligne({ cle: "2", libelle: "B", consomme: null, atteinte: null })]);
    expect(html.indexOf('data-statut="dans_budget"')).toBeLessThan(html.indexOf('data-statut="non_mesurable"'));
  });
});
