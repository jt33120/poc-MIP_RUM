// Registre des routes saturé par un scanner (constat du 28/09/2026).
//
// L'app `gip-plateforme` (FastAPI, copie de l'ancien middleware) a reçu des
// rafales de scan (`/wp-admin/admin-ajax.php`, `/manager/html`, `/jmx-console/`…,
// 88 % de 404) le 21/09 et le 28/09. Sur un 404, le middleware prenait le chemin
// brut pour route : 2 000 routes sur 2 000 au registre depuis le 14/09, et toute
// nouvelle route réelle devenait `(other)`.
//
// Ici, la défense de l'INGESTION, qui vaut pour tout émetteur : un span serveur
// en 404/405 sans `http.route` n'a pas de route, il prend `(non trouvée)`. Le
// middleware FastAPI maison est archivé depuis le 29/09/2026
// (docs/archive/capteurs-serveur-maison.md) : ses copies déjà déployées
// continuent d'émettre la forme `ancienMiddleware` ci-dessous, d'où ces cas. Le
// registre lui-même, sur PostgreSQL, dans tests/integration/route-cardinalite-sql.test.ts.
import { describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp, ROUTE_NON_TROUVEE } from "../../packages/backend/shared/otlp.mjs";

type Attrs = Record<string, string | number>;
const APP = "gip-plateforme";
const TRACE = "ab".repeat(16);
const NOW = 1_760_000_001_000;

const kv = (key: string, value: string | number) => ({
  key,
  value: typeof value === "number" ? { intValue: String(value) } : { stringValue: value },
});

function lot(spans: object[]) {
  return {
    resourceSpans: [{
      resource: { attributes: [kv("mip.app_id", APP), kv("service.name", "api")] },
      scopeSpans: [{ scope: { name: "mip-rum-fastapi" }, spans }],
    }],
  };
}

/** Span tel que l'ANCIEN middleware FastAPI l'émet : chemin brut en `mip.route`, jamais `http.route`. */
function ancienMiddleware(chemin: string, statut: number, attrs: Attrs = {}, spanId = "12".repeat(8)) {
  return {
    traceId: TRACE,
    spanId,
    name: "http.server",
    kind: 2,
    startTimeUnixNano: "1760000000000000000",
    endTimeUnixNano: "1760000000003000000",
    attributes: Object.entries({
      "mip.trace_id": TRACE,
      "mip.span_id": spanId,
      "mip.route": chemin,
      "http.url": chemin,
      "http.method": "GET",
      "http.status_code": statut,
      "http.duration_ms": 3,
      ...attrs,
    }).map(([k, v]) => kv(k, v)),
  };
}

/** Span SERVER d'un agent OpenTelemetry officiel : sur un 404, ni `http.route` ni route dans le nom. */
function agentOfficiel(statut: number, attrs: Attrs = {}, nom = "GET") {
  return {
    traceId: TRACE,
    spanId: "34".repeat(8),
    name: nom,
    kind: 2,
    startTimeUnixNano: "1760000000000000000",
    endTimeUnixNano: "1760000000002000000",
    attributes: Object.entries({
      "http.request.method": "GET",
      "url.path": "/manager/html",
      "http.response.status_code": statut,
      ...attrs,
    }).map(([k, v]) => kv(k, v)),
  };
}

describe("ingestion — une requête qu'aucune route n'a servie n'invente pas de route", () => {
  it("la valeur est une constante exportée", () => {
    expect(ROUTE_NON_TROUVEE).toBe("(non trouvée)");
  });

  it("ancien middleware, rafale de scanner en 404 et 405 : une seule route, le chemin reste dans l'URL", () => {
    const chemins = ["/wp-admin/admin-ajax.php", "/manager/html", "/jmx-console/", "/.env", "/cgi-bin/luci"];
    const spans = [404, 405].flatMap((statut, i) =>
      chemins.map((c, j) => ancienMiddleware(c, statut, {}, `${i}${j}`.padStart(16, "0"))));
    const rows = flattenOtlp(lot(spans), { now: NOW });
    expect(rows.spans).toHaveLength(10);
    expect(new Set(rows.spans.map((s: { route: string }) => s.route))).toEqual(new Set([ROUTE_NON_TROUVEE]));
    expect(rows.spans.map((s: { url: string }) => s.url)).toEqual([...chemins, ...chemins]);
  });

  it("un 404 sur une route résolue (`http.route` présent) garde sa route", () => {
    const rows = flattenOtlp(lot([ancienMiddleware("/commandes/{commande_id}", 404, { "http.route": "/commandes/{commande_id}" })]), { now: NOW });
    expect(rows.spans[0].route).toBe("/commandes/{commande_id}");
  });

  it("hors 404/405, rien ne change : la route déclarée passe telle quelle", () => {
    for (const statut of [200, 401, 403, 500]) {
      const rows = flattenOtlp(lot([ancienMiddleware("/partners/:id", statut)]), { now: NOW });
      expect(rows.spans[0].route, String(statut)).toBe("/partners/:id");
    }
  });

  it("un `http.route` vide ne vaut pas une route résolue", () => {
    const rows = flattenOtlp(lot([ancienMiddleware("/wp-login.php", 404, { "http.route": " " })]), { now: NOW });
    expect(rows.spans[0].route).toBe(ROUTE_NON_TROUVEE);
  });

  it("agent officiel : 404 sans `http.route` → route fixe, même si le nom du span porte le chemin", () => {
    expect(flattenOtlp(lot([agentOfficiel(404)]), { now: NOW }).spans[0].route).toBe(ROUTE_NON_TROUVEE);
    expect(flattenOtlp(lot([agentOfficiel(405, {}, "GET /manager/html")]), { now: NOW }).spans[0].route).toBe(ROUTE_NON_TROUVEE);
    // Attribut de statut historique (semconv < 1.20).
    const ancien = agentOfficiel(404, { "http.status_code": 404 });
    ancien.attributes = ancien.attributes.filter((a) => a.key !== "http.response.status_code");
    expect(flattenOtlp(lot([ancien]), { now: NOW }).spans[0].route).toBe(ROUTE_NON_TROUVEE);
  });

  it("agent officiel : 404 avec `http.route` → route normalisée gardée", () => {
    const rows = flattenOtlp(lot([agentOfficiel(404, { "http.route": "/commandes/<int:commande_id>" })]), { now: NOW });
    expect(rows.spans[0].route).toBe("/commandes/:commande_id");
  });

  it("l'exception portée par un 404 sans route suit la route de son span", () => {
    const span = {
      ...ancienMiddleware("/xmlrpc.php", 404),
      events: [{ name: "exception", timeUnixNano: "1760000000002000000", attributes: [kv("exception.type", "RuntimeError")] }],
    };
    const rows = flattenOtlp(lot([span]), { now: NOW });
    expect(rows.errors[0].route).toBe(ROUTE_NON_TROUVEE);
  });

  it("côté navigateur, un appel en 404 garde la route de la PAGE", () => {
    const client = {
      ...ancienMiddleware("/panier", 404),
      name: "http.client",
      kind: 3,
    };
    client.attributes.push(kv("mip.session_id", "sess-1"));
    const rows = flattenOtlp(lot([client]), { now: NOW });
    const front = rows.spans.find((s: { tier: string }) => s.tier === "front");
    expect(front.route).toBe("/panier");
  });
});
