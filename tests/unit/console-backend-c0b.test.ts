// C0b — le client de console-api côté console (`lib/backend.ts`), contre le VRAI
// pipeline du service, en mémoire.
//
// `fetch` est remplacé par un appel direct au pipeline de `@mip/console-api`
// (table réelle, vraies clés ES256) : ce que la console envoie est exactement ce
// que le service juge. Les scénarios qui comptent :
//
//   · rien de configuré : aucun appel ne part, la vitrine lit la base comme avant ;
//   · une clé PRIVÉE posée sur Vercel est refusée (le module se déclare non branché) ;
//   · la poignée de main part SANS secret, et le secret ne part qu'après elle ;
//   · un hôte qui ne prouve pas son identité (autre clé, nonce rejoué) ne reçoit
//     jamais le secret ;
//   · une réponse non signée (routeur Railway, secret refusé) n'est jamais prise
//     pour une réponse du service ; une lecture est retentée une fois, jamais une écriture.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ETAT_PLATEFORME, messageDePoignee, operation, VERSION } from "@mip/console-contract";
import { chargerTrousseau, creerConsoleApi, creerDebitAuth, creerTable, signer, type Lecteur } from "@mip/console-api";
import { cheminDe, creerBackend, lireConfigBackend } from "../../apps/console/lib/backend";

const planifie = vi.hoisted(() => ({
  appels: 0,
  quotidien: { etat: "lu", date: new Date("2026-09-20T03:00:00Z") } as const,
  tick: { etat: "illisible" } as const,
}));
vi.mock("../../apps/console/lib/queries-planifie", () => ({
  dernierPassagePlanifie: async () => {
    planifie.appels++;
    return planifie.quotidien;
  },
  dernierTickScheduler: async () => planifie.tick,
}));

import { lireEtatPlateforme } from "../../apps/console/lib/etat-plateforme";

const SECRET = "c".repeat(48);
const URL_SERVICE = "https://console-api-production.up.railway.app";

async function jeu(kid: string) {
  const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const j = await crypto.subtle.exportKey("jwk", paire.privateKey);
  return { kty: "EC", crv: "P-256", x: j.x!, y: j.y!, d: j.d!, kid, alg: "ES256", use: "sig" };
}
const publique = ({ d: _d, ...k }: Awaited<ReturnType<typeof jeu>>) => k;

/** Les dépendances de l'identité (C1), inertes : la table réelle les exige. */
const identite = async () => ({
  transacteur: { transaction: <T,>(fn: (c: Lecteur) => Promise<T>) => fn(base) },
  debit: await creerDebitAuth("i".repeat(40)),
  verifierMotDePasse: async () => false,
  hachageFactice: "",
  demo: null,
  oublierSession: () => {},
});

const base: Lecteur = {
  async query(texte: string) {
    if (texte.includes("tenant_usage_daily")) return { rows: [{ t: "2026-09-23 03:00:00+00" }] as never[] };
    if (texte.includes("scheduler_lease")) return { rows: [{ t: "2026-09-24 10:15:00+00" }] as never[] };
    return { rows: [{ value: "15" }] as never[] };
  },
};

/** Un service en mémoire, et un `fetch` qui le joint en notant chaque appel. */
async function monter(opts: { cle?: Awaited<ReturnType<typeof jeu>>; env?: Record<string, string> } = {}) {
  const cle = opts.cle ?? (await jeu("session-20260924-aaaa"));
  const trousseau = await chargerTrousseau(JSON.stringify({ keys: [cle] }), { production: false });
  const { table } = await creerTable({ trousseau, version: "abc123", db: base, identite: await identite(), ecrans: { coquille: async () => ({ projets: { ok: true as const, data: [] }, schema: { ok: true as const, data: [] }, fuseaux: {}, tickets: null }) } });
  const service = creerConsoleApi({ table, secretsClient: [SECRET], journal: { info() {}, warn() {}, error() {} } });
  const appels: { url: string; entetes: Headers; methode: string }[] = [];
  const fetchService = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const req = new Request(url as string, init);
    appels.push({ url: req.url, entetes: req.headers, methode: req.method });
    return service(req);
  });
  const journal = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const env = opts.env ?? { CONSOLE_API_URL: URL_SERVICE, CONSOLE_API_CLIENT_SECRET: SECRET, SESSION_PUBLIC_JWKS: JSON.stringify({ keys: [publique(cle)] }) };
  let t = 1_000_000;
  const client = creerBackend({ env: () => env, fetch: fetchService as typeof fetch, journal, maintenant: () => t, aleatoire: () => 0 });
  return { client, appels, journal, cle, avancer: (ms: number) => (t += ms), fetchService };
}

