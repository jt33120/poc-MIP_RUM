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

// ═══════════════════ F46 — fenêtre ancrée, cascade, Web Vitals par vue ═══════════════════
import {
  PARTIEL_RESSOURCES,
  PISTES_SESSION,
  VUE_FIN_INCONNUE,
  VUE_JUSQU_A_LA_FIN,
  VUE_JUSQU_A_SUIVANTE,
  cascadeDeSession,
  fenetreDeSession,
  libelleFenetre,
  reperesDeSession,
  tonAppel,
  vitauxDeSession,
} from "@/lib/deroule";
import {
  PARTIEL_RESSOURCES as PARTIEL_PANNEAU,
  PISTES_SESSION as PISTES_PANNEAU,
  cascadeDeSession as cascadePanneau,
} from "@/lib/panneau-session";
import { DEFAULT_SLOW_RESOURCE_MS, RESOURCE_CAP_PER_PAGE } from "../../packages/rum-sdk/src/resources";

describe("F46 — fenetreDeSession : la fenêtre est ancrée sur la session, pas sur aujourd'hui", () => {
  const JOUR = 86_400_000;
  const MAINTENANT = Date.UTC(2026, 8, 23, 12, 0, 0);

  it("session commencée il y a 20 jours : de J−27 à J−19, jamais « les 7 derniers jours »", () => {
    const f = fenetreDeSession(MAINTENANT - 20 * JOUR, MAINTENANT);
    expect(f).toEqual({ from: "2026-08-27T12:00:00Z", to: "2026-09-04T12:00:00Z" });
    // Huit jours, sous la limite de 30 jours du contrat.
    expect(Date.parse(f.to) - Date.parse(f.from)).toBe(8 * JOUR);
  });

  it("session commencée il y a 2 heures : `to` = maintenant, jamais dans le futur", () => {
    const f = fenetreDeSession(MAINTENANT - 2 * 3_600_000, MAINTENANT);
    expect(f).toEqual({ from: "2026-09-16T10:00:00Z", to: "2026-09-23T12:00:00Z" });
  });

  it("à la seconde, arrondi vers le bas : la borne haute ne dépasse pas l'heure du serveur", () => {
    const f = fenetreDeSession(MAINTENANT - 60_000 + 456, MAINTENANT + 789);
    expect(f.to).toBe("2026-09-23T12:00:00Z");
    expect(Date.parse(f.to)).toBeLessThanOrEqual(MAINTENANT + 789);
  });

  it("libelleFenetre : « du JJ/MM au JJ/MM », en UTC", () => {
    expect(libelleFenetre("2026-09-03T22:30:00Z", "2026-09-11T22:30:00Z")).toBe("du 03/09 au 11/09");
  });
});

