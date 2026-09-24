// safe-fetch — les sorties HTTP vers une URL saisie par un utilisateur (P1).
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Qu'une sonde uptime ou un webhook atteigne les métadonnées cloud
//     (169.254.169.254), sous sa forme littérale ou déguisée en IPv6 mappée ;
//   - qu'un nom public qui résout vers la boucle locale ou un réseau privé passe,
//     y compris quand UNE seule des adresses rendues est interdite ;
//   - qu'une redirection mène là où l'URL de départ n'aurait pas pu aller ;
//   - qu'un second appel DNS, entre la vérification et la connexion, puisse
//     changer la destination (DNS rebinding) ;
//   - que le réseau privé Railway (`*.railway.internal`, fc00::/7) soit joignable.
//
// AUCUN RÉSEAU RÉEL. Le résolveur est injecté ; le « serveur distant » écoute sur
// 127.0.0.1, que la politique de TEST admet (et elle seule) — c'est précisément
// ce qui prouve l'épinglage : les noms `*.exemple.test` n'existent dans aucun DNS,
// une connexion qui aboutit n'a donc pu passer que par l'adresse vérifiée.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ErreurCibleRefusee,
  MAX_REDIRECTIONS,
  motifAdresseInterdite,
  motifDeRefus,
  safeFetch,
  verifierCible,
  verifierUrlSortante,
} from "../../packages/backend/lib/net/safe-fetch.mjs";

