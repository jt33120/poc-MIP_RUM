import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONTEXT_LIMITS,
  EventContextStore,
  sanitizeContext,
} from "../../packages/rum-sdk/src/event-context";
import { serializeSpan } from "../../packages/rum-sdk/src/retry";
import { applyBeforeSend } from "../../packages/rum-sdk/src/index";
// @ts-expect-error module JS partagé sans déclarations
import { hashIdentity, secureOtlpIdentities } from "../../packages/backend/lib/identity-hash.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

const SECRET = "secret";

const attr = (key: string, value: string | number) => ({
  key,
  value: typeof value === "number" ? { doubleValue: value } : { stringValue: value },
});

function payload(app = "app-a") {
  const nowNanos = BigInt(Date.now()) * 1_000_000n;
  return {
    resourceSpans: [{
      resource: { attributes: [attr("mip.app_id", app)] },
      scopeSpans: [{ spans: [{
        name: "rum.action",
        traceId: "a".repeat(32),
        spanId: "1".repeat(16),
        startTimeUnixNano: nowNanos.toString(),
        endTimeUnixNano: (nowNanos + 10_000_000n).toString(),
        attributes: [
          attr("mip.session_id", "session-1"),
          attr("mip.route", "/checkout"),
          attr("mip.event_type", "action"),
          attr("mip.event_name", "checkout"),
          attr("mip.action_id", "11111111-2222-4333-8444-555555555555"),
          attr("mip.identity.user_id", "alice@example.test"),
          attr("mip.identity.account_id", "customer-42"),
          attr("mip.context", JSON.stringify({ plan: "pro", email: "alice@example.test" })),
        ],
      }] }],
    }],
  };
}

