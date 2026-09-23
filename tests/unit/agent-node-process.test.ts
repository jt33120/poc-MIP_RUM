// P5.3 — l'agent Node dans de VRAIS processus : sort de l'application inchangé,
// exceptions de requête émises avec leur stack, sans mélange entre requêtes.
//
// Ce que ce fichier prouve ne se voit pas dans core.ts : qu'un crash reste un
// crash (même code de sortie, même message de Node), qu'une application qui
// survit à ses exceptions en voit partir le span et le log avec la même identité,
// et que deux requêtes concurrentes ne se prêtent ni leur trace ni leur exception.
// L'agent est construit par esbuild depuis ses sources, comme `pnpm build`.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp, flattenOtlpLogs } from "../../packages/backend/shared/otlp.mjs";

type Attribut = { key: string; value: Record<string, unknown> };
type Payload = {
  resourceSpans?: Array<{ scopeSpans: Array<{ spans: Array<Record<string, unknown>> }> }>;
  resourceLogs?: Array<{ scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }> }>;
};

const RACINE = join(__dirname, "..", "..");
const dossier = mkdtempSync(join(tmpdir(), "mip-agent-node-"));
const AGENT = join(dossier, "register.js");
const API = join(dossier, "index.js");
const recus: Payload[] = [];
let collecteur: Server;
let endpoint = "";

const attrs = (liste: Attribut[]) => Object.fromEntries(liste.map((a) => [a.key, Object.values(a.value)[0]]));
const spans = () => recus.flatMap((p) => p.resourceSpans ?? []).flatMap((r) => r.scopeSpans).flatMap((s) => s.spans);
const logs = () => recus.flatMap((p) => p.resourceLogs ?? []).flatMap((r) => r.scopeLogs).flatMap((s) => s.logRecords);

interface Sortie {
  code: number | null;
  /** Non nul quand le processus a été terminé PAR un signal (et non par exit). */
  signal: string | null;
  stdout: string;
  stderr: string;
}

