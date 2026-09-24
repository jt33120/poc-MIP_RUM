// P3 — relais d'ingestion de la console vers le collector (`lib/ingest-relay.ts`)
// et drapeau de plateforme (`lib/platform-flag.ts`).
//
// Ce que ce fichier tient, sans réseau ni base :
//   · la MATRICE DE REPLI, chaque statut × chaque signal × signé ou non
//     (`x-mip-collector: 1`) : une réponse SIGNÉE est rendue telle quelle, sans
//     échec compté (404 métier des source maps compris) ; seuls 404/405/502/504
//     NON signés (routeur Railway) replient — et les logs, non idempotents, ne
//     se replient ni sur un 502/504 ni sur une connexion perdue après l'envoi ;
//   · `http:` refusé hors de localhost : secret et clés ne partent pas en clair ;
//   · le délai de 8 s : 503 + retry-after pour TOUS les signaux, sans repli ;
//   · le disjoncteur : 5 échecs en 30 s → contournement 60 s, puis retour ;
//   · la LISTE D'EN-TÊTES EXACTE : aucune adresse ne sort, jamais ;
//   · la réponse reconstruite avec les CORS LOCAUX ;
//   · le drapeau : table absente, base en erreur, ligne absente → défaut
//     d'environnement, jamais d'exception ; cache 30 s ;
//   · 0 % (ou URL absente) = aucun fetch, aucune lecture de drapeau.
// Le chemin complet (route → collector réel → ligne en base) est prouvé par
// `tests/contract/relais-ingestion.test.ts`, sur Postgres Docker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const simul = vi.hoisted(() => ({
  // Requête du pool de la console : par défaut, la table n'existe pas encore
  // (fenêtre de déploiement : le code part avant v87).
  query: vi.fn(async (_sql: string, _params?: unknown[]): Promise<{ rows: unknown[] }> => {
    throw Object.assign(new Error('relation "platform_flag" does not exist'), { code: "42P01" });
  }),
  journal: [] as Array<{ niveau: string; msg: string; champs?: object }>,
}));

vi.mock("@/lib/db", () => ({ pool: { query: simul.query } }));

import {
  _resetPlatformFlagCache,
  creerLecteurDrapeaux,
  lirePourcentage,
  pourcentageParDefaut,
  pourcentageRelais,
} from "../../apps/console/lib/platform-flag";
import {
  _resetRelais,
  CHEMINS,
  creerRelais,
  DELAIS,
  ENTETE_COLLECTOR,
  ENTETES_SOURCEMAPS,
  ENTETES_TRANSMIS,
  IDEMPOTENTS,
  issueReponse,
  lireConfigRelais,
  type Signal,
} from "../../apps/console/lib/ingest-relay";
// @ts-expect-error module ESM partagé, sans déclarations
import { ENTETE_COLLECTOR as ENTETE_DU_RECEVEUR } from "../../packages/backend/lib/receiver.mjs";
import { OPTIONS as OPTIONS_TRACES, POST as POST_TRACES } from "../../apps/console/app/api/ingest/v1/traces/route";
import { POST as POST_LOGS } from "../../apps/console/app/api/ingest/v1/logs/route";
import { POST as POST_REPLAY } from "../../apps/console/app/api/ingest/v1/replay/route";
import { POST as POST_SOURCEMAPS } from "../../apps/console/app/api/sourcemaps/route";

const URL_COLLECTOR = "https://collector.test.internal";
const SECRET = "s".repeat(40);
const SIGNAUX: Signal[] = ["traces", "logs", "replay", "sourcemaps"];
const IP = "203.0.113.77";
const ORIGINE = "http://localhost:3000"; // dans le socle CORS statique

const journal = {
  info: (msg: string, champs?: object) => simul.journal.push({ niveau: "info", msg, champs }),
  warn: (msg: string, champs?: object) => simul.journal.push({ niveau: "warn", msg, champs }),
};

type AppelFetch = { url: string; init: RequestInit };

