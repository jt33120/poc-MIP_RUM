// SDK v0.3 — replay (B2) : découpage en chunks, caps, dérivation d'endpoint,
// échantillonnage, résolution de l'URL du bundle (logique pure, sans DOM), et la
// reprise d'un chunk refusé « plus tard » (30/09/2026 : sous la barrière RGPD, le
// collector répond 425 à un chunk arrivé avant l'ancre de sa session ; le transport
// ignorait la réponse et perdait le chunk 0, l'instantané complet de la page).
import { describe, expect, it } from "vitest";
import {
  CHUNK_FLUSH_MS,
  CHUNK_MAX_RAW_BYTES,
  deriveReplayEndpoint,
  isReplaySampled,
  REPLAY_MAX_COMPRESSED_BYTES,
  REPLAY_MAX_MS,
  REPLAY_TENTATIVES,
  ReplayBuffer,
  posterAvecReprise,
  resolveReplayScriptUrl,
} from "../../packages/rum-sdk/src/replay";

describe("constantes des caps replay (contrat ROADMAP B2)", () => {
  it("2 min / 1 Mo gzip / flush 10 s / 256 Ko brut", () => {
    expect(REPLAY_MAX_MS).toBe(120_000);
    expect(REPLAY_MAX_COMPRESSED_BYTES).toBe(1024 * 1024);
    expect(CHUNK_FLUSH_MS).toBe(10_000);
    expect(CHUNK_MAX_RAW_BYTES).toBe(256 * 1024);
  });
});

describe("deriveReplayEndpoint", () => {
  it("remplace /v1/traces par /v1/replay dans l'URL configurée", () => {
    expect(deriveReplayEndpoint("http://localhost:4318/v1/traces")).toBe(
      "http://localhost:4318/v1/replay",
    );
    expect(deriveReplayEndpoint("https://ingest.mip.fr/v1/traces?x=1")).toBe(
      "https://ingest.mip.fr/v1/replay?x=1",
    );
  });
  it("gère le nommage edge function Supabase (…/functions/v1/v1-traces)", () => {
    expect(deriveReplayEndpoint("https://ref.supabase.co/functions/v1/v1-traces")).toBe(
      "https://ref.supabase.co/functions/v1/v1-replay",
    );
  });
  it("la surcharge replayEndpoint gagne toujours", () => {
    expect(
      deriveReplayEndpoint("http://localhost:4318/v1/traces", "http://localhost:4319/v1/replay"),
    ).toBe("http://localhost:4319/v1/replay");
  });
});

describe("isReplaySampled", () => {
  it("false / 0 / undefined -> jamais", () => {
    expect(isReplaySampled(false, 0)).toBe(false);
    expect(isReplaySampled(0, 0)).toBe(false);
    expect(isReplaySampled(undefined, 0)).toBe(false);
  });
  it("true -> toutes les sessions", () => {
    expect(isReplaySampled(true, 0.999)).toBe(true);
  });
  it("number = taux d'échantillonnage 0..1", () => {
    expect(isReplaySampled(0.5, 0.4)).toBe(true);
    expect(isReplaySampled(0.5, 0.6)).toBe(false);
    expect(isReplaySampled(1, 0.999)).toBe(true);
  });
});

describe("resolveReplayScriptUrl (même origine que le script principal)", () => {
  it("résout à côté de mip-rum.js", () => {
    expect(resolveReplayScriptUrl("http://localhost:8080/mip-rum.js")).toBe(
      "http://localhost:8080/mip-rum-replay.js",
    );
    expect(resolveReplayScriptUrl("https://console.mip.fr/assets/mip-rum.js")).toBe(
      "https://console.mip.fr/assets/mip-rum-replay.js",
    );
  });
  it("fallback racine si src inconnu (script inline)", () => {
    expect(resolveReplayScriptUrl(null)).toBe("/mip-rum-replay.js");
  });
});

