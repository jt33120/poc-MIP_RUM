// L'EXTENSION SANS CLÉ : le domaine enregistré tient lieu de clé (décision du
// responsable du produit, 30/09/2026).
//
// Depuis le 29/09/2026, la collecte exige une clé (`REQUIRE_API_KEY=true` sur le
// collector) ; l'extension navigateur n'en a pas, et tous ses lots prenaient 403.
// La règle, portée par UN seul endroit (`createPgAuth.checkApiKey`,
// `packages/backend/lib/pg-ingest.mjs`) : un lot SANS clé passe si et seulement
// si (a) il se dit de l'extension (tous ses spans), (b) l'origine de la page est
// un domaine ACTIF de `extension_scope` pour CET app_id, (c) l'application est
// active et non suspendue. Tout le reste est inchangé.
//
// Ce fichier la vérifie à trois étages : la règle pure, le contrôle adossé au
// registre (cache compris), puis les DEUX ports d'ingestion — la console (chemin
// local, celui du repli) et le collector, en direct comme relayé (l'origine
// traverse alors le relais sous sa signature, `x-mip-edge-origin`).
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

const { requetes, poolDeTest } = await vi.hoisted(async () => {
  // `lib/ingest.ts` lit REQUIRE_API_KEY au chargement : le réglage du collector
  // en production depuis le 29/09/2026.
  process.env.REQUIRE_API_KEY = "true";
  const { createHash } = await import("node:crypto");
  const empreinte = (s: string) => createHash("sha256").update(s).digest("hex");
  const ligne = (app_id: string, domaines: string[], extra: Record<string, unknown> = {}) => ({
    app_id,
    api_key_hash: empreinte(`cle-${app_id}`),
    active: true,
    allowed_origins: [],
    ingestion_suspended_at: null,
    // Ce que rend la requête du registre : les domaines ACTIFS seulement
    // (`s.active`, filtré en SQL — prouvé par le contrat de parité).
    extension_domains: domaines,
    ...extra,
  });
  const REGISTRE = [
    ligne("app-ext", ["app.client.fr"]),
    ligne("app-autre", ["autre.client.fr"]),
    ligne("app-sans-cle", ["sanscle.client.fr"], { api_key_hash: null }),
    ligne("app-suspendue", ["suspendue.client.fr"], { ingestion_suspended_at: "2026-09-30T08:00:00Z" }),
    ligne("app-coupee", ["coupee.client.fr"], { active: false }),
    ligne("app-debit", ["debit.client.fr"]),
    ligne("app-domaine-coupe", []),
  ];
  const requetes: string[] = [];
  const query = async (text: string, params?: unknown[]) => {
    requetes.push(text);
    if (text.includes("from app_registry")) return { rows: REGISTRE.map((r) => ({ ...r })) };
    if (text.includes("rate_check")) return { rows: [{ ok: params?.[0] !== "app-debit" }] };
    return { rows: [] };
  };
  return { requetes, poolDeTest: { query, connect: async () => ({ query, release() {} }) } };
});

vi.mock("@/lib/db", () => ({ pool: poolDeTest }));
// Relais éteint : c'est le chemin local de la console — celui du repli — qui est jugé ici.
vi.mock("@/lib/ingest-relay", () => ({ relayer: async () => null }));

import { POST as POST_LOGS } from "../../apps/console/app/api/ingest/v1/logs/route";
import { POST as POST_TRACES } from "../../apps/console/app/api/ingest/v1/traces/route";
// @ts-expect-error module ESM partagé, sans déclarations
import { autoriseParDomaine, createPgAuth, hoteDOrigine } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { creerReceveur } from "../../packages/backend/lib/receiver.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });

/**
 * Un lot du SDK web : deux spans, tous deux marqués comme le SDK injecté par
 * l'extension les marque (`mip.collection_source`, par span, jamais sur la
 * resource). `source: "sdk"` : le même lot, posé par le snippet.
 */
function lot(app: string, opts: { source?: "extension" | "sdk" | "melange"; cle?: string } = {}) {
  const t = (BigInt(Date.now()) * 1_000_000n).toString();
  const source = opts.source ?? "extension";
  const ressource = [attr("mip.app_id", app)];
  if (opts.cle) ressource.push(attr("mip.api_key", opts.cle));
  const span = (i: number, marque: string) => ({
    name: i === 0 ? "rum.pageview" : "rum.webvital",
    traceId: "e".repeat(32),
    spanId: `${"f".repeat(15)}${i}`,
    startTimeUnixNano: t,
    endTimeUnixNano: t,
    attributes: [
      attr("mip.session_id", `${app}-session`),
      attr("mip.event_type", "pageview"),
      attr("mip.page", "/"),
      attr("mip.collection_source", marque),
    ],
  });
  const marques = source === "melange" ? ["extension", "sdk"] : [source, source];
  return JSON.stringify({
    resourceSpans: [{ resource: { attributes: ressource }, scopeSpans: [{ spans: marques.map((m, i) => span(i, m)) }] }],
  });
}