/**
 * Faux collector : `/health` conforme, et une réponse programmable pour le POST.
 * Comme le vrai, il SIGNE ses réponses (`x-mip-collector: 1`) ; `postSigne:
 * false` simule le routeur Railway (réponse que le collector n'a pas émise),
 * `santeSignee: false` un collector antérieur à la signature.
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
        : Response.json({ partialSuccess: {} }, { headers: { "access-control-allow-origin": "https://malveillant.test" } }),
      opts.postSigne !== false,
    );
  });
  return { fetch, appels, posts: () => appels.filter((a) => !a.url.endsWith("/health")) };
}

function relais(opts: {
  env?: Record<string, string | undefined>;
  pct?: number;
  aleatoire?: () => number;
  horloge?: { t: number };
  collector?: ReturnType<typeof fauxCollector>;
  delais?: Partial<typeof DELAIS>;
} = {}) {
  const collector = opts.collector ?? fauxCollector();
  const horloge = opts.horloge ?? { t: 1_000_000 };
  const pourcentage = vi.fn(async () => opts.pct ?? 100);
  const r = creerRelais({
    env: () => opts.env ?? { CONSOLE_INGEST_RELAY_URL: URL_COLLECTOR, EDGE_PROXY_SECRET: SECRET },
    fetch: collector.fetch as unknown as typeof fetch,
    maintenant: () => horloge.t,
    aleatoire: opts.aleatoire ?? (() => 0),
    pourcentage,
    log: journal,
    delais: opts.delais,
  });
  return { r, collector, horloge, pourcentage };
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
  _resetPlatformFlagCache();
});

// ─────────────────────────────── Configuration ──────────────────────────────

describe("configuration — URL du collector et secret du relais", () => {
  it("URL absente : relais éteint QUEL QUE SOIT le drapeau, sans lire le drapeau ni appeler le réseau", async () => {
    const { r, collector, pourcentage } = relais({ env: { EDGE_PROXY_SECRET: SECRET }, pct: 100 });
    for (const s of SIGNAUX) expect(await r.choisir(s)).toBeNull();
    expect(pourcentage).not.toHaveBeenCalled();
    expect(collector.fetch).not.toHaveBeenCalled();
    // État normal avant la bascule : rien au journal.
    expect(simul.journal).toEqual([]);
  });

  it.each([
    ["secret absent", undefined],
    ["secret trop court", "court"],
    ["deux valeurs (la rotation se fait côté collector)", `${SECRET},${"t".repeat(40)}`],
  ])("%s : relais éteint, une ligne de journal qui ne cite pas le secret", async (_nom, secret) => {
    const { r, collector } = relais({ env: { CONSOLE_INGEST_RELAY_URL: URL_COLLECTOR, EDGE_PROXY_SECRET: secret } });
    expect(await r.choisir("traces")).toBeNull();
    expect(await r.choisir("traces")).toBeNull();
    expect(collector.fetch).not.toHaveBeenCalled();
    expect(simul.journal.filter((l) => l.msg === "relay disabled")).toHaveLength(1);
    expect(JSON.stringify(simul.journal)).not.toContain(SECRET);
  });

  it("URL invalide ou hors http(s) : éteint", () => {
    expect(lireConfigRelais({ CONSOLE_INGEST_RELAY_URL: "pas une url", EDGE_PROXY_SECRET: SECRET }).config).toBeNull();
    expect(lireConfigRelais({ CONSOLE_INGEST_RELAY_URL: "ftp://x.test", EDGE_PROXY_SECRET: SECRET }).config).toBeNull();
    expect(lireConfigRelais({ CONSOLE_INGEST_RELAY_URL: `${URL_COLLECTOR}/`, EDGE_PROXY_SECRET: SECRET }).config)
      .toEqual({ url: URL_COLLECTOR, secret: SECRET });
  });

  it("http: hors de la machine : éteint — le secret de bord, les clés et le jeton ne partent pas en clair", async () => {
    for (const url of ["http://collector.up.railway.app", "http://10.0.0.5:8080", "http://127.0.0.2", "http://localhost.evil.test"]) {
      const lu = lireConfigRelais({ CONSOLE_INGEST_RELAY_URL: url, EDGE_PROXY_SECRET: SECRET });
      expect(lu.config, url).toBeNull();
      expect("raison" in lu && lu.raison, url).toMatch(/https/);
    }
    // Journalisé UNE fois, quel que soit le nombre de requêtes ; aucun appel réseau.
    const { r, collector } = relais({ env: { CONSOLE_INGEST_RELAY_URL: "http://collector.up.railway.app", EDGE_PROXY_SECRET: SECRET } });
    for (let i = 0; i < 20; i++) expect(await r.choisir("traces")).toBeNull();
    expect(collector.fetch).not.toHaveBeenCalled();
    expect(simul.journal.filter((l) => l.msg === "relay disabled")).toHaveLength(1);
    expect(JSON.stringify(simul.journal)).not.toContain(SECRET);
  });

  it("http: permis sur la machine elle-même (localhost, 127.0.0.1, ::1) — tests et collector local", () => {
    for (const url of ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080"]) {
      expect(lireConfigRelais({ CONSOLE_INGEST_RELAY_URL: url, EDGE_PROXY_SECRET: SECRET }).config, url)
        .toEqual({ url, secret: SECRET });
    }
  });
});

// ─────────────────────────────── Pourcentage ────────────────────────────────

describe("pourcentage — tirage par requête", () => {
  it("0 % : JAMAIS de fetch, ni santé ni POST, sur mille requêtes", async () => {
    const { r, collector } = relais({ pct: 0, aleatoire: Math.random });
    for (let i = 0; i < 1000; i++) expect(await r.relayer("traces", entrante(), corps, CORS)).toBeNull();
    expect(collector.fetch).not.toHaveBeenCalled();
  });

  it("10 % : relayé sous le seuil tiré, local au-dessus", async () => {
    let tirage = 0.05;
    const { r } = relais({ pct: 10, aleatoire: () => tirage });
    expect(await r.choisir("traces")).not.toBeNull();
    tirage = 0.1;
    expect(await r.choisir("traces")).toBeNull();
    tirage = 0.99;
    expect(await r.choisir("traces")).toBeNull();
  });

  it("100 % : toujours relayé, sans dépendre du tirage", async () => {
    const { r } = relais({ pct: 100, aleatoire: () => 0.999999 });
    expect(await r.choisir("logs")).not.toBeNull();
  });
});

// ─────────────────────────────── Santé du collector ─────────────────────────

describe("vérification du collector — GET /health, cache 60 s", () => {
  it("une seule sonde pour de nombreuses requêtes, renouvelée après 60 s", async () => {
    const { r, collector, horloge } = relais();
    for (let i = 0; i < 20; i++) await r.choisir("traces");
    expect(collector.appels.filter((a) => a.url === `${URL_COLLECTOR}/health`)).toHaveLength(1);
    horloge.t += 59_000;
    await r.choisir("traces");
    expect(collector.appels.filter((a) => a.url.endsWith("/health"))).toHaveLength(1);
    horloge.t += 2_000;
    await r.choisir("traces");
    expect(collector.appels.filter((a) => a.url.endsWith("/health"))).toHaveLength(2);
  });

  it.each([
    ["protocole de bord inattendu", () => Response.json({ status: "ok", edge_protocol: "mip-edge/0", edge_trust: true })],
    ["collector sans secret de relais", () => Response.json({ status: "ok", edge_protocol: "mip-edge/1", edge_trust: false })],
    ["collector en 503", () => Response.json({ status: "unavailable", edge_protocol: "mip-edge/1", edge_trust: true }, { status: 503 })],
    ["corps illisible", () => new Response("<html>", { status: 200 })],
    ["collector injoignable", () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }],
  ])("%s : contournement, et l'échec est mis en cache 60 s", async (_nom, sante) => {
    const collector = fauxCollector({ sante });
    const { r, horloge } = relais({ collector });
    expect(await r.choisir("traces")).toBeNull();
    expect(await r.choisir("replay")).toBeNull();
    expect(collector.appels).toHaveLength(1);
    expect(simul.journal.filter((l) => l.msg === "relay bypass: collector health")).toHaveLength(1);
    horloge.t += 61_000;
    await r.choisir("traces");
    expect(collector.appels).toHaveLength(2);
  });

  it("/health SANS signature x-mip-collector (collector antérieur) : contournement — ses 404 métier seraient pris pour un routage raté", async () => {
    const collector = fauxCollector({ santeSignee: false });
    const { r } = relais({ collector });
    expect(await r.choisir("sourcemaps")).toBeNull();
    const avis = simul.journal.find((l) => l.msg === "relay bypass: collector health");
    expect(avis?.champs).toEqual({ raison: `réponse sans ${ENTETE_COLLECTOR}` });
  });

  it("la signature est celle que le receveur du collector pose (ENTETE_COLLECTOR)", () => {
    expect(ENTETE_COLLECTOR).toBe(ENTETE_DU_RECEVEUR);
  });

  it("id_fp n'est PAS comparé (Vercel ne hache plus, décision du 23/09)", async () => {
    const collector = fauxCollector({
      sante: () => Response.json({ status: "ok", edge_protocol: "mip-edge/1", edge_trust: true, identity: "active", id_fp: "0123456789ab" }),
    });
    expect(await relais({ collector }).r.choisir("traces")).not.toBeNull();
  });
});

// ─────────────────────────────── Matrice de repli ───────────────────────────

describe("matrice de repli — chaque statut × chaque signal × signé ou non", () => {
  const STATUTS = [200, 400, 401, 403, 404, 405, 409, 410, 413, 425, 429, 500, 502, 503, 504];

  /** La règle du plan, écrite indépendamment du code. */
  const attendu = (signal: Signal, statut: number, signee: boolean) => {
    if (signee) return "collector";
    if ([404, 405].includes(statut)) return "repli";
    if ([502, 504].includes(statut)) return signal === "logs" ? "incertain" : "repli";
    return "collector";
  };
  /** Échec compté au disjoncteur : jamais sur une réponse signée. */
  const echecAttendu = (signal: Signal, statut: number, signee: boolean) =>
    !signee && (attendu(signal, statut, signee) !== "collector" || statut >= 500);

  it("les logs sont les SEULS non idempotents", () => {
    expect(IDEMPOTENTS).toEqual({ traces: true, replay: true, sourcemaps: true, logs: false });
  });

  for (const signee of [true, false]) {
    for (const signal of SIGNAUX) {
      for (const statut of STATUTS) {
        const issue = attendu(signal, statut, signee);
        it(`${signal} × ${statut} ${signee ? "signé" : "NON signé"} → ${issue}`, async () => {
          const collector = fauxCollector({
            postSigne: signee,
            post: () =>
              new Response(JSON.stringify({ statut }), {
                status: statut,
                headers: { "content-type": "application/json", "retry-after": "7", "access-control-allow-origin": "*" },
              }),
          });
          const { r } = relais({ collector });
          const rep = await r.relayer(signal, entrante(), corps, CORS);
          expect(issueReponse(signal, statut, signee)).toBe(issue);
          if (issue === "repli") {
            expect(rep).toBeNull();
            expect(simul.journal.some((l) => l.msg === "relay fallback")).toBe(true);
          } else if (issue === "incertain") {
            expect(rep!.status).toBe(503);
            expect(rep!.headers.get("retry-after")).toBe("5");
            expect(rep!.headers.get("access-control-allow-origin")).toBe(ORIGINE);
            expect(await rep!.json()).toMatchObject({ retry: true });
          } else {
            expect(rep).not.toBeNull();
            expect(rep!.status).toBe(statut);
            expect(await rep!.json()).toEqual({ statut });
            expect(rep!.headers.get("retry-after")).toBe("7");
            // CORS LOCAUX, jamais ceux du collector.
            expect(rep!.headers.get("access-control-allow-origin")).toBe(ORIGINE);
          }
          expect(r.etat().echecs).toBe(echecAttendu(signal, statut, signee) ? 1 : 0);
          expect(collector.posts()[0].url).toBe(`${URL_COLLECTOR}${CHEMINS[signal]}`);
        });
      }
    }
  }

  it("sourcemaps : 404 MÉTIER signé (app inconnue), rejoué en boucle → rendu tel quel, disjoncteur intact", async () => {
    const collector = fauxCollector({
      post: () => Response.json({ error: "application inconnue : app-supprimee" }, { status: 404 }),
    });
    const { r } = relais({ collector });
    for (let i = 0; i < 12; i++) {
      const rep = await r.relayer("sourcemaps", entrante(), corps, CORS);
      expect(rep!.status).toBe(404);
      expect(await rep!.json()).toEqual({ error: "application inconnue : app-supprimee" });
    }
    expect(r.etat()).toEqual({ echecs: 0, contourne: false });
    expect(simul.journal.some((l) => l.msg === "relay fallback" || l.msg === "relay circuit open")).toBe(false);
    // Et les autres signaux passent toujours par le relais.
    expect(await r.choisir("traces")).not.toBeNull();
  });

  it("404 SANS signature (routeur Railway : service absent) → repli local, échec compté", async () => {
    const collector = fauxCollector({ postSigne: false, post: () => new Response("Not Found", { status: 404 }) });
    const { r } = relais({ collector });
    expect(await r.relayer("sourcemaps", entrante(), corps, CORS)).toBeNull();
    expect(r.etat().echecs).toBe(1);
    expect(simul.journal.some((l) => l.msg === "relay fallback")).toBe(true);
  });

  it("réponse rendue en application/json + nosniff, quel que soit le content-type reçu", async () => {
    const collector = fauxCollector({
      post: () => new Response("<script>alert(1)</script>", { status: 200, headers: { "content-type": "text/html" } }),
    });
    const rep = await relais({ collector }).r.relayer("traces", entrante(), corps, CORS);
    expect(rep!.headers.get("content-type")).toBe("application/json");
    expect(rep!.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("erreur de CONNEXION (requête jamais partie) : repli pour tous les signaux, logs compris", async () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]) {
      for (const signal of SIGNAUX) {
        const collector = fauxCollector({
          post: () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code } }); },
        });
        expect(await relais({ collector }).r.relayer(signal, entrante(), corps, CORS)).toBeNull();
      }
    }
  });

  it("connexion PERDUE après l'envoi : repli pour les idempotents, 503 + retry-after pour les logs", async () => {
    for (const code of ["ECONNRESET", "UND_ERR_SOCKET", undefined]) {
      for (const signal of SIGNAUX) {
        const collector = fauxCollector({
          post: () => { throw Object.assign(new TypeError("fetch failed"), { cause: code ? { code } : undefined }); },
        });
        const rep = await relais({ collector }).r.relayer(signal, entrante(), corps, CORS);
        if (IDEMPOTENTS[signal]) {
          expect(rep).toBeNull();
        } else {
          expect(rep!.status).toBe(503);
          expect(rep!.headers.get("retry-after")).toBeTruthy();
          expect(rep!.headers.get("access-control-allow-origin")).toBe(ORIGINE);
        }
      }
    }
  });
});

