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
import {
  SESSIONS_ROUTE_NON_PROPOSEES,
  refusDesSessions,
  sessionsDeLaRoute,
} from "../../apps/console/lib/breakdowns";
import { parseSessionSearch } from "../../apps/console/lib/sessions-search";
import { checkSurface, surfaceFor } from "../../apps/console/lib/surfaces";

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

describe("les sessions d'une route (hero des Actions, panneau route, angles morts)", () => {
  const sessions = surfaceFor("/sessions");
  const lue = (href: string) => requete(new URL(href, "https://x").searchParams.toString());
  /** Le lien rendu, ou l'échec du test avec la raison donnée. */
  const lien = (qs: string, route: string, schema: DimensionSchema = V75) => {
    const l = sessionsDeLaRoute(requete(qs), route, schema);
    if (l.href === null) throw new Error(`lien attendu, raison rendue : ${l.raison}`);
    return l.href;
  };

  it("ouvrent la recherche EXACTE par route de /sessions, plage et population gardées", () => {
    const href = lien("period=7d&device=mobile", "/panier");
    expect(href).toBe("/sessions?period=7d&device=mobile&qf=route&q=%2Fpanier");
    const params = new URL(href, "https://x").searchParams;
    // La recherche que l'écran applique : « Sessions ayant vu la route « /panier » ».
    expect(parseSessionSearch(params.get("qf"), params.get("q"))).toEqual({ field: "route", value: "/panier" });
    // Et l'écran l'accepte : aucune condition de population qu'il ne sache appliquer.
    expect(sessions && checkSurface(lue(href), sessions, V75).ok).toBe(true);
  });

  it("jamais `route=`, que /sessions refuse, ni le repli d'un drill-down, qui mène à /pages", () => {
    // Ce que construisaient le panneau route (F17) et le hero des Actions (F24).
    expect(sessions && checkSurface(requete("route=%2Fpanier"), sessions, V75).ok).toBe(false);
    expect(breakdownDrillHref("/sessions", requete(), "route", "/panier", V75)).toBe("/pages?route=%2Fpanier");
    expect(new URL(lien("", "/panier"), "https://x").searchParams.has("route")).toBe(false);
  });

  it("source filtrée sur une route (« Ouvrir en page », puis une ligne) : `route=` retiré, remplacé par la recherche", () => {
    const href = lien("period=24h&route=%2Fpanier&browser=Firefox", "/compte");
    const params = new URL(href, "https://x").searchParams;
    expect(params.has("route")).toBe(false);
    expect([params.get("qf"), params.get("q")]).toEqual(["route", "/compte"]);
    // Le reste de la population suit : c'est une dimension de SESSION.
    expect(params.get("browser")).toBe("Firefox");
    expect(sessions && checkSurface(lue(href), sessions, V75).ok).toBe(true);
  });

  it("source filtrée sur une release, un environnement ou un service : AUCUN lien, la raison du contrat écrite", () => {
    for (const [qs, libelle] of [
      ["release=1.4.2", "« Release » est sans objet pour les sessions"],
      ["env=production", "« Environnement » est sans objet pour les sessions"],
      ["service=api", "« Service » est sans objet pour les sessions"],
      // `route=` ET release : retirer la route ne suffit pas.
      ["route=%2Fpanier&release=1.4.2", "« Release » est sans objet pour les sessions"],
    ] as const) {
      const l = sessionsDeLaRoute(requete(`period=7d&${qs}`), "/panier", V75);
      expect(l.href, qs).toBeNull();
      expect(l.raison, qs).toBe(`${SESSIONS_ROUTE_NON_PROPOSEES} sous ces filtres : ${libelle}.`);
      // La même raison que l'écran de refus de /sessions (le lien d'avant y menait).
      expect(sessions && checkSurface(requete(`period=7d&${qs}`), sessions, V75)).toMatchObject({ ok: false });
      expect(refusDesSessions(requete(`period=7d&${qs}`), V75)).toBe(l.raison);
    }
  });

  it("une condition de segment que /sessions refuse (route exclue, release inconnue) : aucun lien non plus", () => {
    // Seul le PARAMÈTRE `route=` est remplacé par la recherche : une exclusion de route
    // ou un « Inconnu » de release ne se traduit pas en recherche exacte.
    for (const seg of ["v2:route:neq:%252Fpanier", "v2:release:is_null"]) {
      const l = sessionsDeLaRoute(requete(`seg=${seg}`), "/compte", V75);
      expect(l.href, seg).toBeNull();
      expect(l.raison, seg).toContain("est sans objet pour les sessions");
    }
  });

  it("une dimension de session non collectée : refusée par /sessions, donc pas de lien", () => {
    const l = sessionsDeLaRoute(requete("browser=Firefox"), "/panier", AVANT_V75);
    expect(l.href).toBeNull();
    expect(l.raison).toContain("« Navigateur » n'est pas encore collecté pour les sessions");
    // Et collectée, le même filtre suit le lien.
    expect(new URL(lien("browser=Firefox", "/panier"), "https://x").searchParams.get("browser")).toBe("Firefox");
  });

  it("une route que la recherche exacte refuserait (écran mobile sans « / ») : pas de lien, la règle écrite", () => {
    const l = sessionsDeLaRoute(requete(), "Accueil", V75);
    expect(l.href).toBeNull();
    expect(l.raison).toContain("une route normalisée commence par « / »");
    // Ce n'est pas un refus de population : l'écran pourrait dire la raison ligne par ligne.
    expect(refusDesSessions(requete(), V75)).toBeNull();
  });

  it("les réglages propres au lien (app, heure d'une ligne d'angle mort) remplacent ceux de la source", () => {
    const l = sessionsDeLaRoute(requete("app=a&period=7d"), "/panier", V75, {
      app: "b",
      period: null,
      from: "2026-09-17T09:00:00.000Z",
      to: "2026-09-17T10:00:00.000Z",
    });
    expect(l.href).not.toBeNull();
    const params = new URL(l.href!, "https://x").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      app: "b",
      from: "2026-09-17T09:00:00.000Z",
      to: "2026-09-17T10:00:00.000Z",
      qf: "route",
      q: "/panier",
    });
  });
});
