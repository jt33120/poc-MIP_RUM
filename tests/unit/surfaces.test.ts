// Capacités de filtrage des écrans (P6.2) : la matrice écran × filtre, exécutée.
// Un écran de mesures n'annonce un filtre que si TOUTES ses mesures l'appliquent ;
// sinon le contrôle est désactivé avec sa raison et l'URL qui l'impose est refusée.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DIMENSIONS, parseAnalyticsQuery, type Dimension } from "../../apps/console/lib/query-contract";
import {
  RAISON_APP_UNIQUE,
  SURFACES,
  checkSurface,
  conditionAvailability,
  dimensionAvailability,
  perimetreAvailability,
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
    // P8.7 : `country_source` accompagne `country` partout où il est disponible.
    const SESSION = ["device", "browser", "os", "country", "country_source", "source", "client"];
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
    expect(disponibles("/errors", V74).sort()).toEqual(["client", "country", "country_source", "device", "env", "release", "route", "service", "source"]);
    expect(disponibles("/pages", V74).sort()).toEqual(["client", "country", "country_source", "device", "route", "source"]);
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
      expect(disponibles(path).sort(), path).toEqual(["client", "country", "country_source", "device", "source"]);
      expect(dimensionAvailability(s, "browser", schemaComplet())).toEqual({
        available: false,
        reason: "« Navigateur » n'est pas encore appliqué par cet écran",
      });
      expect(conditionAvailability(s, { dimension: "device", operator: "eq", value: "tablet" }, schemaComplet()).available).toBe(false);
      expect(conditionAvailability(s, { dimension: "country", operator: "is_null", value: null }, schemaComplet()).available).toBe(false);
      expect(conditionAvailability(s, { dimension: "device", operator: "neq", value: "mobile" }, schemaComplet()).available).toBe(true);
      if (path === "/retention") continue; // fenêtre en semaines, voir le test suivant
      expect(rangeAvailability(s, true)).toEqual({
        available: false,
        reason: "Cet écran n'accepte encore que les périodes 1 h, 24 h et 7 j.",
      });
      expect(rangeAvailability(s, false).available).toBe(true);
    }
    for (const path of ["/logs", "/ai", "/forecast", "/svi", "/svi/appels/1"]) expect(disponibles(path), path).toEqual([]);
  });

  // F40 (§ 5.17.5) : la rétention lit N semaines choisies dans l'écran. La période
  // du haut, active mais sans effet, laissait croire qu'elle s'appliquait (V10).
  it("/retention lit ses propres semaines : la période est désactivée avec sa raison, une plage refusée", () => {
    const s = surface("/retention");
    const raison = "La rétention se lit sur un nombre de semaines choisi dans l'écran ; la période choisie en haut ne s'applique pas.";
    expect(s.range).toBe("none");
    expect(s.rangeNote).toBe(raison);
    expect(rangeAvailability(s, false)).toEqual({ available: false, reason: raison });
    expect(rangeAvailability(s, true)).toEqual({ available: false, reason: raison });
    expect(checkSurface(requete("from=2026-09-17T10:00:00Z&to=2026-09-17T11:00:00Z"), s, schemaComplet())).toMatchObject({
      ok: false,
      error: { code: "unsupported_dimension", parameter: "from", message: raison },
    });
    // Les segments historiques, eux, s'appliquent toujours.
    expect(checkSurface(requete("seg=geo==FR;device!=mobile"), s, schemaComplet()).ok).toBe(true);
  });

  it("/forecast lit une fenêtre fixe : la période est désactivée avec sa raison, jamais ignorée", () => {
    const s = surface("/forecast");
    const raison = "Cet écran lit une fenêtre fixe de 14 jours complets ; la période choisie en haut ne s'applique pas.";
    expect(rangeAvailability(s, false)).toEqual({ available: false, reason: raison });
    expect(checkSurface(requete("from=2026-09-17T10:00:00Z&to=2026-09-17T11:00:00Z"), s, schemaComplet())).toMatchObject({
      ok: false,
      error: { code: "unsupported_dimension", parameter: "from", message: raison },
    });
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

// P7.5 — `/mobile` applique MOINS de dimensions que ses jeux de données n'en
// portent, et c'est délibéré : ses mesures sont des TAUX sur une cohorte de
// sessions. Une dimension d'occurrence (route, service, env) filtrerait le
// numérateur sans filtrer le dénominateur, et le résultat ne serait plus un taux.
describe("/mobile — la liste blanche de dimensions", () => {
  it("n'applique que l'appareil, le système et la release", () => {
    expect(disponibles("/mobile")).toEqual(["device", "os", "release"]);
  });

  it("refuse une dimension d'occurrence avec sa raison, jamais en l'ignorant", () => {
    expect(checkSurface(requete("route=%2Fpanier"), surface("/mobile"), schemaComplet())).toMatchObject({
      ok: false,
      error: { code: "unsupported_dimension", dimension: "route" },
    });
    expect(checkSurface(requete("service=api"), surface("/mobile"), schemaComplet()).ok).toBe(false);
    expect(checkSurface(requete("country=FR"), surface("/mobile"), schemaComplet()).ok).toBe(false);
    expect(checkSurface(requete("browser=Firefox"), surface("/mobile"), schemaComplet()).ok).toBe(false);
  });

  it("accepte la plateforme (traduite en `os`), la release et la plage personnalisée", () => {
    expect(
      checkSurface(
        requete("os=iOS&release=4.2.0&device=mobile&from=2026-09-17T10:00:00Z&to=2026-09-17T11:00:00Z"),
        surface("/mobile"),
        schemaComplet(),
      ),
    ).toEqual({ ok: true, value: true });
  });
});

// F40 (R-A, CS1) — les lectures de ces écrans filtrent l'app par
// `($1::text is null or app_id = $1)` : sous `app=all`, elles liraient TOUTES les
// apps de la base. Un principal restreint qui demande toutes ses apps est refusé.
describe("perimetreAvailability — écrans à lecture mono-app", () => {
  const MONO_APP = ["/acquisition", "/paths", "/forms", "/retention", "/goals"];
  const scope = (requestedApp: string | null, authorizedApps: string[] | null) => ({
    requestedApp,
    authorizedApps,
    effectiveApps: requestedApp ? [requestedApp] : authorizedApps,
  });

  it("exactement les cinq écrans historiques d'usage sont marqués", () => {
    expect(SURFACES.filter((s) => s.appUnique).map((s) => s.path).sort()).toEqual([...MONO_APP].sort());
  });

  it("principal restreint + toutes les apps → refus typé, texte opposable", () => {
    for (const path of MONO_APP) {
      expect(perimetreAvailability(surface(path), scope(null, ["a"])), path).toEqual({ available: false, reason: RAISON_APP_UNIQUE });
      expect(perimetreAvailability(surface(path), scope(null, ["a", "b"])), path).toEqual({ available: false, reason: RAISON_APP_UNIQUE });
    }
    expect(RAISON_APP_UNIQUE.startsWith("Cet écran lit une application à la fois")).toBe(true);
  });

  it("une app nommée, ou un principal sans restriction : rien à refuser", () => {
    for (const path of MONO_APP) {
      expect(perimetreAvailability(surface(path), scope("a", ["a", "b"])).available, path).toBe(true);
      expect(perimetreAvailability(surface(path), scope(null, null)).available, path).toBe(true);
    }
  });

  it("un écran sur le contrat lie ses apps effectives : jamais refusé sous « toutes »", () => {
    for (const path of ["/sessions", "/map", "/pages", "/errors", "/"]) {
      expect(perimetreAvailability(surface(path), scope(null, ["a", "b"])).available, path).toBe(true);
    }
  });
});