const silencieux = { debug() {}, info() {}, warn() {}, error() {} };
const EDGE = "e".repeat(40);

afterEach(() => {
  requetes.length = 0;
});

// ───────────────────────────── 1. La règle, pure ─────────────────────────────

describe("hoteDOrigine — l'hôte d'une origine de page", () => {
  it("https ou http, port ignoré, casse normalisée", () => {
    expect(hoteDOrigine("https://app.client.fr")).toBe("app.client.fr");
    expect(hoteDOrigine("https://APP.Client.fr:8443")).toBe("app.client.fr");
    expect(hoteDOrigine("http://localhost:3000")).toBe("localhost");
  });

  it("tout le reste : null (jamais une devinette)", () => {
    for (const v of [null, undefined, "", "null", "app.client.fr", "file:///etc/passwd", "chrome-extension://abc", "ftp://app.client.fr", 42, "x".repeat(2049)]) {
      expect(hoteDOrigine(v), String(v)).toBeNull();
    }
  });
});

describe("autoriseParDomaine — conditions (a) et (b)", () => {
  const app = { extension_domains: ["app.client.fr"] };
  it("marqué extension ET domaine enregistré de l'app : oui", () => {
    expect(autoriseParDomaine(app, { extension: true, origine: "https://app.client.fr" })).toBe(true);
  });
  it("sans le marqueur, sans origine, ou hors registre : non", () => {
    expect(autoriseParDomaine(app, { extension: false, origine: "https://app.client.fr" })).toBe(false);
    expect(autoriseParDomaine(app, { origine: "https://app.client.fr" })).toBe(false);
    expect(autoriseParDomaine(app, { extension: true, origine: null })).toBe(false);
    expect(autoriseParDomaine(app, { extension: true, origine: "https://sous.app.client.fr" })).toBe(false);
    expect(autoriseParDomaine({ extension_domains: [] }, { extension: true, origine: "https://app.client.fr" })).toBe(false);
    // Registre antérieur (ligne sans la colonne) : rien n'autorise.
    expect(autoriseParDomaine({}, { extension: true, origine: "https://app.client.fr" })).toBe(false);
  });
});

describe("flattenOtlp — le marqueur de l'extension, par resource", () => {
  const cle = (corps: string) => flattenOtlp(JSON.parse(corps)).apiKeys[0];
  it("tous les spans marqués : extension", () => {
    expect(cle(lot("app-ext"))).toEqual({ app_id: "app-ext", api_key: null, extension: true });
  });
  it("snippet, ou lot MÊLÉ : pas de marqueur (le champ est absent, jamais « false »)", () => {
    expect(cle(lot("app-ext", { source: "sdk" }))).toEqual({ app_id: "app-ext", api_key: null });
    expect("extension" in cle(lot("app-ext", { source: "melange" }))).toBe(false);
  });
  it("marqueur sur la resource seule, ou aucun span : pas de marqueur", () => {
    const surResource = {
      resourceSpans: [{ resource: { attributes: [attr("mip.app_id", "a"), attr("mip.collection_source", "extension")] }, scopeSpans: [{ spans: [] }] }],
    };
    expect(flattenOtlp(surResource).apiKeys).toEqual([{ app_id: "a", api_key: null }]);
  });
});

// ─────────────────────── 2. Le contrôle, adossé au registre ───────────────────

