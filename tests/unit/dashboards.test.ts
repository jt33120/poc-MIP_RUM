// Helpers purs des tableaux de bord (lib/dashboards.ts) : adaptateur de lecture
// v1/v2, sérialisation d'écriture et carte de diagnostic (P6.5).
import { describe, expect, it } from "vitest";
import {
  defaultTitle,
  MAX_WIDGETS,
  normalizeLayout,
  parseRangeOverride,
  serializeLayout,
  widgetFiltersLabel,
  widgetFromPlan,
  type AnalyticsWidget,
} from "../../apps/console/lib/dashboards";
import { parseExplorerPlan } from "../../apps/console/lib/analytics-schema";
import { MODELES_TABLEAUX as F35_MODELES, cartesDuModele as f35CartesDuModele, optionsDeClonage as f35OptionsDeClonage, pucesDuTableau as f35PucesDuTableau } from "../../apps/console/lib/dashboard-templates";
// F37 — sections de tableau de bord (imports du lot).
import {
  ANALYTICS_WIDGET_TYPE,
  QUESTION_MAX,
  WIDGET_TYPES,
  groupesDuLayout,
  layoutPlein,
  nombreDeCartes,
  questionDeSection,
  sectionDuFormulaire,
} from "../../apps/console/lib/dashboards";

/** Une configuration v2 telle qu'elle est stockée en jsonb. */
const ANALYSE = {
  schemaVersion: 2,
  type: "analytics",
  title: "Erreurs par release",
  query: {
    version: 1,
    dataset: "errors",
    measure: { aggregation: "sum", field: "occurrences" },
    filters: [{ field: "browser", operator: "eq", type: "string", value: "Firefox" }],
    groupBy: ["release"],
    limit: 10,
  },
  visualization: "toplist",
  filters: [{ field: "os", operator: "eq", type: "string", value: "iOS" }],
};

describe("normalizeLayout — adaptateur de lecture", () => {
  it("rejette une entrée non-array", () => {
    expect(normalizeLayout(null)).toEqual([]);
    expect(normalizeLayout({})).toEqual([]);
    expect(normalizeLayout("x")).toEqual([]);
  });

  it("garde les widgets v1 et TRANSFORME l'inconnu en diagnostic, sans le perdre", () => {
    const out = normalizeLayout([
      { type: "traffic", title: "Trafic" },
      { type: "inconnu", title: "x" },
      { type: "frustration" },
    ]);
    expect(out.map((w) => w.kind)).toEqual(["v1", "invalid", "v1"]);
    // La carte illisible dit POURQUOI, et conserve son JSON d'origine intact.
    expect(out[1]).toMatchObject({ kind: "invalid", title: "x" });
    expect(out[1].kind === "invalid" && out[1].reason).toMatch(/type de widget inconnu/);
    expect(out[1].kind === "invalid" && out[1].raw).toEqual({ type: "inconnu", title: "x" });
  });

  it("vital_p75 sans métrique valide devient un diagnostic ; avec métrique, un widget", () => {
    const sansMetrique = normalizeLayout([{ type: "vital_p75", title: "x" }]);
    expect(sansMetrique[0].kind).toBe("invalid");
    const mauvaise = normalizeLayout([{ type: "vital_p75", metric: "ZZZ" }]);
    expect(mauvaise[0].kind).toBe("invalid");
    const ok = normalizeLayout([{ type: "vital_p75", metric: "LCP" }]);
    expect(ok[0]).toMatchObject({ kind: "v1", type: "vital_p75", metric: "LCP", title: "LCP p75" });
  });

  it("titre par défaut si absent", () => {
    const [w] = normalizeLayout([{ type: "traffic" }]);
    expect(w.title).toBe(defaultTitle("traffic"));
  });

  it("event_count exige un nom borné et le conserve pour le rendu/export partagé", () => {
    expect(normalizeLayout([{ type: "event_count" }])[0].kind).toBe("invalid");
    expect(normalizeLayout([{ type: "event_count", eventName: "x".repeat(101) }])[0].kind).toBe("invalid");
    expect(normalizeLayout([{ type: "event_count", eventName: "checkout" }])[0]).toEqual({
      kind: "v1", type: "event_count", eventName: "checkout", title: "Événements · checkout",
    });
  });

  it("borne le nombre de widgets à MAX_WIDGETS", () => {
    const many = Array.from({ length: MAX_WIDGETS + 10 }, () => ({ type: "traffic" }));
    expect(normalizeLayout(many)).toHaveLength(MAX_WIDGETS);
  });

  it("tronque les titres trop longs", () => {
    const [w] = normalizeLayout([{ type: "traffic", title: "x".repeat(200) }]);
    expect(w.title.length).toBeLessThanOrEqual(60);
  });
});

