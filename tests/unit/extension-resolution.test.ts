// P6b.G — l'adresse que la résolution d'un domaine rend à l'extension.
//
// L'extension injecte `endpoint ?? son défaut` : c'est la réponse de la console
// qui décide de la collecte directe, sans toucher au code de l'extension. Trois
// propriétés tenues ici : inerte sans la variable (octet pour octet sur une
// réponse relayée), un `extension_scope.endpoint` explicite gagne toujours (le
// domaine à CSP figée reste en relais), et la réponse du collector relayée suit
// la même règle que la réponse locale.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { completerResolutionRelayee, endpointExtension } from "../../apps/console/lib/extension-resolution";
import { decideInjection } from "../../apps/extension/lib/scope";

const COLLECTOR = "https://collector-production-d769.up.railway.app";
const CONSOLE = "https://mip-rum-console.vercel.app/api/ingest/v1/traces";
const CLE = "NEXT_PUBLIC_DIRECT_COLLECTOR_URL";

let avant: string | undefined;
beforeEach(() => {
  avant = process.env[CLE];
  delete process.env[CLE];
});
afterEach(() => {
  if (avant === undefined) delete process.env[CLE];
  else process.env[CLE] = avant;
});

/** Une réponse relayée telle que la rend `lib/ingest-relay.ts`. */
function relayee(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=60",
    },
  });
}

describe("endpointExtension", () => {
  it("sans la variable : la valeur de la base, `null` compris (l'extension prend son défaut)", () => {
    expect(endpointExtension(null)).toBeNull();
    expect(endpointExtension(CONSOLE)).toBe(CONSOLE);
  });

  it("avec la variable : l'adresse directe à la place d'un vide", () => {
    process.env[CLE] = COLLECTOR;
    expect(endpointExtension(null)).toBe(`${COLLECTOR}/v1/traces`);
    expect(endpointExtension("  ")).toBe(`${COLLECTOR}/v1/traces`);
  });

  it("un endpoint posé pour le domaine gagne toujours (CSP figée : on le garde sur la console)", () => {
    process.env[CLE] = COLLECTOR;
    expect(endpointExtension(CONSOLE)).toBe(CONSOLE);
  });

  it("l'extension injecte bien ce qu'on lui rend", () => {
    process.env[CLE] = COLLECTOR;
    const scope = { app_id: "gip-plateforme", endpoint: endpointExtension(null), active: true };
    expect(decideInjection({ scope, hasPermission: true, sdkAlreadyPresent: false }).endpoint).toBe(`${COLLECTOR}/v1/traces`);
  });
});

describe("completerResolutionRelayee — la réponse du collector, relayée", () => {
  it("sans la variable : la MÊME réponse, pas une copie", async () => {
    const res = relayee({ app_id: "a", endpoint: null, active: true });
    expect(await completerResolutionRelayee(res)).toBe(res);
  });

  it("avec la variable : `endpoint` complété, statut et en-têtes conservés", async () => {
    process.env[CLE] = COLLECTOR;
    const res = await completerResolutionRelayee(relayee({ app_id: "a", endpoint: null, active: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ app_id: "a", endpoint: `${COLLECTOR}/v1/traces`, active: true });
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("un endpoint déclaré, un refus ou un corps illisible repartent tels quels", async () => {
    process.env[CLE] = COLLECTOR;
    const declare = relayee({ app_id: "a", endpoint: CONSOLE, active: true });
    expect(await completerResolutionRelayee(declare)).toBe(declare);
    const introuvable = relayee({ error: "domaine non enregistré" }, 404);
    expect(await completerResolutionRelayee(introuvable)).toBe(introuvable);
    const illisible = new Response("pas du json", { status: 200 });
    expect(await completerResolutionRelayee(illisible)).toBe(illisible);
  });
});