// ─────────────────────────────── Délai ──────────────────────────────────────

describe("délai du relais", () => {
  it("vaut 8 s, au-delà du budget de 4 s du collector", () => {
    expect(DELAIS.relaisMs).toBe(8_000);
  });

  it("dépassé (vrai AbortSignal) : 503 + retry-after pour TOUS les signaux, sans repli", async () => {
    for (const signal of SIGNAUX) {
      const collector = fauxCollector({
        // Un collector qui ne répond jamais : seul le signal d'abandon le libère.
        post: (_url, init) =>
          new Promise<Response>((_ok, ko) => {
            init.signal!.addEventListener("abort", () => ko(init.signal!.reason));
          }),
      });
      const { r } = relais({ collector, delais: { relaisMs: 30 } });
      const rep = await r.relayer(signal, entrante(), corps, CORS);
      expect(rep).not.toBeNull();
      expect(rep!.status).toBe(503);
      expect(rep!.headers.get("retry-after")).toBe("5");
      expect(rep!.headers.get("access-control-allow-origin")).toBe(ORIGINE);
      expect(await rep!.json()).toMatchObject({ retry: true });
    }
  });
});

// ─────────────────────────────── Disjoncteur ────────────────────────────────

describe("disjoncteur — 5 échecs en 30 s → contournement 60 s", () => {
  // 502 du ROUTEUR Railway : non signé.
  const en502 = () => fauxCollector({ postSigne: false, post: () => new Response("Bad Gateway", { status: 502 }) });

  it("s'ouvre au 5e échec, contourne 60 s SANS appel réseau, puis se referme", async () => {
    const collector = en502();
    const { r, horloge } = relais({ collector });
    for (let i = 0; i < 5; i++) {
      expect(await r.relayer("traces", entrante(), corps, CORS)).toBeNull();
      horloge.t += 1_000;
    }
    expect(collector.posts()).toHaveLength(5);
    expect(r.etat().contourne).toBe(true);
    expect(simul.journal.filter((l) => l.msg === "relay circuit open")).toHaveLength(1);

    horloge.t += 50_000;
    for (let i = 0; i < 10; i++) expect(await r.choisir("traces")).toBeNull();
    expect(collector.posts()).toHaveLength(5);

    horloge.t += 11_000; // 61 s après l'ouverture
    expect(await r.choisir("traces")).not.toBeNull();
  });

  it("5 échecs étalés sur PLUS de 30 s : reste fermé", async () => {
    const { r, horloge } = relais({ collector: en502() });
    for (let i = 0; i < 5; i++) {
      await r.relayer("replay", entrante(), corps, CORS);
      horloge.t += 8_000;
    }
    expect(r.etat().contourne).toBe(false);
  });

  it("les délais dépassés comptent comme des échecs", async () => {
    const collector = fauxCollector({
      post: (_u, init) => new Promise<Response>((_ok, ko) => init.signal!.addEventListener("abort", () => ko(init.signal!.reason))),
    });
    const { r } = relais({ collector, delais: { relaisMs: 5 } });
    for (let i = 0; i < 5; i++) await r.relayer("logs", entrante(), corps, CORS);
    expect(r.etat().contourne).toBe(true);
  });

  it("une réponse SIGNÉE du collector (400, 403, 404, 429, 500, 503) n'est PAS un échec", async () => {
    for (const statut of [400, 403, 404, 429, 500, 503]) {
      const { r } = relais({ collector: fauxCollector({ post: () => new Response("{}", { status: statut }) }) });
      for (let i = 0; i < 10; i++) await r.relayer("traces", entrante(), corps, CORS);
      expect(r.etat()).toEqual({ echecs: 0, contourne: false });
    }
  });
});

