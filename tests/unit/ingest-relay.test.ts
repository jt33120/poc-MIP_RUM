// C12 — la console RELAIE la collecte au collector, et ne l'écrit plus jamais
// (`lib/ingest-relay.ts`, ADR 0005 point 5). Et le lecteur de drapeaux de
// plateforme (`lib/platform-flag.ts`), qui sert encore les autres relais.
//
// Ce que ce fichier tient, sans réseau ni base :
//   · configuration absente ou invalide : 503 + retry-after, aucun appel réseau ;
//   · `http:` refusé hors de localhost : secret et clés ne partent pas en clair ;
//   · santé du collector (cache 60 s) : en échec, 503 sans POST ;
//   · la MATRICE DES RÉPONSES, chaque statut × chaque signal × signé ou non
//     (`x-mip-collector: 1`) : signée, rendue telle quelle ; NON signée 404, 405,
//     502, 504 (routeur Railway), 503 + retry-after ; erreur réseau ou délai, 503 ;
//   · la LISTE D'EN-TÊTES EXACTE : le pays, jamais une adresse ;
//   · le corps octet pour octet ;
//   · par les routes : relais, CORS du collector, refus de taille locaux, et
//     AUCUNE requête à la base — ni lecture, ni écriture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const simul = vi.hoisted(() => ({
  // Le pool de la console : les routes de collecte ne doivent jamais l'appeler.
  query: vi.fn(async (_sql: string, _params?: unknown[]): Promise<{ rows: unknown[] }> => {
    throw Object.assign(new Error('relation "platform_flag" does not exist'), { code: "42P01" });
  }),
  journal: [] as Array<{ niveau: string; msg: string; champs?: object }>,
}));

vi.mock("@/lib/db", () => ({ pool: { query: simul.query }, q: simul.query }));

import { creerLecteurDrapeaux, lirePourcentage } from "../../apps/console/lib/platform-flag";
import {
  _resetRelais,
  CHEMINS,
  collectorAbsent,
  creerRelais,
  DELAIS,
  ENTETE_COLLECTOR,
  ENTETES_SOURCEMAPS,
  ENTETES_TRANSMIS,
  lireConfigRelais,
  RETRY_AFTER_DELAI_S,
  type Signal,
} from "../../apps/console/lib/ingest-relay";
// @ts-expect-error module ESM partagé, sans déclarations
import { ENTETE_COLLECTOR as ENTETE_DU_RECEVEUR } from "../../packages/backend/lib/receiver.mjs";
import { GET as GET_TRACES, OPTIONS as OPTIONS_TRACES, POST as POST_TRACES } from "../../apps/console/app/api/ingest/v1/traces/route";
import { POST as POST_LOGS } from "../../apps/console/app/api/ingest/v1/logs/route";
import { OPTIONS as OPTIONS_REPLAY, POST as POST_REPLAY } from "../../apps/console/app/api/ingest/v1/replay/route";
import { POST as POST_SOURCEMAPS } from "../../apps/console/app/api/sourcemaps/route";
import { POST as POST_HEARTBEAT } from "../../apps/console/app/api/extension/heartbeat/route";
import { GET as GET_RESOLVE } from "../../apps/console/app/api/extension/resolve/route";
import { POST as POST_DEPLOYS } from "../../apps/console/app/api/v1/deploys/route";

const URL_COLLECTOR = "https://collector.test.internal";
const SECRET = "s".repeat(40);
/** Un jeton de CI au format réel (`msu_<id>_<secret>`) : la route des marqueurs le reconnaît. */
const JETON_CI = `Bearer msu_${"a".repeat(32)}_${"b".repeat(64)}`;
const SIGNAUX: Signal[] = ["traces", "logs", "replay", "sourcemaps", "extensionHeartbeat", "deploys"];
const NAVIGATEUR: Signal[] = ["traces", "logs", "replay"];
const IP = "203.0.113.77";
const ORIGINE = "http://localhost:3000"; // dans le socle CORS statique
const ORIGINE_CLIENT = "https://app.client.fr"; // connue du seul registre du collector

const journal = {
  info: (msg: string, champs?: object) => simul.journal.push({ niveau: "info", msg, champs }),
  warn: (msg: string, champs?: object) => simul.journal.push({ niveau: "warn", msg, champs }),
};

type AppelFetch = { url: string; init: RequestInit };

/**
 * Faux collector : `/health` conforme, et une réponse programmable pour le reste.
 * Comme le vrai, il SIGNE ses réponses (`x-mip-collector: 1`) et pose ses CORS ;
 * `postSigne: false` simule le routeur Railway, `santeSignee: false` un collector
 * antérieur à la signature.
 */
