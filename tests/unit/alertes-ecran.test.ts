// F64 — écran /alerts (plan § 5.19) : les règles pures de la page
// (apps/console/lib/alertes-ecran.ts).
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Qu'une notification « transmise » (pending) soit comptée comme livrée, ou
//     comme perdue : trois états, pas deux (v49).
//   - Qu'une règle `no_data` ou jamais évaluée passe pour « normale ».
//   - Qu'un lien « Voir la mesure » parte sur la plage de l'ÉCRAN au lieu de la
//     fenêtre ÉVALUÉE `[fired_at − window_minutes, fired_at)`.
//   - Qu'une règle franchie qui n'a pas déclenché sur la fenêtre disparaisse de la
//     frise, sous une tuile qui la compte.
import { describe, expect, it } from "vitest";
import {
  alternativeParJour,
  cibleMesure,
  comptesRegles,
  etatDeRegle,
  etatLivraison,
  fluxATraiter,
  grilleDesJours,
  hrefDeSource,
  hrefEvenement,
  libelleDeRegle,
  pistesDeDeclenchements,
  pointsParJour,
  reglageDeRegle,
  severiteConnue,
  titreEvenement,
  totalDeclenchements,
} from "../../apps/console/lib/alertes-ecran";
import type { AlertFiringRow, AlertRuleRow } from "../../apps/console/lib/queries-v2";

const REGLE: AlertRuleRow = {
  id: 7,
  app_id: "demo",
  metric: "LCP",
  route: "/checkout",
  comparator: ">",
  threshold: 2500,
  window_minutes: 15,
  webhook_url: null,
  active: true,
  created_at: new Date("2026-09-01T00:00:00Z"),
  mode: "threshold",
  severity: "warning",
  sensitivity: 3,
  baseline_weeks: 4,
  unacked: 0,
  env: null,
  last_state: "ok",
  last_value: 2100,
  last_reason: null,
  last_evaluated_at: new Date("2026-09-22T10:00:00Z"),
};

const regle = (p: Partial<AlertRuleRow>): AlertRuleRow => ({ ...REGLE, ...p });

const declenchement = (p: Partial<AlertFiringRow>): AlertFiringRow => ({
  source: "regle",
  source_id: "7",
  libelle: "LCP (ms) · /checkout",
  fired_at: new Date("2026-09-20T12:00:00Z"),
  severity: "warning",
  delivered: 1,
  pending: 0,
  acknowledged: false,
  event_id: 101,
  ...p,
});

describe("F64 — sévérités", () => {
  it("les sévérités anciennes de la base retombent sur les trois du domaine", () => {
    expect(severiteConnue("critical")).toBe("critical");
    expect(severiteConnue("page")).toBe("critical");
    expect(severiteConnue("error")).toBe("critical");
    expect(severiteConnue("warning")).toBe("warning");
    expect(severiteConnue("bizarre")).toBe("info");
  });
});

describe("F64 — comptesRegles (A3, A4)", () => {
  it("« sans données » compte le no_data ET le jamais évalué ; « franchies » ne compte que l'actif", () => {
    const c = comptesRegles([
      regle({ id: 1, last_state: "breached" }),
      regle({ id: 2, last_state: "no_data" }),
      regle({ id: 3, last_state: null }),
      regle({ id: 4, last_state: "ok" }),
      // Désactivée : son dernier état est une photo périmée, elle ne compte nulle part.
      regle({ id: 5, last_state: "breached", active: false }),
    ]);
    expect(c).toEqual({ actives: 4, franchies: 1, sansDonnees: 2, jamaisEvaluees: 1 });
  });

  it("aucune règle : des zéros réels, pas un inconnu", () => {
    expect(comptesRegles([])).toEqual({ actives: 0, franchies: 0, sansDonnees: 0, jamaisEvaluees: 0 });
  });
});