// ─────────────────────────────── En-têtes ───────────────────────────────────

describe("en-têtes transmis — liste EXACTE, jamais une adresse", () => {
  it("la liste est celle du plan, sans plus", () => {
    expect([...ENTETES_TRANSMIS]).toEqual([
      "content-type", "content-encoding", "x-mip-session", "x-mip-app", "x-mip-seq", "x-mip-key",
    ]);
    expect([...ENTETES_SOURCEMAPS]).toEqual([...ENTETES_TRANSMIS, "authorization"]);
  });

  for (const signal of SIGNAUX) {
    it(`${signal} : exactement la liste + le bord de confiance ; ni IP, ni x-forwarded-for, ni en-tête forgé`, async () => {
      const { r, collector } = relais();
      await r.relayer(signal, entrante(), corps, CORS);
      const envoyes = new Headers(collector.posts()[0].init.headers);
      const noms = [...envoyes.keys()].sort();
      const attendus = [
        ...(signal === "sourcemaps" ? ENTETES_SOURCEMAPS : ENTETES_TRANSMIS),
        "x-mip-edge-auth",
        "x-mip-edge-country",
      ].sort();
      expect(noms).toEqual(attendus);
      // Le secret du relais, pas la valeur forgée par le client.
      expect(envoyes.get("x-mip-edge-auth")).toBe(SECRET);
      // Le pays de VERCEL, pas celui forgé par le client.
      expect(envoyes.get("x-mip-edge-country")).toBe("FR");
      for (const nom of ["x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for", "forwarded", "cf-connecting-ip",
        "true-client-ip", "x-mip-edge-ip", "x-vercel-ip-country", "x-vercel-ip-city", "cookie", "origin"]) {
        expect(envoyes.has(nom), nom).toBe(false);
      }
      // Aucune valeur transmise ne contient l'adresse, sous quelque nom que ce soit.
      for (const [, v] of envoyes) expect(v).not.toContain(IP);
      if (signal !== "sourcemaps") expect(envoyes.has("authorization")).toBe(false);
    });
  }

  it("pays Vercel absent ou mal formé : pas de x-mip-edge-country (jamais un pays inventé)", async () => {
    for (const pays of [undefined, "fr", "FRA", ""]) {
      const { r, collector } = relais();
      const req = entrante();
      const h = new Headers(req.headers);
      if (pays === undefined) h.delete("x-vercel-ip-country");
      else h.set("x-vercel-ip-country", pays);
      await r.relayer("traces", new Request(req.url, { method: "POST", headers: h, body: "{}" }), corps, CORS);
      expect(new Headers(collector.posts()[0].init.headers).has("x-mip-edge-country")).toBe(false);
    }
  });

  it("le corps part octet pour octet", async () => {
    const { r, collector } = relais();
    const octets = new Uint8Array([0x1f, 0x8b, 0, 1, 2, 250, 255]);
    await r.relayer("replay", entrante(), octets, CORS);
    expect(Buffer.from(collector.posts()[0].init.body as Uint8Array)).toEqual(Buffer.from(octets));
  });
});

