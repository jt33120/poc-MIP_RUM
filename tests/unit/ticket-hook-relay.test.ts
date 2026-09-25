// C11 — le hook entrant des tickets, relayé OCTET POUR OCTET au notifier : les
// seuls en-têtes que la signature lit, le corps tel quel ; la réponse signée du
// notifier rendue telle quelle, tout le reste replié sur la console (sûr : une
// livraison rejouée n'applique rien deux fois).
import { describe, expect, it, vi } from "vitest";
import { ENTETES_TRANSMIS, lireUrlNotifier, relayerLivraison } from "@/lib/ticket-hook-relay";
import { SESSION_COOKIE } from "@/lib/auth";
// @ts-expect-error module ESM partagé, sans déclarations
import { COOKIE_SESSION_CONSOLE } from "../../packages/backend/lib/integrations/tickets/webhook-entrant.mjs";

const ENV = { CONSOLE_TICKET_HOOK_URL: "https://notifier.test" };
const corps = new TextEncoder().encode('{"action":"closed"}');
const livraison = () =>
  new Request("https://mip-rum-console.vercel.app/api/webhooks/tickets/7", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issues",
      "x-github-delivery": "d-1",
      "x-hub-signature-256": "sha256=abc",
      cookie: "autre=1",
      "x-forwarded-for": "203.0.113.9",
    },
    body: corps,
  });

describe("relais du hook entrant des tickets (C11)", () => {
  it("éteint sans CONSOLE_TICKET_HOOK_URL, ou avec une URL http hors de la machine", async () => {
    expect(lireUrlNotifier({})).toBeNull();
    expect(lireUrlNotifier({ CONSOLE_TICKET_HOOK_URL: "http://notifier.test" })).toBeNull();
    expect(lireUrlNotifier({ CONSOLE_TICKET_HOOK_URL: "http://localhost:4330" })).toBe("http://localhost:4330");
    const fetch = vi.fn();
    expect(await relayerLivraison("7", livraison(), corps, { env: {}, fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("les octets tels quels et les seuls en-têtes de la signature ; la réponse signée rendue telle quelle", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "signature refusée" }, { status: 401, headers: { "x-mip-notifier": "1" } }));
    const r = await relayerLivraison("7", livraison(), corps, { env: ENV, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(r?.status).toBe(401);
    expect(await r?.json()).toEqual({ error: "signature refusée" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://notifier.test/v1/webhooks/tickets/7");
    expect(init.body).toBe(corps);
    expect([...new Headers(init.headers).keys()].sort()).toEqual(["content-type", "x-github-delivery", "x-github-event", "x-hub-signature-256"]);
    expect(ENTETES_TRANSMIS).not.toContain("cookie");
  });

  it("non signée (routeur Railway) ou réseau en panne : la console traite elle-même", async () => {
    const railway = vi.fn(async () => new Response("not found", { status: 404 }));
    expect(await relayerLivraison("7", livraison(), corps, { env: ENV, fetch: railway as unknown as typeof globalThis.fetch })).toBeNull();
    const panne = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await relayerLivraison("7", livraison(), corps, { env: ENV, fetch: panne as unknown as typeof globalThis.fetch })).toBeNull();
  });

  it("le notifier refuse le MÊME cookie que la console", () => {
    expect(COOKIE_SESSION_CONSOLE).toBe(SESSION_COOKIE);
  });
});
