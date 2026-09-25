// P4 — le relais de l'API de lecture v1, de la console vers le service `api`.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Qu'une requête au COOKIE de session parte au service : il n'accepte pas les
//     sessions, les écrans de la console recevraient 401.
//   - Qu'une écriture parte au service : il n'en sert aucune.
//   - Qu'une réponse du routeur Railway (service absent) ou un 5xx soit rendu au
//     client : une lecture se rejoue localement, sans risque.
//   - Que le jeton parte en clair hors de la machine, ou qu'un cookie parte tout court.
//   - Qu'un service en panne soit rappelé à chaque requête : le disjoncteur coupe.
import { describe, expect, it, vi } from "vitest";
import { DELAIS, ENTETE_API, creerRelaisApi, eligible, lireUrlRelaisApi } from "../../apps/console/lib/api-relay";

const URL_API = "https://api.exemple.up.railway.app";
const JETON = { authorization: "Bearer jeton-machine" };
const req = (chemin: string, init: RequestInit = {}) => new Request(`https://mip-rum-console.vercel.app${chemin}`, init);
const signee = (statut: number, corps = "{}", entetes: Record<string, string> = {}) =>
  new Response(statut === 304 ? null : corps, { status: statut, headers: { [ENTETE_API]: "1", "content-type": "application/json", ...entetes } });

function relais(o: { fetch?: typeof fetch; pct?: number; env?: Record<string, string>; t?: { v: number } } = {}) {
  const t = o.t ?? { v: 1_000_000 };
  const fetchImpl = vi.fn(o.fetch ?? (async () => signee(200, '{"ok":true}')));
  return {
    fetchImpl,
    t,
    r: creerRelaisApi({
      env: () => o.env ?? { CONSOLE_API_RELAY_URL: URL_API },
      fetch: fetchImpl as unknown as typeof fetch,
      maintenant: () => t.v,
      aleatoire: () => 0.5,
      pourcentage: async () => o.pct ?? 100,
    }),
  };
}

describe("configuration et éligibilité", () => {
  it("https seulement (http réservé à localhost), sinon éteint", () => {
    expect(lireUrlRelaisApi({})).toBeNull();
    expect(lireUrlRelaisApi({ CONSOLE_API_RELAY_URL: "http://api.exemple.test" })).toBeNull();
    expect(lireUrlRelaisApi({ CONSOLE_API_RELAY_URL: "http://localhost:4323/x" })).toBe("http://localhost:4323");
    expect(lireUrlRelaisApi({ CONSOLE_API_RELAY_URL: `${URL_API}/` })).toBe(URL_API);
  });

  it("jeton machine seulement ; lectures seulement", () => {
    expect(eligible(req("/api/v1/apps", { headers: JETON }))).toBe(true);
    expect(eligible(req("/api/v1/apps", { headers: { cookie: "mip_session=x" } }))).toBe(false);
    expect(eligible(req("/api/v1/explorer/query", { method: "POST", headers: JETON, body: "{}" }))).toBe(true);
    expect(eligible(req("/api/v1/explorer/views", { method: "POST", headers: JETON, body: "{}" }))).toBe(false);
    expect(eligible(req("/api/v1/issues/x/triage", { method: "POST", headers: JETON }))).toBe(false);
  });
});

