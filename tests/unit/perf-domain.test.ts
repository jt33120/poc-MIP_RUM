// F10 — règles de valeur du domaine performance (lib/perf-domain.ts).
//
// Ce que l'écran a le droit de tirer des lectures : une part jamais au-dessus de
// 100 %, jamais calculée sur une base vide ni sur une population échantillonnée
// différemment (CP15) ; un ratio « pour 100 vues » qui peut dépasser 100 et vaut
// `null`, pas 0, sans vue.
import { describe, expect, it } from "vitest";
import { queryOf } from "../../apps/console/lib/filters";
import {
  RAISON_ECHANTILLONNAGE,
  avecCondition,
  partTouchees,
  ratioPour100,
  serieRatioPour100,
} from "../../apps/console/lib/perf-domain";

describe("partTouchees", () => {
  it("base 0 → null, avec la raison et la plage", () => {
    expect(partTouchees({ base: 0, touchees: 0, tauxMin: null }, "24 h")).toEqual({
      valeur: null,
      raison: "aucune session avec vue sur 24 h",
    });
  });

  it("tauxMin 0,1 → null : erreurs et vues échantillonnées différemment (CP15)", () => {
    expect(partTouchees({ base: 40, touchees: 4, tauxMin: 0.1 })).toEqual({ valeur: null, raison: RAISON_ECHANTILLONNAGE });
  });

  it("tauxMin inconnu sur une base non vide → null (jamais supposé à 1)", () => {
    expect(partTouchees({ base: 40, touchees: 4, tauxMin: null }).valeur).toBeNull();
  });

  it("touchees / base quand tout est collecté", () => {
    expect(partTouchees({ base: 40, touchees: 10, tauxMin: 1 })).toEqual({ valeur: 0.25, raison: null });
  });

  it("jamais > 1, même sur une entrée incohérente", () => {
    expect(partTouchees({ base: 3, touchees: 5, tauxMin: 1 }).valeur).toBe(1);
  });
});

describe("ratioPour100", () => {
  it("0 vue → null (aucun dénominateur), jamais 0", () => {
    expect(ratioPour100(12, 0)).toBeNull();
    expect(ratioPour100(0, 0)).toBeNull();
    expect(ratioPour100(5, null)).toBeNull();
  });

  it("30 occurrences pour 20 vues → 150 : un ratio, pas une part", () => {
    expect(ratioPour100(30, 20)).toBe(150);
  });

  it("0 occurrence sur des vues → 0 réel", () => {
    expect(ratioPour100(0, 20)).toBe(0);
  });
});

describe("serieRatioPour100", () => {
  it("seau sans vue → null (trou) ; seau absent des erreurs → null ; sinon le ratio", () => {
    const vues = [
      { bucket: "2026-09-22T10:00:00Z", chargements: 15, spa: 4, inconnu: 1 },
      { bucket: "2026-09-22T11:00:00Z", chargements: 0, spa: 0, inconnu: 0 },
      { bucket: "2026-09-22T12:00:00Z", chargements: 10, spa: 0, inconnu: 0 },
    ];
    const erreurs = [
      { bucket: "2026-09-22T10:00:00Z", navigateur: 30 },
      { bucket: "2026-09-22T11:00:00Z", navigateur: 2 },
    ];
    expect(serieRatioPour100(erreurs, vues)).toEqual([
      { bucket: "2026-09-22T10:00:00Z", ratio: 150 },
      { bucket: "2026-09-22T11:00:00Z", ratio: null },
      { bucket: "2026-09-22T12:00:00Z", ratio: null },
    ]);
  });
});

describe("avecCondition", () => {
  const f = { app: "a", period: "24h" as const, device: null, segment: [] };

  it("ajoute la condition au contrat, sans toucher la fenêtre ni le périmètre", () => {
    const base = queryOf(f);
    const g = avecCondition({ ...f, query: base }, "route", "/checkout");
    expect(g.query.range).toEqual(base.range);
    expect(g.query.scope).toEqual(base.scope);
    expect(g.query.filters.segments).toEqual([{ dimension: "route", operator: "eq", value: "/checkout" }]);
  });

  it("même dimension = ET : un filtre global n'est jamais remplacé", () => {
    const base = queryOf(f);
    const avecA = { ...f, query: { ...base, filters: { ...base.filters, segments: [{ dimension: "route" as const, operator: "eq" as const, value: "/a" }] } } };
    expect(avecCondition(avecA, "route", "/b").query.filters.segments).toHaveLength(2);
  });
});

