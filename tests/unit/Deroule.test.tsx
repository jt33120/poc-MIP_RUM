// F45 — rendu SSR du déroulé groupé (`components/sessions/Deroule.tsx`).
//
// CE QUE CE TEST PROUVE, ET QUI EST LA PREUVE DE FIN DU LOT : plus aucune ligne
// « Vital RTT ». Les phases réseau sont repliées derrière « Phases réseau (8) »
// et n'ont plus l'étiquette « Vital » (§ 5.12.6) ; les Web Vitals sont des
// pastilles sur la ligne de leur vue, avec le verdict de `lib/rating.ts`.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Deroule } from "@/components/sessions/Deroule";
import { FriseSession, elementsDeFrise } from "@/components/sessions/FriseSession";
import type { TimelineItem } from "@/lib/queries";

const T0 = Date.parse("2026-09-22T10:00:00Z");

function item(kind: TimelineItem["kind"], s: number, extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    kind,
    ts: new Date(T0 + s * 1000),
    title: null,
    detail: null,
    value: null,
    rating: null,
    action_id: null,
    action_name: null,
    ...extra,
  };
}

const PHASES = ["REDIRECT", "DNS", "TCP", "TLS", "REQUEST", "RESPONSE", "RTT", "UNLOAD"];

const ITEMS: TimelineItem[] = [
  item("pageview", 0, { title: "/panier", detail: "navigate" }),
  item("vital", 1, { title: "LCP", detail: "/panier", value: 2100, rating: "good" }),
  ...PHASES.map((p, i) => item("vital", 1 + i / 10, { title: p, detail: "/panier", value: 12 })),
  item("action", 10, { title: "Payer", detail: "click · /panier", action_id: "a1", action_name: "Payer" }),
  item("error", 11, { title: "TypeError", detail: "x is undefined", value: 3, action_id: "a1" }),
  item("event", 20, { title: "frustration.rage", detail: "{}" }),
];

const rendu = (props: Partial<Parameters<typeof Deroule>[0]> = {}) =>
  renderToStaticMarkup(
    <Deroule items={ITEMS} t0={T0} voir={null} liens={{}} tronque={false} {...props} />,
  );

describe("Deroule", () => {
  it("les huit phases réseau sont repliées et ne portent plus l'étiquette « Vital »", () => {
    const html = rendu();
    expect(html).toContain("Phases réseau (8)");
    // Preuve de fin du lot : aucune ligne « Vital RTT » — le nom reste lisible
    // dans le tiroir, l'étiquette de nature a disparu du déroulé.
    expect(html).not.toContain(">Vital<");
    expect(html).toContain("RTT");
  });

  it("le Web Vital est une pastille sur la ligne de sa vue, avec le verdict des seuils", () => {
    const html = rendu();
    expect(html).toContain('data-testid="entete-vue"');
    expect(html).toContain('data-testid="pastille-vital"');
    expect(html).toContain("LCP");
    // `rating2026("LCP", 2100)` = good → jeton `good`, jamais une couleur en dur.
    expect(html).toContain("text-good-ink");
    expect(html).not.toMatch(/emerald-|amber-|red-[0-9]/);
  });

  it("l'effet d'une action est imbriqué sous elle, sans badge causal en doublon", () => {
    const html = rendu();
    expect(html).toContain('data-testid="effets-action"');
    expect(html).toContain("Déclenché par cette action");
    expect(html).not.toContain("↳ Payer");
  });

  it("les liens sortants sont ceux que la page a pré-calculés, et eux seuls", () => {
    const sansLien = rendu();
    expect(sansLien).not.toContain('data-testid="lien-ligne"');
    const avecLien = rendu({ liens: { 0: "/pages?app=a&route=%2Fpanier" } });
    expect(avecLien).toContain("/pages?app=a&amp;route=%2Fpanier");
  });

  it("les ancres restent celles de la chronologie lue (récit « En bref », P*.9)", () => {
    const html = rendu();
    // Le récit vérifie en e2e que chaque lien désigne un `li#evt-N` de la
    // chronologie — y compris une PASTILLE de vital et une PHASE réseau, que le
    // groupement sort de la liste plate. Aucune ligne lue ne perd son ancre.
    for (let i = 0; i < ITEMS.length; i++) {
      expect(html).toMatch(new RegExp(`<li[^>]*\\bid="evt-${i}"`));
    }
  });

  it("un vital rapporté sans vue connue reste rendu, avec son ancre", () => {
    const orphelin = [item("vital", 0, { title: "TTFB", detail: null, value: 700 })];
    const html = rendu({ items: orphelin });
    expect(html).toMatch(/<li[^>]*\bid="evt-0"/);
    expect(html).toContain("TTFB");
  });

  it("`voir=erreur` ne montre que les erreurs ; une nature sans ligne le dit", () => {
    const erreurs = rendu({ voir: ["erreur"] });
    expect(erreurs).toContain("TypeError");
    expect(erreurs).not.toContain("Phases réseau");
    expect(erreurs).not.toContain('data-testid="entete-vue"');
    expect(erreurs).not.toContain("frustration.rage");

    const vide = rendu({ voir: ["ressource"] });
    expect(vide).toContain("Aucun événement de cette nature dans cette session");
  });

  it("chronologie vide et chronologie tronquée : deux états distincts, tous deux dits", () => {
    expect(rendu({ items: [] })).toContain("Aucun événement enregistré pour cette session");
    expect(rendu({ tronque: true })).toContain("chronologie tronquée à 500 événements");
  });
});

