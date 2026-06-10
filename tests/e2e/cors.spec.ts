// CORS = piège n°1 (PLAN §7.2) : préflight 204 + headers, whitelist d'origines.
import { expect, test } from "@playwright/test";

const ENDPOINT = "http://localhost:4318/v1/traces";
const GIT_ORIGIN = "https://plateforme.groupement-it.com";

test("préflight OPTIONS : 204 + headers CORS pour l'origine G-IT", async ({ request }) => {
  const res = await request.fetch(ENDPOINT, {
    method: "OPTIONS",
    headers: {
      Origin: GIT_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  expect(res.status()).toBe(204);
  expect(res.headers()["access-control-allow-origin"]).toBe(GIT_ORIGIN);
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
    headers: { "content-type": "application/json", Origin: GIT_ORIGIN },
    data: { resourceSpans: [] },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ partialSuccess: {} });
});