/** Lance `code` (CommonJS) sous l'agent, ou sans lui, et attend la fin du processus. */
function lancer(
  nom: string,
  code: string,
  avecAgent = true,
  options: { env?: Record<string, string>; auDemarrage?: (enfant: ReturnType<typeof spawn>) => void } = {},
): Promise<Sortie> {
  const fichier = join(dossier, `${nom}-${avecAgent ? "agent" : "nu"}.cjs`);
  writeFileSync(fichier, code.replaceAll("<API>", JSON.stringify(API)));
  const enfant = spawn(process.execPath, [...(avecAgent ? ["-r", AGENT] : []), fichier], {
    env: {
      PATH: process.env.PATH,
      MIP_RUM_ENDPOINT: endpoint,
      MIP_RUM_APP_ID: "agent-process",
      MIP_RUM_FLUSH_MS: "50",
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  enfant.stdout.on("data", (c) => (stdout += c));
  enfant.stderr.on("data", (c) => (stderr += c));
  options.auDemarrage?.(enfant);
  return new Promise((resolve) =>
    enfant.on("close", (code, signal) => resolve({ code, signal, stdout, stderr })),
  );
}

/**
 * Le message de crash de Node jusqu'à la première frame : ligne source fautive,
 * curseur et exception. Les frames, elles, montrent légitimement les fonctions
 * patchées par l'agent (`emit`, `_load`) : c'est le message qu'on compare.
 */
function crash(sortie: Sortie): string {
  const lignes = sortie.stderr.replaceAll(dossier, "<dossier>").replace(/-(agent|nu)\.cjs/g, ".cjs").split("\n");
  const frame = lignes.findIndex((ligne) => /^\s+at /.test(ligne));
  return (frame < 0 ? lignes : lignes.slice(0, frame)).join("\n");
}

beforeAll(async () => {
  const { build } = createRequire(join(RACINE, "packages", "agent-node", "package.json"))("esbuild");
  // Les DEUX entrées, séparément, comme `pnpm build` : c'est cette séparation
  // qui rend le rendez-vous par symbole global nécessaire — et testable.
  for (const [entree, sortie] of [["register", AGENT], ["index", API]] as const) {
    await build({
      entryPoints: [join(RACINE, "packages", "agent-node", "src", `${entree}.ts`)],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node18",
      outfile: sortie,
      logLevel: "silent",
    });
  }
  collecteur = createServer((req, res) => {
    let corps = "";
    req.on("data", (c) => (corps += c));
    req.on("end", () => {
      recus.push(JSON.parse(corps));
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => collecteur.listen(0, "127.0.0.1", resolve));
  const adresse = collecteur.address();
  if (!adresse || typeof adresse === "string") throw new Error("collecteur indisponible");
  endpoint = `http://127.0.0.1:${adresse.port}/v1/traces`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => collecteur.close(() => resolve()));
  rmSync(dossier, { recursive: true, force: true });
});

describe("agent Node — le sort de l'application ne change pas", () => {
  const cas: Array<[string, string, number]> = [
    ["exception au démarrage", `throw new TypeError("démarrage impossible");`, 1],
    ["rejet non géré", `Promise.reject(new RangeError("rejet oublié"));`, 1],
    ["gestionnaire HTTP qui lève", `
      const http = require("node:http");
      const serveur = http.createServer((req) => { throw new SyntaxError("route " + req.url); });
      serveur.listen(0, "127.0.0.1", () => {
        http.get({ host: "127.0.0.1", port: serveur.address().port, path: "/boom" }).on("error", () => {});
      });`, 1],
    ["code de sortie applicatif", `process.exitCode = 3;`, 3],
  ];

  it.each(cas)("%s : même code de sortie et même message que sans l'agent", async (nom, code, attendu) => {
    const [nu, instrumente] = await Promise.all([lancer(nom, code, false), lancer(nom, code)]);
    expect(nu.code).toBe(attendu);
    expect(instrumente.code).toBe(attendu);
    // Le message de crash pointe toujours la ligne de l'application, jamais l'agent.
    expect(crash(instrumente)).toBe(crash(nu));
    expect(crash(instrumente)).not.toContain("register.js");
  }, 30_000);
});

describe("agent Node — exceptions de requête", () => {
  it("application qui survit : span porteur de l'exception et log avec la même identité", async () => {
    recus.length = 0;
    const sortie = await lancer("survivante", `
      const http = require("node:http");
      process.on("uncaughtException", (err) => { console.error("rattrapée", err); });
      const serveur = http.createServer((req, res) => {
        if (req.url === "/boom") throw new TypeError("total indéfini");
        res.end("ok");
      });
      serveur.listen(0, "127.0.0.1", () => {
        const port = serveur.address().port;
        const req = http.get({
          host: "127.0.0.1", port, path: "/boom",
          headers: { traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" },
        });
        req.on("error", () => {});
        // Sans réponse, le client abandonne : la fermeture émet le span.
        setTimeout(() => req.destroy(), 150);
        setTimeout(() => process.exit(0), 1_000);
      });`);
    expect(sortie.code).toBe(0);
    expect(sortie.stderr).toContain("rattrapée");

    const [span] = spans().filter((s) => s.name === "http.server");
    expect(span).toMatchObject({ traceId: "0af7651916cd43dd8448eb211c80319c", parentSpanId: "b7ad6b7169203331", status: { code: 2 } });
    // Aucune réponse n'est partie : pas de statut HTTP inventé.
    expect(attrs(span.attributes as Attribut[])).not.toHaveProperty("http.status_code");
    const [evenement] = span.events as Array<{ name: string; attributes: Attribut[] }>;
    const exception = attrs(evenement.attributes);
    expect(evenement.name).toBe("exception");
    expect(exception).toMatchObject({
      "exception.type": "TypeError",
      "exception.message": "total indéfini",
      "mip.error_handled": false,
    });
    expect(exception["exception.stacktrace"]).toContain("survivante-agent.cjs");
    // Le handler applicatif existait : la fin du processus n'était pas certaine.
    expect(exception).not.toHaveProperty("mip.error_fatal");

    const [log] = logs().filter((l) => attrs(l.attributes as Attribut[])["exception.type"]);
    expect(attrs(log.attributes as Attribut[])["mip.exception_id"]).toBe(exception["mip.exception_id"]);

    // À l'ingestion : deux signaux, une seule identité.
    const deSpan = recus.filter((p) => p.resourceSpans).flatMap((p) => flattenOtlp(p).errors);
    const deLog = recus.filter((p) => p.resourceLogs).flatMap((p) => flattenOtlpLogs(p).errors);
    expect(deSpan).toHaveLength(1);
    expect(deLog).toHaveLength(1);
    expect(deLog[0].span_id).toBe(deSpan[0].span_id);
    expect(deSpan[0]).toMatchObject({ error_source: "node", trace_id: "0af7651916cd43dd8448eb211c80319c" });
  }, 30_000);

  it("requêtes concurrentes : chaque exception reste dans sa trace", async () => {
    recus.length = 0;
    const sortie = await lancer("concurrentes", `
      const http = require("node:http");
      const serveur = http.createServer((req, res) => {
        const n = Number(req.url.slice(1));
        // Délais croisés : la requête 1 finit après la 2, dans le même processus.
        setTimeout(() => {
          console.error("échec requête", new Error("requête " + n));
          res.statusCode = 500;
          res.end();
        }, n === 1 ? 120 : 20);
      });
      serveur.listen(0, "127.0.0.1", () => {
        const port = serveur.address().port;
        let restantes = 2;
        for (const n of [1, 2]) {
          http.get({
            host: "127.0.0.1", port, path: "/" + n,
            headers: { traceparent: "00-" + String(n).repeat(32) + "-" + String(n).repeat(16) + "-01" },
          }, (res) => { res.resume(); if (--restantes === 0) setTimeout(() => process.exit(0), 600); });
        }
      });`);
    expect(sortie.code).toBe(0);

    const parTrace = new Map(logs()
      .filter((l) => attrs(l.attributes as Attribut[])["exception.type"])
      .map((l) => [l.traceId, attrs(l.attributes as Attribut[])["exception.message"]]));
    expect(parTrace).toEqual(new Map([["1".repeat(32), "requête 1"], ["2".repeat(32), "requête 2"]]));
    // Les spans des deux requêtes portent leur propre trace et leur statut réel.
    expect(spans().filter((s) => s.name === "http.server").map((s) => [s.traceId, attrs(s.attributes as Attribut[])["http.status_code"]]).sort())
      .toEqual([["1".repeat(32), "500"], ["2".repeat(32), "500"]]);
  }, 30_000);

  it("un console.error texte reste un log sans exception", async () => {
    recus.length = 0;
    const sortie = await lancer("texte", `
      console.error("paiement refusé pour la commande 4711");
      setTimeout(() => process.exit(0), 600);`);
    expect(sortie.code).toBe(0);
    const [log] = logs();
    expect(Object.keys(attrs(log.attributes as Attribut[])).filter((k) => k.startsWith("exception."))).toEqual([]);
  }, 30_000);
});

// ───────────────────── P7.4 : API publique dans un vrai processus ─────────────

describe("agent Node — API publique et préchargement partagent UN runtime", () => {
  it("un seul patch, un seul contexte : l'API voit la requête que l'agent instrumente", async () => {
    recus.length = 0;
    const sortie = await lancer("api", `
      // L'agent est DÉJÀ préchargé (-r register.js) ; l'application importe en
      // plus l'API publique, qui est un autre bundle du même runtime.
      const mip = require(<API>);
      const http = require("node:http");
      const serveur = http.createServer((req, res) => {
        const contexte = mip.getContext();
        console.log("CONTEXTE " + JSON.stringify({ trace: contexte && contexte.traceId, session: contexte && contexte.sessionId }));
        mip.withContext({ userId: "u-42", attributes: { canal: "web" } }, () => {
          mip.track("commande_validee", { montant: 42 });
          mip.captureException(new RangeError("stock insuffisant"), { article: "A-1" });
        });
        res.end("ok");
      });
      serveur.listen(0, "127.0.0.1", () => {
        http.get({
          host: "127.0.0.1", port: serveur.address().port, path: "/commandes",
          headers: {
            traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
            tracestate: "mip=s:sess-9",
          },
        }, (res) => {
          res.resume();
          res.on("end", async () => {
            // Arrêt explicite et borné, puis fin normale du processus.
            await mip.flush({ timeoutMs: 1000 });
            console.log("DIAG " + JSON.stringify(mip.getDiagnostics()));
            await mip.shutdown({ timeoutMs: 1000 });
            process.exit(0);
          });
        });
      });`);
    expect(sortie.code).toBe(0);
    // Le contexte de la requête, lu depuis l'API : même ALS que l'instrumentation.
    expect(sortie.stdout).toContain('CONTEXTE {"trace":"0af7651916cd43dd8448eb211c80319c","session":"sess-9"}');
    const diagnostics = JSON.parse(sortie.stdout.split("DIAG ")[1].split("\n")[0]);
    expect(diagnostics).toMatchObject({ enabled: true, installed: true, droppedSpans: 0 });

    const requetes = spans().filter((s) => s.name === "http.server");
    const evenements = spans().filter((s) => String(s.name).startsWith("track."));
    // Un seul patch de http : une requête, un span. Idem pour l'événement.
    expect(requetes).toHaveLength(1);
    expect(evenements).toHaveLength(1);
    expect(evenements[0].parentSpanId).toBe(requetes[0].spanId);

    const aRequete = attrs(requetes[0].attributes as Attribut[]);
    expect(JSON.parse(String(aRequete["mip.context"]))).toEqual({ canal: "web", article: "A-1" });
    expect(aRequete["mip.identity.user_id"]).toBe("u-42");
    // Exception capturée puis traitée : la réponse 200 est partie, le span
    // garde son statut OK — la requête n'a pas échoué.
    expect(requetes[0].status).toEqual({ code: 1 });
    const [evenement] = requetes[0].events as Array<{ name: string; attributes: Attribut[] }>;
    expect(attrs(evenement.attributes)).toMatchObject({
      "exception.type": "RangeError",
      "mip.error_handled": true,
    });

    // À l'ingestion : l'événement métier devient un rum_event porté par la
    // session propagée, et l'exception une erreur avec son contexte.
    const collections = recus.filter((p) => p.resourceSpans).map((p) => flattenOtlp(p));
    expect(collections.flatMap((c) => c.rejected)).toEqual(collections.map(() => 0));
    const events = collections.flatMap((c) => c.events);
    expect(events).toHaveLength(1);
    // Aucune session revendiquée par le backend : le front reste seul maître de
    // `rum_session`. Le lien vers la session passe par la trace du span parent,
    // qui la porte — et aucune ligne de session n'est écrite depuis ici.
    expect(events[0]).toMatchObject({ name: "commande_validee", session_id: null, event_type: "custom" });
    expect(events[0].props).toEqual({ montant: 42 });
    expect(collections.flatMap((c) => c.sessions)).toEqual([]);
    const erreurs = collections.flatMap((c) => c.errors);
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toMatchObject({ error_source: "node", handled: true, session_claim: "sess-9" });
  }, 30_000);
});

describe("agent Node — arrêt borné, jamais d'attente indéfinie", () => {
  it("SIGTERM : le processus se termine sous le budget, même collecteur muet", async () => {
    // Collecteur qui accepte la connexion et ne répond JAMAIS : sans borne,
    // l'envoi d'arrêt tiendrait le processus jusqu'au SIGKILL.
    const muet = createServer(() => {});
    await new Promise<void>((resolve) => muet.listen(0, "127.0.0.1", resolve));
    const adresse = muet.address();
    if (!adresse || typeof adresse === "string") throw new Error("collecteur muet indisponible");
    const code = `
      const http = require("node:http");
      // Un serveur ouvert : sans lui, le processus s'arrêterait de lui-même.
      const serveur = http.createServer((req, res) => res.end("ok"));
      serveur.listen(0, "127.0.0.1", () => {
        console.error("une erreur à expédier", new Error("avant l'arrêt"));
        console.log("PRET");
      });`;

    const mesurer = (nom: string, avecAgent: boolean) => {
      let debut = 0;
      return lancer(nom, code, avecAgent, {
        env: {
          MIP_RUM_ENDPOINT: `http://127.0.0.1:${adresse.port}/v1/traces`,
          MIP_RUM_FLUSH_MS: "0",
          MIP_RUM_SHUTDOWN_MS: "300",
        },
        auDemarrage: (enfant) => {
          enfant.stdout.on("data", (c: Buffer) => {
            if (String(c).includes("PRET")) {
              debut = Date.now();
              enfant.kill("SIGTERM");
            }
          });
        },
      }).then((sortie) => ({ ...sortie, duree: Date.now() - debut }));
    };

    const [nu, instrumente] = await Promise.all([mesurer("sigterm", false), mesurer("sigterm", true)]);
    muet.close();

    // Poser un écouteur SIGTERM SUPPRIME la terminaison par défaut de Node :
    // l'agent doit donc la rendre. Même fin que sans lui — terminé PAR le
    // signal, et non survivant jusqu'au SIGKILL de l'orchestrateur.
    expect([nu.code, nu.signal]).toEqual([null, "SIGTERM"]);
    expect([instrumente.code, instrumente.signal]).toEqual([null, "SIGTERM"]);
    // Borné par MIP_RUM_SHUTDOWN_MS, très en deçà du sursis d'un orchestrateur.
    expect(instrumente.duree).toBeLessThan(3_000);
  }, 30_000);

  it("l'application qui gère SIGTERM elle-même garde la main", async () => {
    recus.length = 0;
    const sortie = await lancer("sigterm-app", `
      const http = require("node:http");
      const serveur = http.createServer((req, res) => res.end("ok"));
      process.on("SIGTERM", () => { console.log("ARRET APPLICATIF"); process.exit(7); });
      serveur.listen(0, "127.0.0.1", () => console.log("PRET"));`, true, {
      auDemarrage: (enfant) => {
        enfant.stdout.on("data", (c: Buffer) => {
          if (String(c).includes("PRET")) enfant.kill("SIGTERM");
        });
      },
    });
    // L'agent n'a ni retardé ni détourné la terminaison décidée par l'application.
    expect(sortie.stdout).toContain("ARRET APPLICATIF");
    expect(sortie.code).toBe(7);
  }, 30_000);
});