describe("F64 — barres par jour (A5 haut)", () => {
  const jours = [
    { jour: "2026-09-20", severity: "critical", n: 2, non_livres: 1 },
    { jour: "2026-09-20", severity: "warning", n: 1, non_livres: 0 },
    { jour: "2026-09-20", severity: "info", n: 0, non_livres: 0 },
    { jour: "2026-09-21", severity: "critical", n: 0, non_livres: 0 },
    { jour: "2026-09-21", severity: "warning", n: 0, non_livres: 0 },
    // Sévérité ancienne : repliée sur « critique », jamais perdue.
    { jour: "2026-09-21", severity: "page", n: 3, non_livres: 3 },
  ];

  it("la grille est en instants UTC, un seau par jour, dans l'ordre", () => {
    expect(grilleDesJours(jours)).toEqual(["2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z"]);
  });

  it("un jour sans déclenchement vaut 0 (un compte est additif), et les sévérités inconnues sont repliées", () => {
    expect(pointsParJour(jours)).toEqual([
      { t: "2026-09-20T00:00:00Z", critical: 2, warning: 1, info: 0 },
      { t: "2026-09-21T00:00:00Z", critical: 3, warning: 0, info: 0 },
    ]);
  });

  it("le total est la somme des barres, pas le plafond de lecture des 100 derniers", () => {
    expect(totalDeclenchements(jours)).toBe(6);
  });

  it("l'alternative textuelle a une ligne par jour et un total par ligne", () => {
    const a = alternativeParJour(jours);
    expect(a.colonnes).toEqual(["Jour (UTC)", "Critique", "Avertissement", "Information", "Total"]);
    expect(a.lignes).toHaveLength(2);
    expect(a.lignes[0][0]).toBe("2026-09-20");
    expect(a.lignes[1][4]).toBe("3");
  });
});

describe("F64 — état d'une règle (A7, frise)", () => {
  it("no_data dit sa raison ; jamais évaluée n'est pas « normale »", () => {
    expect(etatDeRegle(regle({ last_state: "no_data", last_reason: "moins de 4 fenêtres" }))).toEqual({
      libelle: "Données insuffisantes",
      ton: "neutre",
      raison: "moins de 4 fenêtres",
    });
    expect(etatDeRegle(regle({ last_state: null })).libelle).toBe("Données insuffisantes");
    expect(etatDeRegle(regle({ last_state: "breached" }))).toMatchObject({ libelle: "Franchie", ton: "bad" });
    expect(etatDeRegle(regle({ last_state: "ok" }))).toMatchObject({ libelle: "Normale", ton: "good" });
    expect(etatDeRegle(regle({ active: false })).libelle).toBe("Désactivée");
  });

  it("le libellé et le réglage disent ce que la règle surveille, sans lire son formulaire", () => {
    expect(libelleDeRegle(regle({}))).toBe("LCP (ms) · /checkout");
    expect(libelleDeRegle(regle({ route: null }))).toBe("LCP (ms)");
    // `formater("count")` sépare les milliers par une espace fine insécable : on
    // compare le texte NORMALISÉ, pas l'octet de l'espace.
    const sansFine = (texte: string) => texte.replace(/[\u202f\u00a0]/g, " ");
    expect(sansFine(reglageDeRegle(regle({})))).toBe("seuil : > 2 500 sur 15 min · sévérité warning");
    expect(sansFine(reglageDeRegle(regle({ mode: "baseline", env: "prod" })))).toBe(
      "anomalie (baseline) : écart à l'habitude au-delà de 3 sigma sur 15 min · sévérité warning · env prod",
    );
  });
});