describe("widget v2 — AST validé par le registre de l'Explorer", () => {
  it("lit une analyse complète : plan, filtres d'AST et filtres de carte séparés", () => {
    const [w] = normalizeLayout([ANALYSE]);
    expect(w.kind).toBe("v2");
    const analyse = w as AnalyticsWidget;
    expect(analyse.plan.dataset).toBe("errors");
    expect(analyse.plan.visualization).toBe("toplist");
    expect(analyse.plan.groupBy).toEqual(["release"]);
    expect(analyse.conditions).toEqual([{ dimension: "browser", operator: "eq", value: "Firefox" }]);
    expect(analyse.filters).toEqual([{ dimension: "os", operator: "eq", value: "iOS" }]);
    expect(analyse.rangeOverride).toBeNull();
    expect(widgetFiltersLabel(analyse)).toBe("Navigateur = Firefox · Système = iOS");
  });

  it("refuse une mesure, une dimension ou une représentation hors registre — avec sa raison", () => {
    const cas: Array<[unknown, RegExp]> = [
      [{ ...ANALYSE, query: { ...ANALYSE.query, dataset: "secrets" } }, /jeu de données inconnu/],
      [{ ...ANALYSE, query: { ...ANALYSE.query, measure: { aggregation: "p95", field: "occurrences" } }}, /p95|agr/i],
      [{ ...ANALYSE, visualization: "camembert" }, /représentation inconnue/],
      [{ ...ANALYSE, query: { ...ANALYSE.query, groupBy: ["mot_de_passe"] } }, /dimension/i],
      [{ ...ANALYSE, query: { ...ANALYSE.query, limit: 9999 } }, /limite|limit/i],
      [{ ...ANALYSE, inconnu: 1 }, /clé de widget inconnue/],
      [{ ...ANALYSE, query: { ...ANALYSE.query, version: 2 } }, /version d'AST non supportée/],
    ];
    for (const [config, motif] of cas) {
      const [w] = normalizeLayout([config]);
      expect(w.kind, JSON.stringify(config).slice(0, 80)).toBe("invalid");
      expect(w.kind === "invalid" && w.reason).toMatch(motif);
    }
  });

  it("borne le total des conditions d'une carte à celui du contrat", () => {
    const dix = Array.from({ length: 6 }, (_, i) => ({
      field: "release", operator: "eq", type: "string", value: `r${i}`,
    }));
    const [w] = normalizeLayout([{ ...ANALYSE, query: { ...ANALYSE.query, filters: dix }, filters: dix }]);
    expect(w.kind).toBe("invalid");
    expect(w.kind === "invalid" && w.reason).toMatch(/10 conditions/);
  });

  it("un curseur ne s'enregistre pas : une page n'est pas une analyse", () => {
    const plan = parseExplorerPlan(
      { dataset: "errors", measure: { aggregation: "sum", field: "occurrences" }, visualization: "table", cursor: "x".repeat(20) },
      null,
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.error.code).toBe("invalid_cursor");
  });
});

describe("parseRangeOverride — fenêtre propre bornée", () => {
  it("accepte un preset ou deux instants UTC, refuse le reste", () => {
    expect(parseRangeOverride(null)).toEqual({ ok: true, value: null });
    expect(parseRangeOverride({ preset: "7d" })).toEqual({ ok: true, value: { preset: "7d" } });
    expect(parseRangeOverride({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" })).toEqual({
      ok: true,
      value: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" },
    });
    for (const mauvais of [
      { preset: "90d" },
      { preset: "7d", from: "2026-09-01T00:00:00.000Z" },
      { from: "2026-09-02T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
      // Plus de 30 jours : la fenêtre d'une carte ne dépasse pas celle du contrat.
      { from: "2026-07-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
      { from: "2026-09-01", to: "2026-09-02" },
      "24h",
    ]) {
      expect(parseRangeOverride(mauvais).ok, JSON.stringify(mauvais)).toBe(false);
    }
  });
});

describe("serializeLayout — chaque widget repart dans SA version", () => {
  it("n'ajoute aucune clé à un widget v1 : ouvrir un tableau ne le convertit pas", () => {
    const stocke = [{ type: "traffic", title: "Trafic" }, { type: "vital_p75", metric: "LCP", title: "LCP p75" }];
    expect(serializeLayout(normalizeLayout(stocke))).toEqual(stocke);
  });

  it("réécrit un widget illisible TEL QUEL — il n'est jamais effacé par une écriture", () => {
    const stocke = [{ type: "traffic", title: "Trafic" }, { type: "venu_du_futur", options: { x: 1 } }];
    expect(serializeLayout(normalizeLayout(stocke))).toEqual(stocke);
  });

  it("fait l'aller-retour d'une analyse sans la déformer", () => {
    const aller = serializeLayout(normalizeLayout([ANALYSE]));
    expect(aller).toEqual([ANALYSE]);
    expect(serializeLayout(normalizeLayout(aller))).toEqual([ANALYSE]);
  });

  it("construit une carte depuis un plan, sans app ni fenêtre", () => {
    const plan = parseExplorerPlan(
      { dataset: "views", measure: { aggregation: "count", field: "rows" }, visualization: "timeseries" },
      null,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const carte = widgetFromPlan(plan.value, { title: "Vues" });
    const [json] = serializeLayout([carte]) as Array<Record<string, unknown>>;
    expect(json.schemaVersion).toBe(2);
    expect(Object.keys(json.query as object)).not.toContain("app");
    expect(Object.keys(json.query as object)).not.toContain("range");
    expect(json.rangeOverride).toBeUndefined();
  });
});

// F35 (W-D1, § 5.24.5) — chaque carte de chaque modèle est un plan que le registre
// relit : écrite comme un clone l'écrit, relue comme un tableau relit son jsonb.
describe("F35 — modèles de tableaux de bord", () => {
  it("quatre modèles, dans l'ordre de la page", () => {
    expect(F35_MODELES.map((m) => m.cle)).toEqual(["performance", "erreurs", "usages", "releases"]);
  });

  for (const modele of F35_MODELES) {
    it(`« ${modele.titre} » : aller-retour serializeLayout / normalizeLayout sans carte illisible, ≤ ${MAX_WIDGETS} cartes`, () => {
      const cartes = f35CartesDuModele(modele);
      expect(cartes.length).toBeGreaterThan(0);
      expect(cartes.length).toBeLessThanOrEqual(MAX_WIDGETS);
      const jsonb = serializeLayout(cartes);
      const relues = normalizeLayout(JSON.parse(JSON.stringify(jsonb)));
      expect(relues.filter((w) => w.kind === "invalid")).toEqual([]);
      expect(relues).toHaveLength(cartes.length);
      // Le jsonb relu se réécrit à l'identique : aucune dérive d'une écriture à l'autre.
      expect(serializeLayout(relues)).toEqual(jsonb);
      // F37 : chaque section ouvre sur son titre de section ; ses cartes gardent le leur
      // (le préfixe « Seuils — LCP p75 » d'avant F37 a disparu).
      const sections = relues.filter((w) => w.kind === "section");
      expect(sections.map((s) => s.title)).toEqual(modele.sections.map((s) => s.titre));
      const titresDesCartes = relues.filter((w) => w.kind !== "section").map((w) => w.title);
      expect(titresDesCartes).toEqual(modele.sections.flatMap((s) => s.cartes.map((c) => c.title)));
    });
  }

  it("deux populations, deux cartes (V2) : jamais de sessions et d'occurrences sur une même carte", () => {
    const erreurs = f35CartesDuModele(F35_MODELES[1]).filter((w) => w.kind === "v2");
    const champs = erreurs.map((w) => (w.kind === "v2" ? `${w.plan.measure.field}:${w.plan.measure.aggregation}` : ""));
    expect(champs).toContain("occurrences:sum");
    expect(champs).toContain("sessions:distinct");
    const usages = f35CartesDuModele(F35_MODELES[2]);
    expect(usages.map((w) => w.title)).toEqual(expect.arrayContaining(["Sessions commencées", "Visiteurs"]));
  });

  it("puces de type d'une carte (W-D2) : représentation pour une analyse, « v1 : … » pour le catalogue historique", () => {
    const cartes = f35CartesDuModele(F35_MODELES[1]);
    expect(f35PucesDuTableau(cartes)).toEqual([
      { libelle: "Valeur", n: 2 },
      { libelle: "Série", n: 1 },
      { libelle: "Classement", n: 2 },
      { libelle: "v1 : Erreurs principales", n: 1 },
    ]);
    expect(f35PucesDuTableau(normalizeLayout([{ type: "vital_p75", metric: "LCP" }, { type: "inconnu" }]))).toEqual([
      { libelle: "v1 : LCP p75", n: 1 },
      { libelle: "illisible", n: 1 },
    ]);
  });

  it("cloner : jamais en démo, jamais sans app autorisée, et seulement dans les apps permises", () => {
    const APPS = [
      { app_id: "app-a", name: "Mini-site A" },
      { app_id: "app-b", name: "" },
    ];
    expect(f35OptionsDeClonage({ email: "d@x", role: "viewer", apps: ["app-a"], demo: true }, APPS)).toEqual({
      cloner: null,
      raison: "Session de démonstration : lecture seule.",
    });
    expect(f35OptionsDeClonage({ email: "v@x", role: "viewer", apps: [] }, APPS)).toEqual({
      cloner: null,
      raison: "Création réservée aux comptes autorisés sur une app.",
    });
    expect(f35OptionsDeClonage(null, APPS).cloner).toBeNull();
    expect(f35OptionsDeClonage({ email: "v@x", role: "viewer", apps: ["app-a"] }, APPS)).toEqual({
      cloner: { apps: [{ id: "app-a", libelle: "Mini-site A" }] },
    });
    // Un nom vide retombe sur l'identifiant ; « toutes les apps » n'est jamais proposé.
    expect(f35OptionsDeClonage({ email: "a@x", role: "admin", apps: null }, APPS).cloner?.apps).toEqual([
      { id: "app-a", libelle: "Mini-site A" },
      { id: "app-b", libelle: "app-b" },
    ]);
  });
});

// F37 (W-B12, § 5.25) — sections de tableau de bord. Un titre de section est un
// élément du layout : lu et écrit par la même porte que les cartes, compté dans
// MAX_WIDGETS, et illisible — jamais perdu — pour un lecteur qui ne le connaît pas.
describe("F37 — sections de tableau de bord", () => {
  /** Une section telle qu'elle est stockée en jsonb : `type`, jamais `kind`. */
  const SECTION_F37 = { type: "section", title: "Où ?", question: "Où les pages sont-elles lentes ?" };
  const vingtQuatreCartesF37 = () => Array.from({ length: MAX_WIDGETS }, () => ({ type: "traffic" }));

  it("aller-retour d'une section : lue, réécrite, relue à l'identique — sans `kind` dans le jsonb", () => {
    const stocke = [{ type: "traffic", title: "Trafic" }, SECTION_F37, { type: "top_errors", title: "Erreurs" }];
    const lu = normalizeLayout(stocke);
    expect(lu[1]).toEqual({ kind: "section", title: "Où ?", question: "Où les pages sont-elles lentes ?" });
    const jsonb = serializeLayout(lu);
    expect(jsonb).toEqual(stocke);
    expect(jsonb[1]).not.toHaveProperty("kind");
    expect(serializeLayout(normalizeLayout(JSON.parse(JSON.stringify(jsonb))))).toEqual(stocke);
    // Question vide : non écrite (comme une métrique absente), relue vide.
    const sansQuestion = { type: "section", title: "Qui ?" };
    expect(normalizeLayout([sansQuestion])).toEqual([{ kind: "section", title: "Qui ?", question: "" }]);
    expect(serializeLayout(normalizeLayout([sansQuestion]))).toEqual([sansQuestion]);
  });

  it("un tableau enregistré avant F37 s'ouvre à l'identique : une grille unique, aucune section inventée, jsonb réécrit tel quel", () => {
    const avantF37 = [
      { type: "traffic", title: "Trafic" },
      ANALYSE,
      { type: "vital_p75", metric: "LCP", title: "LCP p75" },
      { type: "venu_du_futur", options: { x: 1 } },
    ];
    const lu = normalizeLayout(avantF37);
    expect(lu.map((w) => w.kind)).toEqual(["v1", "v2", "v1", "invalid"]);
    const groupes = groupesDuLayout(lu);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].section).toBeNull();
    expect(groupes[0].cartes.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(serializeLayout(lu)).toEqual(avantF37);
  });

  it("une section compte dans MAX_WIDGETS : 24 cartes + 1 section → refusée au même titre qu'une 25e carte", () => {
    const avecSection = normalizeLayout([...vingtQuatreCartesF37(), SECTION_F37]);
    const avecCarte = normalizeLayout([...vingtQuatreCartesF37(), { type: "traffic" }]);
    expect(avecSection).toHaveLength(MAX_WIDGETS);
    expect(avecCarte).toHaveLength(MAX_WIDGETS);
    expect(avecSection.some((w) => w.kind === "section")).toBe(false);
    // En écriture aussi : le 25e élément ne part pas, qu'il soit section ou carte.
    const [section] = normalizeLayout([SECTION_F37]);
    expect(serializeLayout([...avecCarte, section])).toHaveLength(MAX_WIDGETS);
    // Une section en tête prend la place d'une carte : la 24e carte tombe, pas la section.
    const enTete = normalizeLayout([SECTION_F37, ...vingtQuatreCartesF37()]);
    expect(enTete).toHaveLength(MAX_WIDGETS);
    expect(enTete[0].kind).toBe("section");
    expect(nombreDeCartes(enTete)).toBe(MAX_WIDGETS - 1);
    // Le tableau plein le sait : les actions refusent alors le 25e élément, et le disent.
    expect(layoutPlein(enTete)).toBe(true);
    expect(layoutPlein(enTete.slice(1))).toBe(false);
  });

  it("un lecteur d'avant F37 lit une section comme une carte illisible : rien n'est perdu", () => {
    const [json] = serializeLayout(normalizeLayout([SECTION_F37])) as Record<string, unknown>[];
    // Les trois portes du lecteur d'avant F37 (`lireWidget`, commit d99c9ec) :
    // 1. un objet à `kind` passe TEL QUEL (widget déjà normalisé) — une section stockée n'en porte pas ;
    expect(json).not.toHaveProperty("kind");
    // 2. le discriminant d'une analyse v2 — absent ;
    expect(json.type).not.toBe(ANALYTICS_WIDGET_TYPE);
    expect(json).not.toHaveProperty("schemaVersion");
    // 3. le catalogue v1 — « section » n'en fait pas partie : type inconnu.
    expect(WIDGET_TYPES as readonly string[]).not.toContain(json.type);
    // Ce que ce lecteur fait d'un type inconnu, rejoué sur un type que le lecteur
    // d'aujourd'hui ignore aussi : une carte illisible, titrée, réécrite INTACTE.
    const ignoree = { ...json, type: "section-venue-du-futur" };
    const [lue] = normalizeLayout([ignoree]);
    expect(lue).toMatchObject({ kind: "invalid", title: "Où ?", raw: ignoree });
    expect(lue.kind === "invalid" && lue.reason).toMatch(/type de widget inconnu/);
    expect(serializeLayout([lue])).toEqual([ignoree]);
  });

  it("une section que CE lecteur ne sait pas lire (clé plus récente, sans titre) devient une carte illisible, réécrite intacte", () => {
    const futures = [
      { ...SECTION_F37, repliee: true },
      { type: "section", question: "Sans titre ?" },
      { type: "section", title: "Où ?", question: 42 },
    ];
    const lues = normalizeLayout(futures);
    expect(lues.map((w) => w.kind)).toEqual(["invalid", "invalid", "invalid"]);
    expect(lues[0]).toMatchObject({ title: "Où ?" });
    expect(lues[0].kind === "invalid" && lues[0].reason).toMatch(/clé de section inconnue : repliee/);
    expect(lues[1]).toMatchObject({ title: "Section illisible" });
    expect(serializeLayout(lues)).toEqual(futures);
  });

  it("formulaire « Ajouter une section » : même porte que le jsonb ; titre vide refusé, question facultative", () => {
    expect(sectionDuFormulaire("  Par segment ", " Où ? ")).toEqual({
      ok: true,
      value: { kind: "section", title: "Par segment", question: "Où ?" },
    });
    expect(sectionDuFormulaire("Qui ?", null)).toEqual({ ok: true, value: { kind: "section", title: "Qui ?", question: "" } });
    // Des espaces passent l'attribut `required` : c'est ici qu'ils sont refusés.
    expect(sectionDuFormulaire("   ", "Où ?").ok).toBe(false);
    expect(sectionDuFormulaire(null, null).ok).toBe(false);
    // Bornes : celle d'un titre de carte (60), une phrase pour la question.
    const long = sectionDuFormulaire("x".repeat(200), "y".repeat(500));
    expect(long.ok && long.value.title.length).toBe(60);
    expect(long.ok && long.value.question.length).toBe(QUESTION_MAX);
  });

  it("groupes de la grille : cartes d'avant la 1re section sans titre, section vide conservée, positions du layout gardées", () => {
    const layout = normalizeLayout([
      { type: "traffic", title: "Trafic" },
      SECTION_F37,
      { type: "top_errors", title: "Erreurs" },
      { type: "frustration", title: "Frustration" },
      { type: "section", title: "Vide" },
    ]);
    const groupes = groupesDuLayout(layout).map((g) => [
      g.section?.widget.title ?? null,
      g.section?.index ?? null,
      g.cartes.map((c) => c.index),
    ]);
    expect(groupes).toEqual([
      [null, null, [0]],
      ["Où ?", 1, [2, 3]],
      ["Vide", 4, []],
    ]);
    // Sans section : une seule grille, sans titre — le rendu d'avant F37.
    const sansSection = groupesDuLayout(normalizeLayout([{ type: "traffic" }, { type: "frustration" }]));
    expect(sansSection).toHaveLength(1);
    expect(sansSection[0].section).toBeNull();
    expect(sansSection[0].cartes.map((c) => c.index)).toEqual([0, 1]);
    expect(groupesDuLayout([])).toEqual([]);
  });

  it("question sous le titre : absente, ou identique au titre, elle ne s'écrit pas", () => {
    expect(questionDeSection({ kind: "section", title: "Seuils", question: "Les vitals tiennent-ils les seuils ?" })).toBe(
      "Les vitals tiennent-ils les seuils ?",
    );
    expect(questionDeSection({ kind: "section", title: "Où ?", question: "" })).toBeNull();
    expect(questionDeSection({ kind: "section", title: "Où ?", question: " où ? " })).toBeNull();
  });

  it("tableau cloné depuis un modèle : des sections titrées, chacune avec ses cartes (preuve de fin)", () => {
    for (const modele of F35_MODELES) {
      const relu = normalizeLayout(JSON.parse(JSON.stringify(serializeLayout(f35CartesDuModele(modele)))));
      const groupes = groupesDuLayout(relu);
      // Aucune carte orpheline : un modèle commence par un titre de section.
      expect(groupes.every((g) => g.section !== null), modele.cle).toBe(true);
      expect(groupes.map((g) => g.section?.widget.title)).toEqual(modele.sections.map((s) => s.titre));
      expect(groupes.map((g) => g.section?.widget.question)).toEqual(modele.sections.map((s) => s.question));
      expect(groupes.map((g) => g.cartes.map((c) => c.widget.title))).toEqual(
        modele.sections.map((s) => s.cartes.map((c) => c.title)),
      );
      // Le titre ne redit pas la question : chacune des deux lignes apprend quelque chose.
      for (const g of groupes) expect(questionDeSection(g.section!.widget), g.section!.widget.title).not.toBeNull();
    }
  });

  it("liste des tableaux : un titre de section n'est ni une carte comptée, ni une puce", () => {
    const layout = normalizeLayout([SECTION_F37, { type: "traffic" }, { type: "section", title: "Qui ?" }, ANALYSE]);
    expect(layout).toHaveLength(4);
    expect(nombreDeCartes(layout)).toBe(2);
    expect(f35PucesDuTableau(layout)).toEqual([
      { libelle: "v1 : Trafic", n: 1 },
      { libelle: "Classement", n: 1 },
    ]);
    expect(nombreDeCartes(normalizeLayout([SECTION_F37]))).toBe(0);
  });
});
