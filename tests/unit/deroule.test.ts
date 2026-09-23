// F45 — groupement du déroulé d'une session par vue (`lib/deroule.ts`, plan § 5.12.4).
//
// CE QUE CES TESTS TIENNENT, ET QUI NE SE VOIT PAS À LA LECTURE DU CODE :
//   - un Web Vital va sur la vue de MÊME ROUTE la plus proche avant lui, même si
//     une autre vue s'est ouverte entre-temps (SPA : le LCP de /a peut arriver
//     après l'ouverture de /b) ;
//   - les phases réseau ne sont pas des Web Vitals et vivent dans leur propre
//     tiroir : c'est ce qui fait disparaître la ligne « Vital RTT » ;
//   - les effets d'une action sont rattachés à ELLE, pas à la vue ;
//   - un effet orphelin (action absente de la chronologie) n'est pas inventé ;
//   - le filtre `voir=` ne perd rien d'autre que ce qu'on lui demande d'écarter.
import { describe, expect, it } from "vitest";
import {
  elementsDuGroupe,
  filtrerParNature,
  grouperParVue,
  natureDe,
} from "@/lib/deroule";
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

const vue = (s: number, route: string, nav = "navigate") => item("pageview", s, { title: route, detail: nav });
const vital = (s: number, nom: string, route: string, valeur: number) =>
  item("vital", s, { title: nom, detail: route, value: valeur });

describe("grouperParVue", () => {
  it("une section par page vue ; ce qui précède la première vue reste dans un groupe sans vue", () => {
    const items = [item("event", 0, { title: "app.demarre" }), vue(1, "/"), item("error", 2, { title: "TypeError" })];
    const groupes = grouperParVue(items);
    expect(groupes).toHaveLength(2);
    expect(groupes[0].vue).toBeNull();
    expect(groupes[0].autres.map((i) => i.title)).toEqual(["app.demarre"]);
    expect(groupes[1].vue?.title).toBe("/");
    expect(groupes[1].autres.map((i) => i.title)).toEqual(["TypeError"]);
  });

  it("un LCP rapporté APRÈS la vue suivante revient à la vue de sa route, pas à la vue courante", () => {
    // SPA : /a s'ouvre, /b s'ouvre, puis le LCP de /a est enfin rapporté.
    const items = [vue(0, "/a"), vue(5, "/b", "route-change"), vital(6, "LCP", "/a", 2100)];
    const [a, b] = grouperParVue(items);
    expect(a.vue?.title).toBe("/a");
    expect(a.vitals.map((v) => v.title)).toEqual(["LCP"]);
    expect(b.vitals).toEqual([]);
  });

  it("sans route connue, un vital reste sur la vue courante", () => {
    const items = [vue(0, "/a"), item("vital", 1, { title: "INP", detail: null, value: 90 })];
    const [a] = grouperParVue(items);
    expect(a.vitals.map((v) => v.title)).toEqual(["INP"]);
  });

  it("les huit phases réseau d'une vue sortent des Web Vitals et vont dans leur tiroir", () => {
    const phases = ["REDIRECT", "DNS", "TCP", "TLS", "REQUEST", "RESPONSE", "RTT", "UNLOAD"];
    const items = [vue(0, "/"), vital(1, "LCP", "/", 2100), ...phases.map((p, i) => vital(1 + i / 10, p, "/", 12))];
    const [g] = grouperParVue(items);
    expect(g.vitals.map((v) => v.title)).toEqual(["LCP"]);
    expect(g.phases).toHaveLength(8);
    expect(g.phases.map((p) => p.title)).toEqual(phases);
  });

  it("une action porte ses effets ; un effet dont l'action manque reste une ligne de premier niveau", () => {
    const items = [
      vue(0, "/panier"),
      item("action", 10, { title: "Payer", action_id: "a1", action_name: "Payer" }),
      item("api", 11, { title: "POST /api/paiement", action_id: "a1", value: 180 }),
      item("error", 12, { title: "TypeError", action_id: "a1" }),
      item("resource", 13, { title: "script", action_id: "a1", value: 300 }),
      // Action jamais reçue (chronologie tronquée, ou table `rum_action` absente) :
      // on ne fabrique pas une action pour accueillir son effet.
      item("error", 20, { title: "RangeError", action_id: "inconnue", action_name: "Valider" }),
    ];
    const [g] = grouperParVue(items);
    expect(g.actions).toHaveLength(1);
    expect(g.actions[0].action.title).toBe("Payer");
    expect(g.actions[0].effets.map((e) => e.title)).toEqual(["POST /api/paiement", "TypeError", "script"]);
    expect(g.autres.map((a) => a.title)).toEqual(["RangeError"]);
  });

  it("aucun événement n'est perdu ni dupliqué", () => {
    const items = [
      item("breadcrumb", 0, { title: "click" }),
      vue(1, "/"),
      vital(2, "CLS", "/", 0.05),
      vital(2, "DNS", "/", 8),
      item("action", 3, { title: "Ajouter", action_id: "a1", action_name: "Ajouter" }),
      item("event", 4, { title: "panier.ajout", action_id: "a1" }),
      vue(5, "/panier"),
      item("longtask", 6, { title: "Blocage · recalculer", value: 220 }),
    ];
    const compte = grouperParVue(items).reduce(
      (n, g) =>
        n +
        (g.vue ? 1 : 0) +
        g.vitals.length +
        g.phases.length +
        g.autres.length +
        g.actions.reduce((m, a) => m + 1 + a.effets.length, 0),
      0,
    );
    expect(compte).toBe(items.length);
  });
});

