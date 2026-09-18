// P6.3 — les décisions des découpages : quels onglets sont proposables, où mène
// un groupe, et ce que devient « Inconnu » dans une URL.
import { describe, expect, it } from "vitest";
import {
  BREAKDOWN_DIMENSIONS,
  BREAKDOWN_NOTICES,
  availableBreakdowns,
  breakdownDrillHref,
  breakdownTabs,
  breakdownTarget,
  datasetAvailability,
  groupDescription,
  groupLabel,
  parseBreakdown,
  type BreakdownDimension,
} from "../../apps/console/lib/breakdowns";
import { ERRORS_BREAKDOWN_DATASETS, VITALS_BREAKDOWN_DATASETS } from "../../apps/console/lib/queries-breakdowns";
import type { DimensionSchema } from "../../apps/console/lib/query-compiler";
import { parseAnalyticsQuery, type AnalyticsQuery } from "../../apps/console/lib/query-contract";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

/** Schéma APRÈS migration-v75 : toutes les colonnes de dimensions sont là. */
const V75: DimensionSchema = new Set([
  "rum_session.device_type",
  "rum_session.geo_country",
  "rum_session.client_id",
  "rum_session.collection_source",
  "rum_session.browser",
  "rum_session.os",
  "rum_pageview.route",
  "rum_pageview.release",
  "rum_pageview.env",
  "rum_metric.route",
  "rum_metric.release",
  "rum_metric.env",
  "rum_error.route",
  "rum_error.release",
  "rum_error.env",
  "rum_error.service",
]);

/** Schéma AVANT migration-v75 : ni navigateur, ni système, ni release par occurrence. */
const AVANT_V75: DimensionSchema = new Set([
  "rum_session.device_type",
  "rum_session.geo_country",
  "rum_session.client_id",
  "rum_session.collection_source",
  "rum_pageview.route",
  "rum_metric.route",
  "rum_error.route",
  "rum_error.release",
]);

