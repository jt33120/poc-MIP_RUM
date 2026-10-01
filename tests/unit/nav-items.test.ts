// Navigation en cinq catégories (plan § 2.2 – § 2.4, F09). Aucune route ne change
// d'adresse : on range et on renomme. Ces tests fixent le rangement.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMINISTRATION,
  CATEGORIES,
  DOMAINE_DE_CATEGORIE,
  activeCategory,
  domaineDe,
  estAdministration,
  hrefMatches,
  lienAdministrationActif,
  ongletActif,
  ongletExact,
  sousOnglets,
  surtitreDe,
} from "../../apps/console/components/nav-items";

const APP_DIR = join(__dirname, "..", "..", "apps", "console", "app");

const ouvertes = () => CATEGORIES.filter((c) => !c.verrouille && c.children?.length);

describe("activeCategory", () => {
  it.each([
    ["/", "Performance"],
    ["/pages", "Performance"],
    ["/errors/abc123", "Performance"],
    ["/errors/issues/42", "Performance"],
    // Route gardée derrière l'onglet interne d'« Interactions » : masquée, mais comptée.
    ["/actions", "Performance"],
    ["/correlation", "Synthétique × RUM"],
    ["/tracing/0af7651916cd43dd8448eb211c80319c", "Synthétique × RUM"],
    ["/map", "Synthétique × RUM"],
    ["/goals", "Usages"],
    ["/sessions/s-1", "Usages"],
    ["/retention", "Usages"],
    // Recette du 01/10/2026 : Tendances sous Performance ; Explorer hors menu (la loupe),
    // Journal et Tableaux de bord dans « Données ».
    ["/forecast", "Performance"],
    ["/alerts", "Fiabilité"],
    ["/events", "Données"],
    ["/explorer", "Données"],
    ["/explorer/views", "Données"],
    ["/dashboards", "Données"],
    ["/dashboards/abc", "Données"],
  ])("%s → %s", (chemin, categorie) => {
    expect(activeCategory(chemin)?.label).toBe(categorie);
  });

  it("hors navigation (admin, sélection) : aucune catégorie", () => {
    expect(activeCategory("/admin/users")).toBeUndefined();
    expect(activeCategory("/select")).toBeUndefined();
  });

  it("« / » exige l'égalité stricte", () => {
    expect(hrefMatches("/", "/pages")).toBe(false);
    expect(hrefMatches("/pages", "/pagesx")).toBe(false);
  });
});

describe("CATEGORIES (§ 2.2)", () => {
  it("cinq catégories ouvertes, dans l'ordre, puis « API et MCP » (30/09/2026 : sans Logs, Supervision IA ni Installer)", () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual([
      "Performance",
      "Synthétique × RUM",
      "Usages",
      "Fiabilité",
      "Données",
      "API et MCP",
    ]);
    expect(ouvertes().map((c) => [c.href, c.icon])).toEqual([
      ["/", "gauge"],
      ["/correlation", "compare"],
      ["/sessions", "users"],
      ["/slo", "target"],
      ["/events", "compass"],
    ]);
  });

  // Deux au moins (01/10/2026) : Fiabilité (SLO, Alertes) et Données (Journal, Tableaux
  // de bord) ont perdu Tendances et Explorer ; une barre d'un seul onglet ne servirait à rien.
  it("aucune barre de sous-onglets ne dépasse six entrées, ni n'en a moins de deux", () => {
    for (const c of ouvertes()) {
      expect(sousOnglets(c).length, c.label).toBeGreaterThanOrEqual(2);
      expect(sousOnglets(c).length, c.label).toBeLessThanOrEqual(6);
    }
  });

  it("la landing de chaque catégorie est son premier onglet", () => {
    for (const c of ouvertes()) expect(sousOnglets(c)[0].href, c.label).toBe(c.href);
  });

  it("libellés du § 2.3, /actions masqué juste après /ux, /mobile hors menu", () => {
    const perf = CATEGORIES[0];
    expect(perf.children?.map((l) => [l.href, l.label, l.sousOnglet ?? true, l.horsMenu ?? false])).toEqual([
      ["/", "Vue d'ensemble", true, false],
      ["/pages", "Pages", true, false],
      ["/errors", "Erreurs", true, false],
      ["/ux", "Interactions", true, false],
      ["/actions", "Actions", false, false],
      ["/experience", "Satisfaction", true, false],
      // Recette du 30/09/2026 : seul le SDK React Native, non publié, l'alimente ;
      // aucun projet n'est mobile. Hors menu, l'adresse reste.
      ["/mobile", "Mobile", true, true],
      ["/forecast", "Tendances", true, false],
    ]);
    const libelles = Object.fromEntries(ouvertes().flatMap((c) => c.children!.map((l) => [l.href, l.label])));
    expect(libelles["/goals"]).toBe("Conversions");
    expect(libelles["/forecast"]).toBe("Tendances");
    expect(libelles["/events"]).toBe("Journal");
    expect(libelles["/correlation"]).toBe("Corrélation");
  });

  it("aucune route ne change d'adresse : chaque lien mène à une page existante", () => {
    for (const c of CATEGORIES) {
      for (const { href } of c.children ?? [{ href: c.href }]) {
        const page = join(APP_DIR, href === "/" ? "" : href, "page.tsx");
        expect(statSync(page, { throwIfNoEntry: false })?.isFile(), href).toBe(true);
      }
    }
  });

  it("chaque route d'écran du périmètre est rangée dans une catégorie", () => {
    // Écrans de premier niveau que la navigation doit couvrir (§ 2.3).
    const perimetre = [
      "pages", "errors", "ux", "actions", "experience", "mobile", "correlation", "tracing", "map",
      "sessions", "paths", "goals", "forms", "acquisition", "retention", "slo", "alerts", "forecast",
      "explorer", "events", "dashboards",
    ];
    for (const dossier of perimetre) {
      expect(readdirSync(APP_DIR)).toContain(dossier);
      expect(activeCategory(`/${dossier}`), dossier).toBeDefined();
    }
  });
});

