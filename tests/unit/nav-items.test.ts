// Navigation en cinq catégories (plan § 2.2 – § 2.4, F09). Aucune route ne change
// d'adresse : on range et on renomme. Ces tests fixent le rangement.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  DOMAINE_DE_CATEGORIE,
  activeCategory,
  domaineDe,
  hrefMatches,
  ongletActif,
  sousOnglets,
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
    ["/correlation", "Robot et réel"],
    ["/tracing/0af7651916cd43dd8448eb211c80319c", "Robot et réel"],
    ["/map", "Robot et réel"],
    ["/goals", "Usages"],
    ["/sessions/s-1", "Usages"],
    ["/retention", "Usages"],
    ["/forecast", "Fiabilité"],
    ["/alerts", "Fiabilité"],
    ["/events", "Explorer"],
    ["/explorer/views", "Explorer"],
    ["/dashboards", "Explorer"],
    ["/dashboards/abc", "Explorer"],
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
  it("cinq catégories ouvertes, dans l'ordre, puis les entrées hors périmètre inchangées", () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual([
      "Performance",
      "Robot et réel",
      "Usages",
      "Fiabilité",
      "Explorer",
      "Logs",
      "Supervision SVI",
      "Supervision IA",
      "API et MCP",
    ]);
    expect(ouvertes().map((c) => [c.href, c.icon])).toEqual([
      ["/", "gauge"],
      ["/correlation", "compare"],
      ["/sessions", "users"],
      ["/slo", "target"],
      ["/explorer", "compass"],
    ]);
  });

  it("aucune barre de sous-onglets ne dépasse six entrées, ni n'en a moins de trois", () => {
    for (const c of ouvertes()) {
      expect(sousOnglets(c).length, c.label).toBeGreaterThanOrEqual(3);
      expect(sousOnglets(c).length, c.label).toBeLessThanOrEqual(6);
    }
  });

  it("la landing de chaque catégorie est son premier onglet", () => {
    for (const c of ouvertes()) expect(sousOnglets(c)[0].href, c.label).toBe(c.href);
  });

  it("libellés du § 2.3, et /actions masqué juste après /ux", () => {
    const perf = CATEGORIES[0];
    expect(perf.children?.map((l) => [l.href, l.label, l.sousOnglet ?? true])).toEqual([
      ["/", "Vue d'ensemble", true],
      ["/pages", "Pages", true],
      ["/errors", "Erreurs et issues", true],
      ["/ux", "Interactions", true],
      ["/actions", "Actions", false],
      ["/experience", "Satisfaction", true],
      ["/mobile", "Mobile", true],
    ]);
    const libelles = Object.fromEntries(ouvertes().flatMap((c) => c.children!.map((l) => [l.href, l.label])));
    expect(libelles["/goals"]).toBe("Conversions");
    expect(libelles["/forecast"]).toBe("Tendances");
    expect(libelles["/events"]).toBe("Journal");
    expect(libelles["/correlation"]).toBe("Corrélation synthétique ↔ RUM");
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

  it("SubNav ne rend pas les liens sousOnglet: false", () => {
    expect(sousOnglets(perf).map((l) => l.href)).not.toContain("/actions");
  });

  it("un lien masqué allume l'onglet visible qui le précède", () => {
    expect(ongletActif(perf, "/actions")).toBe("/ux");
    expect(ongletActif(perf, "/ux")).toBe("/ux");
    expect(ongletActif(perf, "/errors/issues/7")).toBe("/errors");
    expect(ongletActif(perf, "/")).toBe("/");
    expect(ongletActif(perf, "/sessions")).toBeUndefined();
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
    ["/forecast", "fiabilite"],
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