afterEach(() => {
  planifie.appels = 0;
});

describe("C0b — la configuration de console-api côté Vercel", () => {
  it("rien de posé : non branché, sans bruit", () => {
    expect(lireConfigBackend({})).toEqual({ etat: "absente" });
  });

  it("refuse une clé privée, un hôte en clair, un secret court, une configuration partielle", async () => {
    const cle = await jeu("k1");
    const ok = { CONSOLE_API_URL: URL_SERVICE, CONSOLE_API_CLIENT_SECRET: SECRET, SESSION_PUBLIC_JWKS: JSON.stringify({ keys: [publique(cle)] }) };
    expect(lireConfigBackend(ok)).toMatchObject({ etat: "branche", config: { url: URL_SERVICE } });
    expect(lireConfigBackend({ ...ok, SESSION_PUBLIC_JWKS: JSON.stringify({ keys: [cle] }) })).toMatchObject({ etat: "invalide", raison: expect.stringContaining("PRIVÉE") });
    expect(lireConfigBackend({ ...ok, CONSOLE_API_URL: "http://console-api.up.railway.app" })).toMatchObject({ etat: "invalide", raison: expect.stringContaining("https") });
    expect(lireConfigBackend({ ...ok, CONSOLE_API_URL: "http://localhost:4324" })).toMatchObject({ etat: "branche" });
    expect(lireConfigBackend({ ...ok, CONSOLE_API_URL: "https://moi:pw@x.test" })).toMatchObject({ etat: "invalide" });
    expect(lireConfigBackend({ ...ok, CONSOLE_API_CLIENT_SECRET: "court" })).toMatchObject({ etat: "invalide" });
    expect(lireConfigBackend({ CONSOLE_API_URL: URL_SERVICE })).toMatchObject({ etat: "invalide", raison: expect.stringContaining("vont ensemble") });
  });

  it("mal configuré : non branché, une seule ligne d'erreur au journal, aucun appel", async () => {
    const { client, journal, fetchService } = await monter({ env: { CONSOLE_API_URL: URL_SERVICE } });
    expect(client.estBranche()).toBe(false);
    expect(client.estBranche()).toBe(false);
    expect((await client.appeler(ETAT_PLATEFORME)).ok).toBe(false);
    expect(journal.error).toHaveBeenCalledTimes(1);
    expect(fetchService).not.toHaveBeenCalled();
  });
});

