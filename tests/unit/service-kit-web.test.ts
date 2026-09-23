// @mip/service-kit — web.mjs : aller-retour node:http ↔ Request/Response sur
// un vrai serveur. Méthode, chemin, query, en-têtes répétés, corps en flux,
// cookies multiples, HEAD ; plafond de corps avec et sans Content-Length ;
// signal avorté quand le client part.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { toNodeHandler } from "../../packages/service-kit/web.mjs";

const serveurs: http.Server[] = [];
afterEach(async () => {
  await Promise.all(serveurs.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function servir(gestionnaire: (r: Request) => Response | Promise<Response>, options: Record<string, unknown> = {}) {
  const s = http.createServer(toNodeHandler(gestionnaire, options));
  serveurs.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

/** Requête brute (http.request) : pour maîtriser en-têtes et corps au plus près. */
function brute(url: string, options: http.RequestOptions, ecrire?: (req: http.ClientRequest) => void) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; corps: string }>((resoudre, rejeter) => {
    const req = http.request(url, options, (res) => {
      let corps = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (corps += c));
      res.on("end", () => resoudre({ status: res.statusCode!, headers: res.headers, corps }));
    });
    req.on("error", rejeter);
    if (ecrire) ecrire(req);
    else req.end();
  });
}

describe("service-kit/web — aller-retour", () => {
  it("rend au gestionnaire ce que le client a envoyé, et au client ce que le gestionnaire a rendu", async () => {
    let vu: any = null;
    const base = await servir(async (request) => {
      const url = new URL(request.url);
      vu = {
        method: request.method,
        chemin: url.pathname,
        query: url.searchParams.get("q"),
        custom: request.headers.get("x-mip-app"),
        type: request.headers.get("content-type"),
        corps: await request.json(),
      };
      const flux = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("morceau-1;"));
          c.enqueue(new TextEncoder().encode("morceau-2"));
          c.close();
        },
      });
      const h = new Headers({ "content-type": "text/plain; charset=utf-8", "x-trace": "abc" });
      h.append("set-cookie", "a=1; Path=/");
      h.append("set-cookie", "b=2; Path=/; HttpOnly");
      return new Response(flux, { status: 201, statusText: "Créé", headers: h });
    });

    const r = await fetch(`${base}/v1/traces?q=%C3%A9t%C3%A9`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mip-app": "demo" },
      body: JSON.stringify({ resourceSpans: [], accent: "é" }),
    });
    expect(vu).toEqual({
      method: "POST",
      chemin: "/v1/traces",
      query: "été",
      custom: "demo",
      type: "application/json",
      corps: { resourceSpans: [], accent: "é" },
    });
    expect(r.status).toBe(201);
    expect(r.headers.get("x-trace")).toBe("abc");
    // deux Set-Cookie DISTINCTS, pas fusionnés par une virgule
    expect(r.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/; HttpOnly"]);
    expect(await r.text()).toBe("morceau-1;morceau-2");
  });

  it("HEAD : en-têtes sans corps ; GET : pas de corps côté Request", async () => {
    let corpsVu: unknown = "non lu";
    const base = await servir((request) => {
      corpsVu = request.body;
      return new Response("contenu", { headers: { "x-ok": "1" } });
    });
    const r = await brute(`${base}/x`, { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.headers["x-ok"]).toBe("1");
    expect(r.corps).toBe("");
    expect(corpsVu).toBeNull();
  });

  it("une cible `//autre/x` reste un chemin : jamais un changement d'hôte", async () => {
    let url = "";
    const base = await servir((request) => {
      url = request.url;
      return new Response(null, { status: 204 });
    });
    await brute(`${base}//autre.example/x`, { method: "GET", path: "//autre.example/x" });
    expect(new URL(url).hostname).toBe("127.0.0.1");
    expect(new URL(url).pathname).toBe("//autre.example/x");
  });

  it("en-têtes de saut filtrés au retour (un fetch relayé ne ment pas sur la connexion)", async () => {
    const base = await servir(() => new Response("x", { headers: { "keep-alive": "timeout=99", "x-garde": "1" } }));
    const r = await brute(`${base}/`, { method: "GET" });
    expect(r.headers["keep-alive"]).not.toBe("timeout=99");
    expect(r.headers["x-garde"]).toBe("1");
  });
});