// ─────────────────────────────── F18 — Erreurs ───────────────────────────────
import { autresGroupes, libelleGroupeErreur, referencePeriodePrecedente } from "../../apps/console/lib/perf-domain";

describe("F18 — autresGroupes", () => {
  it("« Autres » = trend − Σ4, seau par seau", () => {
    const trend = [10, 7, 0, 5];
    const series = [
      [4, 2, 0, 1],
      [3, 1, 0, 1],
      [1, 1, 0, 0],
      [1, 0, 0, 1],
    ];
    expect(autresGroupes(trend, series)).toEqual([1, 3, 0, 2]);
  });

  it("borné à 0 : des séries au-dessus de la tendance (ingestion concurrente) ne dessinent rien de négatif", () => {
    expect(autresGroupes([2, 0], [[3, 0], [1, 1]])).toEqual([0, 0]);
  });

  it("≤ 4 groupes : tout est dessiné, « Autres » vaut 0 partout", () => {
    expect(autresGroupes([5, 3], [[5, 3]])).toEqual([0, 0]);
    expect(autresGroupes([5, 3], [])).toEqual([5, 3]);
  });

  it("un seau absent d'une série compte 0 (des comptes), jamais NaN", () => {
    expect(autresGroupes([4, 4], [[1]])).toEqual([3, 4]);
  });
});

describe("F18 — libelleGroupeErreur", () => {
  it("message tronqué à 40 caractères + empreinte courte : jamais le seul type", () => {
    const long = "TypeError: Cannot read properties of undefined (reading 'panier')";
    const libelle = libelleGroupeErreur({ message: long, fingerprint: "a1b2c3d4e5f6a7b8" });
    expect(libelle).toBe(`${long.slice(0, 39)}… · a1b2c3d4`);
    expect(libelle.split(" · ")[0]).toHaveLength(40);
  });

  it("cinq groupes du même type « Error » ont cinq libellés distincts", () => {
    const libelles = [1, 2, 3, 4, 5].map((i) => libelleGroupeErreur({ message: `boom ${i}`, fingerprint: `fp-${i}-xxxxxxxx` }));
    expect(new Set(libelles).size).toBe(5);
    expect(libelles).not.toContain("Error");
  });

  it("sans message : « (sans message) » ; plusieurs apps : l'app nomme le groupe", () => {
    expect(libelleGroupeErreur({ message: null, fingerprint: "ffff0000aaaa" })).toBe("(sans message) · ffff0000");
    expect(libelleGroupeErreur({ message: "  boom\n  ", fingerprint: "ffff0000aaaa", app_id: "shop" })).toBe(
      "boom · ffff0000 · shop",
    );
  });
});

describe("F18 — referencePeriodePrecedente", () => {
  it("24 h : la plage précédente, datée en UTC", () => {
    expect(
      referencePeriodePrecedente({ from: "2026-09-21T14:00:00.000Z", to: "2026-09-22T14:00:00.000Z", preset: "24h" }),
    ).toBe("vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC)");
  });

  it("plage personnalisée : « période précédente », même durée, juste avant", () => {
    expect(
      referencePeriodePrecedente({ from: "2026-09-22T10:00:00.000Z", to: "2026-09-22T12:00:00.000Z", preset: null }),
    ).toBe("vs période précédente (22/09 08:00 → 22/09 10:00 UTC)");
  });
});

// ─────────────────────────────── F22 — Interactions ───────────────────────────────
import {
  MANQUE_CAPTEUR_MOBILE,
  RAISON_RUNTIME_ABSENT,
  classerRoutesFrustrantes,
  etatCapteurFrustration,
} from "../../apps/console/lib/perf-domain";