describe("C0b — la poignée de main, avant tout secret", () => {
  it("le cas nominal : poignée SANS secret, puis l'appel AVEC, et le service répond", async () => {
    const { client, appels } = await monter();
    const r = await client.appeler(ETAT_PLATEFORME, {}, { requestId: "req-c0b-0001" });
    expect(r).toMatchObject({ ok: true, requestId: "req-c0b-0001" });
    if (!r.ok) return;
    expect(r.data.tick).toEqual({ etat: "lu", date: "2026-09-24T10:15:00.000Z", cadenceMin: 15 });
    expect(appels.map((a) => new URL(a.url).pathname)).toEqual([VERSION.chemin, ETAT_PLATEFORME.chemin]);
    expect(appels[0].entetes.get("x-mip-client")).toBeNull();
    expect(appels[1].entetes.get("x-mip-client")).toBe(SECRET);
    expect(appels[1].entetes.get("x-request-id")).toBe("req-c0b-0001");
    // Le budget du service est plus court que celui du client.
    expect(Number(appels[1].entetes.get("x-mip-deadline-ms"))).toBeLessThanOrEqual(8_000 - 500);
  });

  it("une poignée réussie vaut 10 minutes par instance, puis se refait", async () => {
    const { client, appels, avancer } = await monter();
    await client.appeler(ETAT_PLATEFORME);
    await client.appeler(ETAT_PLATEFORME);
    expect(appels.filter((a) => a.url.includes("/v1/version")).length).toBe(1);
    avancer(10 * 60_000 + 1);
    await client.appeler(ETAT_PLATEFORME);
    expect(appels.filter((a) => a.url.includes("/v1/version")).length).toBe(2);
  });

  it("un hôte signé par une AUTRE clé ne reçoit jamais le secret", async () => {
    const imposteur = await jeu("session-20260924-aaaa"); // même kid, autre clé
    const vraie = await jeu("session-20260924-aaaa");
    const { client, appels, journal } = await monter({
      cle: imposteur,
      env: { CONSOLE_API_URL: URL_SERVICE, CONSOLE_API_CLIENT_SECRET: SECRET, SESSION_PUBLIC_JWKS: JSON.stringify({ keys: [publique(vraie)] }) },
    });
    const r = await client.appeler(ETAT_PLATEFORME);
    expect(r).toMatchObject({ ok: false, code: "hote_non_verifie" });
    expect(appels.some((a) => a.entetes.get("x-mip-client"))).toBe(false);
    expect(journal.error).toHaveBeenCalledWith(expect.stringContaining("REFUSÉE"), expect.any(Object));
  });

  it("une réponse signée REJOUÉE (autre nonce) est refusée", async () => {
    const cle = await jeu("session-20260924-bbbb");
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [cle] }), { production: false });
    const capturee = { service: "console-api", nonce: "N".repeat(32), contrat: "x", version: "v", kid: cle.kid };
    const signature = await signer(trousseau.courante, messageDePoignee(capturee));
    const rejeu = vi.fn(async () =>
      new Response(JSON.stringify({ meta: { request_id: "r" }, data: { ...capturee, signature } }), { headers: { "x-mip-console-api": "1" } }),
    );
    const client = creerBackend({
      env: () => ({ CONSOLE_API_URL: URL_SERVICE, CONSOLE_API_CLIENT_SECRET: SECRET, SESSION_PUBLIC_JWKS: JSON.stringify({ keys: [publique(cle)] }) }),
      fetch: rejeu as unknown as typeof fetch,
      journal: { info() {}, warn() {}, error() {} },
    });
    expect(await client.appeler(ETAT_PLATEFORME)).toMatchObject({ ok: false, code: "hote_non_verifie" });
    expect(rejeu).toHaveBeenCalledTimes(1); // la poignée seule : l'appel n'est jamais parti
  });

  it("un contrat différent est signalé une fois, sans bloquer (N et N−1)", async () => {
    const cle = await jeu("session-20260924-cccc");
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [cle] }), { production: false });
    const { table } = await creerTable({ trousseau, version: "abc", db: base, identite: await identite(), ecrans: { coquille: async () => ({ projets: { ok: true as const, data: [] }, schema: { ok: true as const, data: [] }, fuseaux: {}, tickets: null }) } });
    // Le service annonce un contrat que la console ne connaît pas (une opération
    // ajoutée côté service, déployé d'abord) : la poignée de main est re-signée
    // avec cette empreinte, comme le ferait un vrai service plus récent.
    const service = creerConsoleApi({ table, secretsClient: [SECRET], journal: { info() {}, warn() {}, error() {} } });
    const journal = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const faux = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const res = await service(new Request(url as string, init));
      if (!String(url).includes("/v1/version")) return res;
      const corps = await res.json();
      corps.data.contrat = "f".repeat(64);
      corps.data.signature = await signer(trousseau.courante, messageDePoignee(corps.data));
      return new Response(JSON.stringify(corps), { headers: res.headers });
    });
    const client = creerBackend({
      env: () => ({ CONSOLE_API_URL: URL_SERVICE, CONSOLE_API_CLIENT_SECRET: SECRET, SESSION_PUBLIC_JWKS: JSON.stringify({ keys: [publique(cle)] }) }),
      fetch: faux as unknown as typeof fetch,
      journal,
    });
    expect((await client.appeler(ETAT_PLATEFORME)).ok).toBe(true);
    expect(journal.warn).toHaveBeenCalledWith(expect.stringContaining("contrat"), expect.objectContaining({ service: "ffffffffffff" }));
  });
});

