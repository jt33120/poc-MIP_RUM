// F43 — panneau de session de `/sessions` (`lib/panneau-session.ts`, plan § 5.11.4).
//
// CE QUE CES TESTS TIENNENT, ET QUI NE SE VOIT PAS À LA LECTURE DU CODE :
//   - la garde : une liste d'apps VIDE n'ouvre rien (jamais « toutes ») ;
//   - précédent / suivant n'existent que pour une session de la page affichée ;
//   - « 15 premiers événements » compte des ÉVÉNEMENTS : un premier chargement et
//     ses neuf mesures n'épuisent pas le panneau, et le LCP rapporté tard reste sur
//     SA vue — celui d'une vue non retenue ne s'invite pas ;
//   - la mini-cascade : une vue court jusqu'à la suivante, la dernière jusqu'à la
//     dernière observation ; seules les erreurs et les appels en échec sont « erreur ».
import { describe, expect, it } from "vitest";
import {
  EVENEMENTS_DU_PANNEAU,
  PARTIEL_RESSOURCES,
  PISTES_SESSION,
  cascadeDeSession,
  premiersEvenements,
  sessionDansLePerimetre,
  voisinsDansLaListe,
} from "@/lib/panneau-session";
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

const vue = (s: number, route: string) => item("pageview", s, { title: route, detail: "navigate" });
const mesure = (s: number, nom: string, route: string, valeur = 12) => item("vital", s, { title: nom, detail: route, value: valeur });
const action = (s: number, nom = `clic ${s}`) => item("action", s, { title: nom, detail: "click · /" });
const PHASES = ["REDIRECT", "DNS", "TCP", "TLS", "REQUEST", "RESPONSE", "RTT", "UNLOAD"];

describe("F43 — sessionDansLePerimetre", () => {
  it("toutes les apps (null) : ouverte ; liste : seulement ses apps ; liste vide : rien", () => {
    expect(sessionDansLePerimetre("a", null)).toBe(true);
    expect(sessionDansLePerimetre("a", ["a", "b"])).toBe(true);
    expect(sessionDansLePerimetre("c", ["a", "b"])).toBe(false);
    // `[]` = AUCUN accès, jamais « sans restriction » (V7).
    expect(sessionDansLePerimetre("a", [])).toBe(false);
  });
});

describe("F43 — voisinsDansLaListe", () => {
  const ids = ["s0", "s1", "s2"];

  it("au milieu : précédent et suivant dans l'ordre de la table", () => {
    expect(voisinsDansLaListe(ids, "s1")).toEqual({ precedent: "s0", suivant: "s2" });
  });

  it("en bout de page : le voisin manquant vaut null (bouton éteint), pas un saut de page", () => {
    expect(voisinsDansLaListe(ids, "s0")).toEqual({ precedent: null, suivant: "s1" });
    expect(voisinsDansLaListe(ids, "s2")).toEqual({ precedent: "s1", suivant: null });
    expect(voisinsDansLaListe(["seule"], "seule")).toEqual({ precedent: null, suivant: null });
  });

  it("hors de la page affichée (lien partagé, hero) : aucun parcours", () => {
    expect(voisinsDansLaListe(ids, "ailleurs")).toBeNull();
    expect(voisinsDansLaListe([], "s0")).toBeNull();
  });
});

describe("F43 — premiersEvenements", () => {
  it("compte des événements, pas des mesures : un premier chargement n'épuise pas les quinze", () => {
    const items = [
      vue(0, "/"),
      ...PHASES.map((p, i) => mesure(0.1 + i / 10, p, "/")),
      mesure(1, "FCP", "/", 900),
      ...Array.from({ length: 20 }, (_, i) => action(10 + i)),
    ];
    const r = premiersEvenements(items);
    expect(EVENEMENTS_DU_PANNEAU).toBe(15);
    expect(r.montres).toBe(15);
    expect(r.total).toBe(21);
    // La vue et ses quatorze premières actions ; les neuf mesures de la vue en plus.
    expect(r.items.filter((it) => it.kind !== "vital")).toHaveLength(15);
    expect(r.items.filter((it) => it.kind === "vital")).toHaveLength(9);
    expect(r.items.some((it) => it.title === "clic 24")).toBe(false);
  });

  it("un LCP rapporté tard reste sur SA vue ; celui d'une vue non retenue n'entre pas", () => {
    const items = [
      vue(0, "/a"),
      ...Array.from({ length: 14 }, (_, i) => action(1 + i)),
      vue(20, "/b"), // seizième événement : hors du panneau
      mesure(21, "LCP", "/b", 3100),
      mesure(22, "LCP", "/a", 2100), // rapporté quand l'onglet se masque, bien après
    ];
    const r = premiersEvenements(items);
    expect(r.montres).toBe(15);
    expect(r.total).toBe(16);
    const lcp = r.items.filter((it) => it.title === "LCP");
    expect(lcp).toHaveLength(1);
    expect(lcp[0].detail).toBe("/a");
    expect(r.items.some((it) => it.kind === "pageview" && it.title === "/b")).toBe(false);
  });

  it("garde l'ordre de la chronologie (le déroulé regroupe lui-même)", () => {
    const items = [mesure(0, "TTFB", "/"), vue(1, "/"), action(2), mesure(9, "LCP", "/", 2000)];
    const r = premiersEvenements(items);
    expect(r.items).toEqual(items);
    expect(r).toMatchObject({ montres: 2, total: 2 });
  });

  it("moins de quinze événements : tout est montré ; chronologie vide : rien", () => {
    const items = [vue(0, "/"), action(1), item("error", 2, { title: "TypeError" })];
    expect(premiersEvenements(items)).toMatchObject({ items, montres: 3, total: 3 });
    expect(premiersEvenements([])).toEqual({ items: [], montres: 0, total: 0 });
  });
});

