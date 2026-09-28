// Routes serveur : chaque framework écrit `http.route` à sa façon, les agents
// OpenTelemetry officiels le recopient tel quel, et l'ingestion le ramène à la
// forme canonique du produit — celle du SDK web, `:nom`.
//
// Constat du 28/09/2026 : sous Flask, `http.route` valait
// `/api/commandes/<int:commande_id>` et restait tel quel ; sous ASP.NET Core,
// `/api/commandes/{id:int}` devenait `/api/commandes/:id:int`. Deux routes que
// l'écran ne rapprochait plus de celle du navigateur.
import { describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp, normalizeRouteTemplate } from "../../packages/backend/shared/otlp.mjs";

describe("normalizeRouteTemplate — toute syntaxe de framework vers `:nom`", () => {
  const cas: Array<[string, string, string]> = [
    // [framework, http.route reçu, route canonique]
    ["OpenAPI / FastAPI", "/aos/{ao_id}", "/aos/:ao_id"],
    ["Starlette, convertisseur", "/fichiers/{chemin:path}", "/fichiers/:chemin"],
    ["Flask, convertisseur", "/api/commandes/<int:commande_id>", "/api/commandes/:commande_id"],
    ["Flask, sans convertisseur", "/api/clients/<nom>/factures", "/api/clients/:nom/factures"],
    ["Flask, convertisseur à arguments", "/<string(length=2):langue>/aide", "/:langue/aide"],
    ["Flask, chemin", "/statique/<path:fichier>", "/statique/:fichier"],
    ["Django, convertisseur", "/commandes/<int:pk>/", "/commandes/:pk/"],
    ["ASP.NET Core, contrainte", "/api/commandes/{id:int}", "/api/commandes/:id"],
    ["ASP.NET Core, contraintes chaînées", "/api/commandes/{id:int:min(1)}", "/api/commandes/:id"],
    ["ASP.NET Core, optionnel", "/api/commandes/{id?}", "/api/commandes/:id"],
    ["ASP.NET Core, valeur par défaut", "/api/pages/{numero=1}", "/api/pages/:numero"],
    ["ASP.NET Core, attrape-tout", "/docs/{*slug}", "/docs/:slug"],
    ["ASP.NET Core, attrape-tout double", "/docs/{**slug}", "/docs/:slug"],
    ["ASP.NET Core, regex à accolades doublées", "/codes/{code:regex(^\\d{{3}}$)}", "/codes/:code"],
    ["ancienne réécriture de {id:int}", "/api/commandes/:id:int", "/api/commandes/:id"],
    ["Express, déjà canonique", "/api/commandes/:id", "/api/commandes/:id"],
    ["Express, expression", "/api/commandes/:id(\\d+)", "/api/commandes/:id"],
    ["Express, optionnel", "/api/commandes/:id?", "/api/commandes/:id"],
    ["Express 5, groupe optionnel", "/api/commandes{/:id}/lignes", "/api/commandes/:id/lignes"],
    ["Rails, format", "/commandes/:id(.:format)", "/commandes/:id"],
    ["Rails, glob", "/fichiers/*chemin", "/fichiers/:chemin"],
  ];
  for (const [framework, recu, attendu] of cas) {
    it(`${framework} : ${recu} → ${attendu}`, () => {
      expect(normalizeRouteTemplate(recu)).toBe(attendu);
    });
  }

  it("laisse intacts un chemin littéral et deux paramètres dans un même segment", () => {
    expect(normalizeRouteTemplate("/wp-admin/admin-ajax.php")).toBe("/wp-admin/admin-ajax.php");
    expect(normalizeRouteTemplate("/vols/:depart-:arrivee")).toBe("/vols/:depart-:arrivee");
    expect(normalizeRouteTemplate("/")).toBe("/");
  });

  it("n'invente rien d'une valeur qui n'est pas une chaîne", () => {
    expect(normalizeRouteTemplate(undefined)).toBeNull();
    expect(normalizeRouteTemplate(42)).toBeNull();
  });

  it("est idempotente : une route déjà canonique ne bouge plus", () => {
    for (const [, recu] of cas) {
      const une = normalizeRouteTemplate(recu);
      expect(normalizeRouteTemplate(une)).toBe(une);
    }
  });
});

describe("flattenOtlp — la route canonique arrive jusqu'au span et à son exception", () => {
  const span = (route: string, nom = `GET ${route}`) => ({
    resourceSpans: [{
      resource: { attributes: [{ key: "mip.app_id", value: { stringValue: "app-routes" } }] },
      scopeSpans: [{
        spans: [{
          traceId: "ab".repeat(16),
          spanId: "12".repeat(8),
          kind: 2,
          name: nom,
          startTimeUnixNano: "1760000000000000000",
          endTimeUnixNano: "1760000000050000000",
          attributes: [
            { key: "http.request.method", value: { stringValue: "GET" } },
            { key: "http.route", value: { stringValue: route } },
            { key: "http.response.status_code", value: { intValue: 500 } },
          ],
          events: [{
            name: "exception",
            timeUnixNano: "1760000000040000000",
            attributes: [{ key: "exception.type", value: { stringValue: "KeyError" } }],
          }],
        }],
      }],
    }],
  });

  it("Flask : route et nom du span, et la route de l'exception dérivée", () => {
    const rows = flattenOtlp(span("/api/commandes/<int:commande_id>"), { now: 1760000001000 });
    expect(rows.spans[0]).toMatchObject({ route: "/api/commandes/:commande_id", name: "/api/commandes/:commande_id" });
    expect(rows.errors[0].route).toBe("/api/commandes/:commande_id");
  });

  it("ASP.NET Core : plus jamais `:id:int`", () => {
    const rows = flattenOtlp(span("/api/commandes/{id:int}"), { now: 1760000001000 });
    expect(rows.spans[0].route).toBe("/api/commandes/:id");
  });
});