describe("F64 — pistes de la frise (A5 bas)", () => {
  it("une piste par source, groupée, avec l'état de sa règle et un marqueur par déclenchement", () => {
    const pistes = pistesDeDeclenchements(
      [
        declenchement({}),
        declenchement({ event_id: 102, fired_at: new Date("2026-09-21T09:00:00Z"), delivered: 0, pending: 1 }),
        declenchement({ source: "slo", source_id: "3", libelle: "LCP 99 %", event_id: 103 }),
        declenchement({
          source: "issue",
          source_id: "11111111-2222-3333-4444-555555555555",
          libelle: "Issue 11111111",
          event_id: 104,
        }),
      ],
      [regle({})],
    );
    expect(pistes.map((p) => p.groupe)).toEqual(["regle", "slo", "issue"]);
    const piste = pistes[0];
    expect(piste.marqueurs).toHaveLength(2);
    expect(piste.etatActuel).toMatchObject({ libelle: "Normale" });
    expect(piste.href).toBe("#regle-7");
    // Un marqueur mène à SON déclenchement par `evt`, jamais par `fired`.
    expect(piste.marqueurs[0].href).toBe("/alerts?evt=101#evt-101");
    // Livré / en attente / non livré : trois états distincts.
    expect(piste.marqueurs[0]).toMatchObject({ livre: true, enAttente: false });
    expect(piste.marqueurs[1]).toMatchObject({ livre: false, enAttente: true });
    expect(pistes[1].href).toBe("/slo#definitions");
    expect(pistes[2].href).toBe("/errors/issues/11111111-2222-3333-4444-555555555555");
  });

  it("une règle franchie sans déclenchement sur la fenêtre garde une piste VIDE, avec son état", () => {
    const pistes = pistesDeDeclenchements([], [regle({ id: 9, last_state: "breached" })]);
    expect(pistes).toHaveLength(1);
    expect(pistes[0]).toMatchObject({ cle: "regle:9", marqueurs: [] });
    expect(pistes[0].etatActuel).toMatchObject({ libelle: "Franchie", ton: "bad" });
  });

  it("une règle normale sans déclenchement n'encombre pas la frise", () => {
    expect(pistesDeDeclenchements([], [regle({ last_state: "ok" })])).toEqual([]);
  });

  it("l'alerte « nouvelle erreur » (sans règle, sans SLO, sans issue) a quand même sa piste", () => {
    const [piste] = pistesDeDeclenchements(
      [declenchement({ source: "nouvelle_erreur", source_id: "nouvelles-erreurs", libelle: "Nouvelles erreurs (sans issue)" })],
      [],
    );
    expect(piste).toMatchObject({ groupe: "issue", etatActuel: null });
    expect(hrefDeSource({ source: "nouvelle_erreur", source_id: "nouvelles-erreurs" })).toBe("#a-traiter");
  });

  it("hrefEvenement ne réutilise jamais `fired` (§ 3.1)", () => {
    expect(hrefEvenement(42)).toBe("/alerts?evt=42#evt-42");
    expect(hrefEvenement(42)).not.toContain("fired=");
  });
});

describe("F64 — flux « À traiter » (A6)", () => {
  const evt = (id: number, acknowledged: boolean, t: string) => ({ id, acknowledged, fired_at: new Date(t) });

  it("les non acquittés d'abord, puis les plus récents", () => {
    const ordre = fluxATraiter([
      evt(1, true, "2026-09-22T12:00:00Z"),
      evt(2, false, "2026-09-20T08:00:00Z"),
      evt(3, false, "2026-09-21T08:00:00Z"),
      evt(4, true, "2026-09-22T13:00:00Z"),
    ]).map((e) => e.id);
    expect(ordre).toEqual([3, 2, 4, 1]);
  });

  it("les trois états de livraison, jamais deux", () => {
    expect(etatLivraison({ delivered: 2, pending: 1 })).toMatchObject({ etat: "livree", libelle: "livrée ×2" });
    expect(etatLivraison({ delivered: 0, pending: 3 })).toMatchObject({ etat: "en_attente", libelle: "en attente ×3" });
    expect(etatLivraison({ delivered: 0, pending: 0 })).toMatchObject({ etat: "non_livree", libelle: "non livrée" });
  });

  it("le titre retombe sur la métrique, puis sur la source, jamais sur du vide", () => {
    expect(titreEvenement({ message: "LCP franchi", metric: "LCP", rule_id: 7, slo_id: null })).toBe("LCP franchi");
    expect(titreEvenement({ message: null, metric: "LCP", rule_id: 7, slo_id: null })).toBe("LCP (ms)");
    expect(
      titreEvenement({ message: null, metric: null, rule_id: null, slo_id: null }, { source: "issue", libelle: "Issue 1111" }),
    ).toBe("Issue 1111");
  });
});