describe("F43 — cascadeDeSession", () => {
  const debut = new Date(T0);
  const fin = new Date(T0 + 120_000);

  it("une vue court jusqu'à la suivante, la dernière jusqu'à la dernière observation — et le dit", () => {
    const c = cascadeDeSession([vue(0, "/"), vue(30, "/panier")], debut, fin);
    expect(c.totalMs).toBe(120_000);
    expect(c.pistes).toBe(PISTES_SESSION);
    const [a, b] = c.elements;
    expect(a).toMatchObject({ piste: "vues", libelle: "/", debutMs: 0, dureeMs: 30_000, ton: "neutre", detail: "jusqu'à la vue suivante" });
    expect(b).toMatchObject({ piste: "vues", libelle: "/panier", debutMs: 30_000, dureeMs: 90_000, detail: "jusqu'à la dernière observation" });
  });

  it("appel en échec = « erreur », appel réussi = neutre ; durée lue même en chaîne, absente dite", () => {
    const c = cascadeDeSession(
      [
        item("api", 5, { title: "POST /api/paiement", detail: "500 · serveur 45 ms", value: "180" as unknown as number, rating: "poor" }),
        item("api", 6, { title: "GET /api/panier", detail: "200", value: 90 }),
        item("api", 7, { title: "GET /api/stock", detail: "0", value: null, rating: "poor" }),
      ],
      debut,
      fin,
    );
    expect(c.elements[0]).toMatchObject({ piste: "api", dureeMs: 180, ton: "erreur", detail: "500" });
    expect(c.elements[1]).toMatchObject({ piste: "api", dureeMs: 90, ton: "neutre", detail: "200" });
    // Statut 0 = réseau, jamais « 500 » ; sans durée, un instant qui le dit.
    expect(c.elements[2]).toMatchObject({ dureeMs: null, ton: "erreur", detail: "réseau (statut 0) · durée non mesurée" });
  });

  it("actions et erreurs sont des instants ; une erreur répétée dit ses occurrences", () => {
    const c = cascadeDeSession(
      [action(3, "Payer"), item("error", 4, { title: "TypeError", detail: "x is undefined", value: 3 }), item("error", 5, { title: "Error", value: 1 })],
      debut,
      fin,
    );
    expect(c.elements[0]).toMatchObject({ piste: "actions", libelle: "Payer", dureeMs: null, ton: "neutre" });
    expect(c.elements[1]).toMatchObject({ piste: "erreurs", libelle: "TypeError", dureeMs: null, ton: "erreur", detail: "3 occurrences" });
    expect(c.elements[2].detail).toBeUndefined();
  });

  it("ressources et tâches longues : barres neutres (aucun seuil publié) ; la ressource se nomme par son URL", () => {
    const c = cascadeDeSession(
      [
        item("resource", 8, { title: "script", detail: "https://cdn.example/app.js", value: 420 }),
        item("longtask", 9, { title: "Blocage · recalculerTotal", detail: "", value: 180 }),
      ],
      debut,
      fin,
    );
    expect(c.elements[0]).toMatchObject({ piste: "ressources", libelle: "https://cdn.example/app.js", detail: "script", dureeMs: 420, ton: "neutre" });
    expect(c.elements[1]).toMatchObject({ piste: "taches", libelle: "Blocage · recalculerTotal", dureeMs: 180, ton: "neutre" });
    expect(c.elements[1].detail).toBeUndefined();
  });

  it("mesures, événements et fil d'Ariane ne sont pas placés : le déroulé les porte", () => {
    const c = cascadeDeSession(
      [mesure(1, "LCP", "/", 2100), item("event", 2, { title: "frustration.rage" }), item("breadcrumb", 3, { title: "nav" })],
      debut,
      fin,
    );
    expect(c.elements).toEqual([]);
  });

  it("« partiel » en tête : la collecte des ressources, et la troncature quand elle a lieu", () => {
    expect(cascadeDeSession([vue(0, "/")], debut, fin).partiel).toBe(PARTIEL_RESSOURCES);
    expect(PARTIEL_RESSOURCES).toContain("rattachées à une action");
    expect(cascadeDeSession([vue(0, "/")], debut, fin, true).partiel).toContain("limitée à 500 événements");
  });

  it("horloges désaccordées : ni durée ni axe négatifs", () => {
    const c = cascadeDeSession([vue(0, "/")], debut, new Date(T0 - 5_000));
    expect(c.totalMs).toBe(0);
    expect(c.elements[0].dureeMs).toBe(0);
  });
});
