// P2 — le receveur du collector (`creerReceveur`), sans base : un faux pool
// enregistre les requêtes SQL et peut simuler un verrou tenu, une base coupée.
//
// Ce qui est vérifié, dans l'ordre du plan :
//   1. la normalisation des chemins historiques AVANT le routage (et donc
//      avant `estReplay`, qui décide des en-têtes de préflight) ;
//   2. le budget de requête : verrou 1,5 s × 2, reprises plafonnées, puis 503
//      + retry-after — jamais un 500, jamais une attente de 15 s ; et c'est
//      une ÉCHÉANCE DURE : gardes et requêtes de la transaction bornées, COMMIT
//      jamais envoyé après elle, connexion détruite (pas rendue) ;
//   3. le refus de démarrer avec le tampon /__recent en production ;
//   4. /ready (registre chargé au moins une fois, identité concordante) et ce
//      que /health dit du receveur (service, protocole de bord, identité) ;
//   5. le bord de confiance branché sur le GeoIP : relayé = pays seul et pas de
//      GeoIP ; direct = GeoIP, en-têtes pays de CDN ignorés ; signature fausse
//      = ni l'un ni l'autre.
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_REQUETE,
  creerReceveur,
  normaliserChemin,
  plafondCorps,
  // @ts-expect-error module ESM partagé, sans déclarations
} from "../../packages/backend/lib/receiver.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { empreinteIdentite } from "../../packages/backend/lib/identity-hash.mjs";

type Requete = { text: string; params?: unknown[] };
type Panne = (text: string) => unknown;

/** Colonnes optionnelles que `writeRows` sonde (même jeu que identity-ingest-ports). */
const OPTIONNELLES: Record<string, string[]> = {
  rum_session: ["collection_source", "release", "net_type", "visitor_id", "sample_rate", "error_sample_rate", "has_error", "user_id_hash", "account_id_hash", "context", "geo_source", "geo_db_version"],
  rum_event: ["event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name", "action_id", "timing_ms", "feature_flag_value"],
};

/**
 * Faux pool : toute requête réussit (lignes vides), sauf si `panne(text)` rend
 * une erreur, qui est alors levée, ou si `bloque(text)` est vrai : la requête ne
 * répond JAMAIS (réseau qui avale, base qui ne se réveille pas). `connect` peut
 * échouer aussi. `liberations` : l'argument de chaque `release` (une erreur =
 * connexion détruite par pg-pool, pas rendue).
 */
function fauxPool({ panne, panneConnexion, bloque }: { panne?: Panne; panneConnexion?: () => unknown; bloque?: (text: string) => boolean } = {}) {
  const requetes: Requete[] = [];
  const liberations: unknown[] = [];
  let connexions = 0;
  const query = async (text: string, params?: unknown[]) => {
    requetes.push({ text, params });
    if (bloque?.(text)) return new Promise(() => {});
    const err = panne?.(text);
    if (err) throw err;
    if (text.includes("information_schema.columns")) {
      return { rows: (OPTIONNELLES[String(params?.[0])] ?? []).map((column_name) => ({ column_name })) };
    }
    if (text.includes("rate_check")) return { rows: [{ ok: true }] };
    return { rows: [] };
  };
  const pool = {
    query,
    connect: async () => {
      connexions++;
      const err = panneConnexion?.();
      if (err) throw err;
      return { query, release(e?: unknown) { liberations.push(e); } };
    },
  };
  return { pool, requetes, liberations, connexions: () => connexions };
}

function journal() {
  const lignes: Array<{ niveau: string; msg: string; champs?: any }> = [];
  const ecrire = (niveau: string) => (msg: string, champs?: unknown) => lignes.push({ niveau, msg, champs });
  return { log: { debug: ecrire("debug"), info: ecrire("info"), warn: ecrire("warn"), error: ecrire("error") }, lignes };
}

const aFermer: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(aFermer.splice(0).map((f) => f()));
});

