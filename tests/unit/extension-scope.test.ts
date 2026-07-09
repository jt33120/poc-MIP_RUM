// Ext-B : logique pure de résolution/décision d'injection de l'extension.
import { describe, expect, it } from "vitest";
import { decideInjection, isFresh, normalizeHost, type ScopeEntry } from "../../apps/extension/lib/scope";

const SCOPE: ScopeEntry = { app_id: "gip-plateforme", endpoint: null, active: true };

describe("normalizeHost", () => {
  it("met en minuscules et retire les espaces", () => {
    expect(normalizeHost(" App.Client.FR ")).toBe("app.client.fr");
  });
  it("gère null/undefined", () => {
    expect(normalizeHost(null)).toBe("");
    expect(normalizeHost(undefined)).toBe("");
  });
});

describe("decideInjection", () => {
  it("domaine non enregistré -> jamais d'injection, quelle que soit la permission", () => {
    const d = decideInjection({ scope: null, hasPermission: true, sdkAlreadyPresent: false });
    expect(d).toEqual({ inject: false, reason: "domain-not-scoped", appId: null, endpoint: null });
  });
  it("domaine désactivé (active=false) -> pas d'injection", () => {
    const d = decideInjection({
      scope: { ...SCOPE, active: false },
      hasPermission: true,
      sdkAlreadyPresent: false,
    });
    expect(d.inject).toBe(false);
    expect(d.reason).toBe("domain-not-scoped");
  });
  it("site déjà instrumenté par son propre SDK -> recule (anti double-comptage)", () => {
    const d = decideInjection({ scope: SCOPE, hasPermission: true, sdkAlreadyPresent: true });
    expect(d).toEqual({
      inject: false,
      reason: "sdk-already-present",
      appId: "gip-plateforme",
      endpoint: null,
    });
  });
  it("domaine scopé mais permission pas encore accordée -> pas d'injection", () => {
    const d = decideInjection({ scope: SCOPE, hasPermission: false, sdkAlreadyPresent: false });
    expect(d.inject).toBe(false);
    expect(d.reason).toBe("permission-required");
  });
  it("domaine scopé + permission + pas de SDK présent -> injection", () => {
    const d = decideInjection({ scope: SCOPE, hasPermission: true, sdkAlreadyPresent: false });
    expect(d).toEqual({ inject: true, reason: "ok", appId: "gip-plateforme", endpoint: null });
  });
  it("appId toujours renvoyé quand scope existe, même en refus (utile au popup Ext-C)", () => {
    const d = decideInjection({ scope: SCOPE, hasPermission: false, sdkAlreadyPresent: false });
    expect(d.appId).toBe("gip-plateforme");
  });
});

describe("isFresh", () => {
  it("undefined -> jamais frais", () => {
    expect(isFresh(undefined, 1000, 500)).toBe(false);
  });
  it("dans le TTL -> frais", () => {
    expect(isFresh({ scope: null, at: 1000 }, 1400, 500)).toBe(true);
  });
  it("hors TTL -> pas frais", () => {
    expect(isFresh({ scope: null, at: 1000 }, 1600, 500)).toBe(false);
  });
});
