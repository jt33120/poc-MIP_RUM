// P6.6 — la règle d'emploi des agrégats, la partition hybride et la fusion des
// distributions. Tout est pur : aucune base n'est nécessaire pour prouver qu'un
// agrégat sans navigateur ne répondra jamais à `browser = Firefox`.
import { describe, expect, it } from "vitest";
import {
  GRAIN_SECONDS,
  ROLLUP_IDS,
  chooseRollup,
  dansAgregat,
  effectif,
  fenetreHybride,
  fusionnerSeaux,
  hybrideDisponible,
  percentileFusionne,
  rollupAnswers,
  rollupCapability,
  rollupColumns,
  rollupSource,
  COLONNES_HYBRIDE,
} from "../../apps/console/lib/analytics-rollups";
import { parseExplorerQuery, type ExplorerRequest } from "../../apps/console/lib/analytics-schema";
import { percentileDepuisSeaux, seau } from "../../apps/console/lib/histogramme";
import type { ScopePrincipal } from "../../apps/console/lib/query-contract";

const ADMIN: ScopePrincipal = { role: "admin", apps: null };
const HISTO = rollupSource("vitals_histogram");
const TRAFIC = rollupSource("traffic_hourly");

/** Requête validée par le vrai parseur : le test ne fabrique pas d'AST à la main. */
function requete(ast: Record<string, unknown>): ExplorerRequest {
  const parsed = parseExplorerQuery(
    { version: 1, app: "demo", range: { preset: "24h" }, ...ast },
    { principal: ADMIN, nowMs: Date.parse("2026-09-17T12:00:00.000Z") },
  );
  if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
  return parsed.value;
}

/** p75 des Web Vitals, la seule mesure qu'un agrégat de ce dépôt sache servir. */
const vitals = (ast: Record<string, unknown> = {}) =>
  requete({ dataset: "vitals", measure: { aggregation: "p75", field: "value" }, variant: "LCP", ...ast });

