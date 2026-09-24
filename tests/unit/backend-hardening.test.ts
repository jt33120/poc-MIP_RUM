// v0.7 — robustesse backend : logger structuré, retry transitoire, garde-fous
// de charge. Logique pure (aucune base) — exécutée par vitest dans les deux
// runtimes ciblés (les modules _shared sont runtime-agnostic Node/Deno).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../packages/backend/shared/log.mjs";
import { isTransient, withRetry } from "../../packages/backend/shared/retry.mjs";
import { bodyTooLarge, MAX_BODY_BYTES } from "../../packages/backend/shared/limits.mjs";
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";
import {
  corsHeaders,
  isAllowedOrigin,
  originsFromRegistry,
  STATIC_ALLOWED_ORIGINS,
} from "../../packages/backend/shared/cors.mjs";

// --- log.mjs ----------------------------------------------------------------
describe("createLogger — logs structurés JSON", () => {
  let out: string[];
  let err: string[];
  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => void out.push(l));
    vi.spyOn(console, "error").mockImplementation((l: string) => void err.push(l));
  });
  afterEach(() => vi.restoreAllMocks());

  it("émet une ligne JSON avec ts/level/service/msg + champs", () => {
    createLogger("test").info("hello", { app_id: "demo" });
    expect(out).toHaveLength(1);
    const o = JSON.parse(out[0]);
    expect(o).toMatchObject({ level: "info", service: "test", msg: "hello", app_id: "demo" });
    expect(typeof o.ts).toBe("string");
  });

  it("warn/error partent sur stderr (séparation des flux)", () => {
    const log = createLogger("test");
    log.warn("w");
    log.error("e");
    expect(err).toHaveLength(2);
    expect(out).toHaveLength(0);
  });

  it("redacte les secrets (api_key, authorization, token…)", () => {
    createLogger("test").info("auth", { api_key: "s3cr3t", nested: { token: "t", ok: 1 } });
    const o = JSON.parse(out[0]);
    expect(o.api_key).toBe("[redacted]");
    expect(o.nested.token).toBe("[redacted]");
    expect(o.nested.ok).toBe(1);
  });

  it("sérialise sans planter sur une Error ou un cycle", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      createLogger("test").error("boom", { err: new Error("nope"), cyclic }),
    ).not.toThrow();
    const o = JSON.parse(err[0]); // sortie toujours parseable
    expect(o.err.message).toBe("nope");
    expect(JSON.stringify(o)).toContain("[circular]"); // cycle coupé, pas d'inf. loop
  });

  it("child() hérite des champs liés", () => {
    createLogger("test").child({ app_id: "demo" }).info("x", { n: 2 });
    const o = JSON.parse(out[0]);
    expect(o.app_id).toBe("demo");
    expect(o.n).toBe(2);
  });
});

// --- retry.mjs --------------------------------------------------------------
describe("isTransient — classification des erreurs", () => {
  it("vrai pour les codes réseau/SQLSTATE transitoires", () => {
    expect(isTransient({ code: "ECONNRESET" })).toBe(true);
    expect(isTransient({ code: "40001" })).toBe(true); // serialization_failure
    expect(isTransient({ code: "57P03" })).toBe(true); // cannot_connect_now
    expect(isTransient({ cause: { code: "53300" } })).toBe(true); // too_many_connections
  });
  it("faux pour une faute déterministe (contrainte, syntaxe) ou sans code", () => {
    expect(isTransient({ code: "23505" })).toBe(false); // unique_violation
    expect(isTransient(new Error("plain"))).toBe(false);
    expect(isTransient(null)).toBe(false);
  });
});