describe("sousOnglets et ongletActif", () => {
  const perf = CATEGORIES[0];

  it("SubNav ne rend pas les liens sousOnglet: false ni horsMenu", () => {
    expect(sousOnglets(perf).map((l) => l.href)).not.toContain("/actions");
    expect(sousOnglets(perf).map((l) => l.href)).toEqual(["/", "/pages", "/errors", "/ux", "/experience", "/forecast"]);
  });

  it("un lien masqué allume l'onglet visible qui le précède", () => {
    expect(ongletActif(perf, "/actions")).toBe("/ux");
    expect(ongletActif(perf, "/ux")).toBe("/ux");
    expect(ongletActif(perf, "/errors/issues/7")).toBe("/errors");
    expect(ongletActif(perf, "/")).toBe("/");
    expect(ongletActif(perf, "/sessions")).toBeUndefined();
  });

  it("une route hors menu garde sa catégorie mais n'allume AUCUN onglet", () => {
    // « Satisfaction » allumé sur /mobile dirait qu'on lit les avis.
    expect(activeCategory("/mobile")?.label).toBe("Performance");
    expect(domaineDe("/mobile")).toBe("perf");
    expect(ongletActif(perf, "/mobile")).toBeUndefined();
    // Et l'onglet précédent garde sa propre route.
    expect(ongletActif(perf, "/experience")).toBe("/experience");
  });

  it("aucune autre entrée n'est hors menu", () => {
    const horsMenu = CATEGORIES.flatMap((c) => (c.children ?? []).filter((l) => l.horsMenu).map((l) => l.href));
    expect(horsMenu).toEqual(["/mobile", "/explorer"]);
  });
});

describe("domaineDe (surtitre de PageHeader, § 2.4)", () => {
  it.each([
    ["/", "perf"],
    ["/actions", "perf"],
    ["/errors/abc", "perf"],
    ["/tracing/abc", "robot"],
    ["/sessions/abc", "usages"],
    ["/goals", "usages"],
    ["/forecast", "perf"],
    ["/explorer/views", "explorer"],
    ["/dashboards/abc", "explorer"],
    ["/events", "explorer"],
  ])("%s → %s", (chemin, domaine) => {
    expect(domaineDe(chemin)).toBe(domaine);
  });

  it("hors des catégories RUM : null (le repli est l'affaire de l'en-tête)", () => {
    expect(domaineDe("/admin/users")).toBeNull();
    expect(domaineDe("/api-docs")).toBeNull();
  });

  it("une clé de domaine par catégorie ouverte", () => {
    expect(Object.keys(DOMAINE_DE_CATEGORIE).sort()).toEqual(ouvertes().map((c) => c.href).sort());
  });
});

// Recette du 26/09/2026 : hors des cinq catégories RUM, le surtitre retombait sur
// « Performance » (administration, API et MCP, Logs, IA), et le bloc
// Administration n'avait pas d'état actif.
describe("surtitreDe — le surtitre suit la sidebar, y compris hors RUM", () => {
  it.each([
    ["/", "perf"],
    ["/tracing/abc", "robot"],
    ["/admin/users", "admin"],
    ["/admin/customers/demo-app", "admin"],
    ["/api-docs", "integrations"],
    // La page d'installation d'une application : une intégration, comme l'API.
    ["/installer", "integrations"],
    ["/logs", "logs"],
    ["/ai", "ai"],
  ])("%s → %s", (chemin, domaine) => {
    expect(surtitreDe(chemin)).toBe(domaine);
  });

  it("un chemin inconnu : null (le composant retombe sur son défaut)", () => {
    expect(surtitreDe("/select")).toBeNull();
    expect(surtitreDe("/administrateur")).toBeNull();
  });
});