describe("createPgAuth.checkApiKey — sous REQUIRE_API_KEY", () => {
  const auth = () => createPgAuth(poolDeTest, { requireApiKey: true });
  const ext = (origine: string | null) => ({ extension: true, origine });

  it("lot de l'extension, sans clé, depuis un domaine actif de l'app : accepté", async () => {
    const a = auth();
    expect(await a.checkApiKey("app-ext", null, ext("https://app.client.fr"))).toBeNull();
    // Une app qui n'a même pas de clé : le domaine suffit, pour l'extension seulement.
    expect(await a.checkApiKey("app-sans-cle", null, ext("https://sanscle.client.fr"))).toBeNull();
  });

  it("domaine non enregistré, domaine d'une AUTRE app, domaine désactivé : refusé, et le refus le dit", async () => {
    const a = auth();
    expect(await a.checkApiKey("app-ext", null, ext("https://ailleurs.fr"))).toBe("extension origin not registered for app: app-ext");
    expect(await a.checkApiKey("app-ext", null, ext("https://autre.client.fr"))).toMatch(/extension origin not registered/);
    expect(await a.checkApiKey("app-domaine-coupe", null, ext("https://coupe.client.fr"))).toMatch(/extension origin not registered/);
    expect(await a.checkApiKey("app-ext", null, ext(null))).toMatch(/extension origin not registered/);
  });

  it("(c) application suspendue, désactivée, inconnue : refusée AVANT la règle", async () => {
    const a = auth();
    expect(await a.checkApiKey("app-suspendue", null, ext("https://suspendue.client.fr"))).toBe("ingestion suspended for app: app-suspendue");
    expect(await a.checkApiKey("app-coupee", null, ext("https://coupee.client.fr"))).toBe("inactive app: app-coupee");
    expect(await a.checkApiKey("app-fantome", null, ext("https://app.client.fr"))).toMatch(/unknown or inactive app/);
  });

  it("le lot du snippet sans clé reste refusé, même depuis un domaine enregistré", async () => {
    const a = auth();
    expect(await a.checkApiKey("app-ext", null, { extension: false, origine: "https://app.client.fr" })).toBe("invalid api key for app: app-ext");
    expect(await a.checkApiKey("app-ext", null)).toBe("invalid api key for app: app-ext");
    expect(await a.checkApiKey("app-sans-cle", null, { origine: "https://sanscle.client.fr" })).toBe("app requires an API key: app-sans-cle");
  });

  it("SANS CLÉ SEULEMENT : une clé fausse reste un 403, même marquée et depuis le bon domaine ; une clé juste passe", async () => {
    const a = auth();
    expect(await a.checkApiKey("app-ext", "mauvaise", ext("https://app.client.fr"))).toBe("invalid api key for app: app-ext");
    expect(await a.checkApiKey("app-ext", "cle-app-ext", ext("https://ailleurs.fr"))).toBeNull();
  });

  it("le registre de l'extension vient dans la MÊME lecture, sous le même cache de 60 s", async () => {
    const a = auth();
    for (let i = 0; i < 5; i++) await a.checkApiKey("app-ext", null, ext("https://app.client.fr"));
    const lectures = requetes.filter((q) => q.includes("app_registry"));
    expect(lectures).toHaveLength(1);
    expect(lectures[0]).toMatch(/extension_scope/);
    expect(lectures[0]).toMatch(/s\.active/);
    expect(requetes.filter((q) => q.includes("extension_scope"))).toHaveLength(1);
  });

  it("REQUIRE_API_KEY=false : rien ne change (tout lot d'une app active passe)", async () => {
    const a = createPgAuth(poolDeTest, { requireApiKey: false });
    expect(await a.checkApiKey("app-ext", null, ext("https://ailleurs.fr"))).toBeNull();
    expect(await a.checkApiKey("app-coupee", null, ext("https://coupee.client.fr"))).toBe("inactive app: app-coupee");
  });
});

// ─────────────────────── 3. Les deux ports d'ingestion ────────────────────────

