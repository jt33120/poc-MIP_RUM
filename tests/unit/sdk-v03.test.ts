// SDK v0.3 — replay (B2) : découpage en chunks, caps, dérivation d'endpoint,
// échantillonnage, résolution de l'URL du bundle (logique pure, sans DOM).
import { describe, expect, it } from "vitest";
import {
  CHUNK_FLUSH_MS,
  CHUNK_MAX_RAW_BYTES,
  deriveReplayEndpoint,
  isReplaySampled,
  REPLAY_MAX_COMPRESSED_BYTES,
  REPLAY_MAX_MS,
  ReplayBuffer,
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