describe("règle d'emploi des agrégats", () => {
  it("sert le p75 d'une métrique nommée, sans dimension hors de l'agrégat", () => {
    const decision = chooseRollup(vitals().plan, vitals().query);
    expect(decision.usable).toBe(true);
    if (!decision.usable) return;
    expect(decision.source.id).toBe("vitals_histogram");
    expect(decision.source.table).toBe("metric_histogram_hourly");
  });

  it("un agrégat sans navigateur ne répond JAMAIS à browser = Firefox", () => {
    const { query, plan } = vitals({
      filters: [{ field: "browser", operator: "eq", type: "string", value: "Firefox" }],
    });
    const decision = chooseRollup(plan, query);
    expect(decision.usable).toBe(false);
    if (decision.usable) return;
    expect(decision.reason).toMatch(/browser.*filtre/);
  });

  it("une dimension de REGROUPEMENT hors de l'agrégat le refuse aussi", () => {
    const { query, plan } = vitals({ visualization: "toplist", groupBy: ["route"], limit: 5 });
    const decision = chooseRollup(plan, query);
    expect(decision.usable).toBe(false);
    if (decision.usable) return;
    expect(decision.reason).toMatch(/route.*regroupement/);
  });

  it("la dimension que l'agrégat PORTE, elle, passe — en filtre comme en regroupement", () => {
    expect(chooseRollup(vitals({ visualization: "toplist", groupBy: ["device"], limit: 5 }).plan, vitals().query).usable).toBe(
      true,
    );
    const filtre = vitals({ filters: [{ field: "device", operator: "eq", type: "string", value: "mobile" }] });
    expect(chooseRollup(filtre.plan, filtre.query).usable).toBe(true);
  });

  it("un agrégat qui INCLUT les robots ne sert pas une mesure qui les exclut", () => {
    // Le trafic horaire ne filtre pas is_bot à son rafraîchissement : il ne peut
    // donc pas répondre à une requête qui les exclut, c'est-à-dire à celle par défaut.
    const vues = requete({ dataset: "views", measure: { aggregation: "count", field: "rows" } });
    const refus = rollupAnswers(TRAFIC, vues.plan, vues.query);
    expect(refus.usable).toBe(false);
    if (refus.usable) return;
    expect(refus.reason).toMatch(/robots/);

    // Et l'histogramme, qui les exclut, refuse la requête inverse.
    const vitalsBots = vitals({ includeBots: true });
    const inverse = rollupAnswers(HISTO, vitalsBots.plan, vitalsBots.query);
    expect(inverse.usable).toBe(false);
    if (inverse.usable) return;
    expect(inverse.reason).toMatch(/robots/);
  });

  it("une source sans filigrane n'est jamais lue, et le dit", () => {
    // Même population (robots inclus), même dimension : il ne reste que le
    // filigrane. `refresh_rum_rollups` n'en enregistre aucun, donc rien ne sépare
    // les heures consolidées des lignes à relire — la partition serait un pari.
    expect(TRAFIC.state).toBeNull();
    const avecRobots = requete({ dataset: "views", measure: { aggregation: "count", field: "rows" }, includeBots: true });
    const refus = rollupAnswers(TRAFIC, avecRobots.plan, avecRobots.query);
    expect(refus.usable).toBe(false);
    if (refus.usable) return;
    expect(refus.reason).toMatch(/filigrane/);
    // Le registre public ne promet donc rien sur ces mesures.
    expect(rollupCapability("views", "rows")).toBeNull();
    expect(rollupCapability("errors", "occurrences")).toBeNull();
    // Et l'Explorer ne route jamais vers elle, quelle que soit la requête.
    expect(chooseRollup(avecRobots.plan, avecRobots.query).usable).toBe(false);
  });

  it("un dénombrement de distincts n'est additionnable par AUCUN agrégat", () => {
    const { query, plan } = requete({ dataset: "vitals", measure: { aggregation: "distinct", field: "sessions" }, variant: "LCP" });
    const decision = chooseRollup(plan, query);
    expect(decision.usable).toBe(false);
    // Aucun agrégat ne DÉCLARE cette mesure : le refus vient du registre, et la
    // règle « un distinct ne s'additionne pas » le double par sécurité.
    for (const id of ROLLUP_IDS) {
      expect(rollupSource(id).answers.some((a) => a.aggregations.includes("distinct"))).toBe(false);
    }
  });

  it("une moyenne n'est pas servie par des seaux, un journal n'est pas servi du tout", () => {
    const moyenne = vitals({ measure: { aggregation: "avg", field: "value" } });
    expect(rollupAnswers(HISTO, moyenne.plan, moyenne.query).usable).toBe(false);
    const journal = vitals({ visualization: "table", limit: 10 });
    const refus = rollupAnswers(HISTO, journal.plan, journal.query);
    expect(refus.usable).toBe(false);
    if (refus.usable) return;
    expect(refus.reason).toMatch(/lignes à paginer/);
  });

  it("une sous-population non couverte par le rafraîchissement est refusée", () => {
    // `mip_core_vitals()` fixe les cinq métriques agrégées ; le registre les
    // recopie et doit refuser tout ce qui vit dans la même table sans y être.
    const { query, plan } = vitals();
    expect(rollupAnswers(HISTO, { ...plan, variant: "TTVI" }, query).usable).toBe(false);
    expect(rollupAnswers(HISTO, { ...plan, variant: null }, query).usable).toBe(false);
  });

  it("un seau plus fin que l'heure ne sort pas d'un agrégat horaire", () => {
    // La source la plus permissive imaginable — un agrégat horaire qui porterait
    // la série temporelle : même elle refuse un seau de 5 minutes.
    const horaire = {
      ...TRAFIC,
      state: { table: "metric_histogram_state", refreshedAt: "refreshed_at", maxId: "max_metric_id" },
    };
    const heure = requete({
      dataset: "views",
      measure: { aggregation: "count", field: "rows" },
      includeBots: true,
      visualization: "timeseries",
      range: { preset: "1h" },
    });
    expect(heure.query.range.bucketSeconds).toBeLessThan(GRAIN_SECONDS);
    const refus = rollupAnswers(horaire, heure.plan, heure.query);
    expect(refus.usable).toBe(false);
    if (refus.usable) return;
    expect(refus.reason).toMatch(/grain/);
  });

  it("la capacité publiée dit ce que l'agrégat sait faire, sans nommer de table cliente", () => {
    const capacite = rollupCapability("vitals", "value");
    expect(capacite).toEqual({
      source: "vitals_histogram",
      aggregations: ["p75", "p95"],
      dimensions: ["device"],
      visualizations: ["value", "toplist"],
      approximate: true,
      grain_seconds: GRAIN_SECONDS,
      includes_bots: false,
    });
    // Une mesure sans agrégat le dit franchement, plutôt que d'en inventer un.
    expect(rollupCapability("errors", "sessions")).toBeNull();
    expect(rollupCapability("spans", "rows")).toBeNull();
  });
});