describe("contexte navigateur P2", () => {
  it("applique la précédence et fige un snapshot indépendant", () => {
    const store = new EventContextStore();
    store.setGlobal({ shared: "global", global: true });
    store.setUser({ id: "u-1", shared: "user", role: "admin" });
    store.setAccount({ id: "a-1", shared: "account", tier: "gold" });
    store.startView("Checkout", "/checkout", { shared: "view", step: 1 }, 1000);
    const first = store.snapshot({ shared: "action", action: true }, { shared: "local", local: true });
    store.setGlobal({ shared: "changed" });
    const second = store.snapshot();
    expect(first).toMatchObject({ shared: "local", global: true, role: "admin", tier: "gold", step: 1, action: true, local: true });
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.shared).toBe("local");
    expect(second.shared).toBe("view");
  });

  it("borne clefs, chaînes, profondeur, volume et champs réservés", () => {
    const hostile = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key-${i}`, "x".repeat(1000)]));
    const clean = sanitizeContext({ ...hostile, "mip.session_id": "fake", session_id: "fake" });
    expect(Object.keys(clean).length).toBeLessThanOrEqual(CONTEXT_LIMITS.keys);
    expect(JSON.stringify(clean).length).toBeLessThanOrEqual(CONTEXT_LIMITS.bytes);
    expect(clean).not.toHaveProperty("mip.session_id");
    expect(clean).not.toHaveProperty("session_id");
    expect(clean["key-0"]).toBeUndefined();
  });

  it("préserve les clefs locales prioritaires quand le budget total est atteint", () => {
    const store = new EventContextStore();
    store.setGlobal(Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`global-${i}`, i])));
    const snapshot = store.snapshot({}, { important: true });
    expect(snapshot.important).toBe(true);
    expect(Object.keys(snapshot)).toHaveLength(64);
  });

  it("calcule les timings de vue et refuse noms/timestamps/flags invalides", () => {
    const store = new EventContextStore();
    expect(store.timing("ready", 100)).toBeNull();
    expect(store.startView("Checkout", "/checkout", {}, 1000)).toBeTruthy();
    expect(store.timing("ready", 1125)).toBe(125);
    expect(store.timing("ready", 999)).toBeNull();
    expect(store.addFlag("experiment", { variant: "A" })).toBe(false);
    expect(store.addFlag("experiment", "")).toBe(false);
    expect(store.addFlag("experiment", "x".repeat(501))).toBe(false);
    expect(store.addFlag("experiment", "A")).toBe(true);
    expect(store.snapshot()).toMatchObject({ feature_flags: { experiment: "A" } });
  });

  it("conserve une identité valide après une mise à jour invalide et génère des IDs sans Web Crypto", () => {
    const store = new EventContextStore();
    expect(store.setUser("alice")).toBe(true);
    expect(store.setUser({ id: "" })).toBe(false);
    expect(store.envelope().userId).toBe("alice");
    const saved = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    expect(store.startView("legacy-webview", "/legacy")?.id).toMatch(/^[0-9a-f]{32}$/);
    vi.stubGlobal("crypto", saved);
  });

  it("préserve beforeSend(attrs), fournit meta, protège l'enveloppe et permet de pseudonymiser le nom", () => {
    let metaSeen: unknown;
    const attrs = { "mip.session_id": "real", "mip.visitor_id": "visitor", custom: "before" };
    const legacy = applyBeforeSend((input) => ({
      ...input, custom: "after", "mip.session_id": "fake", "mip.visitor_id": "fake",
    }), attrs, { type: "custom", name: "signup" });
    expect(legacy).toEqual({ custom: "after", "mip.session_id": "real", "mip.visitor_id": "visitor" });
    const actionAttrs = { ...attrs, "mip.event_name": "checkout" };
    const modern = applyBeforeSend((input, meta) => {
      metaSeen = meta;
      return input;
    }, actionAttrs, { type: "action", name: "checkout" });
    expect(modern).toEqual(actionAttrs);
    expect(metaSeen).toEqual({ type: "action", name: "checkout" });
    expect(applyBeforeSend((input) => ({
      ...input,
      "mip.event_name": "checkout.submit",
      "mip.session_id": "fake",
    }), { ...attrs, "mip.event_name": "Jean Dupont" }, { type: "action", name: "Jean Dupont" }))
      .toMatchObject({ "mip.event_name": "checkout.submit", "mip.session_id": "real" });
    expect(applyBeforeSend((input) => {
      const next = { ...input };
      delete next["mip.event_name"];
      return next;
    }, { ...attrs, "mip.event_name": "Jean Dupont" }, { type: "action", name: "Jean Dupont" }))
      .toBeNull();
    expect(applyBeforeSend((input) => ({
      ...input,
      "mip.event_name": "x".repeat(101),
    }), { ...attrs, "mip.event_name": "Payer" }, { type: "action", name: "Payer" }))
      .toBeNull();
    expect(applyBeforeSend(() => null, attrs, { type: "custom", name: "drop" })).toBeNull();
  });
});

describe("identité HMAC et ingestion P2", () => {
  it("produit des hashes différents par app et ne garde jamais le brut", () => {
    expect(hashIdentity("secret", "app-a", "user", "alice")).not.toBe(
      hashIdentity("secret", "app-b", "user", "alice"),
    );
    const secured = secureOtlpIdentities(payload(), "secret");
    const serialized = JSON.stringify(secured.payload);
    expect(serialized).not.toContain("customer-42");
    expect(serialized).not.toContain("mip.identity.user_id");
    expect(serialized).toContain("mip.user_id_hash");
    expect(serialized).toContain("mip.account_id_hash");
  });

  it("omet les identités et signale le mode dégradé sans secret", () => {
    const secured = secureOtlpIdentities(payload(), undefined);
    expect(secured.degraded).toBe(true);
    expect(JSON.stringify(secured.payload)).not.toContain("mip.identity.user_id");
    const rows = flattenOtlp(secured.payload);
    expect(rows.events[0].user_id_hash).toBeUndefined();
    expect(rows.events[0].account_id_hash).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain("alice@example.test");
  });

  it("fail-closed sur ressource malformée ou app ambiguë et sécurise aussi les logs", () => {
    const malformed = payload();
    malformed.resourceSpans[0].resource.attributes = {} as never;
    expect(() => secureOtlpIdentities(malformed, SECRET)).not.toThrow();
    expect(JSON.stringify(malformed)).not.toContain("mip.identity.user_id");
    expect(JSON.stringify(flattenOtlp(malformed))).not.toContain("alice@example.test");

    const ambiguous = payload();
    ambiguous.resourceSpans[0].resource.attributes.push(attr("mip.app_id", "app-b"));
    const securedAmbiguous = secureOtlpIdentities(ambiguous, SECRET);
    expect(securedAmbiguous.degraded).toBe(true);
    expect(JSON.stringify(securedAmbiguous.payload)).not.toContain("mip.identity.user_id");
    expect(JSON.stringify(flattenOtlp(securedAmbiguous.payload))).not.toContain("alice@example.test");
    expect(JSON.stringify(securedAmbiguous.payload)).not.toContain("mip.user_id_hash");

    const logPayload = {
      resourceLogs: [{
        resource: { attributes: [attr("mip.app_id", "app-a")] },
        scopeLogs: [{ logRecords: [{ attributes: [attr("mip.identity.user_id", "log-user")] }] }],
      }],
    };
    const securedLogs = secureOtlpIdentities(logPayload, SECRET).payload;
    expect(JSON.stringify(securedLogs)).not.toContain("log-user");
    expect(JSON.stringify(securedLogs)).toContain("mip.user_id_hash");
  });

  it("rejette les incohérences de taxonomie manuelle", () => {
    const invalid = payload();
    const span = invalid.resourceSpans[0].scopeSpans[0].spans[0];
    span.name = "rum.view";
    const rows = flattenOtlp(secureOtlpIdentities(invalid, SECRET).payload);
    expect(rows.events).toEqual([]);
    expect(rows.rejected).toBe(1);
  });

  it("rescrubbe le contexte et persiste les métadonnées typées", () => {
    const rows = flattenOtlp(secureOtlpIdentities(payload(), "secret").payload);
    expect(rows.events[0]).toMatchObject({ name: "checkout", event_type: "action", context: { plan: "pro", email: "[email]" } });
    expect(rows.eventIndex[0]).toMatchObject({ kind: "event", event_type: "action", context: { plan: "pro", email: "[email]" } });
    expect(rows.sessions[0].user_id_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejette côté serveur toutes les clefs techniques réservées, même imbriquées", () => {
    const hostile = payload();
    const reserved = [
      "session_id", "trace_id", "span_id", "app_id", "client_id", "sampling",
      "sample_rate", "error_sample_rate", "route", "view_id", "action_id",
    ];
    const span = hostile.resourceSpans[0].scopeSpans[0].spans[0];
    const context = Object.fromEntries(reserved.map((key) => [key, `forged-${key}`]));
    span.attributes = span.attributes.map((entry) => entry.key === "mip.context"
      ? attr("mip.context", JSON.stringify({ allowed: "kept", nested: { ...context }, ...context }))
      : entry);
    const rows = flattenOtlp(secureOtlpIdentities(hostile, SECRET).payload);
    expect(rows.events[0].context).toEqual({ allowed: "kept", nested: {} });
    expect(rows.eventIndex[0].context).toEqual({ allowed: "kept", nested: {} });
    expect(JSON.stringify(rows)).not.toContain("forged-");
  });

  it("refuse un timing manuel incomplet sans créer d'événement", () => {
    const invalid = payload();
    const span = invalid.resourceSpans[0].scopeSpans[0].spans[0];
    span.name = "rum.timing";
    span.attributes = span.attributes.filter((entry) => entry.key !== "mip.action_id");
    for (const entry of span.attributes) {
      if (entry.key === "mip.event_type") entry.value = { stringValue: "timing" };
    }
    const rows = flattenOtlp(secureOtlpIdentities(invalid, SECRET).payload);
    expect(rows.events).toEqual([]);
    expect(rows.rejected).toBe(1);
  });

  it("exclut les identités brutes de la file navigateur", () => {
    const queued = serializeSpan({
      name: "rum.action",
      attributes: { "mip.identity.user_id": "alice", "mip.context": "{}", ok: true },
      startTime: [1, 0],
      endTime: [2, 0],
    });
    expect(queued.a).not.toHaveProperty("mip.identity.user_id");
    expect(queued.a.ok).toBe(true);
  });
});

describe("DSAR identité", () => {
  it("soumet le brut par Server Action POST et ne le remet ni dans l'URL ni dans l'audit", () => {
    const page = readFileSync("apps/console/app/admin/privacy/page.tsx", "utf8");
    const actions = readFileSync("apps/console/app/admin/privacy/actions.ts", "utf8");
    expect(page).toContain("action={searchIdentityAction}");
    expect(page).toContain('data-testid="dsar-visitor-search-form"');
    expect(page).toContain('method="GET"');
    expect(page).toContain("action={eraseUserAction}");
    expect(actions).toContain("prepareIdentitySearch");
    expect(actions).toContain("request.auditDetail");
    expect(actions).not.toContain("identity=${raw}");
    expect(actions).not.toContain("raw=${raw}");
  });
});