describe("ADMINISTRATION — le bloc de la sidebar", () => {
  it("chaque entrée a une route réelle et une icône qui lui est propre", () => {
    for (const l of ADMINISTRATION) {
      const dossier = join(APP_DIR, ...l.href.split("/").filter(Boolean));
      expect(statSync(dossier).isDirectory(), l.href).toBe(true);
    }
    const icones = ADMINISTRATION.map((l) => l.icon);
    expect(new Set(icones).size).toBe(icones.length);
    const principales = new Set(CATEGORIES.map((c) => c.icon));
    expect(icones.filter((i) => principales.has(i))).toEqual([]);
  });

  it("l'entrée active est celle du chemin, sous-pages comprises", () => {
    expect(lienAdministrationActif("/admin/customers/demo-app")?.href).toBe("/admin/customers");
    expect(lienAdministrationActif("/admin/users")?.href).toBe("/admin/users");
    expect(lienAdministrationActif("/")).toBeUndefined();
  });

  it("« Jetons d'accès » : le libellé change, l'adresse reste (recette du 30/09/2026)", () => {
    const jetons = ADMINISTRATION.find((l) => l.href === "/admin/read-tokens");
    expect(jetons?.label).toBe("Jetons d'accès");
    expect(ADMINISTRATION.map((l) => l.label).join(" ")).not.toMatch(/lecture/i);
  });

  it("ongletExact : l'écran d'un onglet (son titre redirait l'onglet), jamais une sous-page ni une route hors menu", () => {
    // Recette du 01/10/2026 : « Pages » sous l'onglet Pages — le titre passe en lecture seule.
    expect(ongletExact("/")?.label).toBe("Vue d'ensemble");
    expect(ongletExact("/pages")?.label).toBe("Pages");
    expect(ongletExact("/alerts")?.label).toBe("Alertes");
    // Explorer, hors menu depuis le 01/10/2026 : aucun onglet ne le nomme, son titre reste écrit.
    expect(ongletExact("/explorer")).toBeUndefined();
    // Onglet interne : l'écran porte son propre onglet (« Interactions · Actions »).
    expect(ongletExact("/actions")?.href).toBe("/actions");
    // Une sous-page dit ce que l'onglet ne dit pas (la trace, le tableau) : titre écrit.
    expect(ongletExact("/errors/abc123")).toBeUndefined();
    expect(ongletExact("/dashboards/42")).toBeUndefined();
    // /mobile : aucun onglet ne la nomme.
    expect(ongletExact("/mobile")).toBeUndefined();
    // Écrans sans barre d'onglets : administration, API et MCP.
    expect(ongletExact("/admin/users")).toBeUndefined();
    expect(ongletExact("/api-docs")).toBeUndefined();
  });

  it("estAdministration : /admin et ses sous-pages, rien d'autre", () => {
    expect(estAdministration("/admin")).toBe(true);
    expect(estAdministration("/admin/customers/demo-app")).toBe(true);
    expect(estAdministration("/administrateur")).toBe(false);
    expect(estAdministration("/api-docs")).toBe(false);
    expect(estAdministration("/")).toBe(false);
  });
});

// La loupe (recette du 01/10/2026) remplace l'entrée « Explorer » : elle mène à un
// écran (menu ou hors menu), à une action, à une session ou à une route.
describe("loupe", async () => {
  const { avecContexte, chercher, normaliser } = await import("../../apps/console/lib/loupe");

  it("trouve un écran sans les accents, en tête quand le libellé commence par la saisie", () => {
    expect(normaliser("  Rétention ")).toBe("retention");
    expect(chercher("reten", false)[0]).toMatchObject({ libelle: "Rétention", href: "/retention" });
    // Hors menu, mais joignable par la loupe.
    expect(chercher("explorer", false).map((r) => r.href)).toContain("/explorer");
    expect(chercher("mobile", false).map((r) => r.href)).toContain("/mobile");
  });

  it("les actions de création, et l'administration pour un administrateur seulement", () => {
    expect(chercher("alerte", false).map((r) => r.libelle)).toContain("Créer une alerte");
    expect(chercher("jetons", false).some((r) => r.groupe === "Administration")).toBe(false);
    expect(chercher("jetons", true).some((r) => r.href === "/admin/read-tokens")).toBe(true);
  });

  it("un identifiant de session ou une route collés mènent directement", () => {
    expect(chercher("e67bf2c5-1a2b-4c3d-8e9f-001122334455", false)[0]).toMatchObject({
      groupe: "Session",
      href: "/sessions/e67bf2c5-1a2b-4c3d-8e9f-001122334455",
    });
    expect(chercher("/checkout", false)[0]).toMatchObject({ groupe: "Route", href: "/pages?route=%2Fcheckout" });
    expect(chercher("zzzz introuvable", false)).toEqual([]);
  });

  it("l'application et la période suivent l'écran visé ; l'ancre reste à la fin", () => {
    const [alerte] = chercher("créer une alerte", false);
    expect(avecContexte(alerte, "?app=uti&period=7d&vital=LCP")).toBe("/alerts?app=uti&period=7d#nouvelle-regle");
    const [route] = chercher("/checkout", false);
    expect(avecContexte(route, "?app=uti")).toBe("/pages?route=%2Fcheckout&app=uti");
  });
});