type Adresse = { address: string; family: number };
const resolveur = (table: Record<string, string | string[]>) =>
  vi.fn(async (nom: string): Promise<Adresse[]> => {
    const valeur = table[nom];
    if (!valeur) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${nom}`), { code: "ENOTFOUND" });
    return (Array.isArray(valeur) ? valeur : [valeur]).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  });

/** La politique réelle, sauf 127.0.0.1 : le seul écart, pour joindre le serveur de test. */
const politiqueDeTest = (adresse: string) => (adresse === "127.0.0.1" ? null : motifAdresseInterdite(adresse));

async function refus(promesse: Promise<unknown>): Promise<ErreurCibleRefusee> {
  const err = await promesse.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ErreurCibleRefusee);
  return err as ErreurCibleRefusee;
}

let serveur: Server;
let port = 0;
const recues: { url: string; method: string; host: string; corps: string; auth: string | null }[] = [];

beforeAll(async () => {
  serveur = createServer((req: IncomingMessage, res: ServerResponse) => {
    let corps = "";
    req.on("data", (m) => (corps += m));
    req.on("end", () => {
      recues.push({
        url: req.url ?? "",
        method: req.method ?? "",
        host: req.headers.host ?? "",
        corps,
        auth: req.headers.authorization ?? null,
      });
      const u = new URL(req.url ?? "/", "http://x");
      if (u.pathname === "/ok") {
        res.writeHead(200, { "content-type": "text/plain" }).end("pong");
      } else if (u.pathname === "/vers") {
        res.writeHead(Number(u.searchParams.get("code") ?? 302), { location: u.searchParams.get("cible") ?? "/" }).end();
      } else if (u.pathname === "/chaine") {
        // /chaine?n=3 → /chaine?n=2 → … → /ok : n redirections.
        const n = Number(u.searchParams.get("n"));
        res.writeHead(302, { location: n > 1 ? `/chaine?n=${n - 1}` : "/ok" }).end();
      } else if (u.pathname === "/muet") {
        // Ne répond jamais : le délai doit trancher.
      } else if (u.pathname === "/deluge") {
        res.writeHead(200);
        res.end(Buffer.alloc(64 * 1024, 0x61));
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  port = (serveur.address() as AddressInfo).port;
});

afterAll(async () => {
  serveur.closeAllConnections();
  await new Promise<void>((ok) => serveur.close(() => ok()));
});

describe("verifierUrlSortante — ce qui est refusé sans réseau (et à l'écriture)", () => {
  it("refuse 169.254.169.254, l'adresse des métadonnées cloud", () => {
    expect(verifierUrlSortante("http://169.254.169.254/latest/meta-data/")).toMatchObject({ ok: false, code: "ip_litterale" });
  });

  it("refuse la même adresse déguisée en IPv6 mappée, http://[::ffff:169.254.169.254]", () => {
    expect(verifierUrlSortante("http://[::ffff:169.254.169.254]/")).toMatchObject({ ok: false, code: "ip_litterale" });
  });

  it("refuse 10.0.0.1 et toute IP littérale, écritures détournées comprises", () => {
    for (const url of [
      "http://10.0.0.1/",
      "https://10.0.0.1:8443/hook",
      "http://2130706433/", // 127.0.0.1 en décimal
      "http://0x7f.1/", // 127.0.0.1 en hexadécimal abrégé
      "http://127.1/",
      "http://[::1]/",
      "http://[fd12:3456::1]/",
      "http://8.8.8.8/", // publique, mais littérale : une cible légitime a un nom
    ]) {
      expect(verifierUrlSortante(url), url).toMatchObject({ ok: false, code: "ip_litterale" });
    }
  });

  it("refuse *.railway.internal et les autres noms qui ne peuvent pas être publics", () => {
    for (const url of [
      "http://postgres.railway.internal:5432/",
      "http://collector.railway.internal./v1/traces", // point final
      "http://RAILWAY.INTERNAL/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://localhost:3000/",
      "http://api.localhost/",
      "http://imprimante.local/",
      "http://routeur.home.arpa/",
      "http://redis:6379/", // nom sans domaine : un service voisin sous Docker
    ]) {
      expect(verifierUrlSortante(url), url).toMatchObject({ ok: false, code: "hote_interne" });
    }
  });

  it("refuse les autres protocoles, les identifiants et l'illisible, avec un message pour chacun", () => {
    expect(verifierUrlSortante("file:///etc/passwd")).toMatchObject({ ok: false, code: "protocole" });
    expect(verifierUrlSortante("gopher://exemple.fr/")).toMatchObject({ ok: false, code: "protocole" });
    expect(verifierUrlSortante("https://moi:secret@exemple.fr/")).toMatchObject({ ok: false, code: "identifiants" });
    expect(verifierUrlSortante("pas une url")).toMatchObject({ ok: false, code: "url_invalide" });
    expect(verifierUrlSortante(null)).toMatchObject({ ok: false, code: "url_invalide" });
    for (const code of ["url_invalide", "protocole", "identifiants", "ip_litterale", "hote_interne"]) {
      expect(motifDeRefus(code)).toMatch(/\S/);
    }
    // Un code inconnu ne rend rien : la console n'affiche jamais un texte venu de l'URL.
    expect(motifDeRefus("<script>")).toBeNull();
    expect(motifDeRefus("toString")).toBeNull();
  });

  it("accepte une URL publique ordinaire", () => {
    const verdict = verifierUrlSortante("  https://hooks.slack.com/services/T0/B0/xyz  ");
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.url.hostname).toBe("hooks.slack.com");
  });
});

describe("motifAdresseInterdite — les plages", () => {
  it("interdit les plages du plan, IPv4 et IPv6", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.4",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "100.127.255.254",
      "0.0.0.0",
      "0.1.2.3",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "::ffff:169.254.169.254",
      "::ffff:8.8.8.8", // mappée : refusée d'office, même vers une IPv4 publique
      "fc00::1",
      "fd12:3456:789a::1", // ULA : le réseau privé Railway
      "fe80::1",
      "fe80::1%eth0",
      "64:ff9b::a9fe:a9fe", // NAT64 vers 169.254.169.254
      "2002:a9fe:a9fe::1", // 6to4 vers 169.254.169.254
      "2001:0:4136:e378::1", // Teredo
    ]) {
      expect(motifAdresseInterdite(ip), ip).not.toBeNull();
    }
  });

  it("laisse passer les adresses publiques, bornes des plages comprises", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "100.63.255.255", // juste avant le CGNAT
      "100.128.0.0", // juste après
      "172.15.255.255",
      "172.32.0.0",
      "169.253.255.255",
      "11.0.0.0",
      "2606:4700:4700::1111",
      "2a00:1450:4007:80e::200e",
      "64:ff9b::808:808", // NAT64 vers 8.8.8.8
    ]) {
      expect(motifAdresseInterdite(ip), ip).toBeNull();
    }
  });

  it("interdit ce qui n'est pas une adresse", () => {
    expect(motifAdresseInterdite("exemple.fr")).not.toBeNull();
    expect(motifAdresseInterdite("")).not.toBeNull();
  });
});

describe("verifierCible — toutes les adresses résolues", () => {
  it("refuse un nom public qui résout vers 127.0.0.1", async () => {
    const resoudre = resolveur({ "piege.exemple.test": "127.0.0.1" });
    const err = await refus(verifierCible("http://piege.exemple.test/", { resoudre }));
    expect(err.code).toBe("adresse_interdite");
    expect(err.message).toMatch(/boucle locale/);
    // L'adresse elle-même n'est jamais recopiée dans le message affiché.
    expect(err.message).not.toContain("127.0.0.1");
    expect(resoudre).toHaveBeenCalledWith("piege.exemple.test");
  });

  it("refuse dès qu'UNE adresse est interdite, même rendue en second", async () => {
    const resoudre = resolveur({ "double.exemple.test": ["93.184.215.14", "10.1.2.3"] });
    expect((await refus(verifierCible("https://double.exemple.test/", { resoudre }))).code).toBe("adresse_interdite");
  });

  it("refuse une réponse AAAA en IPv4 mappée ou en ULA", async () => {
    const resoudre = resolveur({ "v6.exemple.test": "::ffff:169.254.169.254", "ula.exemple.test": "fd00::5" });
    expect((await refus(verifierCible("http://v6.exemple.test/", { resoudre }))).code).toBe("adresse_interdite");
    expect((await refus(verifierCible("http://ula.exemple.test/", { resoudre }))).code).toBe("adresse_interdite");
  });

  it("ne consulte pas le DNS pour un refus statique", async () => {
    const resoudre = resolveur({});
    await refus(verifierCible("http://api.railway.internal/", { resoudre }));
    await refus(verifierCible("http://169.254.169.254/", { resoudre }));
    expect(resoudre).not.toHaveBeenCalled();
  });

  it("rend les adresses vérifiées d'un nom public", async () => {
    const resoudre = resolveur({ "api.exemple.test": ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"] });
    const cible = await verifierCible("https://api.exemple.test/v1", { resoudre });
    expect(cible.adresses).toEqual([
      { address: "93.184.215.14", family: 4 },
      { address: "2606:2800:21f:cb07:6820:80da:af6b:8b2c", family: 6 },
    ]);
  });
});

describe("safeFetch — requête épinglée, redirections revalidées", () => {
  const base = () => `http://service.exemple.test:${port}`;

  it("cas nominal : GET par le nom, connexion sur l'adresse vérifiée, une seule résolution", async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1" });
    const res = await safeFetch(`${base()}/ok`, { resoudre, adresseRefusee: politiqueDeTest });
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("pong");
    expect(res.redirected).toBe(false);
    // Le nom reste l'hôte de la requête (Host, SNI) : seule la connexion est épinglée.
    expect(recues.at(-1)?.host).toBe(`service.exemple.test:${port}`);
    expect(resoudre).toHaveBeenCalledTimes(1);
  });

  it("POST d'un webhook : méthode, corps et en-têtes transmis", async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1" });
    const res = await safeFetch(`${base()}/ok`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "alerte" }),
      resoudre,
      adresseRefusee: politiqueDeTest,
    });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    expect(recues.at(-1)).toMatchObject({ method: "POST", corps: '{"text":"alerte"}' });
  });

  it("DNS rebinding : la seconde réponse du DNS n'est jamais consultée", async () => {
    // Un DNS hostile : 127.0.0.1 (admis ici) à la vérification, puis 10.0.0.1.
    let appels = 0;
    const resoudre = vi.fn(async () => [{ address: ++appels === 1 ? "127.0.0.1" : "10.0.0.1", family: 4 }]);
    const res = await safeFetch(`${base()}/ok`, { resoudre, adresseRefusee: politiqueDeTest });
    expect(await res.text()).toBe("pong");
    expect(resoudre).toHaveBeenCalledTimes(1);
  });

  it("refuse une redirection vers une IP privée littérale", async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1" });
    const cible = encodeURIComponent("http://10.0.0.1/admin");
    const err = await refus(safeFetch(`${base()}/vers?cible=${cible}`, { resoudre, adresseRefusee: politiqueDeTest }));
    expect(err.code).toBe("ip_litterale");
  });

  it("refuse une redirection vers un nom qui résout vers une IP privée", async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1", "interne.exemple.test": "10.0.0.1" });
    const cible = encodeURIComponent("http://interne.exemple.test/");
    const err = await refus(safeFetch(`${base()}/vers?code=307&cible=${cible}`, { resoudre, adresseRefusee: politiqueDeTest }));
    expect(err.code).toBe("adresse_interdite");
    expect(resoudre).toHaveBeenCalledWith("interne.exemple.test");
  });

  it("refuse une redirection vers les métadonnées et vers *.railway.internal", async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1" });
    for (const [destination, code] of [
      ["http://[::ffff:169.254.169.254]/latest/meta-data/", "ip_litterale"],
      ["http://postgres.railway.internal:5432/", "hote_interne"],
    ]) {
      const cible = encodeURIComponent(destination);
      const err = await refus(safeFetch(`${base()}/vers?cible=${cible}`, { resoudre, adresseRefusee: politiqueDeTest }));
      expect(err.code, destination).toBe(code);
    }
  });

  it(`suit ${MAX_REDIRECTIONS} redirections, refuse la suivante`, async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1" });
    const res = await safeFetch(`${base()}/chaine?n=${MAX_REDIRECTIONS}`, { resoudre, adresseRefusee: politiqueDeTest });
    expect(res.status).toBe(200);
    expect(res.redirected).toBe(true);
    expect(res.url).toBe(`${base()}/ok`);
    await res.body?.cancel();
    const err = await refus(
      safeFetch(`${base()}/chaine?n=${MAX_REDIRECTIONS + 1}`, { resoudre, adresseRefusee: politiqueDeTest }),
    );
    expect(err.code).toBe("redirections");
  });

  it("303 et 302 d'un POST repartent en GET sans corps ; l'autorisation ne change pas d'origine", async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1", "autre.exemple.test": "127.0.0.1" });
    const cible = encodeURIComponent(`http://autre.exemple.test:${port}/ok`);
    const res = await safeFetch(`${base()}/vers?code=303&cible=${cible}`, {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: "x=1",
      resoudre,
      adresseRefusee: politiqueDeTest,
    });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    expect(recues.at(-1)).toMatchObject({ method: "GET", corps: "", auth: null, host: `autre.exemple.test:${port}` });
  });

  it("redirect: manual rend la 3xx telle quelle", async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1" });
    const res = await safeFetch(`${base()}/vers?cible=%2Fok`, { resoudre, adresseRefusee: politiqueDeTest, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/ok");
  });

  it("le délai tranche une cible qui ne répond pas (AbortSignal.timeout)", async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1" });
    const debut = Date.now();
    const err = await safeFetch(`${base()}/muet`, { resoudre, adresseRefusee: politiqueDeTest, timeoutMs: 150 }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.name).toBe("TimeoutError");
    expect(Date.now() - debut).toBeLessThan(2_000);
  });

  it("le corps lu est plafonné", async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1" });
    const res = await safeFetch(`${base()}/deluge`, { resoudre, adresseRefusee: politiqueDeTest, maxCorpsOctets: 1024 });
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  it("sans politique de test, la boucle locale est refusée — même par un nom", async () => {
    const resoudre = resolveur({ "service.exemple.test": "127.0.0.1" });
    const avant = recues.length;
    expect((await refus(safeFetch(`${base()}/ok`, { resoudre }))).code).toBe("adresse_interdite");
    expect(recues.length).toBe(avant);
  });

  it("refuse avant tout réseau les cibles SSRF classiques", async () => {
    const resoudre = resolveur({});
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://[::ffff:169.254.169.254]/",
      "http://10.0.0.1/",
      "http://api.railway.internal/",
    ]) {
      await refus(safeFetch(url, { resoudre }));
    }
    expect(resoudre).not.toHaveBeenCalled();
  });
});