describe("ReplayBuffer — découpage en chunks", () => {
  it("take() sur buffer vide -> null", () => {
    expect(new ReplayBuffer().take()).toBeNull();
  });

  it("accumule puis vide, seq strictement croissant", () => {
    const buf = new ReplayBuffer();
    buf.add({ type: 4 });
    buf.add({ type: 2 });
    const c0 = buf.take()!;
    expect(c0.seq).toBe(0);
    expect(c0.events).toHaveLength(2);
    expect(buf.take()).toBeNull(); // buffer vidé
    buf.add({ type: 3 });
    expect(buf.take()!.seq).toBe(1); // seq continue
  });

  it("add() signale le flush anticipé au-delà du cap brut (256 Ko par défaut)", () => {
    const buf = new ReplayBuffer(100); // cap brut abaissé pour le test
    expect(buf.add({ d: "x".repeat(45) })).toBe(false); // JSON = 53 o
    expect(buf.add({ d: "x".repeat(45) })).toBe(true); // 106 o >= 100
  });

  it("la taille brute repart de zéro après take()", () => {
    const buf = new ReplayBuffer(100);
    buf.add({ d: "x".repeat(45) });
    buf.add({ d: "x".repeat(45) });
    buf.take();
    expect(buf.add({ d: "x".repeat(45) })).toBe(false); // nouveau chunk, compteur remis
  });
});

describe("ReplayBuffer — cap compressé cumulé (1 Mo)", () => {
  it("stoppe quand le cumul gzip atteint le cap", () => {
    const buf = new ReplayBuffer(CHUNK_MAX_RAW_BYTES, 2048);
    expect(buf.addCompressed(1000)).toBe(false);
    expect(buf.stopped).toBe(false);
    expect(buf.addCompressed(1100)).toBe(true); // 2100 >= 2048
    expect(buf.stopped).toBe(true);
    expect(buf.sentCompressedBytes).toBe(2100);
  });

  it("stoppé : add() n'accumule plus rien", () => {
    const buf = new ReplayBuffer(CHUNK_MAX_RAW_BYTES, 10);
    buf.addCompressed(20); // cap atteint
    expect(buf.add({ type: 3 })).toBe(false);
    expect(buf.pending).toBe(0);
    expect(buf.take()).toBeNull();
  });
});

function reponse(status: number, retryAfter?: string): Response {
  return new Response(null, { status, headers: retryAfter ? { "retry-after": retryAfter } : {} });
}

/** Un envoi scripté : une réponse (ou une panne réseau) par appel. */
function script(...issues: (Response | "reseau")[]) {
  let appels = 0;
  const envoyer = async () => {
    const issue = issues[Math.min(appels++, issues.length - 1)];
    if (issue === "reseau") throw new TypeError("Failed to fetch");
    return issue;
  };
  return { envoyer, appels: () => appels };
}

describe("posterAvecReprise", () => {
  it("reprend un 425 après le délai demandé, et réussit quand l'ancre est arrivée", async () => {
    const attentes: number[] = [];
    const s = script(reponse(425, "5"), reponse(200));
    const ok = await posterAvecReprise(s.envoyer, async (ms) => void attentes.push(ms));
    expect(ok).toBe(true);
    expect(s.appels()).toBe(2);
    expect(attentes).toEqual([5000]);
  });

  it("ne reprend pas un refus définitif (403, 410 session effacée, 413)", async () => {
    for (const statut of [400, 403, 410, 413]) {
      const s = script(reponse(statut));
      expect(await posterAvecReprise(s.envoyer, async () => {})).toBe(false);
      expect(s.appels(), String(statut)).toBe(1);
    }
  });

  it("abandonne après un nombre borné de tentatives", async () => {
    const s = script(reponse(425, "5"));
    expect(await posterAvecReprise(s.envoyer, async () => {})).toBe(false);
    expect(s.appels()).toBe(REPLAY_TENTATIVES);
  });

  it("reprend une panne réseau, sans en-tête, avec un délai croissant et plafonné", async () => {
    const attentes: number[] = [];
    const s = script("reseau", reponse(503), reponse(429, "3600"), reponse(200));
    expect(await posterAvecReprise(s.envoyer, async (ms) => void attentes.push(ms))).toBe(true);
    expect(attentes[0]).toBeLessThan(attentes[1]);
    expect(Math.max(...attentes)).toBeLessThanOrEqual(10_000);
  });
});