describe("sonde de schéma", () => {
  it("la lecture hybride ne s'active que si TOUTES ses colonnes existent", () => {
    const complet = new Set<string>(COLONNES_HYBRIDE);
    expect(hybrideDisponible(complet)).toBe(true);
    for (const manquante of COLONNES_HYBRIDE) {
      const partiel = new Set(complet);
      partiel.delete(manquante);
      expect(hybrideDisponible(partiel), manquante).toBe(false);
    }
  });

  it("les colonnes à sonder couvrent exactement les paires déclarées", () => {
    const { tables, columns } = rollupColumns();
    for (const paire of COLONNES_HYBRIDE) {
      const [table, colonne] = [paire.slice(0, paire.indexOf(".")), paire.slice(paire.indexOf(".") + 1)];
      expect(tables).toContain(table);
      expect(columns).toContain(colonne);
    }
  });
});

describe("partition raw / agrégat", () => {
  const range = {
    from: "2026-09-17T09:30:00.000Z",
    to: "2026-09-17T12:20:00.000Z",
    preset: null,
    bucketSeconds: 3600,
  };

  it("ne retient que les heures ENTIÈRES situées sous le filigrane", () => {
    const fenetre = fenetreHybride(range, "2026-09-17T12:05:00.000Z");
    // 09:30 n'est pas une heure entière : la première est 10:00. Le filigrane est
    // à 12:05, donc l'heure de 12:00 est encore en cours : la dernière borne est 12:00.
    expect(fenetre).toEqual({
      agregatFrom: "2026-09-17T10:00:00.000Z",
      agregatTo: "2026-09-17T12:00:00.000Z",
      utilisable: true,
    });
  });

  it("l'heure EN COURS n'est jamais dans l'agrégat", () => {
    const fenetre = fenetreHybride(range, "2026-09-17T12:19:59.999Z");
    // Quelle que soit l'avance du filigrane dans l'heure courante, son heure
    // reste en cours de remplissage : la borne haute ne la dépasse pas.
    expect(fenetre.agregatTo).toBe("2026-09-17T12:00:00.000Z");
    expect(dansAgregat(Date.parse("2026-09-17T12:10:00.000Z"), fenetre)).toBe(false);
  });

  it("sans filigrane connu, tout est lu brut : la valeur reste juste, le coût change", () => {
    expect(fenetreHybride(range, null)).toEqual({ agregatFrom: null, agregatTo: null, utilisable: false });
    expect(dansAgregat(Date.parse("2026-09-17T10:30:00.000Z"), fenetreHybride(range, null))).toBe(false);
  });

  it("une fenêtre sans aucune heure entière sous le filigrane n'utilise rien", () => {
    const courte = { ...range, from: "2026-09-17T11:10:00.000Z", to: "2026-09-17T11:50:00.000Z" };
    expect(fenetreHybride(courte, "2026-09-17T12:05:00.000Z").utilisable).toBe(false);
  });

  it("chaque instant de la fenêtre appartient à UNE seule branche", () => {
    const fenetre = fenetreHybride(range, "2026-09-17T12:05:00.000Z");
    const from = Date.parse(range.from);
    const to = Date.parse(range.to);
    let agregat = 0;
    let brut = 0;
    // Une grille de dix minutes couvre les deux bords et les deux bascules.
    for (let t = from; t < to; t += 600_000) {
      if (dansAgregat(t, fenetre)) agregat++;
      else brut++;
    }
    expect(agregat).toBe(12); // deux heures entières
    expect(brut).toBe(5); // 09:30→10:00 et 12:00→12:20
    expect(agregat + brut).toBe(17);
  });
});