describe("F46 — cascadeDeSession : la chronologie sur l'axe de `Cascade`", () => {
  const FIN = T0 + 300_000;
  const ITEMS: TimelineItem[] = [
    vue(0, "/"),
    vital(1, "FCP", "/", 800),
    vital(1, "LCP", "/", 2100),
    vital(1, "DNS", "/", 12),
    item("action", 20, { title: "Payer", detail: "click · /", action_id: "a1", action_name: "Payer" }),
    item("api", 21, { title: "POST /api/paiement", detail: "500 · serveur 45 ms", value: 180, rating: "poor", action_id: "a1" }),
    item("error", 22, { title: "TypeError", detail: "x is undefined", value: 3, action_id: "a1" }),
    item("resource", 23, { title: "script", detail: "https://cdn.example/app.js", value: 450, action_id: "a1" }),
    item("longtask", 24, { title: "Blocage · recalculer", value: 220 }),
    item("event", 25, { title: "frustration.rage" }),
    vue(60, "/panier", "spa"),
    vital(61, "LCP", "/panier", 3000),
    item("api", 70, { title: "GET /api/stock", detail: "0", value: 30, rating: "poor" }),
    item("api", 71, { title: "GET /api/prix", detail: "404", value: 20, rating: "poor" }),
    item("api", 72, { title: "GET /api/ok", detail: "200", value: 25 }),
  ];
  const c = cascadeDeSession(ITEMS, new Date(T0), new Date(FIN), false, { 0: "/pages?app=a&route=%2F" });
  const par = (id: string) => c.elements.find((e) => e.id === id)!;

  it("une vue est une barre JUSQU'À LA VUE SUIVANTE ; la dernière, jusqu'à la dernière observation — et c'est dit", () => {
    expect(par("evt-0")).toMatchObject({ piste: "vues", debutMs: 0, dureeMs: 60_000, detail: VUE_JUSQU_A_SUIVANTE });
    expect(par("evt-10")).toMatchObject({ piste: "vues", debutMs: 60_000, dureeMs: 240_000, detail: VUE_JUSQU_A_LA_FIN });
    // Jamais une « durée de vue » : la console ne sait pas combien de temps la page a été lue.
    expect(JSON.stringify(c.elements)).not.toMatch(/durée de (la )?vue/i);
    expect(c.totalMs).toBe(300_000);
    expect(c.pistes).toBe(PISTES_SESSION);
    expect(c.partiel).toBe(PARTIEL_RESSOURCES);
  });

  it("chronologie tronquée : la dernière vue LUE s'arrête au dernier événement lu, et le partiel le dit", () => {
    const t = cascadeDeSession(ITEMS, T0, FIN, true);
    expect(t.elements.find((e) => e.id === "evt-10")).toMatchObject({ dureeMs: 12_000, detail: VUE_FIN_INCONNUE });
    expect(t.partiel).toContain("limitée à 500 événements");
    // Par défaut, la troncature se lit sur la chronologie elle-même (500 lignes).
    expect(cascadeDeSession(ITEMS, T0, FIN).partiel).toBe(PARTIEL_RESSOURCES);
  });

  it("actions et erreurs sont des instants ; appels, ressources et tâches longues des barres", () => {
    expect(par("evt-4")).toMatchObject({ piste: "actions", dureeMs: null, detail: "click · /" });
    // Une ligne d'erreur répétée dit ses occurrences (V1).
    expect(par("evt-6")).toMatchObject({ piste: "erreurs", dureeMs: null, ton: "erreur", detail: "3 occurrences" });
    expect(par("evt-5")).toMatchObject({ piste: "api", debutMs: 21_000, dureeMs: 180 });
    expect(par("evt-7")).toMatchObject({ piste: "ressources", dureeMs: 450, libelle: "https://cdn.example/app.js", detail: "script" });
    expect(par("evt-8")).toMatchObject({ piste: "taches", dureeMs: 220, ton: "neutre" });
  });

  it("un effet est l'enfant de son action ; événements, signaux et phases réseau restent dans le déroulé", () => {
    for (const id of ["evt-5", "evt-6", "evt-7"]) expect(par(id).parentId).toBe("evt-4");
    expect(par("evt-8").parentId ?? null).toBeNull();
    expect(c.elements.map((e) => e.id)).not.toContain("evt-9");
    expect(c.elements.map((e) => e.id)).not.toContain("evt-3");
  });

  it("ton d'un appel = sa sévérité (règle du détail de trace) : 5xx et réseau en erreur, 4xx à surveiller", () => {
    expect(par("evt-5")).toMatchObject({ ton: "erreur", detail: "500" });
    expect(par("evt-12")).toMatchObject({ ton: "erreur", detail: "réseau (statut 0)" });
    expect(par("evt-13")).toMatchObject({ ton: "warn", detail: "404" });
    expect(par("evt-14")).toMatchObject({ ton: "neutre", detail: "200" });
    expect(tonAppel("—")).toBe("neutre");
    expect(tonAppel(null)).toBe("neutre");
  });

  it("repères FCP / LCP à l'ouverture de leur vue CHARGÉE ; une vue « spa » n'en a pas", () => {
    expect(reperesDeSession(ITEMS, T0)).toEqual([
      { t: 800, libelle: "FCP /", vital: "FCP", valeur: 800 },
      { t: 2100, libelle: "LCP /", vital: "LCP", valeur: 2100 },
    ]);
  });

  it("le lien d'un élément est celui de la chronologie, pré-calculé par la page", () => {
    expect(par("evt-0").href).toBe("/pages?app=a&route=%2F");
    expect(par("evt-4").href).toBeUndefined();
  });

  it("la raison « partiel » écrite en tête suit les règles de collecte du SDK", () => {
    expect(PARTIEL_RESSOURCES).toContain(`${DEFAULT_SLOW_RESOURCE_MS} ms et plus`);
    expect(PARTIEL_RESSOURCES).toContain(`${RESOURCE_CAP_PER_PAGE} par vue`);
    expect(PARTIEL_RESSOURCES).toContain("rattachées à une action");
  });

  it("une seule conversion : le panneau de session (F43) réexporte celle de lib/deroule.ts", () => {
    expect(cascadePanneau).toBe(cascadeDeSession);
    expect(PISTES_PANNEAU).toBe(PISTES_SESSION);
    expect(PARTIEL_PANNEAU).toBe(PARTIEL_RESSOURCES);
  });
});


describe("F46 — vitauxDeSession : une ligne par vue, la pire mesure de chaque vital", () => {
  it("rattache chaque mesure à sa vue ; la pire de la session garde SA route", () => {
    const items = [
      vue(0, "/"),
      vital(1, "LCP", "/", 2100),
      vital(2, "INP", "/", 90),
      vital(2, "DNS", "/", 12),
      vue(60, "/panier"),
      vital(61, "LCP", "/panier", 4800),
      vital(62, "INP", "/panier", 150),
      vital(63, "INP", "/panier", 520),
      vue(120, "/merci"),
    ];
    const v = vitauxDeSession(items);
    expect(v.vitaux).toEqual(["LCP", "INP"]);
    // Une ligne par vue, y compris celle sans mesure : l'absence se lit.
    expect(v.lignes.map((l) => l.vue?.title)).toEqual(["/", "/panier", "/merci"]);
    expect(v.lignes[2].mesures).toEqual({});
    expect(v.lignes[1].mesures.INP).toMatchObject({ n: 2, pire: { valeur: 520, rang: 7 } });
    expect(v.pires.map((p) => [p.vital, p.pire.valeur, p.pire.route, p.n])).toEqual([
      ["LCP", 4800, "/panier", 2],
      ["INP", 520, "/panier", 3],
    ]);
  });

  it("phases réseau et mesures sans valeur n'entrent nulle part", () => {
    const v = vitauxDeSession([vue(0, "/"), vital(1, "TTFB", "/", 300), vital(1, "RTT", "/", 40), item("vital", 2, { title: "CLS", detail: "/" })]);
    expect(v.vitaux).toEqual(["TTFB"]);
    expect(v.pires).toHaveLength(1);
  });

  it("mesures reçues avant la première vue : une ligne sans vue ; aucune mesure : aucune ligne de trop", () => {
    const v = vitauxDeSession([vital(0, "FCP", "/", 900), vue(1, "/")]);
    expect(v.lignes.map((l) => l.vue?.title ?? null)).toEqual([null, "/"]);
    expect(vitauxDeSession([item("error", 0, { title: "E" })]).lignes).toEqual([]);
  });
});
