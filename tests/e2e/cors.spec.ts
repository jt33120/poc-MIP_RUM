// CORS = piège n°1 (PLAN §7.2) : préflight 204 + headers, whitelist d'origines.
import { expect, test } from "@playwright/test";

const ENDPOINT = "http://localhost:4318/v1/traces";
// Origine du site cobaye (socle de développement de `shared/cors.mjs`) : aucun
// domaine client n'est écrit en dur dans le dépôt public.
const ORIGINE = "http://localhost:8080";

test("préflight OPTIONS : 204 + headers CORS pour une origine du socle", async ({ request }) => {
  const res = await request.fetch(ENDPOINT, {
    method: "OPTIONS",
    headers: {
      Origin: ORIGINE,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  expect(res.status()).toBe(204);
  expect(res.headers()["access-control-allow-origin"]).toBe(ORIGINE);
  expect(res.headers()["access-control-allow-methods"]).toContain("POST");
  expect(res.headers()["access-control-allow-headers"]).toContain("content-type");
});

test("origine non whitelistée : pas de reflet de l'origine", async ({ request }) => {
  const res = await request.fetch(ENDPOINT, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "POST" },
  });
  expect(res.status()).toBe(204);
  expect(res.headers()["access-control-allow-origin"]).not.toBe("https://evil.example.com");
});

test("POST OTLP JSON : 200 + partialSuccess", async ({ request }) => {
  const res = await request.post(ENDPOINT, {
    headers: { "content-type": "application/json", Origin: ORIGINE },
    data: { resourceSpans: [] },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ partialSuccess: {} });
});