describe("service-kit/web — plafond de corps", () => {
  it("413 d'après Content-Length, sans appeler le gestionnaire", async () => {
    let appele = false;
    const base = await servir(
      () => {
        appele = true;
        return new Response("ok");
      },
      { maxBodyBytes: 100 },
    );
    const r = await brute(`${base}/`, { method: "POST", headers: { "content-length": "5000" } }, (req) => req.flushHeaders());
    expect(r.status).toBe(413);
    expect(JSON.parse(r.corps)).toEqual({ error: "payload_too_large", limit: 100 });
    expect(r.headers.connection).toBe("close");
    expect(appele).toBe(false);
  });

  it("413 SANS Content-Length (chunked), même si le gestionnaire avale l'erreur et répond 400", async () => {
    const base = await servir(
      async (request) => {
        try {
          await request.arrayBuffer();
          return new Response("lu en entier ?!");
        } catch {
          return new Response("corps illisible", { status: 400 });
        }
      },
      { maxBodyBytes: 1024 },
    );
    const r = await brute(`${base}/`, { method: "POST", headers: { "transfer-encoding": "chunked" } }, (req) => {
      req.write(Buffer.alloc(2048, 1)); // un seul envoi, au-delà du plafond ; on n'écrit plus rien ensuite
    });
    expect(r.status).toBe(413);
  });

  it("un corps sous le plafond passe, et la borne peut dépendre de la route", async () => {
    const base = await servir(async (request) => new Response(String((await request.arrayBuffer()).byteLength)), {
      maxBodyBytes: (req: http.IncomingMessage) => (req.url?.startsWith("/v1/sourcemaps") ? 4096 : 16),
    });
    const petit = await fetch(`${base}/v1/traces`, { method: "POST", body: "x".repeat(16) });
    expect(await petit.text()).toBe("16");
    const gros = await fetch(`${base}/v1/sourcemaps`, { method: "POST", body: "x".repeat(4000) });
    expect(await gros.text()).toBe("4000");
    const refuse = await brute(`${base}/v1/traces`, { method: "POST", headers: { "content-length": "17" } }, (req) => req.flushHeaders());
    expect(refuse.status).toBe(413);
  });
});

describe("service-kit/web — corps non lu, connexion keep-alive", () => {
  /** Deux requêtes sur LA MÊME socket : la seconde n'est lue que si la première a été vidée. */
  async function deuxRequetesSurUneSocket(base: string, taille: number) {
    const port = Number(new URL(base).port);
    const net = await import("node:net");
    return new Promise<string>((resoudre, rejeter) => {
      const s = net.connect(port, "127.0.0.1");
      let recu = "";
      const garde = setTimeout(() => {
        s.destroy();
        resoudre(recu);
      }, 2000);
      s.on("data", (d) => {
        recu += d.toString("latin1");
        if ((recu.match(/HTTP\/1\.1 200/g) ?? []).length === 2) {
          clearTimeout(garde);
          s.destroy();
          resoudre(recu);
        }
      });
      s.on("error", rejeter);
      s.on("connect", () => {
        s.write(`POST /un HTTP/1.1\r\nHost: x\r\nContent-Length: ${taille}\r\n\r\n`);
        s.write(Buffer.alloc(taille, 0x61));
        s.write("GET /deux HTTP/1.1\r\nHost: x\r\n\r\n");
      });
    });
  }

  it("un gestionnaire qui IGNORE le corps ne bloque pas la requête suivante", async () => {
    const base = await servir((request) => new Response(new URL(request.url).pathname), { maxBodyBytes: 1024 * 1024 });
    const recu = await deuxRequetesSurUneSocket(base, 200_000);
    expect(recu.match(/HTTP\/1\.1 200/g)).toHaveLength(2);
    expect(recu).toContain("/deux");
  });

  it("un gestionnaire qui ANNULE le corps : ni exception, ni connexion bloquée", async () => {
    const base = await servir(
      async (request) => {
        await request.body?.cancel();
        return new Response(new URL(request.url).pathname);
      },
      { maxBodyBytes: 1024 * 1024 },
    );
    const recu = await deuxRequetesSurUneSocket(base, 200_000);
    expect(recu.match(/HTTP\/1\.1 200/g)).toHaveLength(2);
  });
});

describe("service-kit/web — erreurs et abandon", () => {
  it("gestionnaire qui lève → 500 sans pile ; qui ne rend pas une Response → 500", async () => {
    const erreurs: unknown[] = [];
    const log = { error: (_m: string, c: any) => erreurs.push(c.err ?? c), info() {}, warn() {}, debug() {} };
    const base = await servir(
      (request) => {
        if (new URL(request.url).pathname === "/leve") throw new Error("détail interne à ne pas montrer");
        return "pas une Response" as any;
      },
      { log },
    );
    const r1 = await brute(`${base}/leve`, { method: "GET" });
    expect(r1.status).toBe(500);
    expect(r1.corps).not.toContain("détail interne");
    const r2 = await brute(`${base}/autre`, { method: "GET" });
    expect(r2.status).toBe(500);
    expect(erreurs).toHaveLength(2);
  });

  it("request.signal avorte quand le client part avant la réponse", async () => {
    let signalVu: AbortSignal | null = null;
    let avorte!: () => void;
    const avortement = new Promise<void>((r) => (avorte = r));
    const base = await servir(async (request) => {
      signalVu = request.signal;
      request.signal.addEventListener("abort", () => avorte());
      await new Promise((r) => setTimeout(r, 2000));
      return new Response("trop tard");
    });
    const ctrl = new AbortController();
    const p = fetch(`${base}/lent`, { signal: ctrl.signal }).catch(() => "annulé");
    await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    expect(await p).toBe("annulé");
    await avortement;
    expect(signalVu!.aborted).toBe(true);
  });
});