async function servir(pool: unknown, opts: Record<string, unknown> = {}) {
  const { log, lignes } = journal();
  const receveur = creerReceveur(pool, { log, requireApiKey: false, env: {}, ...opts });
  const server = createServer(receveur.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  aFermer.push(() => new Promise((r) => server.close(() => r())));
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("port de test indisponible");
  return { base: `http://127.0.0.1:${adresse.port}`, receveur, lignes };
}

/** Un lot OTLP minimal, SANS fuseau : le pays ne peut venir que du GeoIP ou du relais. */
function lot(session = "p2-session") {
  const t = (BigInt(Date.now()) * 1_000_000n).toString();
  const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
  return JSON.stringify({
    resourceSpans: [{
      resource: { attributes: [attr("mip.app_id", "p2-app")] },
      scopeSpans: [{ spans: [{
        name: "rum.pageview", traceId: "a".repeat(32), spanId: "b".repeat(16), startTimeUnixNano: t, endTimeUnixNano: t,
        attributes: [attr("mip.session_id", session), attr("mip.event_type", "pageview"), attr("mip.page", "/")],
      }] }],
    }],
  });
}

const posterTraces = (base: string, chemin = "/v1/traces", headers: Record<string, string> = {}) =>
  fetch(`${base}${chemin}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: lot() });

// ───────────────────────────── 1. Normalisation ─────────────────────────────

describe("normaliserChemin — les chemins historiques arrivent tels quels", () => {
  it("alias de la console → chemins canoniques, query retirée", () => {
    expect(normaliserChemin("/api/ingest/v1/traces")).toBe("/v1/traces");
    expect(normaliserChemin("/api/ingest/v1/logs?x=1")).toBe("/v1/logs");
    expect(normaliserChemin("/api/ingest/v1/replay")).toBe("/v1/replay");
    expect(normaliserChemin("/api/sourcemaps")).toBe("/v1/sourcemaps");
    expect(normaliserChemin("/v1/traces")).toBe("/v1/traces");
    expect(normaliserChemin(undefined)).toBe("/");
  });

  it("ne normalise QUE ces préfixes exacts", () => {
    expect(normaliserChemin("/api/ingest/v2/traces")).toBe("/api/ingest/v2/traces");
    expect(normaliserChemin("/api/sourcemaps/extra")).toBe("/api/sourcemaps/extra");
    expect(normaliserChemin("/xapi/ingest/v1/traces")).toBe("/xapi/ingest/v1/traces");
  });

  it("le plafond de corps suit le chemin normalisé", () => {
    expect(plafondCorps("/api/ingest/v1/replay")).toBe(plafondCorps("/v1/replay"));
    expect(plafondCorps("/api/sourcemaps")).toBe(plafondCorps("/v1/sourcemaps"));
    expect(plafondCorps("/api/sourcemaps")).toBeGreaterThan(plafondCorps("/v1/traces"));
  });
});

describe("routage après normalisation", () => {
  it("le préflight de /api/ingest/v1/replay annonce les en-têtes x-mip-* (normalisé AVANT estReplay)", async () => {
    const { base } = await servir(fauxPool().pool);
    const alias = await fetch(`${base}/api/ingest/v1/replay`, { method: "OPTIONS" });
    const canon = await fetch(`${base}/v1/replay`, { method: "OPTIONS" });
    const traces = await fetch(`${base}/api/ingest/v1/traces`, { method: "OPTIONS" });
    expect(alias.status).toBe(204);
    expect(alias.headers.get("access-control-allow-headers")).toContain("x-mip-session");
    expect(alias.headers.get("access-control-allow-headers")).toBe(canon.headers.get("access-control-allow-headers"));
    expect(traces.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("GET /v1/logs et /v1/traces rendent 200, sous les deux chemins (parité Vercel)", async () => {
    const { base } = await servir(fauxPool().pool);
    for (const chemin of ["/v1/logs", "/api/ingest/v1/logs", "/v1/traces", "/api/ingest/v1/traces"]) {
      const r = await fetch(`${base}${chemin}`);
      expect(r.status, chemin).toBe(200);
    }
    expect(await (await fetch(`${base}/v1/logs`)).json()).toEqual({ status: "ok", service: "v1-logs" });
  });

  it("POST /api/ingest/v1/traces écrit comme /v1/traces", async () => {
    const { pool, requetes } = fauxPool();
    const { base } = await servir(pool);
    const r = await posterTraces(base, "/api/ingest/v1/traces");
    expect(r.status).toBe(200);
    expect(requetes.some((q) => /insert into rum_session/i.test(q.text))).toBe(true);
  });

  it("/api/sourcemaps mène à la branche JETON seulement : POST sans jeton = 401, GET = 404", async () => {
    const { base } = await servir(fauxPool().pool);
    const post = await fetch(`${base}/api/sourcemaps`, { method: "POST", body: "{}" });
    expect(post.status).toBe(401);
    const get = await fetch(`${base}/api/sourcemaps`);
    expect(get.status).toBe(404);
  });
});

// ──────────────────────────── 2. Budget de requête ───────────────────────────

describe("budget de requête ≈ 4 s, puis 503 + retry-after", () => {
  it("les constantes du plan : verrou 1,5 s × 2, reprises plafonnées, 4 s au total", () => {
    expect(BUDGET_REQUETE).toMatchObject({ totalMs: 4_000, verrou: { delaiVerrouMs: 1_500, tentatives: 2 }, reprises: 2 });
    expect(BUDGET_REQUETE.repriseMaxMs).toBeLessThanOrEqual(500);
  });

  it("verrou d'application indisponible : lock_timeout 1500 ms, DEUX essais, puis 503", async () => {
    const verrou = Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
    const { pool, requetes } = fauxPool({ panne: (t) => (t.includes("pg_advisory_xact_lock") ? verrou : null) });
    const { base } = await servir(pool);
    const debut = Date.now();
    const r = await posterTraces(base);
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("2");
    expect(await r.json()).toMatchObject({ retry: true });
    // Sous échéance, les réglages partent en UNE requête `set_config` : le
    // verrou à 1500 ms, et le reste du budget pour statement_timeout.
    const reglages = requetes.filter((q) => q.text.includes("lock_timeout"));
    expect(reglages).toHaveLength(2);
    for (const q of reglages) {
      expect(q.params?.[0]).toBe("1500ms");
      expect(parseInt(String(q.params?.[1]), 10)).toBeLessThanOrEqual(BUDGET_REQUETE.totalMs);
    }
    expect(requetes.filter((q) => q.text.includes("pg_advisory_xact_lock"))).toHaveLength(2);
    expect(Date.now() - debut).toBeLessThan(2_000); // 120 ms de recul, pas 5 s × 3
  });

  it("base coupée (erreur transitoire) : reprises PLAFONNÉES, puis 503 — pas 500", async () => {
    const coupe = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const f = fauxPool({ panneConnexion: () => coupe });
    const { base, lignes } = await servir(f.pool);
    const r = await posterTraces(base);
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("2");
    expect(f.connexions()).toBe(1 + BUDGET_REQUETE.reprises);
    expect(lignes.some((l) => l.msg === "busy: database unavailable within budget")).toBe(true);
  });

  it("délai du pool (pg-pool lève sans code) : 503 aussi", async () => {
    const f = fauxPool({ panneConnexion: () => new Error("timeout exceeded when trying to connect") });
    const { base } = await servir(f.pool);
    const r = await posterTraces(base);
    expect(r.status).toBe(503);
    // Sans code SQLSTATE, `withRetry` ne reprend pas : une seule attente de connexion.
    expect(f.connexions()).toBe(1);
  });

  it("aucune reprise ne part APRÈS l'échéance (ni même la première, échéance nulle)", async () => {
    const coupe = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    const f = fauxPool({ panneConnexion: () => coupe });
    const { base } = await servir(f.pool, { budget: { totalMs: 0 } });
    const r = await posterTraces(base);
    expect(r.status).toBe(503);
    // Échéance déjà passée : aucune connexion n'est même demandée.
    expect(f.connexions()).toBe(0);
  });

  it("une faute déterministe reste un 500 (le budget ne maquille pas les bugs)", async () => {
    const faute = Object.assign(new Error('column "x" does not exist'), { code: "42703" });
    const { pool } = fauxPool({ panne: (t) => (/insert into rum_session/i.test(t) ? faute : null) });
    const { base } = await servir(pool);
    const r = await posterTraces(base);
    expect(r.status).toBe(500);
  });
});

describe("échéance DURE : rien ne part, rien n'est commis après le budget", () => {
  const BUDGET = { totalMs: 400 };
  const commits = (requetes: Requete[]) => requetes.filter((q) => /^\s*commit\b/i.test(q.text));

  it("réglages serveur : statement_timeout, idle_in_transaction et transaction_timeout ≤ budget restant", async () => {
    const { pool, requetes } = fauxPool();
    const { base } = await servir(pool);
    expect((await posterTraces(base)).status).toBe(200);
    const reglage = requetes.find((q) => q.text.includes("statement_timeout"));
    expect(reglage?.text).toMatch(/set_config\('statement_timeout', \$2, true\)/);
    expect(reglage?.text).toMatch(/set_config\('idle_in_transaction_session_timeout', \$2, true\)/);
    expect(reglage?.text).toMatch(/server_version_num[\s\S]*set_config\('transaction_timeout', \$2, true\)/);
    const reste = parseInt(String(reglage?.params?.[1]), 10);
    expect(reste).toBeGreaterThan(0);
    expect(reste).toBeLessThanOrEqual(BUDGET_REQUETE.totalMs);
    expect(commits(requetes)).toHaveLength(1);
  });

  it("compteur de débit qui ne répond jamais (gardes) : 503 à l'échéance, aucune transaction ouverte", async () => {
    const f = fauxPool({ bloque: (t) => t.includes("rate_check") });
    const { base } = await servir(f.pool, { budget: BUDGET });
    const debut = Date.now();
    const r = await posterTraces(base);
    const ms = Date.now() - debut;
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("2");
    expect(await r.json()).toMatchObject({ retry: true });
    expect(ms).toBeGreaterThanOrEqual(BUDGET.totalMs - 20);
    expect(ms).toBeLessThan(BUDGET.totalMs + 500);
    expect(f.connexions()).toBe(0);
    expect(f.requetes.some((q) => q.text === "begin")).toBe(false);
  });

  it("requête de la transaction qui ne répond jamais : 503 à l'échéance, PAS de COMMIT, connexion détruite", async () => {
    const f = fauxPool({ bloque: (t) => /insert into rum_session/i.test(t) });
    const { base, lignes } = await servir(f.pool, { budget: BUDGET });
    const debut = Date.now();
    const r = await posterTraces(base);
    const ms = Date.now() - debut;
    expect(r.status).toBe(503);
    expect(ms).toBeLessThan(BUDGET.totalMs + 500);
    expect(commits(f.requetes)).toHaveLength(0);
    // Ni ROLLBACK attendu (il ferait la queue derrière la requête en vol), ni
    // connexion rendue saine : `release(err)` = pg-pool la détruit, et la
    // fermeture de la socket annule la transaction côté serveur.
    expect(f.requetes.some((q) => q.text === "rollback")).toBe(false);
    expect(f.liberations).toHaveLength(1);
    expect(f.liberations[0]).toBeInstanceOf(Error);
    expect((f.liberations[0] as Error).name).toBe("ErreurEcheance");
    expect(lignes.some((l) => l.msg === "busy: request deadline reached")).toBe(true);
  });

  it("logs : même borne (le signal sans clé naturelle, celui que le doublon abîme)", async () => {
    const f = fauxPool({ bloque: (t) => /insert into rum_log/i.test(t) });
    const { base } = await servir(f.pool, { budget: BUDGET });
    const t = (BigInt(Date.now()) * 1_000_000n).toString();
    const corps = JSON.stringify({ resourceLogs: [{ resource: { attributes: [{ key: "mip.app_id", value: { stringValue: "p2-app" } }] },
      scopeLogs: [{ logRecords: [{ timeUnixNano: t, severityNumber: 9, severityText: "INFO", body: { stringValue: "échéance" } }] }] }] });
    const r = await fetch(`${base}/v1/logs`, { method: "POST", headers: { "content-type": "application/json" }, body: corps });
    expect(r.status).toBe(503);
    expect(commits(f.requetes)).toHaveLength(0);
  });

  it("coupure par l'échéance SERVEUR (statement_timeout, 57014) : 503, pas 500", async () => {
    const annule = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    const f = fauxPool({ panne: (t) => (/insert into rum_session/i.test(t) ? annule : null) });
    const { base } = await servir(f.pool);
    const r = await posterTraces(base);
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("2");
    expect(commits(f.requetes)).toHaveLength(0);
  });

  it("transaction tuée par transaction_timeout au COMMIT (25P04) : 503, rien de commis", async () => {
    const tuee = Object.assign(new Error("terminating connection due to transaction timeout"), { code: "25P04" });
    const f = fauxPool({ panne: (t) => (/^commit$/i.test(t) ? tuee : null) });
    const { base } = await servir(f.pool);
    const r = await posterTraces(base);
    expect(r.status).toBe(503);
    expect((f.liberations[0] as Error)?.name).toBe("ErreurEcheance");
  });

  it("COMMIT sans verdict : 503 avant échéance + grâce, issue « inconnue » journalisée en erreur", async () => {
    const f = fauxPool({ bloque: (t) => /^commit$/i.test(t) });
    const { base, lignes } = await servir(f.pool, { budget: BUDGET });
    const debut = Date.now();
    const r = await posterTraces(base);
    expect(r.status).toBe(503);
    expect(Date.now() - debut).toBeLessThan(BUDGET.totalMs + 750 + 500);
    expect(lignes.some((l) => l.niveau === "error" && /commit outcome unknown/.test(l.msg))).toBe(true);
  });

  it("COMMIT perdu par le réseau (`Query read timeout`, sans SQLSTATE) : issue INCONNUE, pas « base indisponible »", async () => {
    // Régression trouvée par la preuve sous toxiproxy : ce délai du pilote,
    // pris pour une panne ordinaire, rendait « rien d'écrit » sur un lot commis.
    const f = fauxPool({ panne: (t) => (/^commit$/i.test(t) ? new Error("Query read timeout") : null) });
    const { base, lignes } = await servir(f.pool);
    const r = await posterTraces(base);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: "ingestion outcome unknown, retry", retry: true });
    expect(lignes.some((l) => l.niveau === "error" && /commit outcome unknown/.test(l.msg))).toBe(true);
    expect(lignes.some((l) => l.msg === "busy: database unavailable within budget")).toBe(false);
  });

  it("une faute déterministe dans la transaction : ROLLBACK normal, connexion RENDUE (pas détruite)", async () => {
    const faute = Object.assign(new Error('column "x" does not exist'), { code: "42703" });
    const f = fauxPool({ panne: (t) => (/insert into rum_session/i.test(t) ? faute : null) });
    const { base } = await servir(f.pool);
    expect((await posterTraces(base)).status).toBe(500);
    expect(f.requetes.some((q) => q.text === "rollback")).toBe(true);
    expect(f.liberations).toEqual([undefined]);
  });
});

// ──────────────────────────── 3. Tampon /__recent ────────────────────────────

describe("le tampon /__recent ne démarre pas en production", () => {
  const pool = fauxPool().pool;

  it("NODE_ENV=production : refus au démarrage", () => {
    expect(() => creerReceveur(pool, { tampon: true, env: { NODE_ENV: "production" } })).toThrow(/tampon \/__recent est interdit/);
  });

  it("RAILWAY_ENVIRONMENT défini (même « staging ») : refus au démarrage", () => {
    expect(() => creerReceveur(pool, { tampon: true, env: { RAILWAY_ENVIRONMENT: "staging" } })).toThrow(/interdit en production/);
  });

  it("en développement : permis ; et sans tampon, la production démarre", () => {
    expect(() => creerReceveur(pool, { tampon: true, env: { NODE_ENV: "development" } })).not.toThrow();
    expect(() => creerReceveur(pool, { tampon: false, env: { NODE_ENV: "production", RAILWAY_ENVIRONMENT: "production" } })).not.toThrow();
  });
});

// ───────────────────────────── 4. Sondes ─────────────────────────────────────

describe("/ready — registre chargé au moins une fois, identité concordante", () => {
  it("registre jamais chargé (base injoignable au démarrage) : pas prêt", async () => {
    let base = "ko";
    const { pool } = fauxPool({ panne: (t) => (t.includes("from app_registry") && base === "ko" ? new Error("down") : null) });
    const { receveur } = await servir(pool);
    expect(await receveur.pret()).toMatchObject({ ok: false, registry_loaded: false });
    base = "ok";
    expect(await receveur.pret()).toMatchObject({ ok: true, registry_loaded: true });
    // Une panne APRÈS un premier chargement garde l'ancien registre : toujours prêt.
    base = "ko";
    expect(receveur.auth.registryLoaded()).toBe(true);
  });

  it("empreinte discordante : pas prêt, identité retirée, erreur claire au journal", async () => {
    const secret = "s".repeat(40);
    const { receveur, lignes } = await servir(fauxPool().pool, {
      identityHashSecret: secret,
      identityFingerprint: empreinteIdentite("t".repeat(40)),
    });
    expect(await receveur.pret()).toMatchObject({ ok: false, identity: "discordante" });
    const erreur = lignes.find((l) => l.niveau === "error");
    expect(erreur?.msg).toMatch(/empreinte du secret d'identité DISCORDANTE/);
    expect(JSON.stringify(lignes)).not.toContain(secret);
    expect(receveur.infosSante().identity_hash).toEqual({ configured: false });
  });

  it("route /ready des serveurs de développement : 503 tant que le registre n'est pas chargé", async () => {
    const { pool } = fauxPool({ panne: (t) => (t.includes("from app_registry") ? new Error("down") : null) });
    const { base } = await servir(pool);
    const r = await fetch(`${base}/ready`);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ registry_loaded: false });
  });
});

describe("/health — ce que le receveur dit de lui", () => {
  it("sans secret : identité « absente », protocole de bord, jamais de secret", async () => {
    const { base } = await servir(fauxPool().pool, { nom: "collector" });
    const corps = await (await fetch(`${base}/health`)).json();
    expect(corps).toMatchObject({
      status: "ok",
      service: "collector",
      edge_protocol: "mip-edge/1",
      edge_trust: false,
      identity: "absente",
      id_fp: null,
      ingest_deferred: false,
    });
  });

  it("secret + empreinte : « active », l'empreinte et non le secret", async () => {
    const secret = "k".repeat(40);
    const fp = empreinteIdentite(secret);
    const edge = "e".repeat(40);
    const { receveur } = await servir(fauxPool().pool, { identityHashSecret: secret, identityFingerprint: fp, edgeSecrets: [edge] });
    const infos = receveur.infosSante();
    expect(infos).toMatchObject({ identity: "active", id_fp: fp, edge_trust: true, identity_hash: { configured: true } });
    expect(JSON.stringify(infos)).not.toContain(secret);
    expect(JSON.stringify(infos)).not.toContain(edge);
  });
});

// ──────────────────────── 5. Bord de confiance et GeoIP ──────────────────────

describe("bord de confiance branché sur le GeoIP", () => {
  const EDGE = "e".repeat(40);

  function geoipFactice() {
    return {
      resoudre: vi.fn(() => ({ country: "US", version: "dbip-test" })),
      etat: () => "actif",
      version: () => "dbip-test",
      raison: () => null,
    };
  }

  async function poster(headers: Record<string, string>) {
    const { pool, requetes } = fauxPool();
    const geoip = geoipFactice();
    const { base } = await servir(pool, { edgeSecrets: [EDGE], geoip, sourceIp: { mode: "socket" } });
    const r = await posterTraces(base, "/v1/traces", headers);
    expect(r.status).toBe(200);
    const session = requetes.find((q) => /insert into rum_session/i.test(q.text));
    return { geoip, params: JSON.stringify(session?.params ?? []) };
  }

  it("relayée et signée : le pays du relais, et le GeoIP n'est PAS appelé (aucune adresse)", async () => {
    const { geoip, params } = await poster({ "x-mip-edge-auth": EDGE, "x-mip-edge-country": "FR", "x-forwarded-for": "203.0.113.7" });
    expect(geoip.resoudre).not.toHaveBeenCalled();
    expect(params).toContain('"FR"');
    expect(params).toContain('"cdn"');
    expect(params).not.toContain("203.0.113.7");
  });

  it("directe : GeoIP sur la socket, en-têtes pays de CDN ignorés", async () => {
    const { geoip, params } = await poster({ "x-vercel-ip-country": "KP", "cf-ipcountry": "KP" });
    expect(geoip.resoudre).toHaveBeenCalledTimes(1);
    expect(params).toContain('"US"');
    expect(params).not.toContain('"KP"');
  });

  it("directe avec un pays de bord forgé : ignoré (GeoIP seul)", async () => {
    const { geoip, params } = await poster({ "x-mip-edge-country": "FR" });
    expect(geoip.resoudre).toHaveBeenCalledTimes(1);
    expect(params).not.toContain('"FR"');
  });

  it("signature fausse : ni GeoIP (adresse d'un relais), ni pays", async () => {
    const { geoip, params } = await poster({ "x-mip-edge-auth": "f".repeat(40), "x-mip-edge-country": "FR" });
    expect(geoip.resoudre).not.toHaveBeenCalled();
    expect(params).not.toContain('"FR"');
    expect(params).not.toContain('"US"');
  });
});
