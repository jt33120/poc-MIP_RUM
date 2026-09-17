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
import { flattenOtlp, flattenOtlpLogs } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

type Attribut = { key: string; value: Record<string, unknown> };
type Payload = {
  resourceSpans?: Array<{ scopeSpans: Array<{ spans: Array<Record<string, unknown>> }> }>;
  resourceLogs?: Array<{ scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }> }>;
};

const RACINE = join(__dirname, "..", "..");
const dossier = mkdtempSync(join(tmpdir(), "mip-agent-node-"));
const AGENT = join(dossier, "register.js");
const recus: Payload[] = [];
let collecteur: Server;
let endpoint = "";

const attrs = (liste: Attribut[]) => Object.fromEntries(liste.map((a) => [a.key, Object.values(a.value)[0]]));
const spans = () => recus.flatMap((p) => p.resourceSpans ?? []).flatMap((r) => r.scopeSpans).flatMap((s) => s.spans);
const logs = () => recus.flatMap((p) => p.resourceLogs ?? []).flatMap((r) => r.scopeLogs).flatMap((s) => s.logRecords);

interface Sortie {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Lance `code` (CommonJS) sous l'agent, ou sans lui, et attend la fin du processus. */
function lancer(nom: string, code: string, avecAgent = true): Promise<Sortie> {
  const fichier = join(dossier, `${nom}-${avecAgent ? "agent" : "nu"}.cjs`);
  writeFileSync(fichier, code);
  const enfant = spawn(process.execPath, [...(avecAgent ? ["-r", AGENT] : []), fichier], {
    env: {
      PATH: process.env.PATH,
      MIP_RUM_ENDPOINT: endpoint,
      MIP_RUM_APP_ID: "agent-process",
      MIP_RUM_FLUSH_MS: "50",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  enfant.stdout.on("data", (c) => (stdout += c));
  enfant.stderr.on("data", (c) => (stderr += c));
  return new Promise((resolve) => enfant.on("close", (code) => resolve({ code, stdout, stderr })));
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
  await build({
    entryPoints: [join(RACINE, "packages", "agent-node", "src", "register.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    outfile: AGENT,
    logLevel: "silent",
  });
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