describe("withRetry — backoff borné", () => {
  it("réussit sans rejouer quand fn passe du premier coup", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn, { baseMs: 1 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rejoue les erreurs transitoires puis réussit", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (++n < 3) throw { code: "ECONNRESET" };
      return "ok";
    });
    const onRetry = vi.fn();
    expect(await withRetry(fn, { baseMs: 1, maxMs: 2, onRetry })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("ne rejoue PAS une faute déterministe (remonte immédiatement)", async () => {
    const fn = vi.fn(async () => {
      throw { code: "23505" };
    });
    await expect(withRetry(fn, { baseMs: 1 })).rejects.toMatchObject({ code: "23505" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("abandonne après `retries` tentatives", async () => {
    const fn = vi.fn(async () => {
      throw { code: "ETIMEDOUT" };
    });
    await expect(withRetry(fn, { retries: 2, baseMs: 1, maxMs: 2 })).rejects.toMatchObject({
      code: "ETIMEDOUT",
    });
    expect(fn).toHaveBeenCalledTimes(3); // 1 essai + 2 retries
  });
});

// --- limits.mjs -------------------------------------------------------------
describe("bodyTooLarge — garde-fou de taille", () => {
  it("rejette au-delà de la limite, accepte en deçà", () => {
    expect(bodyTooLarge(MAX_BODY_BYTES + 1)).toBe(true);
    expect(bodyTooLarge(MAX_BODY_BYTES)).toBe(false);
    expect(bodyTooLarge("100")).toBe(false);
  });
  it("laisse passer un Content-Length absent (garde mémoire en aval)", () => {
    expect(bodyTooLarge(null)).toBe(false);
    expect(bodyTooLarge(undefined)).toBe(false);
  });
});

// --- otlp.mjs : cap anti-charge --------------------------------------------
describe("flattenOtlp — plafond de spans (maxSpans)", () => {
  const mkSpan = (i: number) => ({
    spanId: `s${i}`,
    startTimeUnixNano: "1760000000000000000",
    name: "pageview",
    attributes: [{ key: "mip.session_id", value: { stringValue: "sess-x" } }],
  });
  const payload = (n: number) => ({
    resourceSpans: [
      {
        resource: { attributes: [{ key: "mip.app_id", value: { stringValue: "demo" } }] },
        scopeSpans: [{ spans: Array.from({ length: n }, (_v, i) => mkSpan(i)) }],
      },
    ],
  });

  it("traite jusqu'au plafond et compte le reste en rejected", () => {
    const rows = flattenOtlp(payload(10), { maxSpans: 4 });
    expect(rows.pageviews).toHaveLength(4);
    expect(rows.rejected).toBe(6);
  });

  it("plafond généreux par défaut : un payload normal passe entier", () => {
    const rows = flattenOtlp(payload(50));
    expect(rows.pageviews).toHaveLength(50);
    expect(rows.rejected).toBe(0);
  });
});

// --- cors.mjs : règles partagées edge/dev-server (R6) + ACAO strict (R7) ------
describe("corsHeaders — origine autorisée reflétée, sinon AUCUN ACAO", () => {
  const GIT = "https://plateforme.groupement-it.com";

  it("origine du socle statique -> ACAO = origine", () => {
    expect(corsHeaders(GIT)["Access-Control-Allow-Origin"]).toBe(GIT);
    expect(STATIC_ALLOWED_ORIGINS).toContain(GIT);
  });

  it("origine d'une app active (extra) -> ACAO = origine", () => {
    const extra = originsFromRegistry([
      { active: true, allowed_origins: ["https://client.example.com"] },
      { active: false, allowed_origins: ["https://inactive.example.com"] },
    ]);
    expect(corsHeaders("https://client.example.com", extra)["Access-Control-Allow-Origin"]).toBe(
      "https://client.example.com",
    );
    // l'app inactive n'ouvre PAS son origine
    expect(isAllowedOrigin("https://inactive.example.com", extra)).toBe(false);
  });

  it("origine non autorisée -> PAS d'en-tête ACAO (R7), préflight conservé", () => {
    const h = corsHeaders("https://evil.example.com");
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(h["Access-Control-Allow-Methods"]).toContain("POST");
  });

  it("origine absente (appel serveur-à-serveur) -> pas d'ACAO, sans planter", () => {
    expect(corsHeaders("")["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(isAllowedOrigin("")).toBe(false);
  });

  it("allowHeaders surchargeable (ingestion replay : en-têtes x-mip-*)", () => {
    const h = corsHeaders(GIT, [], { allowHeaders: "content-type,x-mip-session" });
    expect(h["Access-Control-Allow-Headers"]).toBe("content-type,x-mip-session");
    // défaut inchangé pour les autres appelants
    expect(corsHeaders(GIT)["Access-Control-Allow-Headers"]).toBe("content-type");
  });
});
