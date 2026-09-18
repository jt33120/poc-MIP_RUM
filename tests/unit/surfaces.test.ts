// Capacités de filtrage des écrans (P6.2) : la matrice écran × filtre, exécutée.
// Un écran de mesures n'annonce un filtre que si TOUTES ses mesures l'appliquent ;
// sinon le contrôle est désactivé avec sa raison et l'URL qui l'impose est refusée.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DIMENSIONS, parseAnalyticsQuery, type Dimension } from "../../apps/console/lib/query-contract";
import {
  SURFACES,
  checkSurface,
  conditionAvailability,
  dimensionAvailability,
  rangeAvailability,
  surfaceFor,
  type Surface,
} from "../../apps/console/lib/surfaces";
import { schemaComplet, schemaSans } from "../fixtures/dimension-schema";

const APP_DIR = join(__dirname, "..", "..", "apps", "console", "app");
const NOW = Date.parse("2026-09-17T12:00:00.000Z");

// Schéma v74 (avant P6.1) : navigateur, système, env et release des signaux absents.
const V74 = schemaSans(
  "rum_session.browser",
  "rum_session.os",
  ...["rum_pageview", "rum_metric", "rum_action", "rum_resource", "rum_longtask", "rum_event", "rum_span", "rum_event_index"].flatMap(
    (table) => [`${table}.env`, `${table}.release`],
  ),
  "rum_span.service",
  "rum_event_index.service",
);

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

const surface = (path: string): Surface => {
  const found = surfaceFor(path);
  if (!found) throw new Error(`surface absente : ${path}`);
  return found;
};
const disponibles = (path: string, schema = schemaComplet()): Dimension[] =>
  DIMENSIONS.filter((d) => dimensionAvailability(surface(path), d, schema).available);
const requete = (qs: string) => {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal: { role: "admin", apps: null }, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
};

describe("chaque écran branché sur le contrat déclare ses capacités", () => {
  it("toute page qui appelle pageFilters a une surface, avec le chemin qu'elle annonce", () => {
    const appels = pages(APP_DIR).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/pageFilters\([^;]*?,\s*[`"]([^`"]+)[`"]\)/g)].map((m) => ({
        page: relative(APP_DIR, file),
        path: m[1].replace(/\$\{[^}]+\}/g, "x"),
      }));
    });
    expect(appels.length).toBeGreaterThanOrEqual(25);
    for (const { page, path } of appels) expect(surfaceFor(path), `${page} → ${path}`).not.toBeNull();
  });

  it("préfixe le plus spécifique d'abord ; racine exacte ; écrans d'administration hors contrat", () => {
    expect(surfaceFor("/errors/abc")?.path).toBe("/errors/");
    expect(surfaceFor("/errors/issues/123")?.path).toBe("/errors/");
    expect(surfaceFor("/errors")?.path).toBe("/errors");
    expect(surfaceFor("/sessions/s1")?.noFilters).toBeTruthy();
    expect(surfaceFor("/sessions")?.noFilters).toBeUndefined();
    expect(surfaceFor("/svi/appels/42")?.path).toBe("/svi/");
    expect(surfaceFor("/")?.path).toBe("/");
    expect(surfaceFor("/admin/users")).toBeNull();
    expect(surfaceFor("/select")).toBeNull();
    expect(surfaceFor("/errorsx")).toBeNull();
  });
});