// ─────────────────────────────── Drapeau de plateforme ──────────────────────

describe("platform_flag — lecture en cache 30 s, jamais d'exception", () => {
  const lecteur = (requete: (sql: string, p: unknown[]) => Promise<{ rows: Array<{ value: unknown }> }>, horloge = { t: 0 }) =>
    ({ l: creerLecteurDrapeaux({ requete: vi.fn(requete), maintenant: () => horloge.t, delaiMs: 20 }), horloge });

  it("table ABSENTE (42P01, avant v87) : null, sans exception", async () => {
    const { l } = lecteur(async () => { throw Object.assign(new Error("absente"), { code: "42P01" }); });
    await expect(l.lire("ingest_relay_pct")).resolves.toBeNull();
  });

  it("base en erreur : null, et l'échec est mis en cache 30 s (la base n'est pas relancée à chaque beacon)", async () => {
    const requete = vi.fn(async () => { throw Object.assign(new Error("quota"), { code: "XX000" }); });
    const horloge = { t: 0 };
    const l = creerLecteurDrapeaux({ requete, maintenant: () => horloge.t });
    for (let i = 0; i < 10; i++) expect(await l.lire("ingest_relay_pct")).toBeNull();
    expect(requete).toHaveBeenCalledTimes(1);
    horloge.t += 30_001;
    await l.lire("ingest_relay_pct");
    expect(requete).toHaveBeenCalledTimes(2);
  });

  it("base qui ne répond pas : abandon au délai, null", async () => {
    const { l } = lecteur(() => new Promise(() => {}));
    await expect(l.lire("ingest_relay_pct")).resolves.toBeNull();
  });

  it("valeur lue, gardée 30 s, puis relue (effet d'un update < 30 s)", async () => {
    let valeur = "25";
    const requete = vi.fn(async () => ({ rows: [{ value: valeur }] }));
    const horloge = { t: 0 };
    const l = creerLecteurDrapeaux({ requete, maintenant: () => horloge.t });
    expect(await l.lire("ingest_relay_pct")).toBe("25");
    valeur = "0";
    horloge.t += 29_000;
    expect(await l.lire("ingest_relay_pct")).toBe("25");
    horloge.t += 1_001;
    expect(await l.lire("ingest_relay_pct")).toBe("0");
  });

  it("cinquante lectures simultanées : UNE requête", async () => {
    const requete = vi.fn(async () => ({ rows: [{ value: "10" }] }));
    const l = creerLecteurDrapeaux({ requete });
    const v = await Promise.all(Array.from({ length: 50 }, () => l.lire("ingest_relay_pct")));
    expect(new Set(v)).toEqual(new Set(["10"]));
    expect(requete).toHaveBeenCalledTimes(1);
  });

  it("ligne absente : null", async () => {
    const { l } = lecteur(async () => ({ rows: [] }));
    expect(await l.lire("ingest_relay_pct")).toBeNull();
  });

  it("forme du pourcentage : la même règle que la contrainte de v87", () => {
    for (const [brut, v] of [["0", 0], ["7", 7], ["10", 10], ["100", 100], [" 50 ", 50]] as const) expect(lirePourcentage(brut)).toBe(v);
    for (const brut of ["101", "-1", "10%", "1.5", "010", "", "abc", null, undefined]) expect(lirePourcentage(brut)).toBeNull();
  });

  it("défaut d'environnement INGEST_RELAY_PCT : 0 s'il est absent ou invalide", () => {
    expect(pourcentageParDefaut({})).toBe(0);
    expect(pourcentageParDefaut({ INGEST_RELAY_PCT: "100" })).toBe(100);
    expect(pourcentageParDefaut({ INGEST_RELAY_PCT: "beaucoup" })).toBe(0);
  });

  it("pourcentageRelais : table absente → défaut d'env ; valeur en base → elle prime", async () => {
    vi.stubEnv("INGEST_RELAY_PCT", "30");
    await expect(pourcentageRelais()).resolves.toBe(30);
    _resetPlatformFlagCache();
    simul.query.mockImplementationOnce(async () => ({ rows: [{ value: "0" }] }));
    await expect(pourcentageRelais()).resolves.toBe(0);
    _resetPlatformFlagCache();
    simul.query.mockImplementationOnce(async () => ({ rows: [] }));
    await expect(pourcentageRelais()).resolves.toBe(30);
  });
});