describe("F64 — « Voir la mesure » sur la fenêtre ÉVALUÉE (§ 5.19.1)", () => {
  const base = { fired_at: new Date("2026-09-22T12:00:00Z"), route: "/checkout", slo_id: null };

  it("un vital mène aux pages du vital, sur [fired_at − fenêtre, fired_at), sans period", () => {
    const c = cibleMesure({ ...base, metric: "LCP" }, 15);
    expect(c).toMatchObject({ pathname: "/pages", libelle: "Voir la mesure" });
    expect(c!.extra).toMatchObject({
      from: "2026-09-22T11:45:00Z",
      to: "2026-09-22T12:00:00Z",
      period: null,
      vital: "LCP",
      route: "/checkout",
    });
  });

  it("error_rate mène aux erreurs de la route ; un événement custom au journal, sans route", () => {
    expect(cibleMesure({ ...base, metric: "error_rate" }, 30)).toMatchObject({ pathname: "/errors" });
    const c = cibleMesure({ ...base, metric: "event:checkout" }, 60);
    expect(c).toMatchObject({ pathname: "/events" });
    expect(c!.extra).toMatchObject({ kind: "event", name: "checkout" });
    expect(c!.extra.route).toBeUndefined();
  });

  it("une issue mène à sa page, que la métrique la porte ou que la frise la donne", () => {
    const parMetrique = cibleMesure({ ...base, metric: "issue:11111111-2222-3333-4444-555555555555" }, 15);
    expect(parMetrique!.pathname).toBe("/errors/issues/11111111-2222-3333-4444-555555555555");
    const parFrise = cibleMesure({ ...base, metric: null }, 15, "11111111-2222-3333-4444-555555555555");
    expect(parFrise!.pathname).toBe("/errors/issues/11111111-2222-3333-4444-555555555555");
  });

  it("un déclenchement de SLO mène à sa définition ; log_errors aux logs, sans plage (écran à presets)", () => {
    expect(cibleMesure({ ...base, metric: "LCP", slo_id: 3 }, null)).toMatchObject({ pathname: "/slo" });
    const logs = cibleMesure({ ...base, metric: "log_errors" }, 15);
    expect(logs).toMatchObject({ pathname: "/logs" });
    expect(logs!.extra).toEqual({ from: null, to: null });
  });

  it("sans fenêtre connue, aucune plage n'est INVENTÉE : la raison est dite", () => {
    const c = cibleMesure({ ...base, metric: "LCP" }, null);
    expect(c!.extra.from).toBeUndefined();
    expect(c!.extra.to).toBeUndefined();
    expect(c!.fenetre).toMatch(/fenêtre d'évaluation inconnue/);
  });

  it("une métrique inconnue ne fabrique pas de lien", () => {
    expect(cibleMesure({ ...base, metric: null }, 15)).toBeNull();
  });
});

// F68 — une règle de release (B52) se lit sans son formulaire : une hausse EN POUR
// CENT contre la release précédente, jamais « > 20 » (qui se lirait 20 ms), et la
// phrase du § 3.2 partout où elle s'affiche.
describe("F68 — réglage d'une règle de release", () => {
  const sansFineF68 = (texte: string) => texte.replace(/[\u202f\u00a0]/g, " ");

  it("dit la hausse tolérée, la fenêtre et la phrase obligatoire", () => {
    expect(sansFineF68(reglageDeRegle(regle({ mode: "release", threshold: 20, window_minutes: 1440 })))).toBe(
      "régression de release : p75 en hausse de +20 % ou plus contre la release précédente, sur 1 440 min · sévérité warning · " +
        "même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte",
    );
  });

  it("garde les décimales de la hausse : +12,5 % n'est pas +13 %", () => {
    expect(reglageDeRegle(regle({ mode: "release", threshold: 12.5 }))).toContain("+12,5 % ou plus");
  });
});