describe("matrice écran × filtre", () => {
  it("écrans de mesures, schéma migré : ce que TOUTES leurs mesures appliquent", () => {
    const SESSION = ["device", "browser", "os", "country", "source", "client"];
    expect(disponibles("/errors")).toEqual([...DIMENSIONS]);
    expect(disponibles("/errors/fp")).toEqual([...DIMENSIONS]);
    expect(disponibles("/events")).toEqual([...DIMENSIONS]);
    expect(disponibles("/tracing")).toEqual([...DIMENSIONS]);
    for (const path of ["/pages", "/actions", "/ux", "/dashboards/1"]) {
      expect(disponibles(path).sort(), path).toEqual([...SESSION, "release", "route", "env"].sort());
    }
    // La map croise spans et vitals : pas de service côté vitals.
    expect(disponibles("/map")).not.toContain("service");
    // Les sessions ne portent ni route, ni release, ni env : l'écran ne les propose pas.
    expect(disponibles("/sessions").sort()).toEqual([...SESSION].sort());
    expect(disponibles("/").sort()).toEqual([...SESSION].sort());
    expect(disponibles("/experience").sort()).toEqual([...SESSION].sort());
    // Le robot synthétique n'a que sa route : la corrélation ne filtre que par route.
    expect(disponibles("/correlation")).toEqual(["route"]);
  });

  it("schéma v74 (console publiée avant P6.1) : navigateur et système « pas encore collectés »", () => {
    expect(disponibles("/errors", V74).sort()).toEqual(["client", "country", "device", "env", "release", "route", "service", "source"]);
    expect(disponibles("/pages", V74).sort()).toEqual(["client", "country", "device", "route", "source"]);
    expect(dimensionAvailability(surface("/pages"), "browser", V74)).toEqual({
      available: false,
      reason: "« Navigateur » n'est pas encore collecté pour les pages vues",
    });
    expect(dimensionAvailability(surface("/pages"), "service", V74)).toEqual({
      available: false,
      reason: "« Service » est sans objet pour les pages vues",
    });
  });

  it("écrans historiques : segment v1 et presets seulement, ni tablette ni « inconnu »", () => {
    for (const path of ["/paths", "/forms", "/goals", "/acquisition", "/retention"]) {
      const s = surface(path);
      expect(disponibles(path).sort(), path).toEqual(["client", "country", "device", "source"]);
      expect(dimensionAvailability(s, "browser", schemaComplet())).toEqual({
        available: false,
        reason: "« Navigateur » n'est pas encore appliqué par cet écran",
      });
      expect(conditionAvailability(s, { dimension: "device", operator: "eq", value: "tablet" }, schemaComplet()).available).toBe(false);
      expect(conditionAvailability(s, { dimension: "country", operator: "is_null", value: null }, schemaComplet()).available).toBe(false);
      expect(conditionAvailability(s, { dimension: "device", operator: "neq", value: "mobile" }, schemaComplet()).available).toBe(true);
      expect(rangeAvailability(s, true)).toEqual({
        available: false,
        reason: "Cet écran n'accepte encore que les périodes 1 h, 24 h et 7 j.",
      });
      expect(rangeAvailability(s, false).available).toBe(true);
    }
    for (const path of ["/logs", "/ai", "/forecast", "/svi", "/svi/appels/1"]) expect(disponibles(path), path).toEqual([]);
  });

  it("écrans de configuration et détails entiers : aucun filtre de population, raison dite", () => {
    for (const path of ["/slo", "/alerts", "/dashboards", "/sessions/s1", "/tracing/t1"]) {
      const s = surface(path);
      expect(disponibles(path), path).toEqual([]);
      expect(dimensionAvailability(s, "device", schemaComplet())).toEqual({ available: false, reason: s.noFilters });
      expect(rangeAvailability(s, false).available, path).toBe(false);
    }
    expect(rangeAvailability(surface("/slo"), false)).toEqual({
      available: false,
      reason: "Chaque SLO se mesure sur sa propre fenêtre glissante.",
    });
  });
});

describe("checkSurface : une URL entièrement applicable, ou un refus typé", () => {
  it("accepte ce que l'écran applique", () => {
    expect(checkSurface(requete("device=tablet&release=4.8&from=2026-09-17T10:00:00Z&to=2026-09-17T11:00:00Z"), surface("/errors"), schemaComplet()))
      .toEqual({ ok: true, value: true });
    expect(checkSurface(requete("seg=geo==FR;device!=mobile&period=7d"), surface("/paths"), schemaComplet()).ok).toBe(true);
  });

  it("refuse plage personnalisée sur un écran à presets, tablette sur un écran historique, dimension absente", () => {
    expect(checkSurface(requete("from=2026-09-17T10:00:00Z&to=2026-09-17T11:00:00Z"), surface("/goals"), schemaComplet())).toMatchObject({
      ok: false,
      error: { code: "unsupported_dimension", parameter: "from" },
    });
    expect(checkSurface(requete("device=tablet"), surface("/goals"), schemaComplet())).toMatchObject({
      ok: false,
      error: { code: "unsupported_dimension", dimension: "device", message: "Cet écran n'applique ni « Inconnu » ni la tablette." },
    });
    expect(checkSurface(requete("browser=Firefox"), surface("/pages"), V74)).toMatchObject({
      ok: false,
      error: { dimension: "browser", message: "« Navigateur » n'est pas encore collecté pour les pages vues" },
    });
    expect(checkSurface(requete("route=%2Fa"), surface("/sessions"), schemaComplet())).toMatchObject({
      ok: false,
      error: { dimension: "route", message: "« Route » est sans objet pour les sessions" },
    });
  });
});