async function servirCollector() {
  const { handler } = creerReceveur(poolDeTest, { requireApiKey: true, log: silencieux, env: {}, edgeSecrets: [EDGE] });
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("port de test indisponible");
  return {
    poster: (chemin: string, corps: string | Buffer, entetes: Record<string, string>) =>
      fetch(`http://127.0.0.1:${adresse.port}${chemin}`, { method: "POST", headers: entetes, body: corps }),
    fermer: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function auCollector(corps: string, entetes: Record<string, string>, chemin = "/v1/traces") {
  const c = await servirCollector();
  try {
    const res = await c.poster(chemin, corps, { "content-type": "application/json", ...entetes });
    return { statut: res.status, corps: await res.json().catch(() => null) };
  } finally {
    await c.fermer();
  }
}

async function aLaConsole(corps: string, entetes: Record<string, string>, route = POST_TRACES) {
  const res = await route(new Request("https://mip-rum-console.vercel.app/api/ingest/v1/traces", {
    method: "POST",
    headers: { "content-type": "application/json", ...entetes },
    body: corps,
  }));
  return { statut: res.status, corps: await res.json().catch(() => null) };
}

/** Le même lot aux deux ports, en DIRECT (le navigateur présente son `Origin`). */
async function auxDeuxPorts(corps: string, origine: string) {
  return {
    console: await aLaConsole(corps, { origin: origine }),
    collector: await auCollector(corps, { origin: origine }),
  };
}

describe("les deux ports, en direct : même règle, même verdict", () => {
  const cas: Array<{ nom: string; corps: () => string; origine: string; statut: number; erreur?: string | RegExp }> = [
    { nom: "extension, domaine enregistré → 200", corps: () => lot("app-ext"), origine: "https://app.client.fr", statut: 200 },
    { nom: "extension, domaine non enregistré → 403", corps: () => lot("app-ext"), origine: "https://ailleurs.fr", statut: 403, erreur: "extension origin not registered for app: app-ext" },
    { nom: "extension, domaine d'une autre app → 403", corps: () => lot("app-ext"), origine: "https://autre.client.fr", statut: 403, erreur: /extension origin not registered/ },
    { nom: "extension, app suspendue → 403", corps: () => lot("app-suspendue"), origine: "https://suspendue.client.fr", statut: 403, erreur: "ingestion suspended for app: app-suspendue" },
    { nom: "extension, app désactivée → 403", corps: () => lot("app-coupee"), origine: "https://coupee.client.fr", statut: 403, erreur: "inactive app: app-coupee" },
    { nom: "snippet sans clé, domaine enregistré → 403", corps: () => lot("app-ext", { source: "sdk" }), origine: "https://app.client.fr", statut: 403, erreur: "invalid api key for app: app-ext" },
    { nom: "lot mêlé sans clé, domaine enregistré → 403", corps: () => lot("app-ext", { source: "melange" }), origine: "https://app.client.fr", statut: 403 },
    { nom: "extension avec une clé fausse, domaine enregistré → 403", corps: () => lot("app-ext", { cle: "mauvaise" }), origine: "https://app.client.fr", statut: 403, erreur: "invalid api key for app: app-ext" },
    { nom: "extension acceptée, mais la limite de débit s'applique toujours → 429", corps: () => lot("app-debit"), origine: "https://debit.client.fr", statut: 429 },
  ];
  for (const c of cas) {
    it(c.nom, async () => {
      const { console: cons, collector } = await auxDeuxPorts(c.corps(), c.origine);
      expect(cons.statut, "console").toBe(c.statut);
      expect(collector.statut, "collector").toBe(c.statut);
      expect(collector.corps).toEqual(cons.corps);
      if (c.erreur) expect((cons.corps as { error: string }).error).toMatch(c.erreur);
    });
  }

  it("logs et rejeu : sans marqueur de l'extension, un envoi sans clé reste refusé, même depuis un domaine enregistré", async () => {
    const logs = JSON.stringify({
      resourceLogs: [{
        resource: { attributes: [attr("mip.app_id", "app-ext"), attr("mip.collection_source", "extension")] },
        scopeLogs: [{ logRecords: [{ timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(), severityText: "INFO", body: { stringValue: "x" } }] }],
      }],
    });
    expect((await aLaConsole(logs, { origin: "https://app.client.fr" }, POST_LOGS)).statut).toBe(403);
    expect((await auCollector(logs, { origin: "https://app.client.fr" }, "/v1/logs")).statut).toBe(403);
    const c = await servirCollector();
    try {
      const rejeu = await c.poster("/v1/replay", gzipSync(Buffer.from("[]")), {
        "content-type": "application/octet-stream", origin: "https://app.client.fr",
        "x-mip-session": "app-ext-session", "x-mip-app": "app-ext", "x-mip-seq": "0",
      });
      expect(rejeu.status).toBe(403);
    } finally {
      await c.fermer();
    }
  });
});

describe("collector : l'origine selon le bord de confiance", () => {
  it("RELAYÉE et signée : l'origine transmise par le relais autorise ; l'`Origin` de la requête (la console) n'est pas lue", async () => {
    const r = await auCollector(lot("app-ext"), {
      "x-mip-edge-auth": EDGE, "x-mip-edge-origin": "https://app.client.fr", origin: "https://mip-rum-console.vercel.app",
    });
    expect(r.statut).toBe(200);
  });

  it("RELAYÉE sans x-mip-edge-origin : refusée, même si l'`Origin` de la requête est un domaine enregistré", async () => {
    const r = await auCollector(lot("app-ext"), { "x-mip-edge-auth": EDGE, origin: "https://app.client.fr" });
    expect(r.statut).toBe(403);
  });

  it("DIRECTE avec un x-mip-edge-origin FORGÉ : ignoré, c'est l'`Origin` du navigateur qui compte", async () => {
    const r = await auCollector(lot("app-ext"), { "x-mip-edge-origin": "https://app.client.fr", origin: "https://ailleurs.fr" });
    expect(r.statut).toBe(403);
  });

  it("signature FAUSSE : aucune origine ne vaut, ni la transmise ni celle de la requête", async () => {
    const r = await auCollector(lot("app-ext"), {
      "x-mip-edge-auth": "f".repeat(40), "x-mip-edge-origin": "https://app.client.fr", origin: "https://app.client.fr",
    });
    expect(r.statut).toBe(403);
  });
});