function fauxCollector(opts: {
  sante?: () => Response | Promise<Response>;
  post?: (url: string, init: RequestInit) => Response | Promise<Response>;
  postSigne?: boolean;
  santeSignee?: boolean;
} = {}) {
  const appels: AppelFetch[] = [];
  const signer = (r: Response, oui: boolean) => {
    if (oui) r.headers.set(ENTETE_COLLECTOR, "1");
    return r;
  };
  const fetch = vi.fn(async (entree: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(entree);
    appels.push({ url, init });
    if (url.endsWith("/health")) {
      return signer(
        opts.sante
          ? await opts.sante()
          : Response.json({ status: "ok", service: "collector", edge_protocol: "mip-edge/1", edge_trust: true }),
        opts.santeSignee !== false,
      );
    }
    return signer(
      opts.post
        ? await opts.post(url, init)
        : Response.json({ partialSuccess: {} }, { headers: { "access-control-allow-origin": ORIGINE_CLIENT } }),
      opts.postSigne !== false,
    );
  });
  return { fetch, appels, posts: () => appels.filter((a) => !a.url.endsWith("/health")) };
}

function relais(opts: {
  env?: Record<string, string | undefined>;
  horloge?: { t: number };
  collector?: ReturnType<typeof fauxCollector>;
  delais?: Partial<typeof DELAIS>;
} = {}) {
  const collector = opts.collector ?? fauxCollector();
  const horloge = opts.horloge ?? { t: 1_000_000 };
  const r = creerRelais({
    env: () => opts.env ?? { CONSOLE_INGEST_RELAY_URL: URL_COLLECTOR, EDGE_PROXY_SECRET: SECRET },
    fetch: collector.fetch as unknown as typeof fetch,
    maintenant: () => horloge.t,
    log: journal,
    delais: opts.delais,
  });
  return { r, collector, horloge };
}

/** Requête entrante telle que Vercel la présente : avec TOUS les en-têtes qu'on ne doit pas transmettre. */
function entrante(extra: Record<string, string> = {}) {
  return new Request("https://mip-rum-console.vercel.app/api/ingest/v1/traces", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-encoding": "identity",
      "x-mip-session": "sess-1",
      "x-mip-app": "app-1",
      "x-mip-seq": "3",
      "x-mip-key": "cle-1",
      authorization: "Bearer msu_jeton",
      origin: ORIGINE,
      cookie: "mip_session=secret-de-session",
      "user-agent": "Mozilla/5.0",
      "x-forwarded-for": `${IP}, 10.0.0.1`,
      "x-real-ip": IP,
      "x-vercel-forwarded-for": IP,
      "x-vercel-ip-country": "FR",
      "x-vercel-ip-city": "Paris",
      "x-vercel-ip-latitude": "48.85",
      forwarded: `for=${IP}`,
      "cf-connecting-ip": IP,
      "true-client-ip": IP,
      // Un client qui forge le bord de confiance : ne doit JAMAIS passer tel quel.
      "x-mip-edge-auth": "forge",
      "x-mip-edge-country": "US",
      "x-mip-edge-ip": IP,
      ...extra,
    },
    body: "{}",
  });
}

const CORS = { "Access-Control-Allow-Origin": ORIGINE, "Access-Control-Allow-Methods": "POST, OPTIONS" };
const corps = new TextEncoder().encode('{"resourceSpans":[]}');

beforeEach(() => {
  simul.journal.length = 0;
  simul.query.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  _resetRelais();
});

// ─────────────────────────────── Configuration ──────────────────────────────

