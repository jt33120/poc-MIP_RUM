// @mip/service-kit — http.mjs : les sondes (sens de chacune), le jeton de
// supervision (404 sans lui), le plafond de corps (413), les délais serveur
// (headers, request, keep-alive), le journal d'accès sans IP, et l'arrêt
// complet sur SIGTERM avec un vrai serveur.
import { EventEmitter } from "node:events";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startService } from "../../packages/service-kit/http.mjs";
import { installLifecycle } from "../../packages/service-kit/lifecycle.mjs";
import { createLogger } from "../../packages/service-kit/log.mjs";
import { createMetrics } from "../../packages/service-kit/metrics.mjs";

const JETON = "j".repeat(40);
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const aFermer: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(aFermer.splice(0).map((f) => f()));
});

function journal() {
  const lignes: any[] = [];
  const log = createLogger("test-http", {
    version: "",
    replica: "",
    level: "debug",
    sink: { out: (l: string) => lignes.push(JSON.parse(l)), err: (l: string) => lignes.push(JSON.parse(l)) },
  });
  return { log, lignes };
}

/** Un faux pool : `select 1` réussit, échoue ou pend selon `etat`. */
function fauxPool() {
  const pool = {
    etat: "ok" as "ok" | "ko" | "pend",
    requetes: 0,
    query: vi.fn(async () => {
      pool.requetes += 1;
      if (pool.etat === "ko") throw new Error("connect ECONNREFUSED db.interne:5432");
      if (pool.etat === "pend") await new Promise(() => {});
      await attendre(5);
      return { rows: [{ "?column?": 1 }] };
    }),
  };
  return pool;
}

async function demarrer(options: Record<string, unknown> = {}) {
  const { log, lignes } = journal();
  const svc = startService({ name: "test", log, port: 0, host: "127.0.0.1", ...options } as any);
  const { port } = await svc.listening;
  aFermer.push(() => svc.close({ signal: AbortSignal.abort() }));
  return { svc, base: `http://127.0.0.1:${port}`, port, lignes, log };
}

/** Échange brut sur une socket : ce que le serveur renvoie, et s'il ferme. */
function socketBrute(port: number, envoyer: (s: net.Socket) => void, delaiMax = 3000) {
  return new Promise<{ recu: string; ferme: boolean; ms: number }>((resoudre) => {
    const debut = Date.now();
    const s = net.connect(port, "127.0.0.1");
    let recu = "";
    const fin = (ferme: boolean) => {
      clearTimeout(garde);
      s.destroy();
      resoudre({ recu, ferme, ms: Date.now() - debut });
    };
    const garde = setTimeout(() => fin(false), delaiMax);
    s.on("data", (d) => (recu += d.toString("latin1")));
    s.on("close", () => fin(true));
    s.on("error", () => {});
    s.on("connect", () => envoyer(s));
  });
}

