// BudgetBars (F56, plan § 4.3, § 5.18 SL3) : un dépassement borné à l'échelle mais
// ÉCRIT, une absence sans barre et avec sa raison, une barre neutre sous « épuisé ».
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BudgetBars, statutBudget, type BudgetLigne } from "@/components/charts/BudgetBars";
import type { SloStatusRow } from "@/lib/queries-alerting";
import { lignesBudget } from "@/lib/slo-ecran";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const ligne = (p: Partial<BudgetLigne>): BudgetLigne => ({
  cle: "s1",
  libelle: "LCP checkout",
  detail: "LCP · /checkout · 28 j · objectif 95 %",
  consomme: 80,
  atteinte: 0.96,
  objectif: 0.95,
  brule: false,
  href: "/pages?vital=LCP&route=/checkout",
  ...p,
});

/** Le fragment HTML de la ligne d'état donné. */
const ligneDe = (html: string, statut: string) =>
  html.match(new RegExp(`<li[^>]*data-statut="${statut}"[\\s\\S]*?</li>`))?.[0] ?? "";

describe("BudgetBars", () => {
  it("312 % : barre bornée à 150 % de l'échelle, valeur « 312 % » écrite, verdict « épuisé »", () => {
    const html = renderToStaticMarkup(<BudgetBars lignes={[ligne({ consomme: 312, atteinte: 0.8 })]} ariaLabel="Budget" />);
    const li = ligneDe(html, "epuise");
    // Part pleine jusqu'à 100 % (2/3 de l'échelle), dépassement hachuré jusqu'au bord (100 %).
    expect(li).toMatch(/data-barre="epuise"[^>]*style="width:66\.66+7?%"/);
    expect(li).toContain('data-barre="depassement"');
    expect(li).toMatch(/calc\(100% - 66\.66+7?%\)/);
    expect(texte(li)).toContain("312 %");
    expect(texte(li)).toContain("épuisé");
    expect(li).toContain("bg-bad");
  });

  it("consomme = null : aucune barre, la raison écrite, jamais « 0 % »", () => {
    const html = renderToStaticMarkup(
      <BudgetBars lignes={[ligne({ consomme: null, atteinte: null, raison: "aucune mesure LCP sur 28 j" })]} ariaLabel="Budget" />,
    );
    const li = ligneDe(html, "non_mesurable");
    expect(li).not.toContain("data-barre");
    expect(li).not.toContain('role="img"');
    expect(texte(li)).toContain("Non mesurable : aucune mesure LCP sur 28 j");
    expect(texte(li)).not.toMatch(/(^|\s)0 %/);
  });

  it("80 % : barre neutre, aucune classe bad sur la barre, verdict « dans le budget »", () => {
    const html = renderToStaticMarkup(<BudgetBars lignes={[ligne({ consomme: 80 })]} ariaLabel="Budget" />);
    const barre = html.match(/<span[^>]*data-barre="dans_budget"[^>]*>/)?.[0] ?? "";
    expect(barre).not.toBe("");
    expect(barre).not.toMatch(/bad/);
    expect(html).not.toContain('data-barre="depassement"');
    expect(texte(ligneDe(html, "dans_budget"))).toContain("dans le budget");
  });

  it("atteinte négative : barre pleine hachurée, grise, et sa raison", () => {
    const raison = "plus d'occurrences d'erreurs que de pages vues : atteinte non interprétable";
    const html = renderToStaticMarkup(<BudgetBars lignes={[ligne({ consomme: 999, atteinte: -0.4, raison })]} ariaLabel="Budget" />);
    const li = ligneDe(html, "non_interpretable");
    expect(li).toContain('data-barre="hachuree"');
    expect(li).not.toContain("bg-bad ");
    expect(texte(li)).toContain(raison);
  });

  it('role="img" sur chaque barre dessinée, liste nommée, alternative textuelle, repères gris', () => {
    const html = renderToStaticMarkup(
      <BudgetBars
        lignes={[ligne({ consomme: 40, brule: true }), ligne({ cle: "s2", consomme: null, raison: "r" })]}
        ariaLabel="Budget par SLO"
      />,
    );
    expect(html).toContain('aria-label="Budget par SLO"');
    expect(html.match(/role="img"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="alternative"');
    expect(texte(html)).toContain("brûle vite");
    expect(html).toMatch(/data-repere="50"[^>]*class="[^"]*bg-ink-faint/);
    expect(texte(html)).toContain("repère");
  });

  it("aucune ligne : état vide, pas d'axe", () => {
    const html = renderToStaticMarkup(<BudgetBars lignes={[]} ariaLabel="Budget" />);
    expect(html).toContain('data-etat="vide"');
    expect(html).not.toContain("budget-axe");
  });

  it("statutBudget : null avant tout, puis atteinte négative, puis épuisé à partir de 100", () => {
    expect(statutBudget({ consomme: null, atteinte: -1 })).toBe("non_mesurable");
    expect(statutBudget({ consomme: 50, atteinte: -0.1 })).toBe("non_interpretable");
    expect(statutBudget({ consomme: 100, atteinte: 0.9 })).toBe("epuise");
    expect(statutBudget({ consomme: 99.9, atteinte: 0.9 })).toBe("dans_budget");
  });
});

// F63 — le hero de /slo : les lignes viennent de `slo_status()` via `lignesBudget`.
describe("F63 — hero de /slo : trois SLO (tenu, dépassé, non mesurable)", () => {
  const statut = (p: Partial<SloStatusRow>): SloStatusRow => ({
    slo_id: 1,
    app_id: "demo",
    name: "LCP tenu",
    metric: "LCP",
    route: "/checkout",
    objective: 0.9,
    window_days: 7,
    attainment: 1,
    budget: 0.1,
    burned_pct: 0,
    fast_burn: false,
    ...p,
  });
  const lignes = lignesBudget([
    statut({}),
    statut({ slo_id: 3, name: "CLS sans mesure", metric: "CLS", route: null, attainment: null, burned_pct: null, fast_burn: null }),
    statut({ slo_id: 2, name: "INP dépassé", metric: "INP", objective: 0.95, attainment: 0.6, burned_pct: 800, fast_burn: true }),
  ]);

  it("tri : consommé décroissant, non mesurable en dernier ; drill vers ce qui consomme", () => {
    expect(lignes.map((l) => l.libelle)).toEqual(["INP dépassé", "LCP tenu", "CLS sans mesure"]);
    expect(lignes[0].href).toBe("/pages?app=demo&vital=INP&route=%2Fcheckout");
    expect(lignes[2].raison).toBe("aucune mesure CLS sur 7 j");
  });

  it("rendu : dépassé bordé à l'échelle et écrit, tenu neutre à 0 %, non mesurable sans barre ni « 0 % »", () => {
    const html = renderToStaticMarkup(<BudgetBars lignes={lignes} ariaLabel="Budget" />);
    expect(texte(ligneDe(html, "epuise"))).toContain("800 %");
    expect(texte(ligneDe(html, "epuise"))).toContain("brûle vite");
    // Le trait « épuisé » (repère commun à toutes les lignes) est rouge ; la BARRE, non.
    expect(ligneDe(html, "dans_budget").match(/<span[^>]*data-barre="dans_budget"[^>]*>/)?.[0]).not.toMatch(/bad/);
    const sans = ligneDe(html, "non_mesurable");
    expect(sans).not.toContain("data-barre");
    expect(texte(sans)).toContain("Non mesurable : aucune mesure CLS sur 7 j");
    expect(texte(sans)).not.toMatch(/(^|\s)0 %/);
  });
});