describe("elementsDuGroupe", () => {
  it("remet actions et lignes seules dans l'ordre du temps, l'action d'abord à instant égal", () => {
    const items = [
      vue(0, "/"),
      item("error", 1, { title: "TypeError" }),
      item("action", 2, { title: "Payer", action_id: "a1", action_name: "Payer" }),
      item("event", 3, { title: "panier.vu" }),
    ];
    const [g] = grouperParVue(items);
    expect(elementsDuGroupe(g).map((e) => (e.type === "action" ? e.entree.action.title : e.item.title))).toEqual([
      "TypeError",
      "Payer",
      "panier.vu",
    ]);

    const exAequo = grouperParVue([
      vue(0, "/"),
      item("error", 2, { title: "TypeError" }),
      item("action", 2, { title: "Payer", action_id: "a1", action_name: "Payer" }),
    ])[0];
    expect(elementsDuGroupe(exAequo)[0].type).toBe("action");
  });
});

describe("natureDe et filtrerParNature", () => {
  it("un vital a la nature de sa vue : il est rendu SUR elle, pas à côté", () => {
    expect(natureDe(item("vital", 0, { title: "LCP" }))).toBe("vue");
    expect(natureDe(item("pageview", 0, { title: "/" }))).toBe("vue");
  });

  it("un événement `frustration.*` est de nature frustration, les autres sont des événements", () => {
    expect(natureDe(item("event", 0, { title: "frustration.rage" }))).toBe("frustration");
    expect(natureDe(item("event", 0, { title: "panier.vu" }))).toBe("evenement");
    expect(natureDe(item("breadcrumb", 0, { title: "click" }))).toBe("evenement");
  });

  it("`voir=erreur` ne laisse que les erreurs ; absent ou complet ne retire rien", () => {
    const items = [vue(0, "/"), vital(1, "LCP", "/", 2100), item("error", 2, { title: "TypeError" }), item("api", 3)];
    expect(filtrerParNature(items, ["erreur"]).map((i) => i.kind)).toEqual(["error"]);
    expect(filtrerParNature(items, null)).toHaveLength(items.length);
    expect(
      filtrerParNature(items, ["vue", "action", "erreur", "api", "frustration", "ressource", "tache", "evenement"]),
    ).toHaveLength(items.length);
  });

  it("`voir=vue` garde la vue AVEC ses vitals : une vue sans son LCP ne dit plus rien", () => {
    const items = [vue(0, "/"), vital(1, "LCP", "/", 2100), item("error", 2, { title: "TypeError" })];
    const [g] = grouperParVue(filtrerParNature(items, ["vue"]));
    expect(g.vue?.title).toBe("/");
    expect(g.vitals.map((v) => v.title)).toEqual(["LCP"]);
  });
});