// Refonte du 30/09/2026 — la frise de la session : la chronologie GRAPHIQUE en tête du
// détail. Mêmes lignes que le déroulé, rangées par piste, sur un axe gradué.
describe("FriseSession", () => {
  const FIN = T0 + 60_000;

  it("une vue s'étend jusqu'à la suivante, la dernière jusqu'à la fin ; les Web Vitals n'y sont pas", () => {
    const items = [...ITEMS, item("pageview", 30, { title: "/merci" })];
    const elements = elementsDeFrise(items, T0, FIN);
    const vues = elements.filter((e) => e.piste === "vues");
    expect(vues.map((v) => [v.libelle, v.debutMs, v.dureeMs])).toEqual([
      ["/panier", 0, 30_000],
      ["/merci", 30_000, 30_000],
    ]);
    expect(elements.some((e) => e.libelle === "LCP")).toBe(false);
    expect(elements.find((e) => e.piste === "erreurs")?.libelle).toBe("TypeError : x is undefined");
    expect(elements.find((e) => e.piste === "frustration")?.libelle).toBe("Clics de rage");
    expect(elements.find((e) => e.piste === "actions")?.rang).toBe(10);
  });

  it("dessine une piste par nature présente, un axe gradué, et renvoie chaque point à sa ligne du déroulé", () => {
    const html = renderToStaticMarkup(
      <FriseSession items={ITEMS} debut={T0} fin={FIN} hrefDe={{ 11: "#evt-11" }} tronquee={false} />,
    );
    for (const piste of ["vues", "actions", "erreurs", "frustration"]) expect(html).toContain(`data-piste="${piste}"`);
    expect(html).not.toContain('data-piste="api"');
    expect(html).toContain('href="#evt-11"');
    expect(html).toContain('tabindex="-1"');
    // Axe : 0, puis des durées lisibles (« 15 s », « 1 min »), jamais « 0,5 min ».
    expect(html).toMatch(/>15[\s ]s</);
    expect(html).toMatch(/>1[\s ]min</);
    expect(html).not.toMatch(/0,5[\s ]min/);
    // Résumé lu à la place du dessin, décoratif.
    expect(html).toContain("Pages : 1 · Actions : 1 · Frustration : 1 · Erreurs : 1");
  });

  it("chronologie tronquée : la frise le dit", () => {
    const html = renderToStaticMarkup(<FriseSession items={ITEMS} debut={T0} fin={FIN} hrefDe={{}} tronquee />);
    expect(html).toContain("chronologie tronquée : début seulement");
  });
});
