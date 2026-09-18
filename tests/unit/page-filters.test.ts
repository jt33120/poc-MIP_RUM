// Filtres d'un écran (P6.2) : périmètre signé, capacités de l'écran et erreurs
// récupérables. Principal, schéma et fuseau simulés ; le contrat et les surfaces
// sont les vrais.
import { beforeEach, describe, expect, it, vi } from "vitest";

const simul = vi.hoisted(() => ({ user: null as unknown, schema: null as unknown }));

vi.mock("@/lib/auth", () => ({ getUser: async () => simul.user }));
vi.mock("@/lib/fuseau", () => ({ fuseauDe: async () => "Europe/Paris" }));
vi.mock("@/lib/query-schema", () => ({ dimensionSchema: async () => simul.schema }));

import { pageFilters } from "../../apps/console/lib/page-filters";
import { schemaComplet, schemaSans } from "../fixtures/dimension-schema";

const viewer = (apps: string[] | null) => ({ email: "v@mip", role: "viewer" as const, apps });

beforeEach(() => {
  simul.user = viewer(["a", "b"]);
  simul.schema = schemaComplet();
});

describe("pageFilters", () => {
  it("périmètre vide ou app hors périmètre : accès refusé, reprise vers le choix d'un projet autorisé", async () => {
    simul.user = viewer([]);
    expect(await pageFilters({ app: "a" }, "/pages")).toEqual({
      ok: false,
      problem: {
        code: "no_app_access",
        message: "aucune application autorisée",
        resetHref: "/select",
        resetLabel: "Choisir un projet autorisé",
      },
    });
    simul.user = viewer(["a"]);
    expect(await pageFilters({ app: "b" }, "/errors")).toMatchObject({
      ok: false,
      problem: { code: "forbidden_app", resetHref: "/select" },
    });
    simul.user = null;
    expect(await pageFilters({}, "/")).toMatchObject({ ok: false, problem: { code: "no_app_access" } });
  });

  it("jeton de segment invalide : erreur récupérable, reprise sur le même écran et la même app", async () => {
    expect(await pageFilters({ app: "a", seg: "v2:ville:eq:Paris", period: "7d" }, "/events")).toEqual({
      ok: false,
      problem: {
        code: "unsupported_dimension",
        message: "dimension inconnue : ville",
        resetHref: "/events?app=a",
        resetLabel: "Réinitialiser les filtres",
      },
    });
    expect(await pageFilters({ app: "all", from: "2026-09-17T10:00:00Z" }, "/errors")).toMatchObject({
      ok: false,
      problem: { code: "invalid_range", resetHref: "/errors" },
    });
  });

  it("écran de mesures qui ne sait pas appliquer un filtre : refus, jamais un chiffre qui l'ignore", async () => {
    simul.schema = schemaSans("rum_session.browser");
    expect(await pageFilters({ app: "a", browser: "Firefox" }, "/pages")).toMatchObject({
      ok: false,
      problem: { code: "unsupported_dimension", message: "« Navigateur » n'est pas encore collecté pour les pages vues" },
    });
    expect(await pageFilters({ app: "a", device: "tablet" }, "/goals")).toMatchObject({
      ok: false,
      problem: { message: "Cet écran n'applique ni « Inconnu » ni la tablette.", resetHref: "/goals?app=a" },
    });
    expect(
      await pageFilters({ app: "a", from: "2026-09-16T10:00:00Z", to: "2026-09-16T11:00:00Z" }, "/retention"),
    ).toMatchObject({ ok: false, problem: { message: "Cet écran n'accepte encore que les périodes 1 h, 24 h et 7 j." } });
  });

  it("écran migré : requête résolue, façade historique et tablette pour les lectures P4/P5", async () => {
    const ecran = await pageFilters({ app: "a", device: "tablet", period: "7d", seg: "geo==FR" }, "/errors");
    expect(ecran.ok).toBe(true);
    if (!ecran.ok) return;
    expect(ecran.query.scope).toEqual({ requestedApp: "a", authorizedApps: ["a", "b"], effectiveApps: ["a"] });
    expect(ecran.filters).toMatchObject({ app: "a", period: "7d", device: null, segment: [{ dim: "geo", op: "==", value: "FR" }] });
    expect(ecran.deviceFilters.device).toBe("tablet");
    expect(ecran.label).toBe("7 j");
    expect(ecran.bucketLabel).toBe("6 h");
    expect(ecran.notApplied).toBeNull();
  });

  it("plage personnalisée : libellé dans le fuseau de l'app", async () => {
    const ecran = await pageFilters({ app: "a", from: "2026-09-16T08:00:00Z", to: "2026-09-16T10:00:00Z" }, "/pages");
    expect(ecran).toMatchObject({ ok: true, bucketLabel: "1 h" });
    if (ecran.ok) expect(ecran.label).toMatch(/^du 16\/09,? 10:00 au 16\/09,? 12:00$/);
  });

  it("écran de configuration : s'affiche et dit que les filtres de l'URL ne s'y appliquent pas", async () => {
    const slo = await pageFilters({ app: "a", device: "mobile" }, "/slo");
    expect(slo).toMatchObject({
      ok: true,
      notApplied: "Les SLO portent leur propre métrique, route et fenêtre : seule l'app sélectionnée filtre la liste.",
    });
    const alertes = await pageFilters({ app: "a", from: "2026-09-16T08:00:00Z", to: "2026-09-16T10:00:00Z" }, "/alerts");
    expect(alertes).toMatchObject({ ok: true, notApplied: "Chaque règle s'évalue sur sa propre fenêtre." });
    expect(await pageFilters({ app: "a" }, "/dashboards")).toMatchObject({ ok: true, notApplied: null });
    // Le périmètre, lui, s'applique partout.
    expect(await pageFilters({ app: "z" }, "/slo")).toMatchObject({ ok: false, problem: { code: "forbidden_app" } });
  });

  it("un écran sans capacités déclarées est une erreur de programmation", async () => {
    await expect(pageFilters({}, "/nouvel-ecran")).rejects.toThrow("écran sans capacités de filtrage déclarées : /nouvel-ecran");
  });
});