describe("F22 — etatCapteurFrustration (R-F, CP16)", () => {
  it("sessions React Native seules → non collecté, comptes masqués (aucun « 0 »)", () => {
    expect(etatCapteurFrustration({ sessionsCouvertes: 0, sessionsTotal: 3, runtimeLu: true })).toEqual({
      etat: { kind: "non_collecte", manque: MANQUE_CAPTEUR_MOBILE },
      masquer: true,
    });
  });

  it("population mixte → partiel « N sur M », comptes affichés", () => {
    expect(etatCapteurFrustration({ sessionsCouvertes: 2, sessionsTotal: 3, runtimeLu: true })).toEqual({
      etat: { kind: "partiel", raison: "compté sur les sessions navigateur seulement (2 sur 3)" },
      masquer: false,
    });
  });

  it("colonne runtime absente → partiel « capteur non identifiable », comptes affichés", () => {
    expect(etatCapteurFrustration({ sessionsCouvertes: 5, sessionsTotal: 5, runtimeLu: false })).toEqual({
      etat: { kind: "partiel", raison: RAISON_RUNTIME_ABSENT },
      masquer: false,
    });
  });

  it("tout couvert, ou aucune session : un 0 est un vide réel", () => {
    expect(etatCapteurFrustration({ sessionsCouvertes: 4, sessionsTotal: 4, runtimeLu: true })).toEqual({ etat: null, masquer: false });
    expect(etatCapteurFrustration({ sessionsCouvertes: 0, sessionsTotal: 0, runtimeLu: true })).toEqual({ etat: null, masquer: false });
  });
});

describe("F22 — classerRoutesFrustrantes", () => {
  const route = (r: string | null, touchees: number, sessions: number) => ({
    route: r,
    rage: touchees,
    dead: 0,
    error: 0,
    sessionsTouchees: touchees,
    sessionsRoute: sessions,
  });

  it("un taux, pas un compte : route à 3 sessions / 3 touchées classée APRÈS route à 400 / 40", () => {
    const { lignes, faibles } = classerRoutesFrustrantes([route("/petite", 3, 3), route("/checkout", 40, 400)], "gravite");
    expect(lignes.map((l) => l.route)).toEqual(["/checkout", "/petite"]);
    expect(lignes[0].taux).toBeCloseTo(0.1);
    expect(faibles).toBe(1);
  });

  it("gravité : le plus fort taux d'abord parmi les routes assez vues ; volume : le trafic", () => {
    const rows = [route("/a", 30, 300), route("/b", 90, 300), route("/c", 10, 1000)];
    expect(classerRoutesFrustrantes(rows, "gravite").lignes.map((l) => l.route)).toEqual(["/b", "/a", "/c"]);
    expect(classerRoutesFrustrantes(rows, "volume").lignes.map((l) => l.route)).toEqual(["/c", "/a", "/b"]);
  });

  it("route sans session de vue (signal seul) → taux null, en dernier, jamais 0 %", () => {
    const { lignes } = classerRoutesFrustrantes([route(null, 2, 0), route("/a", 1, 100)], "gravite");
    expect(lignes.map((l) => l.route)).toEqual(["/a", null]);
    expect(lignes[1].taux).toBeNull();
  });
});

import { ecartAuTauxEnsemble, tauxEnsembleRoutes } from "../../apps/console/lib/perf-domain";

describe("F22 — tauxEnsembleRoutes et ecartAuTauxEnsemble (même population que les lignes)", () => {
  // w1 voit /panier et y rage ; w2 voit /panier et /, erreur sur / ; w3 voit /, clic mort.
  // Par route : /panier 1 touchée (w1) sur 2 (w1, w2) ; / 2 touchées (w2, w3) sur 2.
  // L'ancienne référence (touchées n'importe où / sessions avec vue) valait 3/3 = 100 % :
  // « / » paraissait « +0 pt » et /panier « −50 pts ». Sur les couples : 3/4 = 75 %.
  const routes = [
    { route: "/panier", sessionsTouchees: 1, sessionsRoute: 2 },
    { route: "/", sessionsTouchees: 2, sessionsRoute: 2 },
  ];

  it("Σ touchées / Σ sessions de la route, sur les couples session × route", () => {
    expect(tauxEnsembleRoutes(routes)).toEqual({ taux: 0.75, touchees: 3, couples: 4 });
  });

  it("écarts en points au taux de l'ensemble : /panier −25 pts, / +25 pts", () => {
    const ensemble = tauxEnsembleRoutes(routes).taux;
    expect(ecartAuTauxEnsemble(0.5, ensemble)).toEqual({ valeur: -0.25, affichage: "−25 pts vs ensemble" });
    expect(ecartAuTauxEnsemble(1, ensemble)).toEqual({ valeur: 0.25, affichage: "+25 pts vs ensemble" });
    expect(ecartAuTauxEnsemble(0.75, ensemble)?.affichage).toBe("0 pt vs ensemble");
  });

  it("sans couple (aucune vue) → null, jamais 0 % ; taux de route inconnu → pas d'écart", () => {
    expect(tauxEnsembleRoutes([]).taux).toBeNull();
    expect(tauxEnsembleRoutes([{ sessionsTouchees: 0, sessionsRoute: 0 }]).taux).toBeNull();
    expect(ecartAuTauxEnsemble(null, 0.5)).toBeNull();
    expect(ecartAuTauxEnsemble(0.5, null)).toBeNull();
  });
});