function requete(qs = ""): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), {
    principal: { role: "admin", apps: null },
    nowMs: NOW,
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

describe("disponibilité des onglets", () => {
  it("juge l'onglet sur les mesures groupées, pas sur ce que l'écran sait filtrer", () => {
    // L'accueil compte aussi des sessions et refuse `?route=` ; ses Web Vitals,
    // eux, se groupent parfaitement par route. L'onglet doit donc exister.
    const dispo = datasetAvailability(VITALS_BREAKDOWN_DATASETS, V75);
    expect(dispo("route").available).toBe(true);
    expect(availableBreakdowns(dispo)).toEqual([...BREAKDOWN_DIMENSIONS]);
  });

  it("désactive avec sa raison une dimension pas encore collectée", () => {
    const dispo = datasetAvailability(VITALS_BREAKDOWN_DATASETS, AVANT_V75);
    expect(dispo("browser")).toMatchObject({ available: false });
    expect(dispo("browser").reason).toContain("pas encore collecté");
    expect(dispo("release").reason).toContain("pas encore collecté");
    expect(availableBreakdowns(dispo)).toEqual(["route", "country", "device"]);
  });

  it("les erreurs portent les six dimensions une fois v75 appliquée", () => {
    const dispo = datasetAvailability(ERRORS_BREAKDOWN_DATASETS, V75);
    expect(availableBreakdowns(dispo)).toEqual([...BREAKDOWN_DIMENSIONS]);
  });
});

describe("choix de l'onglet", () => {
  const dispo = datasetAvailability(VITALS_BREAKDOWN_DATASETS, V75);
  const disponibles = availableBreakdowns(dispo);

  it("retient l'onglet demandé quand il est proposé", () => {
    expect(parseBreakdown("browser", disponibles)).toBe("browser");
  });

  it("retombe sur la route quand rien n'est demandé", () => {
    expect(parseBreakdown(null, disponibles)).toBe("route");
    expect(parseBreakdown("", disponibles)).toBe("route");
  });

  it("retombe sur le premier onglet disponible quand celui demandé ne l'est pas", () => {
    const restreints = availableBreakdowns(datasetAvailability(VITALS_BREAKDOWN_DATASETS, AVANT_V75));
    expect(parseBreakdown("browser", restreints)).toBe("route");
    expect(parseBreakdown("release", restreints)).toBe("route");
  });

  it("rend null quand aucun onglet n'est proposable", () => {
    expect(parseBreakdown("route", [])).toBeNull();
  });

  it("chaque dimension porte une notice de provenance", () => {
    for (const dimension of BREAKDOWN_DIMENSIONS) expect(BREAKDOWN_NOTICES[dimension].length).toBeGreaterThan(40);
    expect(BREAKDOWN_NOTICES.country).toContain("fuseau");
    expect(BREAKDOWN_NOTICES.release).toContain("CHAQUE MESURE");
  });
});

describe("onglets rendus", () => {
  it("conserve les filtres et les paramètres d'écran d'un onglet à l'autre", () => {
    const tabs = breakdownTabs("/pages", requete("period=7d&device=mobile"), "route", datasetAvailability(VITALS_BREAKDOWN_DATASETS, V75), {
      status: "open",
    });
    const navigateur = tabs.find((tab) => tab.dimension === "browser")!;
    expect(navigateur.href).toBe("/pages?period=7d&device=mobile&status=open&split=browser");
    expect(tabs.find((tab) => tab.dimension === "route")!.current).toBe(true);
  });

  it("un onglet indisponible n'a pas de lien, mais une raison", () => {
    const tabs = breakdownTabs("/pages", requete(), "route", datasetAvailability(VITALS_BREAKDOWN_DATASETS, AVANT_V75));
    const os = tabs.find((tab) => tab.dimension === "os")!;
    expect(os.available).toBe(false);
    expect(os.href).toBeNull();
    expect(os.reason).toContain("Système");
  });
});

describe("cible du drill-down", () => {
  it("reste sur l'écran quand il sait appliquer la dimension", () => {
    expect(breakdownTarget("/", "browser", V75)).toBe("/");
    expect(breakdownTarget("/errors", "release", V75)).toBe("/errors");
    expect(breakdownTarget("/pages", "route", V75)).toBe("/pages");
  });

  it("bascule sur /pages quand l'écran refuserait le filtre", () => {
    // `/` compte des sessions : elles ne portent ni route ni release. Y renvoyer
    // `?route=` produirait un refus de filtre, donc un lien qui casse.
    expect(breakdownTarget("/", "route", V75)).toBe("/pages");
    expect(breakdownTarget("/", "release", V75)).toBe("/pages");
    expect(breakdownTarget("/sessions", "route", V75)).toBe("/pages");
  });
});

describe("lien d'un groupe", () => {
  it("ajoute la dimension libre en paramètre dédié, filtres et plage conservés", () => {
    const href = breakdownDrillHref("/pages", requete("period=7d&device=mobile"), "browser", "Firefox", V75);
    expect(href).toBe("/pages?period=7d&device=mobile&browser=Firefox");
  });

  it("encode « Inconnu » en is_null, jamais en chaîne", () => {
    const href = breakdownDrillHref("/pages", requete(), "browser", null, V75);
    expect(href).toBe("/pages?seg=v2%3Abrowser%3Ais_null");
    expect(href).not.toContain("Inconnu");
  });

  it("INTERSECTE une dimension déjà contrainte au lieu de la remplacer", () => {
    const href = breakdownDrillHref("/pages", requete("route=%2Fa"), "route", "/b", V75);
    const seg = new URL(href, "https://x").searchParams.get("seg");
    expect(new URL(href, "https://x").searchParams.get("route")).toBe("/a");
    expect(seg).toBe("v2:route:eq:%2Fb");
  });

  it("échappe une valeur hostile au lieu de la coller dans l'URL", () => {
    const href = breakdownDrillHref("/pages", requete(), "route", "/a&b=c", V75);
    const params = new URL(href, "https://x").searchParams;
    expect(params.get("route")).toBe("/a&b=c");
    expect(params.get("b")).toBeNull();
  });

  it("depuis l'accueil, un groupe de routes ouvre /pages avec la même plage", () => {
    const href = breakdownDrillHref("/", requete("from=2026-09-16T00:00:00Z&to=2026-09-17T00:00:00Z"), "route", "/panier", V75);
    expect(href).toBe("/pages?from=2026-09-16T00%3A00%3A00.000Z&to=2026-09-17T00%3A00%3A00.000Z&route=%2Fpanier");
  });
});

describe("libellés", () => {
  it("« Inconnu » ne peut pas être confondu avec une valeur", () => {
    expect(groupLabel(null)).toBe("Inconnu");
    expect(groupLabel("Inconnu")).toBe("Inconnu");
  });

  it("l'alternative textuelle nomme la dimension, le groupe et l'échantillon", () => {
    const texte = groupDescription("browser" as BreakdownDimension, null, 1234, "mesure(s)");
    expect(texte).toContain("Navigateur");
    expect(texte).toContain("Inconnu");
    expect(texte).toContain((1234).toLocaleString("fr-FR"));
  });
});