describe("service-kit/http — /health (la sonde Railway)", () => {
  it("200 quand le processus vit et que la base répond ; 503 muet quand elle ne répond pas", async () => {
    const pool = fauxPool();
    const { base, lignes } = await demarrer({ pool });
    const ok = await fetch(`${base}/health`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "ok" });

    pool.etat = "ko";
    const ko = await fetch(`${base}/health`);
    expect(ko.status).toBe(503);
    const corps = await ko.text();
    expect(corps).toBe('{"status":"unavailable"}'); // ni hôte, ni message d'erreur
    // journalisé au changement d'état seulement
    await fetch(`${base}/health`);
    expect(lignes.filter((l) => /santé dégradée/.test(l.msg))).toHaveLength(1);
    pool.etat = "ok";
    await fetch(`${base}/health`);
    expect(lignes.filter((l) => /santé rétablie/.test(l.msg))).toHaveLength(1);
  });

  it("borné : une base qui pend donne 503 au délai, pas une sonde suspendue", async () => {
    const pool = fauxPool();
    pool.etat = "pend";
    const { base } = await demarrer({ pool, healthTimeoutMs: 100 });
    const debut = Date.now();
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(503);
    expect(Date.now() - debut).toBeLessThan(1500);
  });

  it("cent sondes simultanées font UNE requête à la base", async () => {
    // La requête à la base reste bloquée tant que le serveur n'a pas reçu les
    // cent sondes : le test ne dépend plus de la vitesse de la machine.
    let relacher!: () => void;
    const porte = new Promise<void>((r) => (relacher = r));
    let requetes = 0;
    const pool = { query: vi.fn(async () => (requetes += 1, await porte, { rows: [] })) };
    const { base, svc } = await demarrer({ pool, healthTimeoutMs: 10_000 });
    let recues = 0;
    svc.server.on("request", () => (recues += 1));
    const reponses = Promise.all(Array.from({ length: 100 }, () => fetch(`${base}/health`)));
    await vi.waitFor(() => expect(recues).toBe(100), { timeout: 5000 });
    relacher();
    expect((await reponses).every((r) => r.status === 200)).toBe(true);
    expect(requetes).toBe(1);
  });

  it("sans pool : processus vivant = sain (service sans base, comme mcp)", async () => {
    const { base } = await demarrer();
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("`details` : une description statique ajoutée au corps, en 200 comme en 503 ; `status` reste celui du kit", async () => {
    const pool = fauxPool();
    const { base } = await demarrer({ pool, details: () => ({ service: "collector", edge_protocol: "mip-edge/1", status: "menteur" }) });
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ service: "collector", edge_protocol: "mip-edge/1", status: "ok" });
    pool.etat = "ko";
    const panne = await fetch(`${base}/health`);
    expect(panne.status).toBe(503);
    expect(await panne.json()).toEqual({ service: "collector", edge_protocol: "mip-edge/1", status: "unavailable" });
  });

  it("`details` qui lève : la sonde reste saine, l'échec part au journal", async () => {
    const { base, lignes } = await demarrer({
      details: () => {
        throw new Error("description cassée");
      },
    });
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
    expect(lignes.some((l) => l.msg === "détails de /health en échec")).toBe(true);
  });
});