// ─── F14 — Pages : jointure du classement, tuile « Routes au-delà de Bon », références ───
import * as pagesF14 from "../../apps/console/lib/perf-domain";

describe("F14 — Pages : classement des routes et tuiles", () => {
  const groupeF14 = (valeur: string | null, lcp: [number | null, number], inp: [number | null, number] = [null, 0]) => ({
    valeur,
    samples: lcp[1] + inp[1],
    lcp_n: lcp[1],
    inp_n: inp[1],
    cls_n: 0,
    lcp_p75: lcp[0],
    inp_p75: inp[0],
    cls_p75: null,
  });
  const routeF14 = (route: string, views: number, longtasks: number) => ({
    route,
    views,
    lcp_p75: null,
    inp_p75: null,
    cls_p75: null,
    longtasks,
  });

  it("jointure par route : vues et tâches longues rapprochées, route absente de l'autre lecture → null", () => {
    const lignes = pagesF14.joindreRoutesPages(
      [groupeF14("/a", [3000, 40]), groupeF14("/b", [1200, 80]), groupeF14(null, [900, 5])],
      [routeF14("/a", 120, 4), routeF14("/hors-classement", 9, 1)],
      new Map([
        ["/a", [{ route: "/a", url: "https://x/app.js", type: "script", avg_ms: 900, n: 3, render_blocking: true }]],
      ]),
    );
    expect(lignes.map((l) => [l.valeur, l.vues, l.tachesLongues, l.bloquantes])).toEqual([
      ["/a", 120, 4, 1],
      // Absente de `slowRoutes` : inconnue, jamais 0 ; aucune ressource collectée : 0 bloquante.
      ["/b", null, null, 0],
      // « Inconnu » (sans route) : rien à rapprocher.
      [null, null, null, null],
    ]);
    // Jointure À GAUCHE : une route que le découpage ne classe pas n'est pas ajoutée.
    expect(lignes.some((l) => l.valeur === "/hors-classement")).toBe(false);
  });

  it("lectures en échec → null partout, jamais 0", () => {
    const [l] = pagesF14.joindreRoutesPages([groupeF14("/a", [3000, 40])], null, null);
    expect([l.vues, l.tachesLongues, l.bloquantes]).toEqual([null, null, null]);
  });

  it("FCP et TTFB ne classent pas les routes (CP2), avec la raison", () => {
    expect(pagesF14.classementParRoute("INP")).toEqual({ disponible: true, vital: "INP" });
    expect(pagesF14.classementParRoute("FCP")).toEqual({
      disponible: false,
      raison: "classement FCP non disponible : le découpage ne lit que LCP, INP, CLS",
    });
    expect(pagesF14.classementParRoute("TTFB").disponible).toBe(false);
  });

  it("« Routes au-delà de Bon » : routes non faibles seulement, dénominateur écrit, « Inconnu » exclu", () => {
    const tuile = pagesF14.tuileRoutesAuDelaDeBon(
      [
        groupeF14("/lente", [4200, 40]),
        groupeF14("/juste-bonne", [2500, 60]), // borne « Bon » inclusive : pas au-delà
        groupeF14("/rapide", [900, 300]),
        groupeF14("/rare-et-lente", [9000, 12]), // faible effectif : non comptée
        groupeF14("/sans-lcp", [null, 0], [150, 50]),
        groupeF14(null, [8000, 500]),
      ],
      "LCP",
    );
    expect(tuile.valeur).toBe(1);
    expect([tuile.classees, tuile.faibles, tuile.sansMesure]).toEqual([3, 1, 1]);
    expect(tuile.lecture).toContain("sur 3 routes classées, 1 à faible effectif");
    expect(tuile.lecture).toContain("1 sans mesure LCP");
    // La borne vient de lib/rating.ts, formatée, jamais recopiée.
    expect(tuile.lecture).toContain("au-delà de 2,5");
  });

  it("aucune route classée → null avec sa raison, jamais « 0 »", () => {
    expect(pagesF14.tuileRoutesAuDelaDeBon([], "LCP")).toMatchObject({ valeur: null, raison: "aucune route mesurée" });
    expect(pagesF14.tuileRoutesAuDelaDeBon([groupeF14("/a", [9000, 12])], "LCP")).toMatchObject({
      valeur: null,
      raison: "aucune route avec au moins 30 mesures LCP",
    });
  });

  it("écart à l'ensemble : signé, formaté, un inconnu d'un côté n'est pas un écart", () => {
    expect(pagesF14.ecartAEnsemblePages(3700, 2500, "LCP").affichage).toMatch(/^\+1,2\s+s vs ensemble$/);
    expect(pagesF14.ecartAEnsemblePages(160, 200, "INP").affichage).toMatch(/^−40\s+ms vs ensemble$/);
    expect(pagesF14.ecartAEnsemblePages(null, 2500, "LCP")).toEqual({ valeur: null, affichage: "écart non calculable" });
  });

  it("référence `cmp=prev` datée en UTC et accordée", () => {
    const range = { from: "2026-09-21T14:00:00.000Z", to: "2026-09-22T14:00:00.000Z", preset: "24h" as const, bucketSeconds: 3600 };
    expect(pagesF14.referencePrecedentePages(range)).toBe("vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC)");
    expect(pagesF14.referencePrecedentePages({ ...range, from: "2026-09-15T14:00:00.000Z", preset: "7d" })).toMatch(/^vs 7 j précédents \(/);
    expect(pagesF14.referencePrecedentePages({ ...range, preset: null })).toMatch(/^vs période précédente \(20\/09 14:00/);
  });

  it("écart de p75 entre releases : établi seulement si les intervalles sont disjoints, libellé par la release", () => {
    const i = (bas: number, haut: number) => ({ bas, haut, niveau: 0.95 as const, methode: "quantile_normal" as const });
    expect(pagesF14.ecartP75EntreReleases(i(3000, 3400), i(2000, 2400), "1.4.1")).toMatchObject({ etabli: true });
    const chevauche = pagesF14.ecartP75EntreReleases(i(2300, 2600), i(2000, 2400), "1.4.1");
    expect(chevauche?.etabli).toBe(false);
    expect(chevauche?.regle).toContain("release 1.4.1");
    expect(chevauche?.regle).not.toContain("période précédente");
    expect(pagesF14.ecartP75EntreReleases({ indisponible: "7 mesures, 13 requises" }, i(1, 2), "1.4.1")?.etabli).toBe(false);
  });
});

// ─── F15 — Pages : phases du TTFB, plafond d'affichage des distributions ───
import * as pagesF15 from "../../apps/console/lib/perf-domain";

describe("F15 — Pages : phases du TTFB et distributions", () => {
  it("phases filtrées sur les 6 noms, dans l'ordre ; vitals et noms inconnus écartés ; phase absente → « — », n = 0", () => {
    const phases = pagesF15.phasesTtfb([
      { name: "LCP", p75: 2400, n: 300 },
      { name: "TTFB", p75: 600, n: 300 },
      { name: "TLS", p75: 40, n: 120 },
      { name: "DNS", p75: 12, n: 280 },
      { name: "SVI_ATTENTE", p75: 9000, n: 4 },
      { name: "RESPONSE", p75: 80, n: 290 },
    ]);
    expect(phases.map((p) => p.cle)).toEqual(["REDIRECT", "DNS", "TCP", "TLS", "REQUEST", "RESPONSE"]);
    expect(phases.find((p) => p.cle === "DNS")).toMatchObject({ p75: 12, n: 280 });
    // Absente : une ligne, sans valeur, jamais retirée ni mise à 0 ms.
    expect(phases.find((p) => p.cle === "TCP")).toMatchObject({ p75: null, n: 0 });
    expect(phases.find((p) => p.cle === "REDIRECT")).toMatchObject({ p75: null, n: 0 });
  });

  it("plafond d'affichage : p95 44 ms → p99 arrondi au multiple de 100 ms supérieur, et dit", () => {
    expect(pagesF15.plafondAffichage("LCP", { p95: 44, p99: 61 })).toEqual({
      plafond: 100,
      libelle: expect.stringMatching(/^plafond d'affichage : p99 arrondi \(100\s+ms\)$/),
    });
    expect(pagesF15.plafondAffichage("INP", { p95: 40, p99: 230 }).plafond).toBe(300);
    // Un multiple exact reste lui-même.
    expect(pagesF15.plafondAffichage("LCP", { p95: 200, p99: 300 }).plafond).toBe(300);
  });

  it("plafond par défaut (`VITAL_CAP`) quand la population n'est pas concentrée, ou sans percentiles", () => {
    expect(pagesF15.plafondAffichage("LCP", { p95: 1200, p99: 3000 })).toEqual({ plafond: 6000, libelle: null });
    expect(pagesF15.plafondAffichage("LCP", null)).toEqual({ plafond: 6000, libelle: null });
    expect(pagesF15.plafondAffichage("TTFB", { p95: null, p99: 20 })).toEqual({ plafond: 3000, libelle: null });
  });

  it("CLS : pas de 0,05, sans erreur d'arrondi flottant ; jamais un plafond nul", () => {
    expect(pagesF15.plafondAffichage("CLS", { p95: 0.004, p99: 0.031 }).plafond).toBe(0.05);
    expect(pagesF15.plafondAffichage("CLS", { p95: 0.05, p99: 0.12 }).plafond).toBe(0.15);
    expect(pagesF15.plafondAffichage("LCP", { p95: 0, p99: 0 }).plafond).toBe(100);
  });

  it("sous vital=FCP ou TTFB, la 3ᵉ distribution est celle du vital choisi", () => {
    expect(pagesF15.distributionsAffichees("LCP")).toEqual(["LCP", "INP", "CLS"]);
    expect(pagesF15.distributionsAffichees("CLS")).toEqual(["LCP", "INP", "CLS"]);
    expect(pagesF15.distributionsAffichees("FCP")).toEqual(["LCP", "INP", "FCP"]);
    expect(pagesF15.distributionsAffichees("TTFB")).toEqual(["LCP", "INP", "TTFB"]);
  });
});

describe("F15 — Pages : écart d'une phase du TTFB à la période précédente", () => {
  const phase = (p75: number | null, n: number) => ({ p75, n });

  it("même seuil que les tuiles Web Vitals de l'écran (§ 3.12 : 100)", () => {
    expect(pagesF15.FAIBLE_SOUS_PHASE_TTFB).toBe(100);
  });

  it("3 mesures ne s'écrivent pas comme 3 000 : « échantillon faible » à la place du chiffre", () => {
    const faible = pagesF15.ecartPhaseTtfb(phase(90, 3), phase(20, 3_000));
    expect(faible).toEqual({ kind: "silence", texte: pagesF15.TEXTE_ECART_PHASE_FAIBLE });
    expect(pagesF15.TEXTE_ECART_PHASE_FAIBLE).toContain("échantillon faible");
    // Faible de l'AUTRE côté aussi : la période précédente sous le seuil.
    expect(pagesF15.ecartPhaseTtfb(phase(90, 3_000), phase(20, 99))?.kind).toBe("silence");
  });

  it("au seuil sur les deux périodes : l'écart signé, en ms (un écart de percentiles, jamais un %)", () => {
    const e = pagesF15.ecartPhaseTtfb(phase(140, 100), phase(100, 3_000));
    expect(e).toMatchObject({ kind: "ecart", valeur: 40 });
    expect(e?.kind === "ecart" && e.affichage).toMatch(/^\+40\s+ms$/);
    const baisse = pagesF15.ecartPhaseTtfb(phase(60, 500), phase(100, 500));
    expect(baisse?.kind === "ecart" && baisse.affichage).toMatch(/^−40\s+ms$/);
    expect(baisse?.kind === "ecart" && baisse.affichage).not.toContain("%");
  });

  it("phase non mesurée avant → dit ; pas de période précédente ou pas de valeur courante → rien", () => {
    expect(pagesF15.ecartPhaseTtfb(phase(90, 500), phase(null, 0))).toEqual({
      kind: "silence",
      texte: pagesF15.TEXTE_ECART_PHASE_SANS_MESURE,
    });
    expect(pagesF15.ecartPhaseTtfb(phase(90, 500), undefined)).toBeNull();
    expect(pagesF15.ecartPhaseTtfb(phase(null, 0), phase(90, 500))).toBeNull();
  });
});