describe("le relais", () => {
  it("éteint : aucun appel réseau, à 0 % comme sans URL", async () => {
    for (const o of [{ pct: 0 }, { env: {} }]) {
      const { r, fetchImpl } = relais(o);
      expect(await r.relayer(req("/api/v1/apps", { headers: JETON }))).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("transmet chemin et requête, le jeton et l'ETag — jamais le cookie ni l'adresse du client", async () => {
    const { r, fetchImpl } = relais();
    const res = await r.relayer(
      req("/api/v1/overview?app=a&period=7d", {
        headers: { ...JETON, cookie: "mip_session=x", "if-none-match": 'W/"1"', "x-forwarded-for": "203.0.113.9", origin: "https://front.test" },
      }),
    );
    expect(res?.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_API}/api/v1/overview?app=a&period=7d`);
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe("Bearer jeton-machine");
    expect(h.get("if-none-match")).toBe('W/"1"');
    expect(h.get("origin")).toBe("https://front.test");
    expect(h.get("cookie")).toBeNull();
    expect(h.get("x-forwarded-for")).toBeNull();
  });

  it("réponse signée < 500 rendue telle quelle : 200, 304, et les refus du service", async () => {
    for (const statut of [200, 304, 401, 403, 404]) {
      const { r } = relais({ fetch: async () => signee(statut, '{"x":1}', { etag: 'W/"9"' }) });
      const res = await r.relayer(req("/api/v1/apps", { headers: JETON }));
      expect(res?.status, String(statut)).toBe(statut);
      if (statut === 200) expect(res?.headers.get("etag")).toBe('W/"9"');
    }
  });

  it("repli local : réponse non signée (routeur Railway), 5xx du service, erreur réseau", async () => {
    for (const f of [
      async () => new Response("Application not found", { status: 404 }),
      async () => new Response("bad gateway", { status: 502 }),
      async () => signee(500),
      async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      },
    ]) {
      const { r } = relais({ fetch: f as unknown as typeof fetch });
      expect(await r.relayer(req("/api/v1/apps", { headers: JETON }))).toBeNull();
    }
  });

  it("disjoncteur : 5 échecs en 30 s coupent le relais 60 s, puis il reprend", async () => {
    const t = { v: 1_000_000 };
    const { r, fetchImpl } = relais({ t, fetch: (async () => new Response("", { status: 502 })) as unknown as typeof fetch });
    for (let i = 0; i < DELAIS.echecsMax; i++) await r.relayer(req("/api/v1/apps", { headers: JETON }));
    expect(fetchImpl).toHaveBeenCalledTimes(DELAIS.echecsMax);
    await r.relayer(req("/api/v1/apps", { headers: JETON }));
    expect(fetchImpl).toHaveBeenCalledTimes(DELAIS.echecsMax); // coupé : aucun appel
    t.v += DELAIS.coupureMs + 1;
    await r.relayer(req("/api/v1/apps", { headers: JETON }));
    expect(fetchImpl).toHaveBeenCalledTimes(DELAIS.echecsMax + 1);
  });

  it("l'Explorer : le corps est relayé, et reste lisible pour le repli local", async () => {
    const { r, fetchImpl } = relais({ fetch: (async () => new Response("", { status: 502 })) as unknown as typeof fetch });
    const r0 = req("/api/v1/explorer/query", { method: "POST", headers: { ...JETON, "content-type": "application/json" }, body: '{"q":1}' });
    expect(await r.relayer(r0)).toBeNull();
    const envoye = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as ArrayBuffer;
    expect(new TextDecoder().decode(envoye)).toBe('{"q":1}');
    expect(await r0.text()).toBe('{"q":1}');
  });
});

// C11 — relais PUR : plus de lecture au jeton servie par la console, ce qui permet
// de retirer CONSOLE_API_TOKENS de Vercel.
describe("relais pur (CONSOLE_API_RELAY_STRICT=1)", () => {
  const STRICT = { CONSOLE_API_RELAY_URL: URL_API, CONSOLE_API_RELAY_STRICT: "1" };

  it("le pourcentage est ignoré : à 0 %, une lecture au jeton part quand même", async () => {
    const { r, fetchImpl } = relais({ env: STRICT, pct: 0 });
    expect((await r.relayer(req("/api/v1/apps", { headers: JETON })))?.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("service injoignable, non signé ou en 5xx : 503 + retry-after, jamais le chemin local", async () => {
    for (const panne of [
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response("bad gateway", { status: 502 }),
      async () => signee(500),
    ]) {
      const { r } = relais({ env: STRICT, fetch: panne as unknown as typeof fetch });
      const res = await r.relayer(req("/api/v1/apps", { headers: JETON }));
      expect(res?.status).toBe(503);
      expect(res?.headers.get("retry-after")).toBe("5");
    }
  });

  it("les écrans (session) restent locaux : le service n'accepte pas les sessions", async () => {
    const { r, fetchImpl } = relais({ env: STRICT });
    expect(await r.relayer(req("/api/v1/apps", { headers: { cookie: "mip_session=x" } }))).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