describe("configuration — sans URL ni secret valides, 503 et rien d'écrit", () => {
  it.each([
    ["URL absente", { EDGE_PROXY_SECRET: SECRET }],
    ["secret absent", { CONSOLE_INGEST_RELAY_URL: URL_COLLECTOR }],
    ["secret trop court", { CONSOLE_INGEST_RELAY_URL: URL_COLLECTOR, EDGE_PROXY_SECRET: "court" }],
    ["deux valeurs (la rotation se fait côté collector)", { CONSOLE_INGEST_RELAY_URL: URL_COLLECTOR, EDGE_PROXY_SECRET: `${SECRET},${"t".repeat(40)}` }],
  ])("%s : 503 + retry-after, aucun appel réseau, une ligne de journal qui ne cite pas le secret", async (_nom, env) => {
    const { r, collector } = relais({ env });
    for (const s of SIGNAUX) {
      const rep = await r.relayer(s, entrante(), corps, CORS);
      expect(rep.status, s).toBe(503);
      expect(rep.headers.get("retry-after")).toBe(RETRY_AFTER_DELAI_S);
      expect(await rep.json()).toMatchObject({ retry: true });
    }
    expect(collector.fetch).not.toHaveBeenCalled();
    expect(simul.journal.filter((l) => l.msg === "relay not configured")).toHaveLength(1);
    expect(JSON.stringify(simul.journal)).not.toContain(SECRET);
  });

  it("URL invalide ou hors http(s) : refusée ; barre finale retirée", () => {
    expect(lireConfigRelais({ CONSOLE_INGEST_RELAY_URL: "pas une url", EDGE_PROXY_SECRET: SECRET }).config).toBeNull();
    expect(lireConfigRelais({ CONSOLE_INGEST_RELAY_URL: "ftp://x.test", EDGE_PROXY_SECRET: SECRET }).config).toBeNull();
    expect(lireConfigRelais({ CONSOLE_INGEST_RELAY_URL: `${URL_COLLECTOR}/`, EDGE_PROXY_SECRET: SECRET }).config)
      .toEqual({ url: URL_COLLECTOR, secret: SECRET });
  });

  it("http: hors de la machine : refusé — le secret de bord, les clés et le jeton ne partent pas en clair", async () => {
    for (const url of ["http://collector.up.railway.app", "http://10.0.0.5:8080", "http://127.0.0.2", "http://localhost.evil.test"]) {
      const lu = lireConfigRelais({ CONSOLE_INGEST_RELAY_URL: url, EDGE_PROXY_SECRET: SECRET });
      expect(lu.config, url).toBeNull();
      expect("raison" in lu && lu.raison, url).toMatch(/https/);
    }
    const { r, collector } = relais({ env: { CONSOLE_INGEST_RELAY_URL: "http://collector.up.railway.app", EDGE_PROXY_SECRET: SECRET } });
    for (let i = 0; i < 20; i++) expect((await r.relayer("traces", entrante(), corps, CORS)).status).toBe(503);
    expect(collector.fetch).not.toHaveBeenCalled();
    expect(simul.journal.filter((l) => l.msg === "relay not configured")).toHaveLength(1);
  });

  it("http: permis sur la machine elle-même (localhost, 127.0.0.1, ::1) — tests et collector local", () => {
    for (const url of ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080"]) {
      expect(lireConfigRelais({ CONSOLE_INGEST_RELAY_URL: url, EDGE_PROXY_SECRET: SECRET }).config, url)
        .toEqual({ url, secret: SECRET });
    }
  });
});

// ─────────────────────────────── Santé du collector ─────────────────────────

describe("vérification du collector — GET /health, cache 60 s", () => {
  it("une seule sonde pour de nombreuses requêtes, renouvelée après 60 s", async () => {
    const { r, collector, horloge } = relais();
    for (let i = 0; i < 20; i++) await r.relayer("traces", entrante(), corps, CORS);
    expect(collector.appels.filter((a) => a.url === `${URL_COLLECTOR}/health`)).toHaveLength(1);
    expect(collector.posts()).toHaveLength(20);
    horloge.t += 59_000;
    await r.relayer("traces", entrante(), corps, CORS);
    expect(collector.appels.filter((a) => a.url.endsWith("/health"))).toHaveLength(1);
    horloge.t += 2_000;
    await r.relayer("traces", entrante(), corps, CORS);
    expect(collector.appels.filter((a) => a.url.endsWith("/health"))).toHaveLength(2);
  });

  it.each([
    ["protocole de bord inattendu", () => Response.json({ status: "ok", edge_protocol: "mip-edge/0", edge_trust: true })],
    ["collector sans secret de relais", () => Response.json({ status: "ok", edge_protocol: "mip-edge/1", edge_trust: false })],
    ["collector en 503", () => Response.json({ status: "unavailable", edge_protocol: "mip-edge/1", edge_trust: true }, { status: 503 })],
    ["corps illisible", () => new Response("<html>", { status: 200 })],
    ["collector injoignable", () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }],
  ])("%s : 503 + retry-after sans POST, et l'échec est mis en cache 60 s", async (_nom, sante) => {
    const collector = fauxCollector({ sante });
    const { r, horloge } = relais({ collector });
    for (const s of ["traces", "replay"] as Signal[]) {
      const rep = await r.relayer(s, entrante(), corps, CORS);
      expect(rep.status).toBe(503);
      expect(rep.headers.get("retry-after")).toBe(RETRY_AFTER_DELAI_S);
      expect(rep.headers.get("access-control-allow-origin")).toBe(ORIGINE);
    }
    expect(collector.appels).toHaveLength(1);
    expect(simul.journal.filter((l) => l.msg === "relay: collector unhealthy")).toHaveLength(1);
    horloge.t += 61_000;
    await r.relayer("traces", entrante(), corps, CORS);
    expect(collector.appels).toHaveLength(2);
  });

  it("/health SANS signature x-mip-collector (collector antérieur) : 503 — ses 404 métier seraient pris pour un routage raté", async () => {
    const collector = fauxCollector({ santeSignee: false });
    const { r } = relais({ collector });
    expect((await r.relayer("sourcemaps", entrante(), corps, {})).status).toBe(503);
    const avis = simul.journal.find((l) => l.msg === "relay: collector unhealthy");
    expect(avis?.champs).toEqual({ raison: `réponse sans ${ENTETE_COLLECTOR}` });
  });

  it("la signature est celle que le receveur du collector pose (ENTETE_COLLECTOR)", () => {
    expect(ENTETE_COLLECTOR).toBe(ENTETE_DU_RECEVEUR);
  });
});