// ─────────────────────────────── Par les routes ─────────────────────────────

describe("par les route handlers — branchement réel", () => {
  const post = (chemin: string, headers: Record<string, string>, body: BodyInit) =>
    new Request(`https://mip-rum-console.vercel.app${chemin}`, { method: "POST", headers, body });

  function brancher(opts: { pct?: string; sans?: boolean; collector?: ReturnType<typeof fauxCollector> } = {}) {
    if (!opts.sans) {
      vi.stubEnv("CONSOLE_INGEST_RELAY_URL", URL_COLLECTOR);
      vi.stubEnv("EDGE_PROXY_SECRET", SECRET);
    }
    vi.stubEnv("INGEST_RELAY_PCT", opts.pct ?? "100");
    const collector = opts.collector ?? fauxCollector();
    vi.stubGlobal("fetch", collector.fetch);
    return collector;
  }

  it("URL absente (état de la production à la fusion) : aucun fetch, aucune lecture du drapeau", async () => {
    const collector = brancher({ sans: true });
    await POST_TRACES(post("/api/ingest/v1/traces", { "content-type": "application/json" }, "{}"));
    expect(collector.fetch).not.toHaveBeenCalled();
    expect(simul.query.mock.calls.some(([sql]) => String(sql).includes("platform_flag"))).toBe(false);
  });

  it("drapeau à 0 en base : aucun fetch, même avec INGEST_RELAY_PCT=100", async () => {
    simul.query.mockImplementation(async (sql: string) =>
      sql.includes("platform_flag") ? { rows: [{ value: "0" }] } : { rows: [] });
    try {
      const collector = brancher({ pct: "100" });
      await POST_TRACES(post("/api/ingest/v1/traces", { "content-type": "application/json" }, "{}"));
      expect(collector.fetch).not.toHaveBeenCalled();
    } finally {
      simul.query.mockReset();
      simul.query.mockImplementation(async () => {
        throw Object.assign(new Error("absente"), { code: "42P01" });
      });
    }
  });

  it("table absente + INGEST_RELAY_PCT=100 : traces relayées, réponse du collector avec les CORS LOCAUX", async () => {
    const collector = brancher();
    const rep = await POST_TRACES(post("/api/ingest/v1/traces", {
      "content-type": "application/json", origin: ORIGINE, "x-forwarded-for": IP,
    }, '{"resourceSpans":[]}'));
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ partialSuccess: {} });
    expect(rep.headers.get("access-control-allow-origin")).toBe(ORIGINE);
    const [envoi] = collector.posts();
    expect(envoi.url).toBe(`${URL_COLLECTOR}/v1/traces`);
    expect(Buffer.from(envoi.init.body as Uint8Array).toString()).toBe('{"resourceSpans":[]}');
    expect(new Headers(envoi.init.headers).has("x-forwarded-for")).toBe(false);
  });

  it("un corps au-delà du plafond reste refusé LOCALEMENT (413), sans relais", async () => {
    const collector = brancher();
    const rep = await POST_LOGS(post("/api/ingest/v1/logs", { "content-length": String(50 * 1024 * 1024) }, "{}"));
    expect(rep.status).toBe(413);
    expect(collector.posts()).toHaveLength(0);
  });

  it("logs : un 500 du collector est rendu tel quel (pas de second essai local)", async () => {
    const collector = brancher({ collector: fauxCollector({ post: () => Response.json({ error: "internal error" }, { status: 500 }) }) });
    const rep = await POST_LOGS(post("/api/ingest/v1/logs", { origin: ORIGINE }, '{"resourceLogs":[]}'));
    expect(rep.status).toBe(500);
    expect(rep.headers.get("access-control-allow-origin")).toBe(ORIGINE);
    expect(collector.posts()).toHaveLength(1);
  });

  it("replay : relayé AVANT toute garde locale (ni clé ni débit en base), en-têtes x-mip-* transmis", async () => {
    const collector = brancher({
      collector: fauxCollector({ post: () => Response.json({ ok: true, seq: 3, events: 2 }) }),
    });
    const rep = await POST_REPLAY(post("/api/ingest/v1/replay", {
      "content-type": "application/octet-stream", "x-mip-session": "s1", "x-mip-app": "a1", "x-mip-seq": "3", "x-mip-key": "k1", origin: ORIGINE,
    }, new Uint8Array([1, 2, 3])));
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ ok: true, seq: 3, events: 2 });
    const h = new Headers(collector.posts()[0].init.headers);
    expect([h.get("x-mip-session"), h.get("x-mip-app"), h.get("x-mip-seq"), h.get("x-mip-key")]).toEqual(["s1", "a1", "3", "k1"]);
    // Seules lectures : le drapeau, et le registre d'apps qui nourrit les CORS
    // LOCAUX (cache 60 s). Ni clé, ni débit (`rate_check`), ni écriture.
    const lectures = simul.query.mock.calls.map(([sql]) => String(sql));
    expect(lectures.every((sql) => sql.includes("platform_flag") || sql.includes("app_registry")), lectures.join("\n")).toBe(true);
  });

  it("sourcemaps, branche JETON : relayée avec le jeton ; sans jeton (admin) : jamais relayée", async () => {
    const collector = brancher({ collector: fauxCollector({ post: () => Response.json({ uploaded: 1 }, { status: 201 }) }) });
    const avecJeton = Object.assign(post("/api/sourcemaps", { authorization: "Bearer msu_x", "content-type": "application/json" }, '{"appId":"a"}'), {
      nextUrl: new URL("https://mip-rum-console.vercel.app/api/sourcemaps"),
      cookies: { get: () => undefined },
    });
    const rep = await POST_SOURCEMAPS(avecJeton as never);
    expect(rep.status).toBe(201);
    expect(new Headers(collector.posts()[0].init.headers).get("authorization")).toBe("Bearer msu_x");

    const sansJeton = Object.assign(post("/api/sourcemaps", { "content-type": "application/json" }, "{}"), {
      nextUrl: new URL("https://mip-rum-console.vercel.app/api/sourcemaps"),
      cookies: { get: () => undefined },
    });
    await POST_SOURCEMAPS(sansJeton as never);
    expect(collector.posts()).toHaveLength(1);
  });

  it("OPTIONS reste local : aucun fetch", async () => {
    const collector = brancher();
    const rep = await OPTIONS_TRACES(new Request("https://mip-rum-console.vercel.app/api/ingest/v1/traces", {
      method: "OPTIONS", headers: { origin: ORIGINE },
    }));
    expect(rep.status).toBe(204);
    expect(collector.fetch).not.toHaveBeenCalled();
  });
});
