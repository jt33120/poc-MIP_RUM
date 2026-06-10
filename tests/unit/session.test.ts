// Génération / persistance de session (TTL inactivité 30 min) — stubs DOM minimaux.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubBrowserGlobals() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal("navigator", { userAgent: "TestUA/1.0", language: "fr-FR" });
  vi.stubGlobal("screen", { width: 1920, height: 1080 });
  return store;
}

describe("getOrCreateSession", () => {
  beforeEach(() => {
    stubBrowserGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("session stable dans la fenêtre d'inactivité", async () => {
    const { getOrCreateSession } = await import("../../packages/rum-sdk/src/session");
    const s1 = getOrCreateSession();
    const s2 = getOrCreateSession();
    expect(s2.sessionId).toBe(s1.sessionId);
  });

  it("nouvelle session après 30 min d'inactivité", async () => {
    const { getOrCreateSession } = await import("../../packages/rum-sdk/src/session");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T10:00:00Z"));
    const s1 = getOrCreateSession();
    vi.setSystemTime(new Date("2026-06-10T10:31:00Z"));
    const s2 = getOrCreateSession();
    expect(s2.sessionId).not.toBe(s1.sessionId);
  });

  it("user_hash anonymisé : hex 8 chars, déterministe pour un même device", async () => {
    const { getOrCreateSession } = await import("../../packages/rum-sdk/src/session");
    const s = getOrCreateSession();
    expect(s.userHash).toMatch(/^[0-9a-f]{8}$/);
    expect(getOrCreateSession().userHash).toBe(s.userHash);
  });
});