// ─────────────────────────────── Matrice des réponses ───────────────────────

describe("matrice des réponses — chaque statut × chaque signal × signé ou non", () => {
  const STATUTS = [200, 201, 400, 401, 403, 404, 405, 409, 410, 413, 425, 429, 500, 502, 503, 504];

  /** La règle, écrite indépendamment du code. */
  const indisponible = (statut: number, signee: boolean) => !signee && [404, 405, 502, 504].includes(statut);

  for (const signee of [true, false]) {
    for (const signal of SIGNAUX) {
      for (const statut of STATUTS) {
        const attendu = indisponible(statut, signee) ? "503" : "rendue telle quelle";
        it(`${signal} × ${statut} ${signee ? "signé" : "NON signé"} → ${attendu}`, async () => {
          const collector = fauxCollector({
            postSigne: signee,
            post: () =>
              new Response(JSON.stringify({ statut }), {
                status: statut,
                headers: { "content-type": "application/json", "retry-after": "7", "access-control-allow-origin": ORIGINE_CLIENT },
              }),
          });
          const { r } = relais({ collector });
          const rep = await r.relayer(signal, entrante(), corps, CORS);
          expect(collectorAbsent(statut, signee)).toBe(indisponible(statut, signee));
          if (indisponible(statut, signee)) {
            expect(rep.status).toBe(503);
            expect(rep.headers.get("retry-after")).toBe(RETRY_AFTER_DELAI_S);
            expect(rep.headers.get("access-control-allow-origin")).toBe(ORIGINE);
            expect(await rep.json()).toMatchObject({ retry: true });
          } else {
            expect(rep.status).toBe(statut);
            expect(await rep.json()).toEqual({ statut });
            expect(rep.headers.get("retry-after")).toBe("7");
            // CORS du collector sur une réponse SIGNÉE d'un signal navigateur ; sinon ceux de la route.
            const cors = signee && NAVIGATEUR.includes(signal) ? ORIGINE_CLIENT : ORIGINE;
            expect(rep.headers.get("access-control-allow-origin")).toBe(cors);
          }
          expect(collector.posts()[0].url).toBe(`${URL_COLLECTOR}${CHEMINS[signal]}`);
        });
      }
    }
  }

  it("réponse rendue en application/json + nosniff, quel que soit le content-type reçu", async () => {
    const collector = fauxCollector({
      post: () => new Response("<script>alert(1)</script>", { status: 200, headers: { "content-type": "text/html" } }),
    });
    const rep = await relais({ collector }).r.relayer("traces", entrante(), corps, CORS);
    expect(rep.headers.get("content-type")).toBe("application/json");
    expect(rep.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("R11 — réponse SIGNÉE en application/x-protobuf : ce type conservé ; NON signée : application/json imposé", async () => {
    const proto = (signee: boolean) => fauxCollector({
      postSigne: signee,
      post: () => new Response(new Uint8Array(0), { status: 400, headers: { "content-type": "application/x-protobuf" } }),
    });
    expect((await relais({ collector: proto(true) }).r.relayer("traces", entrante(), corps, CORS)).headers.get("content-type"))
      .toBe("application/x-protobuf");
    expect((await relais({ collector: proto(false) }).r.relayer("traces", entrante(), corps, CORS)).headers.get("content-type"))
      .toBe("application/json");
  });

  it("erreur réseau, avant ou après l'envoi : 503 + retry-after pour tous les signaux, jamais d'écriture locale", async () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "UND_ERR_SOCKET", undefined]) {
      for (const signal of SIGNAUX) {
        const collector = fauxCollector({
          post: () => { throw Object.assign(new TypeError("fetch failed"), { cause: code ? { code } : undefined }); },
        });
        const rep = await relais({ collector }).r.relayer(signal, entrante(), corps, CORS);
        expect(rep.status).toBe(503);
        expect(rep.headers.get("retry-after")).toBe(RETRY_AFTER_DELAI_S);
      }
    }
    expect(simul.query).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── Délai ──────────────────────────────────────

describe("délai du relais", () => {
  it("vaut 8 s, au-delà du budget de 4 s du collector", () => {
    expect(DELAIS.relaisMs).toBe(8_000);
  });

  it("dépassé (vrai AbortSignal) : 503 + retry-after pour TOUS les signaux", async () => {
    for (const signal of SIGNAUX) {
      const collector = fauxCollector({
        // Un collector qui ne répond jamais : seul le signal d'abandon le libère.
        post: (_url, init) =>
          new Promise<Response>((_ok, ko) => {
            init.signal!.addEventListener("abort", () => ko(init.signal!.reason));
          }),
      });
      const rep = await relais({ collector, delais: { relaisMs: 30 } }).r.relayer(signal, entrante(), corps, CORS);
      expect(rep.status).toBe(503);
      expect(rep.headers.get("retry-after")).toBe("5");
      expect(await rep.json()).toMatchObject({ error: "ingestion relay timeout, retry", retry: true });
    }
  });
});

// ─────────────────────────────── En-têtes ───────────────────────────────────

describe("en-têtes transmis — liste EXACTE, le pays et jamais l'adresse", () => {
  it("les listes sont celles du plan, sans plus", () => {
    expect([...ENTETES_TRANSMIS]).toEqual([
      "content-type", "content-encoding", "x-mip-session", "x-mip-app", "x-mip-seq", "x-mip-key", "origin",
    ]);
    expect([...ENTETES_SOURCEMAPS]).toEqual(["content-type", "content-encoding", "authorization"]);
  });

  for (const signal of NAVIGATEUR) {
    it(`${signal} : exactement la liste + le bord de confiance ; ni IP, ni x-forwarded-for, ni en-tête forgé`, async () => {
      const { r, collector } = relais();
      await r.relayer(signal, entrante(), corps, CORS);
      const envoyes = new Headers(collector.posts()[0].init.headers);
      const attendus = [
        ...ENTETES_TRANSMIS,
        "x-mip-edge-auth",
        "x-mip-edge-country",
        // L'origine de la page, là où les gardes du collector la lisent (extension sans clé).
        ...(signal === "traces" || signal === "logs" ? ["x-mip-edge-origin"] : []),
      ].sort();
      expect([...envoyes.keys()].sort()).toEqual(attendus);
      // Le secret du relais, pas la valeur forgée par le client ; le pays de VERCEL.
      expect(envoyes.get("x-mip-edge-auth")).toBe(SECRET);
      expect(envoyes.get("x-mip-edge-country")).toBe("FR");
      expect(envoyes.get("origin")).toBe(ORIGINE);
      for (const nom of ["x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for", "forwarded", "cf-connecting-ip",
        "true-client-ip", "x-mip-edge-ip", "x-vercel-ip-country", "x-vercel-ip-city", "cookie", "authorization"]) {
        expect(envoyes.has(nom), nom).toBe(false);
      }
      for (const [, v] of envoyes) expect(v).not.toContain(IP);
    });
  }

  it("sourcemaps : le contenu et le jeton, rien de la page", async () => {
    const { r, collector } = relais();
    await r.relayer("sourcemaps", entrante(), corps, {});
    const envoyes = new Headers(collector.posts()[0].init.headers);
    expect([...envoyes.keys()].sort()).toEqual([...ENTETES_SOURCEMAPS, "x-mip-edge-auth", "x-mip-edge-country"].sort());
    for (const [, v] of envoyes) expect(v).not.toContain(IP);
  });

  it("pays Vercel absent ou mal formé : pas de x-mip-edge-country (jamais un pays inventé)", async () => {
    for (const pays of [undefined, "fr", "FRA", ""]) {
      const { r, collector } = relais();
      const h = new Headers(entrante().headers);
      if (pays === undefined) h.delete("x-vercel-ip-country");
      else h.set("x-vercel-ip-country", pays);
      await r.relayer("traces", new Request("https://c.test/api/ingest/v1/traces", { method: "POST", headers: h, body: "{}" }), corps, CORS);
      expect(new Headers(collector.posts()[0].init.headers).has("x-mip-edge-country")).toBe(false);
    }
  });

  it("le corps part octet pour octet", async () => {
    const { r, collector } = relais();
    const octets = new Uint8Array([0x1f, 0x8b, 0, 1, 2, 250, 255]);
    await r.relayer("replay", entrante(), octets, CORS);
    expect(Buffer.from(collector.posts()[0].init.body as Uint8Array)).toEqual(Buffer.from(octets));
  });

  it("résolution d'un domaine : un GET, la requête transmise, aucun en-tête du client, le cache rendu", async () => {
    const collector = fauxCollector({
      post: () => Response.json({ app_id: "a" }, { headers: { "cache-control": "public, max-age=60" } }),
    });
    const req = new Request("https://mip-rum-console.vercel.app/api/extension/resolve?domain=a.exemple.fr", {
      headers: { "user-agent": "UA", cookie: "mip_session=x", "x-forwarded-for": IP },
    });
    const res = await relais({ collector }).r.relayer("extensionResolve", req, new Uint8Array(), { "access-control-allow-origin": "*" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const [appel] = collector.posts();
    expect(appel.url).toBe(`${URL_COLLECTOR}/v1/extension/resolve?domain=a.exemple.fr`);
    expect(appel.init.method).toBe("GET");
    expect(appel.init.body).toBeUndefined();
    expect([...new Headers(appel.init.headers).keys()].sort()).toEqual(["x-mip-edge-auth"]);
  });

  it("battement d'un poste : content-type et User-Agent ; marqueur : le jeton de la CI", async () => {
    const { r, collector } = relais();
    await r.relayer("extensionHeartbeat", entrante(), corps, {});
    await r.relayer("deploys", entrante(), corps, {});
    const [battement, marqueur] = collector.posts().map((p) => [...new Headers(p.init.headers).keys()].sort());
    expect(battement).toEqual(["content-type", "user-agent", "x-mip-edge-auth", "x-mip-edge-country"]);
    expect(marqueur).toEqual(["authorization", "content-type", "x-mip-edge-auth", "x-mip-edge-country"]);
  });
});

// ─────────────────────────────── Drapeau de plateforme ──────────────────────

describe("platform_flag — lecture en cache 30 s, jamais d'exception", () => {
  const CLE = "api_relay_pct";
  const lecteur = (requete: (sql: string, p: unknown[]) => Promise<{ rows: Array<{ value: unknown }> }>, horloge = { t: 0 }) =>
    ({ l: creerLecteurDrapeaux({ requete: vi.fn(requete), maintenant: () => horloge.t, delaiMs: 20 }), horloge });

  it("table ABSENTE (42P01, avant v87) : null, sans exception", async () => {
    const { l } = lecteur(async () => { throw Object.assign(new Error("absente"), { code: "42P01" }); });
    await expect(l.lire(CLE)).resolves.toBeNull();
  });

  it("base en erreur : null, et l'échec est mis en cache 30 s", async () => {
    const requete = vi.fn(async () => { throw Object.assign(new Error("quota"), { code: "XX000" }); });
    const horloge = { t: 0 };
    const l = creerLecteurDrapeaux({ requete, maintenant: () => horloge.t });
    for (let i = 0; i < 10; i++) expect(await l.lire(CLE)).toBeNull();
    expect(requete).toHaveBeenCalledTimes(1);
    horloge.t += 30_001;
    await l.lire(CLE);
    expect(requete).toHaveBeenCalledTimes(2);
  });

  it("base qui ne répond pas : abandon au délai, null", async () => {
    const { l } = lecteur(() => new Promise(() => {}));
    await expect(l.lire(CLE)).resolves.toBeNull();
  });

  it("valeur lue, gardée 30 s, puis relue (effet d'un update < 30 s)", async () => {
    let valeur = "25";
    const requete = vi.fn(async () => ({ rows: [{ value: valeur }] }));
    const horloge = { t: 0 };
    const l = creerLecteurDrapeaux({ requete, maintenant: () => horloge.t });
    expect(await l.lire(CLE)).toBe("25");
    valeur = "0";
    horloge.t += 29_000;
    expect(await l.lire(CLE)).toBe("25");
    horloge.t += 1_001;
    expect(await l.lire(CLE)).toBe("0");
  });

  it("cinquante lectures simultanées : UNE requête", async () => {
    const requete = vi.fn(async () => ({ rows: [{ value: "10" }] }));
    const l = creerLecteurDrapeaux({ requete });
    const v = await Promise.all(Array.from({ length: 50 }, () => l.lire(CLE)));
    expect(new Set(v)).toEqual(new Set(["10"]));
    expect(requete).toHaveBeenCalledTimes(1);
  });

  it("ligne absente : null", async () => {
    const { l } = lecteur(async () => ({ rows: [] }));
    expect(await l.lire(CLE)).toBeNull();
  });

  it("forme du pourcentage : la même règle que la contrainte de v87", () => {
    for (const [brut, v] of [["0", 0], ["7", 7], ["10", 10], ["100", 100], [" 50 ", 50]] as const) expect(lirePourcentage(brut)).toBe(v);
    for (const brut of ["101", "-1", "10%", "1.5", "010", "", "abc", null, undefined]) expect(lirePourcentage(brut)).toBeNull();
  });
});

// ─────────────────────────────── Par les routes ─────────────────────────────

describe("par les route handlers — la console relaie, n'écrit rien, ne lit pas la base", () => {
  const BASE = "https://mip-rum-console.vercel.app";
  const post = (chemin: string, headers: Record<string, string>, body: BodyInit) =>
    new Request(`${BASE}${chemin}`, { method: "POST", headers, body });
  /** Les routes Next lisent `nextUrl` et `cookies` : la forme minimale d'une NextRequest. */
  const next = (req: Request) =>
    Object.assign(req, { nextUrl: new URL(req.url), cookies: { get: () => undefined } }) as never;

  function brancher(opts: { sans?: boolean; collector?: ReturnType<typeof fauxCollector> } = {}) {
    if (!opts.sans) {
      vi.stubEnv("CONSOLE_INGEST_RELAY_URL", URL_COLLECTOR);
      vi.stubEnv("EDGE_PROXY_SECRET", SECRET);
    } else {
      vi.stubEnv("CONSOLE_INGEST_RELAY_URL", "");
    }
    const collector = opts.collector ?? fauxCollector();
    vi.stubGlobal("fetch", collector.fetch);
    return collector;
  }

  afterEach(() => {
    // Aucune route de collecte n'interroge le pool de la console.
    expect(simul.query).not.toHaveBeenCalled();
  });

  it("configuration absente : chaque route répond 503 + retry-after, sans appel réseau ni base", async () => {
    const collector = brancher({ sans: true });
    const reponses = [
      await POST_TRACES(post("/api/ingest/v1/traces", { "content-type": "application/json", origin: ORIGINE }, "{}")),
      await POST_LOGS(post("/api/ingest/v1/logs", { "content-type": "application/json" }, "{}")),
      await POST_REPLAY(post("/api/ingest/v1/replay", { "x-mip-session": "s", "x-mip-app": "a", "x-mip-seq": "0" }, new Uint8Array([1]))),
      await POST_SOURCEMAPS(next(post("/api/sourcemaps", { authorization: "Bearer msu_x", "content-type": "application/json" }, "{}"))),
      await POST_HEARTBEAT(next(post("/api/extension/heartbeat", { "content-type": "application/json" }, "{}"))),
      await GET_RESOLVE(next(new Request(`${BASE}/api/extension/resolve?domain=a.exemple.fr`))),
      await POST_DEPLOYS(post("/api/v1/deploys", { authorization: JETON_CI, "content-type": "application/json" }, "{}")),
    ];
    for (const rep of reponses) {
      expect(rep.status).toBe(503);
      expect(rep.headers.get("retry-after")).toBe(RETRY_AFTER_DELAI_S);
    }
    expect(collector.fetch).not.toHaveBeenCalled();
  });

  it("traces relayées octet pour octet ; la réponse porte les CORS du COLLECTOR (registre des origines)", async () => {
    const collector = brancher();
    const rep = await POST_TRACES(post("/api/ingest/v1/traces", {
      "content-type": "application/json", origin: ORIGINE_CLIENT, "x-forwarded-for": IP,
    }, '{"resourceSpans":[]}'));
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ partialSuccess: {} });
    expect(rep.headers.get("access-control-allow-origin")).toBe(ORIGINE_CLIENT);
    const [envoi] = collector.posts();
    expect(envoi.url).toBe(`${URL_COLLECTOR}/v1/traces`);
    expect(Buffer.from(envoi.init.body as Uint8Array).toString()).toBe('{"resourceSpans":[]}');
    expect(new Headers(envoi.init.headers).has("x-forwarded-for")).toBe(false);
  });

  it("R11 — traces protobuf gzip relayées : content-type et content-encoding transmis, réponse protobuf rendue telle quelle", async () => {
    const collector = brancher({
      collector: fauxCollector({
        post: () => new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "application/x-protobuf" } }),
      }),
    });
    const rep = await POST_TRACES(post("/api/ingest/v1/traces", {
      "content-type": "application/x-protobuf", "content-encoding": "gzip", origin: ORIGINE,
    }, new Uint8Array([0x1f, 0x8b, 0x08, 0x00])));
    expect(rep.status).toBe(200);
    expect(rep.headers.get("content-type")).toBe("application/x-protobuf");
    expect((await rep.arrayBuffer()).byteLength).toBe(0);
    const envoi = new Headers(collector.posts()[0].init.headers);
    expect(envoi.get("content-type")).toBe("application/x-protobuf");
    expect(envoi.get("content-encoding")).toBe("gzip");
  });

  it("R11 — relais expiré sur une requête protobuf : le 503 part en google.rpc.Status, retry-after gardé", async () => {
    brancher({
      collector: fauxCollector({ post: () => Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })) }),
    });
    const rep = await POST_LOGS(post("/api/ingest/v1/logs", { "content-type": "application/x-protobuf" }, new Uint8Array(0)));
    expect(rep.status).toBe(503);
    expect(rep.headers.get("content-type")).toBe("application/x-protobuf");
    expect(rep.headers.get("retry-after")).toBe(RETRY_AFTER_DELAI_S);
    const octets = Buffer.from(await rep.arrayBuffer());
    expect(octets[0]).toBe(0x12);
    expect(octets.subarray(2).toString()).toBe("ingestion relay timeout, retry");
  });

  it("un corps au-delà du plafond est refusé LOCALEMENT (413), sans relais", async () => {
    const collector = brancher();
    expect((await POST_LOGS(post("/api/ingest/v1/logs", { "content-length": String(50 * 1024 * 1024) }, "{}"))).status).toBe(413);
    expect((await POST_REPLAY(post("/api/ingest/v1/replay", {}, new Uint8Array(3 * 1024 * 1024)))).status).toBe(413);
    expect(collector.fetch).not.toHaveBeenCalled();
  });

  it("logs : un 500 du collector est rendu tel quel (pas de second essai local)", async () => {
    const collector = brancher({ collector: fauxCollector({ post: () => Response.json({ error: "internal error" }, { status: 500 }) }) });
    const rep = await POST_LOGS(post("/api/ingest/v1/logs", { origin: ORIGINE }, '{"resourceLogs":[]}'));
    expect(rep.status).toBe(500);
    expect(collector.posts()).toHaveLength(1);
  });

  it("replay : relayé sans garde locale, en-têtes x-mip-* transmis", async () => {
    const collector = brancher({ collector: fauxCollector({ post: () => Response.json({ ok: true, seq: 3, events: 2 }) }) });
    const rep = await POST_REPLAY(post("/api/ingest/v1/replay", {
      "content-type": "application/octet-stream", "x-mip-session": "s1", "x-mip-app": "a1", "x-mip-seq": "3", "x-mip-key": "k1", origin: ORIGINE,
    }, new Uint8Array([1, 2, 3])));
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ ok: true, seq: 3, events: 2 });
    const h = new Headers(collector.posts()[0].init.headers);
    expect([h.get("x-mip-session"), h.get("x-mip-app"), h.get("x-mip-seq"), h.get("x-mip-key")]).toEqual(["s1", "a1", "3", "k1"]);
  });

  it("préflight et diagnostic relayés : le collector répond, avec ses CORS", async () => {
    const collector = brancher({
      collector: fauxCollector({
        post: (_u, init) => init.method === "OPTIONS"
          ? new Response(null, { status: 204, headers: { "access-control-allow-origin": ORIGINE_CLIENT, "access-control-allow-headers": "content-type,x-mip-session" } })
          : Response.json({ status: "ok", service: "v1-traces" }),
      }),
    });
    const options = await OPTIONS_TRACES(new Request(`${BASE}/api/ingest/v1/traces`, { method: "OPTIONS", headers: { origin: ORIGINE_CLIENT } }));
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe(ORIGINE_CLIENT);
    const replay = await OPTIONS_REPLAY(new Request(`${BASE}/api/ingest/v1/replay`, { method: "OPTIONS", headers: { origin: ORIGINE_CLIENT } }));
    expect(replay.headers.get("access-control-allow-headers")).toBe("content-type,x-mip-session");
    const diag = await GET_TRACES(new Request(`${BASE}/api/ingest/v1/traces`, { headers: { origin: ORIGINE } }));
    expect(await diag.json()).toEqual({ status: "ok", service: "v1-traces" });
    expect(collector.posts().map((p) => [p.init.method, p.init.body])).toEqual([["OPTIONS", undefined], ["OPTIONS", undefined], ["GET", undefined]]);
  });

  it("sourcemaps, branche JETON : relayée avec le jeton ; corps trop gros refusé avant", async () => {
    const collector = brancher({ collector: fauxCollector({ post: () => Response.json({ uploaded: 1 }, { status: 201 }) }) });
    const rep = await POST_SOURCEMAPS(next(post("/api/sourcemaps", { authorization: "Bearer msu_x", "content-type": "application/json" }, '{"appId":"a"}')));
    expect(rep.status).toBe(201);
    expect(new Headers(collector.posts()[0].init.headers).get("authorization")).toBe("Bearer msu_x");
    const gros = await POST_SOURCEMAPS(next(post("/api/sourcemaps", { authorization: "Bearer msu_x", "content-length": String(50 * 1024 * 1024) }, "{}")));
    expect(gros.status).toBe(413);
    expect(collector.posts()).toHaveLength(1);
  });

  it("extension : battement et résolution relayés ; l'endpoint vide est complété si la collecte directe est ouverte", async () => {
    vi.stubEnv("NEXT_PUBLIC_DIRECT_COLLECTOR_URL", "https://collector.exemple.fr");
    const collector = brancher({
      collector: fauxCollector({
        post: (url) => url.includes("resolve")
          ? Response.json({ app_id: "a", endpoint: null, active: true })
          : Response.json({ ok: true }),
      }),
    });
    const battement = await POST_HEARTBEAT(next(post("/api/extension/heartbeat", { "content-type": "application/json", "user-agent": "Chrome/126" }, "{}")));
    expect(battement.status).toBe(200);
    expect(battement.headers.get("access-control-allow-origin")).toBe("*");
    const resolution = await GET_RESOLVE(next(new Request(`${BASE}/api/extension/resolve?domain=a.exemple.fr`)));
    expect(await resolution.json()).toMatchObject({ app_id: "a", endpoint: "https://collector.exemple.fr/v1/traces" });
    const invalide = await GET_RESOLVE(next(new Request(`${BASE}/api/extension/resolve?domain=`)));
    expect(invalide.status).toBe(400);
    expect(collector.posts()).toHaveLength(2);
  });

  it("marqueur de déploiement, jeton de CI : relayé, rendu tel quel", async () => {
    const collector = brancher({ collector: fauxCollector({ post: () => Response.json({ ok: true }, { status: 201 }) }) });
    const rep = await POST_DEPLOYS(post("/api/v1/deploys", { authorization: JETON_CI, "content-type": "application/json" }, '{"appId":"a"}'));
    expect(rep.status).toBe(201);
    expect(collector.posts()[0].url).toBe(`${URL_COLLECTOR}/v1/deploys`);
  });
});