describe("C0b — ce qui n'est pas une réponse du service", () => {
  async function avecReponses(reponses: (() => Response | Promise<Response>)[], methode: "GET" | "POST" = "GET") {
    const cle = await jeu("session-20260924-dddd");
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [cle] }), { production: false });
    const { table } = await creerTable({ trousseau, version: "v", db: base, identite: await identite(), ecrans: { coquille: async () => ({ projets: { ok: true as const, data: [] }, schema: { ok: true as const, data: [] }, fuseaux: {}, tickets: null }) } });
    const vrai = creerConsoleApi({ table, secretsClient: [SECRET], journal: { info() {}, warn() {}, error() {} } });
    let i = 0;
    const journal = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const faux = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/v1/version")) return vrai(new Request(url as string, init));
      const r = reponses[i++];
      if (!r) throw new Error("appel de trop");
      return r();
    });
    const client = creerBackend({
      env: () => ({ CONSOLE_API_URL: URL_SERVICE, CONSOLE_API_CLIENT_SECRET: SECRET, SESSION_PUBLIC_JWKS: JSON.stringify({ keys: [publique(cle)] }) }),
      fetch: faux as unknown as typeof fetch,
      journal,
      aleatoire: () => 0,
    });
    const op = methode === "GET" ? ETAT_PLATEFORME : operation("essai.ecrire", "POST", "/v1/essai");
    return { resultat: await client.appeler(op as typeof ETAT_PLATEFORME), faux, journal };
  }
  const signee = (corps: unknown, statut = 200) => () =>
    new Response(JSON.stringify(corps), { status: statut, headers: { "x-mip-console-api": "1", "content-type": "application/json" } });

  it("un 502 du routeur Railway (non signé) : une lecture est retentée une fois", async () => {
    const { resultat, faux } = await avecReponses([() => new Response("bad gateway", { status: 502 }), signee({ meta: { request_id: "r" }, data: { ok: 1 } })]);
    expect(resultat).toMatchObject({ ok: true });
    expect(faux).toHaveBeenCalledTimes(3); // poignée + 2 essais
  });

  it("une écriture n'est JAMAIS retentée", async () => {
    const { resultat, faux } = await avecReponses([() => new Response("bad gateway", { status: 502 })], "POST");
    expect(resultat).toMatchObject({ ok: false, code: "indisponible", statut: 502 });
    expect(faux).toHaveBeenCalledTimes(2);
  });

  it("un 404 nu (secret refusé) n'est pas « ressource inconnue » : indisponible, et le journal le dit", async () => {
    const { resultat, journal } = await avecReponses([() => new Response(null, { status: 404 })]);
    expect(resultat).toMatchObject({ ok: false, code: "indisponible", statut: 404 });
    expect(journal.error).toHaveBeenCalledWith(expect.stringContaining("secret client refusé"), expect.any(Object));
  });

  it("un refus du service garde son code, son statut et son message", async () => {
    const { resultat } = await avecReponses([signee({ meta: { request_id: "r" }, error: { code: "hors_perimetre", message: "application hors de votre périmètre" } }, 403)]);
    expect(resultat).toEqual({ ok: false, code: "hors_perimetre", statut: 403, message: "application hors de votre périmètre", requestId: expect.any(String) });
  });

  it("réseau en panne deux fois : `reseau`, sans lever", async () => {
    const panne = () => {
      throw new TypeError("fetch failed");
    };
    const { resultat } = await avecReponses([panne, panne]);
    expect(resultat).toMatchObject({ ok: false, code: "reseau" });
  });
});

describe("C0b — la vitrine lit console-api s'il est branché, la base sinon", () => {
  it("non branché : la lecture locale, comme avant", async () => {
    const r = await lireEtatPlateforme({ estBranche: () => false, appeler: vi.fn() as never });
    expect(r.quotidien).toEqual(planifie.quotidien);
    expect(planifie.appels).toBe(1);
  });

  it("branché : les dates de console-api redeviennent des Date, sans toucher la base", async () => {
    const { client } = await monter();
    const r = await lireEtatPlateforme(client);
    expect(r.tick).toEqual({ etat: "lu", date: new Date("2026-09-24T10:15:00Z"), cadenceMin: 15 });
    expect(r.quotidien).toEqual({ etat: "lu", date: new Date("2026-09-23T03:00:00Z") });
    expect(planifie.appels).toBe(0);
  });

  it("branché mais en échec : repli sur la base (une lecture se rejoue sans risque)", async () => {
    const r = await lireEtatPlateforme({
      estBranche: () => true,
      appeler: (async () => ({ ok: false, code: "indisponible", statut: 502, message: "x", requestId: null })) as never,
    });
    expect(r.quotidien).toEqual(planifie.quotidien);
    expect(planifie.appels).toBe(1);
  });
});

describe("C0b — les chemins", () => {
  it("encode chaque paramètre, refuse un paramètre manquant", () => {
    expect(cheminDe("/v1/dashboards/{id}/layout", { id: "a/b c" })).toBe("/v1/dashboards/a%2Fb%20c/layout");
    expect(() => cheminDe("/v1/dashboards/{id}", {})).toThrow(/manquant/);
  });
});