describe("service-kit/http — /ready et /metrics : jeton obligatoire, sinon 404", () => {
  it("sans jeton configuré : 404, même avec un en-tête", async () => {
    const { base } = await demarrer({ metrics: createMetrics() });
    for (const chemin of ["/ready", "/metrics"]) {
      expect((await fetch(`${base}${chemin}`)).status).toBe(404);
      expect((await fetch(`${base}${chemin}`, { headers: { authorization: `Bearer ${JETON}` } })).status).toBe(404);
    }
  });

  it("jeton configuré : 404 sans lui ou faux (ni en query), 200 avec", async () => {
    const { base } = await demarrer({ metrics: createMetrics(), metricsToken: JETON });
    const avec = { headers: { authorization: `Bearer ${JETON}` } };
    expect((await fetch(`${base}/metrics`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { headers: { authorization: "Bearer mauvais" } })).status).toBe(404);
    expect((await fetch(`${base}/metrics?token=${JETON}`)).status).toBe(404);
    expect((await fetch(`${base}/ready`)).status).toBe(404);

    const ready = await fetch(`${base}/ready`, avec);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });

    const m = await fetch(`${base}/metrics`, avec);
    expect(m.status).toBe(200);
    expect(m.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(await m.text()).toContain("# TYPE http_requests_total counter");
  });

  it("/ready relaie le verdict de ready() (fraîcheur, backlog) et passe à 503 au drainage", async () => {
    const lifecycle = { draining: false, onDrain: () => {} };
    let backlog = 3;
    const { base } = await demarrer({
      metricsToken: JETON,
      lifecycle,
      ready: () => ({ ok: backlog < 100, backlog }),
    });
    const avec = { headers: { authorization: `Bearer ${JETON}` } };
    expect(await (await fetch(`${base}/ready`, avec)).json()).toEqual({ ok: true, backlog: 3, status: "ready" });
    backlog = 500;
    const plein = await fetch(`${base}/ready`, avec);
    expect(plein.status).toBe(503);
    expect(await plein.json()).toMatchObject({ backlog: 500, status: "not_ready" });
    backlog = 0;
    lifecycle.draining = true;
    const draine = await fetch(`${base}/ready`, avec);
    expect(draine.status).toBe(503);
    expect(await draine.json()).toEqual({ status: "draining" });
  });

  it("les sondes n'acceptent que GET et HEAD", async () => {
    const { base } = await demarrer();
    const r = await fetch(`${base}/health`, { method: "POST" });
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("service-kit/http — routes, plafond de corps, erreurs", () => {
  it("sans routes (scheduler) : 404 hors sondes", async () => {
    const { base } = await demarrer();
    expect((await fetch(`${base}/v1/traces`)).status).toBe(404);
  });

  it("413 d'après Content-Length, AVANT d'appeler le gestionnaire", async () => {
    const handler = vi.fn((_req, res) => res.end("ok"));
    const { port } = await demarrer({ handler, maxBodyBytes: 64 });
    const r = await socketBrute(port, (s) => s.write("POST /v1/traces HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n"));
    expect(r.recu).toMatch(/^HTTP\/1\.1 413 /);
    expect(r.recu).toMatch(/connection: close/i);
    expect(r.ferme).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it("413 sans Content-Length : ctx.readBody applique le plafond au flux", async () => {
    const { port } = await demarrer({
      maxBodyBytes: 64,
      handler: async (_req: any, res: any, ctx: any) => {
        const corps = await ctx.readBody();
        res.end(String(corps.length));
      },
    });
    const gros = await socketBrute(port, (s) =>
      s.write(`POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n80\r\n${"a".repeat(128)}\r\n`),
    );
    expect(gros.recu).toMatch(/^HTTP\/1\.1 413 /);
    const petit = await socketBrute(port, (s) =>
      s.write(`POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n10\r\n${"a".repeat(16)}\r\n0\r\n\r\n`),
    );
    expect(petit.recu).toMatch(/^HTTP\/1\.1 200 /);
    expect(petit.recu.endsWith("16")).toBe(true);
  });

  it("mode fetch : les routes Web passent par l'adaptateur, plafond compris", async () => {
    const { base, port } = await demarrer({
      maxBodyBytes: 32,
      fetch: async (request: Request) => Response.json({ taille: (await request.arrayBuffer()).byteLength }),
    });
    const ok = await fetch(`${base}/x`, { method: "POST", body: "y".repeat(10) });
    expect(await ok.json()).toEqual({ taille: 10 });
    const r = await socketBrute(port, (s) => s.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 33\r\n\r\n"));
    expect(r.recu).toMatch(/^HTTP\/1\.1 413 /);
  });

  it("un gestionnaire qui lève : 500 avec request_id, pile au journal, jamais au client", async () => {
    const { base, lignes } = await demarrer({
      handler: () => {
        throw new Error("détail interne");
      },
    });
    const r = await fetch(`${base}/boom`);
    expect(r.status).toBe(500);
    const corps = await r.json();
    expect(corps).toEqual({ error: "internal_error", request_id: r.headers.get("x-request-id") });
    const erreur = lignes.find((l) => /requête en échec/.test(l.msg));
    expect(erreur.err.stack).toContain("détail interne");
    expect(erreur.request_id).toBe(corps.request_id);
  });

  it("refuse headersTimeout > requestTimeout, et handler + fetch ensemble", () => {
    const { log } = journal();
    expect(() => startService({ name: "x", log, timeouts: { headersTimeout: 5000, requestTimeout: 1000 } } as any)).toThrow(RangeError);
    expect(() => startService({ name: "x", log, handler() {}, fetch() {} } as any)).toThrow(/pas les deux/);
  });
});

describe("service-kit/http — responseHeaders : la signature du service sur TOUTES ses réponses", () => {
  // Le relais de la console (P3) distingue ainsi un 404 du collector d'un 404
  // du routeur Railway : l'en-tête doit être là jusque sur les erreurs.
  const SIGNE = { "x-mip-collector": "1" };

  it("routes, 404, 413, 500, /health (200 et 503), /ready et /metrics refusés", async () => {
    const pool = fauxPool();
    const { base } = await demarrer({
      pool,
      responseHeaders: SIGNE,
      maxBodyBytes: 10,
      handler: (req: any, res: any) => {
        if (req.url === "/leve") throw new Error("boum");
        if (req.url === "/absente") {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end("{}");
        }
        res.writeHead(200, { "x-autre": "a" });
        res.end("ok");
      },
    });
    const reponses = {
      route: await fetch(`${base}/x`),
      metier404: await fetch(`${base}/absente`),
      trop: await fetch(`${base}/x`, { method: "POST", body: "x".repeat(50) }),
      leve: await fetch(`${base}/leve`),
      sante: await fetch(`${base}/health`),
      ready: await fetch(`${base}/ready`),
      metrics: await fetch(`${base}/metrics`),
      methode: await fetch(`${base}/health`, { method: "POST" }),
    };
    pool.etat = "ko";
    const santeKo = await fetch(`${base}/health`);
    expect([reponses.metier404.status, reponses.trop.status, reponses.leve.status, santeKo.status]).toEqual([404, 413, 500, 503]);
    for (const [nom, r] of Object.entries({ ...reponses, santeKo })) {
      expect(r.headers.get("x-mip-collector"), nom).toBe("1");
    }
    // Fusion, pas remplacement : les en-têtes de la route restent.
    expect(reponses.route.headers.get("x-autre")).toBe("a");
  });

  it("sans routes (scheduler) : le 404 du kit est signé aussi", async () => {
    const { base } = await demarrer({ responseHeaders: SIGNE });
    const r = await fetch(`${base}/nulle-part`);
    expect(r.status).toBe(404);
    expect(r.headers.get("x-mip-collector")).toBe("1");
  });

  it("jusqu'aux réponses que Node rend seul : 400 (requête illisible), 408 (headersTimeout)", async () => {
    const { port } = await demarrer({
      responseHeaders: SIGNE,
      timeouts: { headersTimeout: 300, requestTimeout: 600, connectionsCheckingInterval: 100 },
    });
    const illisible = await socketBrute(port, (s) => s.write("n'importe quoi\r\n\r\n"));
    expect(illisible.recu).toMatch(/^HTTP\/1\.1 400 /);
    expect(illisible.recu.toLowerCase()).toContain("x-mip-collector: 1");
    const lent = await socketBrute(port, (s) => s.write("GET /x HTTP/1.1\r\nHost: a\r\n"));
    expect(lent.recu).toMatch(/^HTTP\/1\.1 408 /);
    expect(lent.recu.toLowerCase()).toContain("x-mip-collector: 1");
    expect(lent.ferme).toBe(true);
  });

  it("sans responseHeaders : aucun en-tête ajouté (les autres services ne signent rien)", async () => {
    const { base } = await demarrer();
    expect((await fetch(`${base}/health`)).headers.get("x-mip-collector")).toBeNull();
  });

  it("un en-tête invalide est refusé au DÉMARRAGE, pas à chaque réponse", () => {
    expect(() => startService({ name: "t", log: journal().log, port: 0, responseHeaders: { "x bad": "1" } } as any)).toThrow();
  });
});

describe("service-kit/http — journal d'accès sans IP, request_id propagé", () => {
  it("méthode, chemin sans query, statut, durée, request_id ; aucune adresse IP", async () => {
    const { base, lignes } = await demarrer({
      handler: (_req: any, res: any, ctx: any) => {
        ctx.log.info("au fond du gestionnaire"); // doit porter le request_id sans qu'on le passe
        res.end("ok");
      },
    });
    const r = await fetch(`${base}/v1/traces?api_key=secret&user=a@b.fr`, {
      headers: { "x-forwarded-for": "203.0.113.7", "x-railway-request-id": "railway-req-123456" },
    });
    expect(r.headers.get("x-request-id")).toBe("railway-req-123456");
    await attendre(10);
    const acces = lignes.find((l) => l.msg === "requête" && l.path === "/v1/traces");
    expect(acces).toMatchObject({ level: "info", method: "GET", status: 200, request_id: "railway-req-123456" });
    expect(acces.ms).toBeTypeOf("number");
    const interne = lignes.find((l) => l.msg === "au fond du gestionnaire");
    expect(interne.request_id).toBe("railway-req-123456");
    const tout = JSON.stringify(lignes);
    expect(tout).not.toContain("203.0.113.7");
    expect(tout).not.toContain("127.0.0.1"); // pas même l'adresse de la socket
    expect(tout).not.toContain("api_key=secret");
    expect(tout).not.toContain("a@b.fr");
  });

  it("un X-Request-Id mal formé est remplacé ; les sondes sont journalisées en debug", async () => {
    const { base, lignes } = await demarrer();
    const r = await fetch(`${base}/health`, { headers: { "x-request-id": "<script>" } });
    expect(r.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await attendre(10);
    expect(lignes.find((l) => l.msg === "requête" && l.path === "/health").level).toBe("debug");
  });

  it("compte les requêtes (sondes exclues) dans les métriques", async () => {
    const metrics = createMetrics();
    const { base } = await demarrer({ metrics, metricsToken: JETON, handler: (_q: any, res: any) => res.end("ok") });
    await fetch(`${base}/a`);
    await fetch(`${base}/b`, { method: "POST", body: "x" });
    await fetch(`${base}/health`);
    await attendre(10);
    const texte = await (await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${JETON}` } })).text();
    expect(texte).toContain('http_requests_total{method="GET",code="200"} 1');
    expect(texte).toContain('http_requests_total{method="POST",code="200"} 1');
    expect(texte).toMatch(/^process_uptime_seconds /m);
  });
});

describe("service-kit/http — délais serveur", () => {
  it("pose headersTimeout, requestTimeout, keepAliveTimeout (défauts du kit)", async () => {
    const { svc } = await demarrer();
    expect(svc.server.headersTimeout).toBe(10_000);
    expect(svc.server.requestTimeout).toBe(30_000);
    expect(svc.server.keepAliveTimeout).toBe(65_000);
  });

  const COURTS = { headersTimeout: 150, requestTimeout: 300, keepAliveTimeout: 150, connectionsCheckingInterval: 25 };

  it("headersTimeout : des en-têtes qui n'en finissent pas → 408 et fermeture", async () => {
    const { port } = await demarrer({ timeouts: COURTS });
    const r = await socketBrute(port, (s) => s.write("GET / HTTP/1.1\r\nHost: x\r\n")); // jamais de ligne vide
    expect(r.ferme).toBe(true);
    expect(r.recu).toMatch(/^HTTP\/1\.1 408 /);
    expect(r.ms).toBeLessThan(1500);
  });

  it("requestTimeout : un corps qui n'arrive jamais → 408 et fermeture", async () => {
    const { port } = await demarrer({
      timeouts: COURTS,
      handler: async (_req: any, res: any, ctx: any) => res.end(String((await ctx.readBody()).length)),
    });
    const r = await socketBrute(port, (s) => s.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nabc"));
    expect(r.ferme).toBe(true);
    expect(r.recu).toMatch(/408/);
    expect(r.ms).toBeLessThan(1500);
  });

  it("keepAliveTimeout : une connexion au repos après sa réponse est fermée", async () => {
    const { port } = await demarrer({ timeouts: COURTS, handler: (_q: any, res: any) => res.end("ok") });
    const r = await socketBrute(port, (s) => s.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
    expect(r.recu).toMatch(/^HTTP\/1\.1 200 /);
    expect(r.ferme).toBe(true);
    expect(r.ms).toBeGreaterThanOrEqual(100);
    expect(r.ms).toBeLessThan(1500);
  });
});

describe("service-kit/http + lifecycle — SIGTERM de bout en bout", () => {
  it("/ready à 503, requête en vol servie, écoute fermée, PUIS pool.end(), puis sortie 0", async () => {
    const proc = new EventEmitter();
    const { log } = journal();
    const etapes: string[] = [];
    const exit = vi.fn((code: number) => etapes.push(`exit:${code}`));
    const lifecycle = installLifecycle({ log, proc: proc as any, exit, env: {}, unreadyDelayMs: 500, drainTimeoutMs: 3000, forceExitMs: 5000 });
    aFermer.push(async () => lifecycle.uninstall());
    lifecycle.onClose("pg", () => etapes.push("pool.end"));

    let relacher!: () => void;
    const verrou = new Promise<void>((r) => (relacher = r));
    const svc = startService({
      name: "e2e",
      log,
      port: 0,
      host: "127.0.0.1",
      metricsToken: JETON,
      lifecycle,
      handler: async (_req: any, res: any) => {
        await verrou;
        res.end("servie jusqu'au bout");
      },
    });
    const { port } = await svc.listening;
    svc.server.on("close", () => etapes.push("écoute fermée"));
    const base = `http://127.0.0.1:${port}`;

    const enVol = fetch(`${base}/lent`).then(async (r) => ({ status: r.status, texte: await r.text(), connexion: r.headers.get("connection") }));
    await attendre(30);
    proc.emit("SIGTERM");

    // Pendant le retrait : le service répond encore, /ready dit 503.
    const ready = await fetch(`${base}/ready`, { headers: { authorization: `Bearer ${JETON}` } });
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: "draining" });
    expect(etapes).toEqual([]);

    // Le retrait passé, l'écoute se ferme ; la requête, elle, est toujours en vol.
    await vi.waitFor(() => expect(fetch(`${base}/health`)).rejects.toThrow(), { timeout: 3000, interval: 50 });
    relacher();
    const r = await enVol;
    expect(r).toEqual({ status: 200, texte: "servie jusqu'au bout", connexion: "close" });

    await lifecycle.shutdown("attente du test");
    expect(etapes).toEqual(["écoute fermée", "pool.end", "exit:0"]);
  });
});