describe("fusion des distributions", () => {
  /** Distribution horaire d'un échantillon : ce que le rafraîchissement écrirait. */
  const distribution = (valeurs: number[]) => {
    const par = new Map<number, number>();
    for (const v of valeurs) par.set(seau(v), (par.get(seau(v)) ?? 0) + 1);
    return [...par].map(([bucket, observed_count]) => ({ bucket, observed_count }));
  };

  it("additionne les effectifs d'un même seau, ignore un poids nul ou illisible", () => {
    const fusion = fusionnerSeaux([
      { bucket: 3, observed_count: 2 },
      { bucket: "3", observed_count: "5" },
      { bucket: 4, observed_count: 0 },
      { bucket: 5, observed_count: "nombre" },
    ]);
    expect(fusion).toEqual([{ bucket: 3, weighted_count: 7 }]);
    expect(effectif([{ bucket: 3, observed_count: 2 }, { bucket: 4, observed_count: 5 }])).toBe(7);
  });

  it("FUSIONNE puis calcule : la moyenne des p75 horaires est une autre valeur", () => {
    // Une heure creuse (dix mesures rapides) et une heure de pointe (mille
    // mesures lentes). Le p75 de la journée est du côté de l'heure de pointe ;
    // moyenner les deux p75 le tirerait vers une valeur qu'aucune mesure n'a.
    const creuse = Array.from({ length: 10 }, (_, i) => 100 + i);
    const pointe = Array.from({ length: 1000 }, (_, i) => 2000 + i);
    const fusionne = percentileFusionne([...distribution(creuse), ...distribution(pointe)], 0.75);
    const moyenneDesP75 =
      ((percentileDepuisSeaux(fusionnerSeaux(distribution(creuse)), 0.75) ?? 0) +
        (percentileDepuisSeaux(fusionnerSeaux(distribution(pointe)), 0.75) ?? 0)) /
      2;

    // Le p75 exact de la population complète : 1010 valeurs, le 758e rang.
    const exact = [...creuse, ...pointe].sort((a, b) => a - b)[Math.ceil(1010 * 0.75) - 1];
    expect(fusionne).not.toBeNull();
    // Les seaux valent 2 % : l'écart au p75 exact tient dans cette largeur.
    expect(Math.abs(fusionne! - exact) / exact).toBeLessThan(0.02);
    // La moyenne des p75, elle, se trompe de plus de 40 %.
    expect(Math.abs(moyenneDesP75 - exact) / exact).toBeGreaterThan(0.4);
  });

  it("une distribution vide rend null, jamais zéro", () => {
    expect(percentileFusionne([], 0.75)).toBeNull();
    expect(percentileFusionne([{ bucket: 2, observed_count: 0 }], 0.95)).toBeNull();
    expect(effectif([])).toBe(0);
  });

  it("le p95 se lit sur la même distribution que le p75, sans la recalculer", () => {
    const seaux = distribution(Array.from({ length: 200 }, (_, i) => 500 + i * 10));
    const p75 = percentileFusionne(seaux, 0.75)!;
    const p95 = percentileFusionne(seaux, 0.95)!;
    expect(p95).toBeGreaterThan(p75);
    expect(Math.abs(p95 - 2400) / 2400).toBeLessThan(0.02);
  });
});
